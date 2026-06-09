import { describe, it, expect } from "vitest";
import {
  buildActionLink,
  generateActionToken,
  hashActionToken,
  mintActionToken,
  sha256Hex,
} from "../../supabase/functions/_shared/action-tokens";

const SECRET = "test-secret";

describe("generateActionToken", () => {
  it("returns 64 hex chars (32 random bytes)", () => {
    const token = generateActionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not repeat across calls", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateActionToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("hashActionToken", () => {
  it("is deterministic for the same token + secret", async () => {
    const token = "abc123";
    expect(await hashActionToken(token, SECRET)).toBe(await hashActionToken(token, SECRET));
  });

  it("matches the documented contract sha256Hex(`${token}.${secret}`)", async () => {
    const token = "abc123";
    expect(await hashActionToken(token, SECRET)).toBe(await sha256Hex(`${token}.${SECRET}`));
  });

  it("changes when the secret changes", async () => {
    const token = "abc123";
    expect(await hashActionToken(token, SECRET)).not.toBe(await hashActionToken(token, "other-secret"));
  });
});

describe("buildActionLink", () => {
  it("joins base + path and url-encodes the token", () => {
    expect(buildActionLink("https://app.example.com", "/forms/check-in", "a b"))
      .toBe("https://app.example.com/forms/check-in?token=a%20b");
  });

  it("trims a trailing slash on the base and adds a leading slash to the path", () => {
    expect(buildActionLink("https://app.example.com/", "forms/check-in", "tok"))
      .toBe("https://app.example.com/forms/check-in?token=tok");
  });
});

describe("mintActionToken", () => {
  it("stores only the hash and returns the raw token", async () => {
    let captured: Record<string, unknown> | null = null;
    const sb = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            captured = row;
            return {
              select() {
                return {
                  single: async () => ({ data: { id: "row-1" }, error: null }),
                };
              },
            };
          },
        };
      },
    };

    const result = await mintActionToken(sb, {
      action: "daily_check_in",
      jobId: "job-1",
      contactId: "crew-1",
      secret: SECRET,
    });

    expect(result.id).toBe("row-1");
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(captured).not.toBeNull();
    expect(captured!.token_hash).toBe(await hashActionToken(result.token, SECRET));
    expect(captured!.token).toBeUndefined();
    expect(captured!.action).toBe("daily_check_in");
    expect(captured!.job_id).toBe("job-1");
    expect(captured!.contact_id).toBe("crew-1");
    // action_tokens has no location_id column — it must never be written.
    expect("location_id" in captured!).toBe(false);
    expect(typeof captured!.expires_at).toBe("string");
  });

  it("omits location_id when not supplied", async () => {
    let captured: Record<string, unknown> | null = null;
    const sb = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            captured = row;
            return {
              select() {
                return { single: async () => ({ data: { id: "row-2" }, error: null }) };
              },
            };
          },
        };
      },
    };

    await mintActionToken(sb, { action: "owner_advance", secret: SECRET });
    expect(captured).not.toBeNull();
    expect("location_id" in captured!).toBe(false);
    expect(captured!.job_id).toBeNull();
    expect(captured!.contact_id).toBeNull();
  });
});
