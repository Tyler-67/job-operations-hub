/* eslint-disable @typescript-eslint/no-explicit-any */
// TEMP: push the app's messaging parties (job customers, crew, supply houses, owner, office)
// into Uptiq/GHL as Contacts (deduped by email/phone) and store the returned contact id back
// on each record. This is what makes people "show up in Contacts" and gives SMS/email a
// contactId to target. Admin-gated; supports { dry_run } (plan only, no live calls) and
// { limit } (cap the number upserted — used to verify the token's Contacts write scope with a
// single live call before syncing everything). Provider calls go through _shared/uptiq.ts.
import { json, preflight, serviceClient, verifySession, logEvent } from "../_shared/util.ts";
import { uptiq } from "../_shared/uptiq.ts";

const WRITE_ROLES = new Set(["owner_admin", "support_admin"]);

function reachable(email: unknown, phone: unknown) {
  return Boolean((typeof email === "string" && email.trim()) || (typeof phone === "string" && phone.trim()));
}

interface Target {
  key: string;                 // stable label for the report
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  existingId: string | null;
  save: (sb: any, contactId: string) => Promise<void>;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);
  if (!WRITE_ROLES.has(String(claims.role ?? ""))) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dry_run === true;
  const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.trunc(Number(body.limit))) : null;
  // "link" (default): READ existing Uptiq contacts + attach their id (needs Contacts read scope
  // only). "upsert": create/update in Uptiq (needs Contacts write scope — enable later).
  const mode = body.mode === "upsert" ? "upsert" : "link";

  const sb = serviceClient();
  const locId = claims.loc as string;

  const { data: loc, error: locErr } = await sb
    .from("locations").select("id, uptiq_location_id, company_name").eq("id", locId).maybeSingle();
  if (locErr) return json({ error: locErr.message }, 500);
  if (!loc?.uptiq_location_id) return json({ error: "no_uptiq_location" }, 400);
  const uptiqLoc = String(loc.uptiq_location_id);

  // Uptiq -> app PULL: import every Uptiq contact carrying a tag (default "crew") as an app crew
  // contact. READ-ONLY to Uptiq. Deduped by uptiq_contact_id and additive (never deletes/deactivates
  // existing app contacts). dry_run previews the matched contacts without touching the app.
  if (body.mode === "pull_crew" || body.mode === "pull_tag") {
    const tag = (typeof body.tag === "string" && body.tag.trim()) ? body.tag.trim() : "crew";
    const res = await uptiq.listContactsByTag({ locationId: uptiqLoc, tag });
    if (!res.ok) return json({ mode: "pull_crew", tag, error: res.error ?? "list_failed", status: res.status, detail: res.data }, 502);
    const found = limit ? res.matched.slice(0, limit) : res.matched;

    if (dryRun) {
      return json({
        location: loc.company_name, mode: "pull_crew", tag, dry_run: true,
        scanned: res.scanned, capped: res.capped, found: res.matched.length,
        contacts: found.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone })),
      });
    }

    let imported = 0, updated = 0, skipped = 0;
    const results: any[] = [];
    for (const c of found) {
      if (!c.id) { skipped++; continue; }
      const { data: existing, error: exErr } = await sb
        .from("contacts").select("id").eq("location_id", locId).eq("uptiq_contact_id", c.id).maybeSingle();
      if (exErr) { skipped++; results.push({ id: c.id, name: c.name, action: "error", error: exErr.message }); continue; }
      const patch: Record<string, unknown> = { email: c.email, phone: c.phone, role: "crew", active: true };
      if (c.name) patch.name = c.name;
      if (existing) {
        const { error } = await sb.from("contacts").update(patch).eq("id", existing.id);
        if (error) { skipped++; results.push({ id: c.id, name: c.name, action: "error", error: error.message }); continue; }
        updated++; results.push({ id: c.id, name: c.name, action: "updated" });
      } else {
        const { error } = await sb.from("contacts").insert({
          location_id: locId, uptiq_contact_id: c.id,
          name: c.name ?? c.email ?? "(unnamed crew)", email: c.email, phone: c.phone, role: "crew", active: true,
        });
        if (error) { skipped++; results.push({ id: c.id, name: c.name, action: "error", error: error.message }); continue; }
        imported++; results.push({ id: c.id, name: c.name, action: "imported" });
      }
    }

    await logEvent({
      source: "admin", kind: "contacts_pull_crew", location_id: locId,
      payload: { tag, found: res.matched.length, imported, updated, skipped, by: claims.email },
    });
    return json({
      location: loc.company_name, mode: "pull_crew", tag, dry_run: false,
      scanned: res.scanned, capped: res.capped, found: res.matched.length,
      imported, updated, skipped, results,
    });
  }

  const targets: Target[] = [];

  // 1) contacts table (customers, crew, ...)
  const { data: contactRows, error: cErr } = await sb
    .from("contacts").select("id, name, email, phone, role, uptiq_contact_id").eq("location_id", locId).eq("active", true);
  if (cErr) return json({ error: cErr.message }, 500);
  for (const row of contactRows ?? []) {
    if (!reachable(row.email, row.phone)) continue;
    targets.push({
      key: `contact:${row.role}:${row.name ?? row.id}`,
      name: row.name, email: row.email, phone: row.phone,
      tags: ["daily-burn", String(row.role ?? "contact")],
      existingId: row.uptiq_contact_id ?? null,
      save: (c, id) => c.from("contacts").update({ uptiq_contact_id: id }).eq("id", row.id).then(() => undefined),
    });
  }

  // 2) supply houses
  const { data: shRows, error: sErr } = await sb
    .from("supply_house_contacts").select("id, name, rep_name, email, phone, uptiq_contact_id").eq("location_id", locId).eq("active", true);
  if (sErr) return json({ error: sErr.message }, 500);
  for (const row of shRows ?? []) {
    if (!reachable(row.email, row.phone)) continue;
    targets.push({
      key: `supply_house:${row.name ?? row.id}`,
      name: row.name ?? row.rep_name, email: row.email, phone: row.phone,
      tags: ["daily-burn", "supply_house"],
      existingId: row.uptiq_contact_id ?? null,
      save: (c, id) => c.from("supply_house_contacts").update({ uptiq_contact_id: id }).eq("id", row.id).then(() => undefined),
    });
  }

  // 3) owner + office (company_settings)
  const { data: cs, error: csErr } = await sb
    .from("company_settings")
    .select("owner_name, owner_email, owner_phone, owner_contact_id, office_email, office_phone, office_contact_id")
    .eq("location_id", locId).maybeSingle();
  if (csErr) return json({ error: csErr.message }, 500);
  if (cs) {
    if (reachable(cs.owner_email, cs.owner_phone)) {
      targets.push({
        key: "owner", name: cs.owner_name ?? "Owner", email: cs.owner_email, phone: cs.owner_phone,
        tags: ["daily-burn", "owner"], existingId: cs.owner_contact_id ?? null,
        save: (c, id) => c.from("company_settings").update({ owner_contact_id: id }).eq("location_id", locId).then(() => undefined),
      });
    }
    if (reachable(cs.office_email, cs.office_phone)) {
      targets.push({
        key: "office", name: "Office", email: cs.office_email, phone: cs.office_phone,
        tags: ["daily-burn", "office"], existingId: cs.office_contact_id ?? null,
        save: (c, id) => c.from("company_settings").update({ office_contact_id: id }).eq("location_id", locId).then(() => undefined),
      });
    }
  }

  const planned = limit ? targets.slice(0, limit) : targets;

  if (dryRun) {
    return json({
      location: loc.company_name, uptiq_location_id: uptiqLoc, mode, dry_run: true,
      would_sync: planned.length, total_reachable: targets.length,
      parties: planned.map((t) => ({ key: t.key, name: t.name, email: t.email, phone: t.phone, has_existing_id: Boolean(t.existingId) })),
    });
  }

  const results: any[] = [];
  let linked = 0, notFound = 0, created = 0, updated = 0, failed = 0;
  for (const t of planned) {
    if (mode === "link") {
      // READ ONLY: find an existing Uptiq contact by email (preferred) or phone and attach its id.
      const query = (t.email || t.phone || "").trim();
      if (!query) { failed++; results.push({ key: t.key, ok: false, error: "no_query" }); continue; }
      const res = await uptiq.findContacts({ locationId: uptiqLoc, query });
      if (!res.ok) {
        failed++;
        results.push({ key: t.key, ok: false, status: res.status, error: res.error ?? "find_failed", detail: res.data });
        continue;
      }
      const found = ((res.data as any)?.contacts ?? []) as any[];
      const match = found.find((c) => t.email && String(c.email ?? "").toLowerCase() === String(t.email).toLowerCase()) ?? found[0] ?? null;
      if (match?.id) {
        await t.save(sb, String(match.id));
        linked++;
        results.push({ key: t.key, ok: true, contact_id: match.id, action: "linked" });
      } else {
        notFound++;
        results.push({ key: t.key, ok: false, action: "not_in_uptiq", error: "not_found" });
      }
      continue;
    }

    // upsert mode — needs Contacts WRITE scope (currently disabled by token scope)
    const res = await uptiq.upsertContact({ locationId: uptiqLoc, name: t.name, email: t.email, phone: t.phone, tags: t.tags });
    if (!res.ok) {
      failed++;
      results.push({ key: t.key, ok: false, status: res.status, error: res.error ?? "upsert_failed", detail: res.data });
      continue;
    }
    const d = res.data as any;
    const contactId = d?.contact?.id ?? d?.id ?? null;
    if (!contactId) { failed++; results.push({ key: t.key, ok: false, error: "no_contact_id_in_response", detail: d }); continue; }
    await t.save(sb, String(contactId));
    if (d?.new === true) created++; else updated++;
    results.push({ key: t.key, ok: true, contact_id: contactId, action: d?.new ? "created" : "updated" });
  }

  await logEvent({
    source: "admin", kind: "contacts_sync", location_id: locId,
    payload: { mode, total: planned.length, linked, not_found: notFound, created, updated, failed, by: claims.email },
  });

  return json({
    location: loc.company_name, uptiq_location_id: uptiqLoc, mode, dry_run: false,
    total_reachable: targets.length, attempted: planned.length,
    linked, not_found: notFound, created, updated, failed, results,
  });
});
