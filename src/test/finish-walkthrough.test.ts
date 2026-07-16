import { describe, it, expect } from "vitest";
import {
  shouldAskFinishWalkthrough,
  enqueueFinishWalkthroughAsk,
} from "../../supabase/functions/_shared/finish-walkthrough";

const JOB = {
  id: "job-1",
  location_id: "loc-1",
  state_set_id: "set-1",
  current_state_id: "state-work",
  address: "1220 Juniper Bay Drive",
};

// Mock sb answering the three tables the enqueuer touches. `hasTransition` decides whether
// job_state_transitions returns a matching progress_100_owner_yes row; `owner` is the
// configured owner contact; `inserts` captures every scheduled_notifications row.
function makeSb(opts: { hasTransition?: boolean; owner?: string | null }) {
  const inserts: Record<string, unknown>[] = [];
  const mintedTokens: Record<string, unknown>[] = [];
  const sb = {
    from(table: string) {
      if (table === "job_state_transitions") {
        return chain(opts.hasTransition ? { id: "trans-1" } : null);
      }
      if (table === "company_settings") {
        return chain({ owner_contact_id: opts.owner ?? null });
      }
      if (table === "scheduled_notifications") {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "action_tokens") {
        return {
          insert(row: Record<string, unknown>) {
            mintedTokens.push(row);
            return {
              select: () => ({ single: () => Promise.resolve({ data: { id: `tok-${mintedTokens.length}` }, error: null }) }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { sb, inserts, mintedTokens };
}

// Minimal Supabase query-builder stub: every filter returns `this`, terminals resolve data.
function chain(data: unknown) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "limit"]) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data, error: null });
  return builder;
}

describe("shouldAskFinishWalkthrough", () => {
  it("asks only when progress is 100 and the state offers the finish transition", () => {
    expect(shouldAskFinishWalkthrough(100, true)).toBe(true);
    expect(shouldAskFinishWalkthrough(100, false)).toBe(false);
    expect(shouldAskFinishWalkthrough(80, true)).toBe(false);
    expect(shouldAskFinishWalkthrough(null, true)).toBe(false);
  });
});

describe("enqueueFinishWalkthroughAsk", () => {
  const opts = { appBaseUrl: "https://app.example.com", cycleKey: "tok-submission-1" };

  it("mints YES/NO tokens and enqueues the owner ask when fully gated", async () => {
    const { sb, inserts, mintedTokens } = makeSb({ hasTransition: true, owner: "demo-owner-cj" });
    const asked = await enqueueFinishWalkthroughAsk(sb, JOB, 100, opts);
    expect(asked).toBe(true);
    expect(mintedTokens.map((t) => t.action)).toEqual(["finish_walkthrough_yes", "finish_walkthrough_no"]);
    expect(inserts).toHaveLength(1);
    const row = inserts[0];
    expect(row.recipient).toBe("demo-owner-cj");
    expect(row.template_key).toBe("finish_walkthrough_ask");
    expect(row.dedupe_key).toBe("notif:finish_wt:job-1:tok-submission-1");
    expect(String((row.payload as any).yes_link)).toContain("https://app.example.com/action/decision?token=");
    expect(String((row.payload as any).no_link)).toContain("https://app.example.com/action/decision?token=");
  });

  it("no-ops when progress is below 100", async () => {
    const { sb, inserts, mintedTokens } = makeSb({ hasTransition: true, owner: "demo-owner-cj" });
    expect(await enqueueFinishWalkthroughAsk(sb, JOB, 80, opts)).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(mintedTokens).toHaveLength(0);
  });

  it("no-ops without an appBaseUrl (no link to build)", async () => {
    const { sb, inserts } = makeSb({ hasTransition: true, owner: "demo-owner-cj" });
    expect(await enqueueFinishWalkthroughAsk(sb, JOB, 100, { cycleKey: "tok-submission-1" })).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("no-ops when the state offers no finish transition (inspection/terminal states)", async () => {
    const { sb, inserts, mintedTokens } = makeSb({ hasTransition: false, owner: "demo-owner-cj" });
    expect(await enqueueFinishWalkthroughAsk(sb, JOB, 100, opts)).toBe(false);
    expect(inserts).toHaveLength(0);
    expect(mintedTokens).toHaveLength(0);
  });

  it("no-ops when no owner contact is configured", async () => {
    const { sb, inserts } = makeSb({ hasTransition: true, owner: null });
    expect(await enqueueFinishWalkthroughAsk(sb, JOB, 100, opts)).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("no-ops when the job has no current state", async () => {
    const { sb, inserts } = makeSb({ hasTransition: true, owner: "demo-owner-cj" });
    const asked = await enqueueFinishWalkthroughAsk(sb, { ...JOB, current_state_id: null }, 100, opts);
    expect(asked).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});
