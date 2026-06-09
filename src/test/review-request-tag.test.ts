import { describe, it, expect } from "vitest";
import {
  maybeEnqueueReviewRequest,
  reviewRequestDedupeKey,
  reviewRequestScheduledFor,
} from "../../supabase/functions/_shared/review-request";

const JOB_ID = "job-1";
const STATE_ID = "state-billing";

// Mock sb answering the four tables maybeEnqueueReviewRequest touches. `isBilling` controls
// the job_states gate; `tag` is the configured review_request_tag; `contact` is the primary
// customer's uptiq_contact_id; `insertError` lets a test simulate a duplicate dedupe_key.
function makeSb(opts: {
  isBilling?: boolean;
  tag?: string | null;
  delayDays?: number | null;
  contact?: string | null;
  insertError?: { message: string } | null;
}) {
  const inserts: Record<string, unknown>[] = [];
  const sb = {
    from(table: string) {
      if (table === "job_states") {
        return chain({ is_billing: opts.isBilling ?? false });
      }
      if (table === "jobs") {
        return chain({ id: JOB_ID, location_id: "loc-1", address: "1220 Juniper Bay Drive" });
      }
      if (table === "company_settings") {
        return chain({
          review_request_tag: opts.tag === undefined ? "review-request" : opts.tag,
          review_request_delay_days: opts.delayDays ?? 4,
        });
      }
      if (table === "job_customers") {
        return chain({ contacts: { uptiq_contact_id: opts.contact ?? null } });
      }
      if (table === "scheduled_notifications") {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return Promise.resolve({ error: opts.insertError ?? null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { sb, inserts };
}

// Minimal Supabase query-builder stub: every filter returns `this`, terminals resolve data.
function chain(data: unknown) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "limit"]) builder[m] = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data, error: null });
  return builder;
}

describe("reviewRequestDedupeKey", () => {
  it("is stable per job", () => {
    expect(reviewRequestDedupeKey("abc")).toBe("review_request:abc");
  });
});

describe("reviewRequestScheduledFor", () => {
  const now = new Date("2026-06-09T00:00:00.000Z");

  it("adds the configured delay in days", () => {
    expect(reviewRequestScheduledFor(now, 4)).toBe("2026-06-13T00:00:00.000Z");
  });

  it("treats zero/negative/non-numeric delays as immediate", () => {
    expect(reviewRequestScheduledFor(now, 0)).toBe("2026-06-09T00:00:00.000Z");
    expect(reviewRequestScheduledFor(now, -3)).toBe("2026-06-09T00:00:00.000Z");
    expect(reviewRequestScheduledFor(now, "nope")).toBe("2026-06-09T00:00:00.000Z");
    expect(reviewRequestScheduledFor(now, null)).toBe("2026-06-09T00:00:00.000Z");
  });
});

describe("maybeEnqueueReviewRequest", () => {
  it("enqueues a delayed tag row for a billing state with tag + customer contact", async () => {
    const { sb, inserts } = makeSb({ isBilling: true, tag: "review-request", contact: "cust-1" });
    const queued = await maybeEnqueueReviewRequest(sb, JOB_ID, STATE_ID);
    expect(queued).toBe(true);
    expect(inserts).toHaveLength(1);
    const row = inserts[0];
    expect(row.channel).toBe("tag");
    expect(row.recipient).toBe("cust-1");
    expect(row.template_key).toBe("review_request_tag");
    expect(row.dedupe_key).toBe("review_request:job-1");
    expect((row.payload as any).tag).toBe("review-request");
    expect((row.payload as any).address).toBe("1220 Juniper Bay Drive");
  });

  it("no-ops for a non-billing destination state", async () => {
    const { sb, inserts } = makeSb({ isBilling: false, tag: "review-request", contact: "cust-1" });
    expect(await maybeEnqueueReviewRequest(sb, JOB_ID, STATE_ID)).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("no-ops when review requests are disabled (tag null/blank)", async () => {
    const { sb, inserts } = makeSb({ isBilling: true, tag: null, contact: "cust-1" });
    expect(await maybeEnqueueReviewRequest(sb, JOB_ID, STATE_ID)).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("no-ops when the job has no primary customer contact", async () => {
    const { sb, inserts } = makeSb({ isBilling: true, tag: "review-request", contact: null });
    expect(await maybeEnqueueReviewRequest(sb, JOB_ID, STATE_ID)).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("swallows a duplicate dedupe_key insert (idempotent re-entry)", async () => {
    const { sb } = makeSb({
      isBilling: true,
      tag: "review-request",
      contact: "cust-1",
      insertError: { message: "duplicate key value violates unique constraint" },
    });
    expect(await maybeEnqueueReviewRequest(sb, JOB_ID, STATE_ID)).toBe(false);
  });
});
