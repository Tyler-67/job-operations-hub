import { describe, it, expect } from "vitest";
import { resolveRecipient, enqueueFollowups } from "../../supabase/functions/_shared/decision-followups";
import { resolveDecision } from "../../supabase/functions/_shared/decisions";

const JOB = {
  id: "job-1",
  location_id: "loc-1",
  address: "1220 Juniper Bay Drive",
  current_state_id: "state-dirt-insp",
};

// Mock sb that answers each table the resolver/enqueuer touches. `settings` and
// `crewLead` are the contact ids; `inserts` captures every scheduled_notifications row.
function makeSb(opts: {
  owner?: string | null;
  office?: string | null;
  crewLead?: string | null;
  insertError?: (row: Record<string, unknown>) => { message: string } | null;
}) {
  const inserts: Record<string, unknown>[] = [];
  const sb = {
    from(table: string) {
      if (table === "company_settings") {
        return chain({ owner_contact_id: opts.owner ?? null, office_contact_id: opts.office ?? null });
      }
      if (table === "job_crew") {
        return chain(opts.crewLead === undefined ? null : { contacts: { uptiq_contact_id: opts.crewLead } });
      }
      if (table === "job_customers") {
        return chain(null);
      }
      if (table === "scheduled_notifications") {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            const err = opts.insertError ? opts.insertError(row) : null;
            return Promise.resolve({ error: err });
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
  builder.maybeSingle = () => Promise.resolve({ data });
  return builder;
}

describe("resolveRecipient", () => {
  it("reads owner_contact_id off company_settings for the owner audience", async () => {
    const { sb } = makeSb({ owner: "demo-owner-cj" });
    expect(await resolveRecipient(sb, "owner", JOB)).toBe("demo-owner-cj");
  });

  it("reads office_contact_id for the office audience", async () => {
    const { sb } = makeSb({ office: "demo-office" });
    expect(await resolveRecipient(sb, "office", JOB)).toBe("demo-office");
  });

  it("reads the lead crew's uptiq_contact_id for crew_lead", async () => {
    const { sb } = makeSb({ crewLead: "demo-crew-tyrell" });
    expect(await resolveRecipient(sb, "crew_lead", JOB)).toBe("demo-crew-tyrell");
  });

  it("returns null when the audience has no configured contact", async () => {
    const { sb } = makeSb({ owner: null });
    expect(await resolveRecipient(sb, "owner", JOB)).toBeNull();
  });

  it("treats a blank/whitespace contact id as no recipient", async () => {
    const { sb } = makeSb({ owner: "   " });
    expect(await resolveRecipient(sb, "owner", JOB)).toBeNull();
  });
});

describe("enqueueFollowups for inspection outcomes", () => {
  it("enqueues both owner and crew_lead on inspection_pass", async () => {
    const { sb, inserts } = makeSb({ owner: "demo-owner-cj", crewLead: "demo-crew-tyrell" });
    const count = await enqueueFollowups(sb, resolveDecision("inspection_pass")!, JOB);
    expect(count).toBe(2);
    expect(inserts.map((r) => r.recipient)).toEqual(["demo-owner-cj", "demo-crew-tyrell"]);
    expect(inserts.map((r) => r.dedupe_key)).toEqual([
      "decision_followup:inspection_pass:job-1:owner",
      "decision_followup:inspection_pass:job-1:crew_lead",
    ]);
    expect(inserts.every((r) => r.template_key === "decision_outcome")).toBe(true);
  });

  it("skips the owner when no owner contact is configured, still texting the crew", async () => {
    const { sb, inserts } = makeSb({ owner: null, crewLead: "demo-crew-tyrell" });
    const count = await enqueueFollowups(sb, resolveDecision("inspection_fail")!, JOB);
    expect(count).toBe(1);
    expect(inserts.map((r) => r.recipient)).toEqual(["demo-crew-tyrell"]);
    expect(inserts[0].payload).toMatchObject({ action: "inspection_fail", audience: "crew_lead" });
  });

  it("swallows a duplicate-key insert (replayed tap) without throwing or counting it", async () => {
    const { sb, inserts } = makeSb({
      owner: "demo-owner-cj",
      crewLead: "demo-crew-tyrell",
      insertError: (row) =>
        row.recipient === "demo-owner-cj" ? { message: "duplicate key value violates unique constraint" } : null,
    });
    const count = await enqueueFollowups(sb, resolveDecision("inspection_pass")!, JOB);
    expect(count).toBe(1);
    expect(inserts).toHaveLength(2); // both attempted; only the crew one succeeded
  });
});
