/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";

const ADMIN_ROLES = new Set(["dev_super", "owner_admin", "office_manager", "support_admin"]);

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function boolValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function slugFromLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isValidSlug(value: string) {
  return /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value);
}

function canWrite(role: unknown) {
  return ADMIN_ROLES.has(String(role ?? ""));
}

async function defaultStateSet(sb: any, locationId: string) {
  const { data, error } = await sb
    .from("job_state_sets")
    .select("id, name, location_id, is_default, created_at")
    .eq("location_id", locationId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function loadState(sb: any, stateSetId: string, stateId: string | null) {
  if (!stateId) return null;
  const { data, error } = await sb
    .from("job_states")
    .select("*")
    .eq("state_set_id", stateSetId)
    .eq("id", stateId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function activeJobCount(sb: any, stateId: string) {
  const { count, error } = await sb
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("current_state_id", stateId)
    .eq("active", true);
  if (error) throw error;
  return count ?? 0;
}

async function transitionCount(sb: any, stateId: string) {
  const { count, error } = await sb
    .from("job_state_transitions")
    .select("id", { count: "exact", head: true })
    .or(`from_state_id.eq.${stateId},to_state_id.eq.${stateId}`);
  if (error) throw error;
  return count ?? 0;
}

async function statePayload(sb: any, locationId: string, includeInactive = true) {
  const stateSet = await defaultStateSet(sb, locationId);
  if (!stateSet) return { state_set: null, states: [], transitions: [], active_job_counts: {} };

  let statesQuery = sb
    .from("job_states")
    .select("*")
    .eq("state_set_id", stateSet.id)
    .order("sort_order")
    .order("label");
  if (!includeInactive) statesQuery = statesQuery.eq("active", true);

  const [{ data: states, error: statesErr }, { data: transitions, error: transErr }, { data: counts, error: countErr }] =
    await Promise.all([
      statesQuery,
      sb.from("job_state_transitions").select("*").eq("state_set_id", stateSet.id).order("trigger"),
      sb.from("jobs").select("current_state_id").eq("location_id", locationId).eq("active", true),
    ]);
  if (statesErr) throw statesErr;
  if (transErr) throw transErr;
  if (countErr) throw countErr;

  const activeJobCounts: Record<string, number> = {};
  for (const row of counts ?? []) {
    if (!row.current_state_id) continue;
    activeJobCounts[row.current_state_id] = (activeJobCounts[row.current_state_id] ?? 0) + 1;
  }

  return {
    state_set: stateSet,
    states: states ?? [],
    transitions: transitions ?? [],
    active_job_counts: activeJobCounts,
  };
}

function statePatch(body: Record<string, unknown>, existing?: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if ("label" in body) {
    const label = cleanText(body.label);
    if (!label) throw new Error("label_required");
    patch.label = label;
  }
  if ("sort_order" in body) patch.sort_order = Math.trunc(numberValue(body.sort_order, Number(existing?.sort_order ?? 0)));
  if ("color" in body) {
    const color = cleanText(body.color) ?? "#64748b";
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("invalid_color");
    patch.color = color;
  }
  for (const key of ["is_terminal", "is_inspection", "is_walkthrough", "is_billing", "allow_check_ins", "active"]) {
    if (key in body) patch[key] = boolValue(body[key], Boolean(existing?.[key]));
  }
  return patch;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);

  const locationId = claims.loc as string;
  const sb = serviceClient();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const includeInactive = url.searchParams.get("include_inactive") !== "false";
      return json(await statePayload(sb, locationId, includeInactive));
    }

    if (!canWrite(claims.role)) return json({ error: "forbidden" }, 403);

    const stateSet = await defaultStateSet(sb, locationId);
    if (!stateSet) return json({ error: "missing_state_set" }, 400);
    const body = await req.json().catch(() => ({}));

    if (req.method === "POST") {
      if (body.action === "transition") {
        const fromState = await loadState(sb, stateSet.id, cleanText(body.from_state_id));
        const toState = await loadState(sb, stateSet.id, cleanText(body.to_state_id));
        const trigger = cleanText(body.trigger);
        if (!fromState || !toState) return json({ error: "invalid_state" }, 400);
        if (!trigger) return json({ error: "trigger_required" }, 400);

        const { error } = await sb.from("job_state_transitions").insert({
          state_set_id: stateSet.id,
          from_state_id: fromState.id,
          to_state_id: toState.id,
          trigger,
          conditions: body.conditions && typeof body.conditions === "object" ? body.conditions : {},
        });
        if (error) throw error;
        return json(await statePayload(sb, locationId), 201);
      }

      const label = cleanText(body.label);
      if (!label) return json({ error: "label_required" }, 400);
      const slug = cleanText(body.slug) ?? slugFromLabel(label);
      if (!slug || !isValidSlug(slug)) return json({ error: "invalid_slug" }, 400);

      const patch = statePatch(body);
      const { error } = await sb.from("job_states").insert({
        state_set_id: stateSet.id,
        slug,
        label,
        sort_order: patch.sort_order ?? 0,
        color: patch.color ?? "#64748b",
        is_terminal: patch.is_terminal ?? false,
        is_inspection: patch.is_inspection ?? false,
        is_walkthrough: patch.is_walkthrough ?? false,
        is_billing: patch.is_billing ?? false,
        allow_check_ins: patch.allow_check_ins ?? true,
        active: patch.active ?? true,
      });
      if (error) throw error;
      return json(await statePayload(sb, locationId), 201);
    }

    if (req.method === "PATCH") {
      if (body.action === "reorder") {
        const items = Array.isArray(body.items) ? body.items : [];
        for (const item of items) {
          const state = await loadState(sb, stateSet.id, cleanText(item?.id));
          if (!state) return json({ error: "invalid_state" }, 400);
        }
        for (const item of items) {
          const { error } = await sb
            .from("job_states")
            .update({ sort_order: Math.trunc(numberValue(item.sort_order)) })
            .eq("id", item.id)
            .eq("state_set_id", stateSet.id);
          if (error) throw error;
        }
        return json(await statePayload(sb, locationId));
      }

      if (body.action === "archive") {
        const state = await loadState(sb, stateSet.id, cleanText(body.id));
        if (!state) return json({ error: "not_found" }, 404);

        const count = await activeJobCount(sb, state.id);
        const reassignTo = await loadState(sb, stateSet.id, cleanText(body.reassign_state_id));
        if (count > 0 && (!reassignTo || reassignTo.id === state.id || !reassignTo.active)) {
          return json({ error: "reassign_required", active_job_count: count }, 409);
        }
        if (count > 0) {
          const { error } = await sb
            .from("jobs")
            .update({ current_state_id: reassignTo.id })
            .eq("location_id", locationId)
            .eq("current_state_id", state.id)
            .eq("active", true);
          if (error) throw error;
        }
        const { error: fromDeleteErr } = await sb
          .from("job_state_transitions")
          .delete()
          .eq("state_set_id", stateSet.id)
          .eq("from_state_id", state.id);
        if (fromDeleteErr) throw fromDeleteErr;
        const { error: toDeleteErr } = await sb
          .from("job_state_transitions")
          .delete()
          .eq("state_set_id", stateSet.id)
          .eq("to_state_id", state.id);
        if (toDeleteErr) throw toDeleteErr;
        const { error } = await sb
          .from("job_states")
          .update({ active: false, allow_check_ins: false })
          .eq("id", state.id)
          .eq("state_set_id", stateSet.id);
        if (error) throw error;
        return json(await statePayload(sb, locationId));
      }

      if (body.action === "delete_transition") {
        const id = cleanText(body.id);
        if (!id) return json({ error: "id_required" }, 400);
        const { error } = await sb.from("job_state_transitions").delete().eq("id", id).eq("state_set_id", stateSet.id);
        if (error) throw error;
        return json(await statePayload(sb, locationId));
      }

      const state = await loadState(sb, stateSet.id, cleanText(body.id));
      if (!state) return json({ error: "not_found" }, 404);

      if ("slug" in body && cleanText(body.slug) && cleanText(body.slug) !== state.slug) {
        const count = await activeJobCount(sb, state.id);
        const transCount = await transitionCount(sb, state.id);
        if (count > 0 || transCount > 0) return json({ error: "slug_locked" }, 409);
        const slug = cleanText(body.slug)!;
        if (!isValidSlug(slug)) return json({ error: "invalid_slug" }, 400);
        body.slug = slug;
      } else {
        delete body.slug;
      }

      const patch = statePatch(body, state);
      if ("slug" in body) patch.slug = body.slug;
      if (Object.keys(patch).length) {
        const { error } = await sb.from("job_states").update(patch).eq("id", state.id).eq("state_set_id", stateSet.id);
        if (error) throw error;
      }
      return json(await statePayload(sb, locationId));
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = ["label_required", "invalid_color", "invalid_slug"].includes(message) ? 400 : 500;
    return json({ error: message }, status);
  }
});
