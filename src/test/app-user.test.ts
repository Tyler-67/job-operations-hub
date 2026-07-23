import { describe, it, expect } from "vitest";
import { normalizeEmail, pickMembershipRow, resolveAppUser } from "../../supabase/functions/_shared/app-user";

describe("normalizeEmail", () => {
  it("trims + lowercases a valid email", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });
  it("rejects malformed / empty / non-string input", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});

// Minimal stub of the query builder: .from(t).select(c).eq(col,val) is awaitable (list)
// and also exposes .maybeSingle() (single). `pick` decides each response.
type Resp = { data?: unknown; error?: unknown };
function stubClient(pick: (table: string, col: string, val: unknown, single: boolean) => Resp) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(col: string, val: unknown) {
              const listPromise = Promise.resolve(pick(table, col, val, false));
              return {
                maybeSingle: () => Promise.resolve(pick(table, col, val, true)),
                then: (onF: (r: Resp) => unknown, onR?: (e: unknown) => unknown) => listPromise.then(onF, onR),
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const USER = { id: "u1", location_id: "loc1", email: "owner@example.com", name: "Owner", role: "owner_admin", active: true };
const LOC = { id: "loc1", company_name: "Acme Plumbing" };

describe("resolveAppUser", () => {
  it("returns null for an invalid email without querying", async () => {
    let queried = false;
    const sb = stubClient(() => { queried = true; return { data: null }; });
    expect(await resolveAppUser(sb, "bogus")).toBeNull();
    expect(queried).toBe(false);
  });

  it("resolves a primary email first (before consulting aliases)", async () => {
    let aliasQueried = false;
    const sb = stubClient((table, col, _val, single) => {
      if (table === "app_users" && col === "email" && !single) return { data: [{ id: "u1" }] };
      if (table === "app_user_emails") { aliasQueried = true; return { data: null }; }
      if (table === "app_users" && col === "id" && single) return { data: USER };
      if (table === "locations") return { data: LOC };
      return { data: null };
    });
    const resolved = await resolveAppUser(sb, "Owner@Example.com");
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe("u1");
    expect(resolved!.email).toBe("owner@example.com");
    expect(resolved!.role).toBe("owner_admin");
    expect(resolved!.location).toEqual({ id: "loc1", company_name: "Acme Plumbing" });
    expect(aliasQueried).toBe(false); // primary match short-circuits the alias lookup
  });

  it("resolves via a secondary alias only when no primary matches", async () => {
    const sb = stubClient((table, col, _val, single) => {
      if (table === "app_users" && col === "email" && !single) return { data: [] }; // no primary
      if (table === "app_user_emails") return { data: { app_user_id: "u1" } };
      if (table === "app_users" && col === "id" && single) return { data: USER };
      if (table === "locations") return { data: LOC };
      return { data: null };
    });
    const resolved = await resolveAppUser(sb, "alias@example.com");
    expect(resolved!.id).toBe("u1");
  });

  it("returns null when the email is unknown", async () => {
    const sb = stubClient((table, col, _val, single) => {
      if (table === "app_users" && col === "email" && !single) return { data: [] };
      if (table === "app_user_emails") return { data: null };
      return { data: null };
    });
    expect(await resolveAppUser(sb, "nobody@example.com")).toBeNull();
  });

  it("multi-instance email resolves to the most recently seen ACTIVE row (membership model)", async () => {
    const rows = [
      { id: "u-stale", active: true, last_seen_at: "2026-07-01T00:00:00Z", created_at: "2026-06-01T00:00:00Z" },
      { id: "u-fresh", active: true, last_seen_at: "2026-07-20T00:00:00Z", created_at: "2026-06-02T00:00:00Z" },
      { id: "u-dead", active: false, last_seen_at: "2026-07-22T00:00:00Z", created_at: "2026-06-03T00:00:00Z" },
    ];
    const sb = stubClient((table, col, _val, single) => {
      if (table === "app_users" && col === "email" && !single) return { data: rows };
      if (table === "app_users" && col === "id" && single) return { data: { ...USER, id: "u-fresh" } };
      if (table === "locations") return { data: LOC };
      return { data: null };
    });
    const resolved = await resolveAppUser(sb, "multi@example.com");
    expect(resolved!.id).toBe("u-fresh"); // active beats inactive; recency breaks the tie
  });
});

// The membership picker itself (used by resolveAppUser and reasoned about by the instance
// switcher): active first, then most recently seen, then newest row; inactive-only sets
// still return a row so the caller's active check 403s as "inactive", not "not provisioned".
describe("pickMembershipRow", () => {
  it("prefers active rows over a more recently seen inactive row", () => {
    const picked = pickMembershipRow([
      { id: "a", active: false, last_seen_at: "2026-07-22T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", active: true, last_seen_at: "2026-07-01T00:00:00Z", created_at: "2026-01-02T00:00:00Z" },
    ] as { id: string; active: boolean; last_seen_at: string; created_at: string }[]);
    expect(picked!.id).toBe("b");
  });

  it("breaks active ties by last_seen_at, treating never-seen as oldest", () => {
    const picked = pickMembershipRow([
      { id: "never", active: true, last_seen_at: null, created_at: "2026-01-05T00:00:00Z" },
      { id: "seen", active: true, last_seen_at: "2026-07-10T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(picked!.id).toBe("seen");
  });

  it("falls back to newest created_at when nothing else differs", () => {
    const picked = pickMembershipRow([
      { id: "old", active: true, last_seen_at: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "new", active: true, last_seen_at: null, created_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(picked!.id).toBe("new");
  });

  it("returns an inactive row when that's all there is, and null for none", () => {
    expect(pickMembershipRow([{ id: "x", active: false }])!.id).toBe("x");
    expect(pickMembershipRow([])).toBeNull();
  });
});
