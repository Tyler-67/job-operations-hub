import { describe, it, expect } from "vitest";
import { normalizeEmail, resolveAppUser } from "../../supabase/functions/_shared/app-user";

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

  it("throws ambiguous_account when the same email is the primary of more than one user", async () => {
    const sb = stubClient((table, col, _val, single) => {
      if (table === "app_users" && col === "email" && !single) return { data: [{ id: "u1" }, { id: "u2" }] };
      return { data: null };
    });
    await expect(resolveAppUser(sb, "dupe@example.com")).rejects.toThrow("ambiguous_account");
  });
});
