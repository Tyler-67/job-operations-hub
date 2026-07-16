/* eslint-disable @typescript-eslint/no-explicit-any */
// TEMP: push the app's messaging parties (job customers, crew, supply houses, owner, office)
// into Uptiq/GHL as Contacts (deduped by email/phone) and store the returned contact id back
// on each record. This is what makes people "show up in Contacts" and gives SMS/email a
// contactId to target. Admin-gated; supports { dry_run } (plan only, no live calls) and
// { limit } (cap the number upserted — used to verify the token's Contacts write scope with a
// single live call before syncing everything). Provider calls go through _shared/uptiq.ts.
import { json, preflight, serviceClient, verifySession, logEvent } from "../_shared/util.ts";
import { canUseDebugTool } from "../_shared/debug-access.ts";
import { uptiq } from "../_shared/uptiq.ts";

const WRITE_ROLES = new Set(["dev_super", "owner_admin", "support_admin"]);
const READ_ROLES = new Set(["dev_super", "owner_admin", "office_manager", "support_admin"]);

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

interface PulledContact { id: string; name: string | null; email: string | null; phone: string | null; tags: string[] }

// Recognized tag WORD -> app contact role. Matched on whole words (a Uptiq tag is split on
// non-alphanumerics), NOT loose substrings — so "homeowner" doesn't read as owner and "screws"
// doesn't read as crew. Common plurals are listed explicitly; "supply house" splits to
// ["supply","house"] and matches on "supply". Anything unrecognized is skipped (surfaced in the
// dry-run preview) so the import stays intentional, not a dump of every contact.
const ROLE_BY_WORD: Record<string, string> = {
  crew: "crew", crews: "crew",
  supply: "supply_house", supplier: "supply_house", suppliers: "supply_house",
  vendor: "supply_house", vendors: "supply_house", warehouse: "supply_house", distributor: "supply_house",
  owner: "owner", owners: "owner",
  office: "office",
  customer: "customer", customers: "customer", client: "customer", clients: "customer",
};
// Tie-break order when a contact carries tags for more than one role (rare).
const ROLE_PRIORITY = ["crew", "supply_house", "owner", "office", "customer"];

function roleForTags(tags: string[]): string | null {
  const words = tags.flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const hits = new Set(words.map((w) => ROLE_BY_WORD[w]).filter(Boolean));
  for (const role of ROLE_PRIORITY) if (hits.has(role)) return role;
  return null;
}

