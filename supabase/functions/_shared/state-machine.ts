/* eslint-disable @typescript-eslint/no-explicit-any */
// Configurable job-state engine. Reads transition rules from job_state_transitions
// (data-driven, not a hardcoded switch) and advances a job's current_state_id.
//
// Split into a pure resolver (resolveTransition) that is unit-testable with plain
// data, and a thin I/O wrapper (applyTransition) that does the guarded DB update.
// No Deno or remote imports here so the resolver can run under vitest.

export type TransitionTrigger =
  | "inspection_requested"
  | "pass"
  | "fail"
  | "progress_100_owner_yes"
  | "walkthrough_approved"
  | "manual";

export interface TransitionRow {
  id: string;
  from_state_id: string;
  to_state_id: string;
  trigger: string;
  conditions?: Record<string, unknown> | null;
}

// A transition's optional `conditions` jsonb must be fully satisfied by the
// runtime context for the transition to apply. Empty/absent conditions always pass.
export function conditionsMet(
  conditions: Record<string, unknown> | null | undefined,
  context: Record<string, unknown>,
): boolean {
  if (!conditions) return true;
  for (const [key, value] of Object.entries(conditions)) {
    if (context[key] !== value) return false;
  }
  return true;
}

// Pure decision: which transition (if any) applies for this from-state + trigger.
// UNIQUE(state_set_id, from_state_id, trigger) guarantees at most one DB row, but
// we still resolve defensively in case conditions narrow multiple candidates.
export function resolveTransition(
  transitions: TransitionRow[],
  fromStateId: string | null | undefined,
  trigger: string,
  context: Record<string, unknown> = {},
): TransitionRow | null {
  if (!fromStateId) return null;
  for (const transition of transitions) {
    if (
      transition.from_state_id === fromStateId &&
      transition.trigger === trigger &&
      conditionsMet(transition.conditions, context)
    ) {
      return transition;
    }
  }
  return null;
}

export type TransitionSkipReason =
  | "job_not_found"
  | "no_matching_transition"
  | "state_changed_concurrently";

export interface ApplyTransitionResult {
  changed: boolean;
  fromStateId: string | null;
  toStateId: string | null;
  trigger: string;
  reason?: TransitionSkipReason;
}

export interface ApplyTransitionOptions {
  locationId: string;
  jobId: string;
  trigger: string;
  context?: Record<string, unknown>;
  actorContactId?: string | null;
  actorAppUserId?: string | null;
  dedupeKey?: string;
  // New phases start fresh; set false to preserve state_progress_pct across a move.
  resetProgressOnChange?: boolean;
}

function isDuplicateKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  return message.toLowerCase().includes("duplicate");
}

// Applies a single state transition with a guarded UPDATE so a replayed trigger
// cannot double-advance: the update only fires while the job is still in the
// expected from-state. The state change itself is one atomic statement.
// deno-lint-ignore no-explicit-any
export async function applyTransition(sb: any, opts: ApplyTransitionOptions): Promise<ApplyTransitionResult> {
  const { data: job, error: jobErr } = await sb
    .from("jobs")
    .select("id, location_id, state_set_id, current_state_id")
    .eq("location_id", opts.locationId)
    .eq("id", opts.jobId)
    .maybeSingle();
  if (jobErr) throw jobErr;
  if (!job) {
    return { changed: false, fromStateId: null, toStateId: null, trigger: opts.trigger, reason: "job_not_found" };
  }

  const { data: transitions, error: tErr } = await sb
    .from("job_state_transitions")
    .select("id, from_state_id, to_state_id, trigger, conditions")
    .eq("state_set_id", job.state_set_id)
    .eq("from_state_id", job.current_state_id);
  if (tErr) throw tErr;

  const match = resolveTransition(transitions ?? [], job.current_state_id, opts.trigger, opts.context ?? {});
  if (!match) {
    return {
      changed: false,
      fromStateId: job.current_state_id,
      toStateId: null,
      trigger: opts.trigger,
      reason: "no_matching_transition",
    };
  }

  const patch: Record<string, unknown> = { current_state_id: match.to_state_id };
  if (opts.resetProgressOnChange !== false) patch.state_progress_pct = 0;

  const { data: updated, error: uErr } = await sb
    .from("jobs")
    .update(patch)
    .eq("id", job.id)
    .eq("location_id", opts.locationId)
    .eq("current_state_id", job.current_state_id)
    .select("id")
    .maybeSingle();
  if (uErr) throw uErr;
  if (!updated) {
    return {
      changed: false,
      fromStateId: job.current_state_id,
      toStateId: match.to_state_id,
      trigger: opts.trigger,
      reason: "state_changed_concurrently",
    };
  }

  const { error: logErr } = await sb.from("event_log").insert({
    location_id: opts.locationId,
    source: "action",
    kind: "job.transition",
    dedupe_key: opts.dedupeKey ?? null,
    actor_contact_id: opts.actorContactId ?? null,
    actor_app_user_id: opts.actorAppUserId ?? null,
    payload: {
      job_id: job.id,
      from_state_id: job.current_state_id,
      to_state_id: match.to_state_id,
      trigger: opts.trigger,
    },
    status: "ok",
  });
  if (logErr && !isDuplicateKeyError(logErr)) throw logErr;

  return {
    changed: true,
    fromStateId: job.current_state_id,
    toStateId: match.to_state_id,
    trigger: opts.trigger,
  };
}