// Mirror-choice "link supply houses": a supply_house-tagged Uptiq contact is also upserted into
// the supply_house_contacts ordering table (which POs/expenses key off). Dedupe by uptiq id, else
// attach the id to a same-named row (links a hand-entered supply house), else insert a new one.
// Only name/phone/email/uptiq id are known from the pull — address/account_number stay blank.
async function upsertSupplyHouseFromContact(
  sb: any, locId: string, c: PulledContact,
): Promise<{ action: "updated" | "linked" | "imported" | "error"; error?: string }> {
  const { data: byId, error: idErr } = await sb
    .from("supply_house_contacts").select("id").eq("location_id", locId).eq("uptiq_contact_id", c.id).limit(1);
  if (idErr) return { action: "error", error: idErr.message };
  // Updates only overwrite a field when Uptiq actually has a value, so a re-sync never nulls out
  // an email/phone we already hold (a Uptiq contact often carries only one of the two).
  if (byId?.[0]) {
    const patch: Record<string, unknown> = { active: true };
    if (c.name) patch.name = c.name;
    if (c.email) patch.email = c.email;
    if (c.phone) patch.phone = c.phone;
    const { error } = await sb.from("supply_house_contacts").update(patch).eq("id", byId[0].id);
    return error ? { action: "error", error: error.message } : { action: "updated" };
  }
  const nm = (c.name ?? "").trim();
  if (nm) {
    const { data: byName, error: nameErr } = await sb
      .from("supply_house_contacts").select("id").eq("location_id", locId).ilike("name", nm).limit(1);
    if (nameErr) return { action: "error", error: nameErr.message };
    if (byName?.[0]) {
      const patch: Record<string, unknown> = { uptiq_contact_id: c.id, active: true };
      if (c.email) patch.email = c.email;
      if (c.phone) patch.phone = c.phone;
      const { error } = await sb.from("supply_house_contacts").update(patch).eq("id", byName[0].id);
      return error ? { action: "error", error: error.message } : { action: "linked" };
    }
  }
  const { error } = await sb.from("supply_house_contacts").insert({
    location_id: locId, name: c.name ?? c.email ?? "(unnamed supply house)", phone: c.phone, email: c.email, uptiq_contact_id: c.id, active: true,
  });
  return error ? { action: "error", error: error.message } : { action: "imported" };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);
  const role = String(claims.role ?? "");

  const sb = serviceClient();
  const locId = claims.loc as string;

  // GET: read-only list of the location's contacts (customers, crew, owner, office, supply houses)
  // for the Contacts admin page. Broader read gate than the sync POST (which writes app records).
  if (req.method === "GET") {
    if (!READ_ROLES.has(role)) return json({ error: "forbidden" }, 403);
    const { data, error } = await sb
      .from("contacts")
      .select("id, name, role, email, phone, uptiq_contact_id, active, created_at")
      .eq("location_id", locId)
      .order("role", { ascending: true })
      .order("active", { ascending: false })
      .order("name", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    const contacts = data ?? [];
    const roleCounts: Record<string, number> = {};
    for (const c of contacts) { const r = (c.role as string) ?? "other"; roleCounts[r] = (roleCounts[r] ?? 0) + 1; }
    return json({ contacts, role_counts: roleCounts, total: contacts.length });
  }

  // POST (sync/pull) writes app records, so it stays write-role gated.
  if (!WRITE_ROLES.has(role)) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dry_run === true;
  const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.trunc(Number(body.limit))) : null;

  // Manage an app contact directly (no Uptiq round-trip): hard delete, or toggle active.
  // Tenant-scoped by location_id so a caller can never touch another tenant's row.
  if (body.mode === "delete" || body.mode === "set_active") {
    const contactId = typeof body.contact_id === "string" ? body.contact_id : "";
    if (!contactId) return json({ error: "contact_id_required" }, 400);
    const { data: existing, error: findErr } = await sb
      .from("contacts").select("id, name, role").eq("id", contactId).eq("location_id", locId).maybeSingle();
    if (findErr) return json({ error: findErr.message }, 500);
    if (!existing) return json({ error: "not_found" }, 404);

    if (body.mode === "set_active") {
      const active = body.active !== false;
      const { error } = await sb.from("contacts").update({ active }).eq("id", contactId).eq("location_id", locId);
      if (error) return json({ error: error.message }, 500);
      await logEvent({
        source: "admin", kind: "contact_set_active", location_id: locId,
        payload: { contact_id: contactId, name: existing.name, active, by: claims.email },
      });
      return json({ ok: true, contact_id: contactId, active });
    }

    // Hard delete. FK RESTRICT/NO ACTION (daily_logs, event_log, job_expenses, purchase_orders)
    // blocks a contact that has activity history — surface that as a clean 409, not a 500.
    const { error } = await sb.from("contacts").delete().eq("id", contactId).eq("location_id", locId);
    if (error) {
      return json({
        error: "has_history",
        message: "This contact has activity history (check-ins, expenses, or messages) and can't be deleted. Deactivate it instead.",
        detail: error.message,
      }, 409);
    }
    await logEvent({
      source: "admin", kind: "contact_deleted", location_id: locId,
      payload: { contact_id: contactId, name: existing.name, role: existing.role, by: claims.email },
    });
    return json({ ok: true, deleted: contactId });
  }
  // "link" (default): READ existing Uptiq contacts + attach their id (needs Contacts read scope
  // only). "upsert": create/update in Uptiq (needs Contacts write scope — enable later).
  const mode = body.mode === "upsert" ? "upsert" : "link";

  const { data: loc, error: locErr } = await sb
    .from("locations").select("id, uptiq_location_id, company_name").eq("id", locId).maybeSingle();
  if (locErr) return json({ error: locErr.message }, 500);
  if (!loc?.uptiq_location_id) return json({ error: "no_uptiq_location" }, 400);
  const uptiqLoc = String(loc.uptiq_location_id);

  // DEBUG: back up a contact's Uptiq conversation (contact snapshot + messages) then delete the
  // conversation THREAD in Uptiq — the contact is never deleted. dry_run previews (search + counts)
  // without backing up or deleting. Clears a chat so the next message starts a fresh thread.
  // Targets either an app contact (contact_id) or — target: "owner"/"office" — the COMPANY
  // messaging contact from Settings. The company ids are where the app actually sends the
  // owner/office texts and often have NO app-contact row (or app contacts map to a different
  // Uptiq id entirely), so without the target option those threads were uncleatable.
  // DEBUG: list the location's recent Uptiq conversations (threads), straight from Uptiq. This is
  // how the clear tool reaches threads whose Uptiq contact the app doesn't know about — e.g. a
  // previous owner/office messaging contact after Settings switched to a different one.
  if (body.mode === "list_conversations" || body.mode === "delete_conversation") {
    // Conversation tools are DEBUG features gated on the per-user "conversations" grant.
    if (!(await canUseDebugTool(sb, claims, "conversations"))) return json({ error: "forbidden" }, 403);
  }

  if (body.mode === "list_conversations") {
    const search = await uptiq.searchConversations({ locationId: uptiqLoc, limit: 100 });
    if (!search.ok) return json({ error: "search_failed", status: search.status, detail: search.data }, 502);
    const conversations = Array.isArray((search.data as Record<string, unknown>)?.conversations)
      ? (search.data as Record<string, any>).conversations as Record<string, any>[]
      : [];
    const threads = conversations.map((c) => ({
      conversation_id: String(c?.id ?? ""),
      uptiq_contact_id: String(c?.contactId ?? c?.contact_id ?? ""),
      name: (c?.fullName ?? c?.contactName ?? c?.name ?? null) as string | null,
      last_message: typeof c?.lastMessageBody === "string" ? c.lastMessageBody.slice(0, 80) : null,
    })).filter((t) => t.conversation_id && t.uptiq_contact_id);
    return json({ threads, total: threads.length });
  }

  if (body.mode === "delete_conversation") {
    const target = body.target === "owner" || body.target === "office" ? body.target as string : null;
    const rawUptiqId = typeof body.uptiq_contact_id === "string" ? body.uptiq_contact_id.trim() : "";
    const contactId = typeof body.contact_id === "string" ? body.contact_id : "";
    if (!target && !contactId && !rawUptiqId) return json({ error: "contact_id_required" }, 400);

    let contact: Record<string, unknown> | null = null;
    let uptiqContactId = "";
    if (rawUptiqId) {
      // Raw Uptiq contact id (from the thread list above). Safe cross-tenant: the conversation
      // search below runs scoped to THIS session's Uptiq location, so a foreign id finds nothing.
      uptiqContactId = rawUptiqId;
    } else if (target) {
      const { data: cs, error: sErr } = await sb
        .from("company_settings").select("owner_contact_id, office_contact_id")
        .eq("location_id", locId).maybeSingle();
      if (sErr) return json({ error: sErr.message }, 500);
      uptiqContactId = String((target === "owner" ? cs?.owner_contact_id : cs?.office_contact_id) ?? "").trim();
      if (!uptiqContactId) {
        return json({ error: "contact_not_linked", message: `No ${target} messaging contact is configured in Settings.` }, 400);
      }
    } else {
      const { data: row, error: cErr } = await sb
        .from("contacts").select("id, name, role, email, phone, uptiq_contact_id, active, created_at")
        .eq("id", contactId).eq("location_id", locId).maybeSingle();
      if (cErr) return json({ error: cErr.message }, 500);
      if (!row) return json({ error: "not_found" }, 404);
      contact = row;
      uptiqContactId = row.uptiq_contact_id ? String(row.uptiq_contact_id) : "";
      if (!uptiqContactId) return json({ error: "contact_not_linked", message: "This contact has no Uptiq contact id, so it has no Uptiq conversation to clear." }, 400);
    }
    const displayName = contact
      ? (contact.name as string | null)
      : rawUptiqId
        ? ((typeof body.label === "string" && body.label.trim()) || `Uptiq contact …${rawUptiqId.slice(-4)}`)
        : target === "owner" ? "Company owner contact" : "Company office contact";

    const search = await uptiq.searchConversations({ locationId: uptiqLoc, contactId: uptiqContactId });
    if (!search.ok) return json({ error: "search_failed", status: search.status, detail: search.data }, 502);
    const searchData = search.data as Record<string, unknown>;
    const conversations = Array.isArray(searchData?.conversations) ? searchData.conversations as Record<string, unknown>[] : [];
    const convIds = conversations.map((c) => String(c?.id ?? "")).filter(Boolean);

    // Pull ALL of each conversation's messages (paginated) for a complete backup. Safety-capped
    // at 20 pages (~2000 msgs); `capped` flags it so a truncated backup is never silent.
    const convDetails: Array<{ id: string; message_count: number; messages: unknown[]; capped: boolean }> = [];
    let fetchFailed = false;
    for (const id of convIds) {
      const all: unknown[] = [];
      let lastMessageId: string | undefined;
      let pages = 0;
      let capped = false;
      while (true) {
        const msgRes = await uptiq.getConversationMessages(id, { limit: 100, lastMessageId });
        if (!msgRes.ok) { fetchFailed = true; break; }
        const box = ((msgRes.data as Record<string, any>)?.messages ?? {}) as Record<string, any>;
        const arr: unknown[] = Array.isArray(box?.messages) ? box.messages : [];
        all.push(...arr);
        pages++;
        lastMessageId = box?.lastMessageId ? String(box.lastMessageId) : undefined;
        if (box?.nextPage !== true || !lastMessageId || arr.length === 0) break;
        if (pages >= 20) { capped = true; break; }
      }
      convDetails.push({ id, message_count: all.length, messages: all, capped });
    }
    const totalMessages = convDetails.reduce((n, c) => n + c.message_count, 0);
    const anyCapped = convDetails.some((c) => c.capped);
    const contactOut = { id: (contact?.id as string | null) ?? null, name: displayName, uptiq_contact_id: uptiqContactId };

    if (body.dry_run === true) {
      return json({
        mode: "delete_conversation", dry_run: true, contact: contactOut, capped: anyCapped, fetch_failed: fetchFailed,
        conversations: convDetails.map((c) => ({ id: c.id, message_count: c.message_count })),
        total_conversations: convIds.length, total_messages: totalMessages,
      });
    }

    // Backup-before-delete is the whole safety guarantee: if a message fetch failed the backup
    // would be incomplete/empty, so refuse to delete and let the operator retry.
    if (fetchFailed) {
      return json({ error: "message_fetch_failed", message: "Couldn't read all messages from Uptiq, so the backup would be incomplete. Delete aborted — please try again." }, 502);
    }

    // Back up BEFORE deleting so nothing is lost even if a delete fails (e.g. missing scope).
    const { data: backup, error: bErr } = await sb.from("conversation_backups").insert({
      location_id: locId,
      contact_id: (contact?.id as string | null) ?? null,
      uptiq_contact_id: uptiqContactId,
      uptiq_conversation_id: convIds.join(",") || null,
      contact_snapshot: contact ?? { target, name: displayName, uptiq_contact_id: uptiqContactId },
      messages_snapshot: convDetails,
      message_count: totalMessages,
      created_by: claims.email ?? null,
    }).select("id").maybeSingle();
    if (bErr) return json({ error: "backup_failed", detail: bErr.message }, 500);

    const results: Array<{ id: string; deleted: boolean; status?: number; error?: string }> = [];
    let deleted = 0;
    for (const id of convIds) {
      const del = await uptiq.deleteConversation(id);
      if (del.ok) { deleted++; results.push({ id, deleted: true }); }
      else { results.push({ id, deleted: false, status: del.status, error: del.error ?? "delete_failed" }); }
    }
    const allOk = deleted === convIds.length; // vacuously true when there was nothing to delete
    if (backup?.id) await sb.from("conversation_backups").update({ deleted_ok: allOk }).eq("id", backup.id);
    await logEvent({
      source: "admin", kind: "conversation_delete", location_id: locId,
      payload: { contact_id: (contact?.id as string | null) ?? target, uptiq_contact_id: uptiqContactId, conversations: convIds.length, deleted, backup_id: backup?.id, by: claims.email },
    });
    return json({
      mode: "delete_conversation", dry_run: false, contact: contactOut, backup_id: backup?.id,
      total_conversations: convIds.length, total_messages: totalMessages, deleted, results, capped: anyCapped,
    });
  }

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
      // Dedupe against existing CREW rows only (limit(1) — a Uptiq id can be shared by other-role
      // app contacts, e.g. a customer, so maybeSingle across all roles could match multiple/throw
      // and we must not flip a non-crew contact to crew).
      const { data: existingRows, error: exErr } = await sb
        .from("contacts").select("id").eq("location_id", locId).eq("role", "crew").eq("uptiq_contact_id", c.id).limit(1);
      if (exErr) { skipped++; results.push({ id: c.id, name: c.name, action: "error", error: exErr.message }); continue; }
      const existing = existingRows?.[0] ?? null;
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

  // Uptiq -> app PULL (full mirror): import EVERY tagged Uptiq contact into the app `contacts`
  // table under a role derived from its tags (crew/customer/owner/office/supply_house), and ALSO
  // link supply_house-tagged contacts into supply_house_contacts. READ-ONLY to Uptiq, additive
  // (never deletes/deactivates). dry_run previews the tag->role breakdown so the operator can
  // confirm the mapping matches their GHL tags before any write. Contacts with no recognized tag
  // are skipped (surfaced under `unrecognized`).
  if (body.mode === "pull_contacts") {
    const res = await uptiq.listContacts({ locationId: uptiqLoc });
    if (!res.ok) return json({ mode: "pull_contacts", error: res.error ?? "list_failed", status: res.status, detail: res.data }, 502);

    const categorized = res.contacts.map((c) => ({ c, role: roleForTags(c.tags) }));
    const byRole: Record<string, number> = {};
    for (const x of categorized) { const k = x.role ?? "unrecognized"; byRole[k] = (byRole[k] ?? 0) + 1; }
    const importable = categorized.filter((x): x is { c: PulledContact; role: string } => Boolean(x.role && x.c.id));

    if (dryRun) {
      return json({
        location: loc.company_name, mode: "pull_contacts", dry_run: true,
        scanned: res.scanned, capped: res.capped, by_role: byRole, would_import: importable.length,
        preview: importable.slice(0, 50).map((x) => ({ id: x.c.id, name: x.c.name, role: x.role, tags: x.c.tags })),
        unrecognized: categorized.filter((x) => !x.role).slice(0, 25).map((x) => ({ name: x.c.name, email: x.c.email, tags: x.c.tags })),
      });
    }

    const counts = { contacts_imported: 0, contacts_updated: 0, supply_imported: 0, supply_updated: 0, supply_linked: 0, skipped: 0 };
    const errors: any[] = [];
    const applied = limit ? importable.slice(0, limit) : importable;
    for (const { c, role } of applied) {
      // 1) contacts mirror row — dedupe by uptiq_contact_id within the target role (limit(1): a
      // Uptiq id can be shared across roles, so scope the match to the role we're writing).
      const { data: existingRows, error: exErr } = await sb
        .from("contacts").select("id").eq("location_id", locId).eq("role", role).eq("uptiq_contact_id", c.id).limit(1);
      if (exErr) { counts.skipped++; errors.push({ id: c.id, where: "contacts", error: exErr.message }); continue; }
      let existing = existingRows?.[0] ?? null;
      // REPAIR path: no id match, but a same-named row of this role exists → its stored id is
      // stale/wrong (e.g. a loose email/phone link once stamped another contact's id on it).
      // The tag pull is the identity authority from Uptiq, so re-point the row at the real id.
      const patch: Record<string, unknown> = { role, active: true };
      if (!existing && c.name) {
        const { data: byName, error: nameErr } = await sb
          .from("contacts").select("id").eq("location_id", locId).eq("role", role).ilike("name", c.name).limit(1);
        if (nameErr) { counts.skipped++; errors.push({ id: c.id, where: "contacts", error: nameErr.message }); continue; }
        if (byName?.[0]) {
          existing = byName[0];
          patch.uptiq_contact_id = c.id;
        }
      }
      // Update only overwrites email/phone when Uptiq has a value (don't null out data we hold).
      if (c.name) patch.name = c.name;
      if (c.email) patch.email = c.email;
      if (c.phone) patch.phone = c.phone;
      if (existing) {
        const { error } = await sb.from("contacts").update(patch).eq("id", existing.id);
        if (error) { counts.skipped++; errors.push({ id: c.id, where: "contacts", error: error.message }); continue; }
        counts.contacts_updated++;
      } else {
        const { error } = await sb.from("contacts").insert({
          location_id: locId, uptiq_contact_id: c.id,
          name: c.name ?? c.email ?? `(unnamed ${role})`, email: c.email, phone: c.phone, role, active: true,
        });
        if (error) { counts.skipped++; errors.push({ id: c.id, where: "contacts", error: error.message }); continue; }
        counts.contacts_imported++;
      }

      // 2) supply houses also link into the ordering table (Mirror + link supply houses).
      if (role === "supply_house") {
        const r = await upsertSupplyHouseFromContact(sb, locId, c);
        if (r.action === "error") errors.push({ id: c.id, where: "supply_house", error: r.error });
        else if (r.action === "updated") counts.supply_updated++;
        else if (r.action === "linked") counts.supply_linked++;
        else counts.supply_imported++;
      }
    }

    await logEvent({
      source: "admin", kind: "contacts_pull_contacts", location_id: locId,
      payload: { ...counts, scanned: res.scanned, by_role: byRole, by: claims.email },
    });
    return json({
      location: loc.company_name, mode: "pull_contacts", dry_run: false,
      scanned: res.scanned, capped: res.capped, by_role: byRole, ...counts, errors: errors.slice(0, 20),
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
      // Already linked → leave it alone. Personas/test setups often share an email or phone, so
      // a loose re-match here once stamped ONE Uptiq contact's id across several parties (owner,
      // office, and a crew member all became "tyler testesto"). The tag pull is the authority
      // for id repairs; link only fills in the blanks.
      if (t.existingId) {
        results.push({ key: t.key, ok: true, contact_id: t.existingId, action: "already_linked" });
        continue;
      }
      // READ ONLY: find an existing Uptiq contact and attach its id. Prefer an exact NAME match
      // (distinguishes persona contacts sharing an email/phone), then exact email, then first hit.
      const query = (t.email || t.phone || "").trim();
      if (!query) { failed++; results.push({ key: t.key, ok: false, error: "no_query" }); continue; }
      const res = await uptiq.findContacts({ locationId: uptiqLoc, query });
      if (!res.ok) {
        failed++;
        results.push({ key: t.key, ok: false, status: res.status, error: res.error ?? "find_failed", detail: res.data });
        continue;
      }
      const found = ((res.data as any)?.contacts ?? []) as any[];
      const nameOf = (c: any) => String(c?.contactName ?? c?.fullName ?? c?.name ?? "").trim().toLowerCase();
      const wanted = String(t.name ?? "").trim().toLowerCase();
      const match = (wanted ? found.find((c) => nameOf(c) === wanted) : null)
        ?? found.find((c) => t.email && String(c.email ?? "").toLowerCase() === String(t.email).toLowerCase())
        ?? found[0] ?? null;
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
