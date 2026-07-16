/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, preflight, serviceClient, verifySession, logEvent } from "../_shared/util.ts";
import { isDebugTool } from "../_shared/debug-access.ts";

const READ_ROLES = new Set(["dev_super", "owner_admin", "office_manager", "support_admin"]);
const WRITE_ROLES = new Set(["dev_super", "owner_admin", "support_admin"]);
const APP_ROLES = new Set(["dev_super", "owner_admin", "office_manager", "crew", "viewer", "support_admin"]);
// Roles that count as "an owner" for the last-owner guard (don't orphan the company).
const OWNER_ROLES = ["dev_super", "owner_admin"];

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function cleanEmail(value: unknown) {
  const email = cleanText(value)?.toLowerCase() ?? null;
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function canRead(role: unknown) {
  return READ_ROLES.has(String(role ?? ""));
}

function canWrite(role: unknown) {
  return WRITE_ROLES.has(String(role ?? ""));
}

// Role hierarchy: dev_super > support_admin > owner_admin. Only dev_super may create/alter
// dev_super users (or grant the debugger); support_admin may not touch dev_super rows.
function canManageRole(actorRole: string, targetRole: string, existingRole?: string | null) {
  if (actorRole === "dev_super") return true;
  if (targetRole === "dev_super" || existingRole === "dev_super") return false;
  if (actorRole === "support_admin") return true;
  if (targetRole === "support_admin" || existingRole === "support_admin") return false;
  return actorRole === "owner_admin";
}

// Set a login password on the auth.users row (creating the row if it doesn't exist yet).
// Authoritative — throws on a hard failure so the caller can surface it (a "set password"
// that silently failed would leave a stored password that doesn't actually log in).
async function setAuthPassword(sb: any, email: string, password: string) {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const existing = (data?.users ?? []).find((u: any) => String(u.email ?? "").toLowerCase() === email);
  if (existing) {
    const { error: upErr } = await sb.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (upErr) throw upErr;
  } else {
    const { error: cErr } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (cErr) throw cErr;
  }
}

// Best-effort: make the email able to log in via the standalone Supabase-Auth door.
// magic-link with shouldCreateUser:false needs the auth.users row to pre-exist. Idempotent
// (an already-registered email is fine) and NEVER fatal — the app_users ACL row is the
// source of truth; auth provisioning is a repairable convenience. When a password is passed,
// it is set on the auth user (create or update).
async function provisionAuthUser(sb: any, email: string, password?: string | null) {
  try {
    if (password) { await setAuthPassword(sb, email, password); return; }
    const { error } = await sb.auth.admin.createUser({ email, email_confirm: true });
    if (!error) return;
    const msg = String(error.message ?? error).toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) return; // idempotent
    await logEvent({ source: "admin", kind: "auth_provision_failed", payload: { email, error: String(error.message ?? error) } });
  } catch (e) {
    await logEvent({ source: "admin", kind: "auth_provision_failed", payload: { email, error: e instanceof Error ? e.message : String(e) } });
  }
}

// Who owns an email WITHIN this location/tenant (primary app_users.email OR a secondary
// app_user_emails alias): "self" if exceptUserId already owns it, "other" if a different
// user in this location does, null if free here. Scoped to locationId to match the app's
// UNIQUE(location_id, email) model — an email used only in a different tenant does NOT
// block reuse here (the Users page is per-tenant, so a global check reported phantom
// "duplicate email" errors for rows the admin couldn't see).
async function emailOwnership(sb: any, locationId: string, email: string, exceptUserId: string | null): Promise<"self" | "other" | null> {
  const { data: primaries } = await sb
    .from("app_users").select("id").eq("location_id", locationId).eq("email", email);
  for (const row of primaries ?? []) {
    if (row.id === exceptUserId) return "self";
    return "other";
  }
  const { data: alias } = await sb.from("app_user_emails").select("app_user_id").eq("email", email).maybeSingle();
  if (alias) {
    // app_user_emails is globally unique on email; only count it as owned here when the
    // owning user is in this location (a cross-tenant alias is still backstopped by the
    // unique index at insert time).
    const owner = await loadUser(sb, locationId, alias.app_user_id);
    if (owner) return alias.app_user_id === exceptUserId ? "self" : "other";
  }
  return null;
}

async function loadUser(sb: any, locationId: string, id: string | null) {
  if (!id) return null;
  const { data, error } = await sb
    .from("app_users")
    .select("*")
    .eq("location_id", locationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function activeOwnerCount(sb: any, locationId: string, exceptId?: string | null) {
  let query = sb
    .from("app_users")
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId)
    .in("role", OWNER_ROLES)
    .eq("active", true);
  if (exceptId) query = query.neq("id", exceptId);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function usersPayload(sb: any, locationId: string, includePassword = false) {
  // login_password is BETA plaintext (see migration 20260709120000) and only surfaced to
  // credential managers (WRITE roles); office_manager reads the list without it.
  const cols = "id, location_id, email, name, phone, role, active, debug_tools, uptiq_contact_id, last_seen_at, created_at, updated_at"
    + (includePassword ? ", login_password" : "");
  const { data, error } = await sb
    .from("app_users")
    .select(cols)
    .eq("location_id", locationId)
    .order("active", { ascending: false })
    .order("role")
    .order("name", { nullsFirst: false })
    .order("email");
  if (error) throw error;

  const users = data ?? [];

  // Attach each user's SECONDARY login emails (aliases). The primary is app_users.email.
  const ids = users.map((user: any) => user.id);
  const emailsByUser: Record<string, { id: string; email: string }[]> = {};
  if (ids.length) {
    const { data: emailRows, error: emailErr } = await sb
      .from("app_user_emails")
      .select("id, app_user_id, email")
      .in("app_user_id", ids)
      .order("email");
    if (emailErr) throw emailErr;
    for (const row of emailRows ?? []) {
      (emailsByUser[row.app_user_id] ??= []).push({ id: row.id, email: row.email });
    }
  }
  const usersWithEmails = users.map((user: any) => ({ ...user, emails: emailsByUser[user.id] ?? [] }));

  const roleCounts: Record<string, number> = {};
  for (const user of users) {
    roleCounts[user.role] = (roleCounts[user.role] ?? 0) + 1;
  }

  return {
    users: usersWithEmails,
    metrics: {
      total_user_count: users.length,
      active_user_count: users.filter((user: any) => user.active).length,
      inactive_user_count: users.filter((user: any) => !user.active).length,
      owner_admin_count: users.filter((user: any) => user.active && OWNER_ROLES.includes(user.role)).length,
      office_manager_count: users.filter((user: any) => user.active && user.role === "office_manager").length,
      role_counts: roleCounts,
    },
  };
}

async function createUser(sb: any, locationId: string, actorRole: string, body: Record<string, unknown>) {
  const email = cleanEmail(body.email);
  if (!email) throw new Error("invalid_email");

  const role = cleanText(body.role) ?? "viewer";
  if (!APP_ROLES.has(role)) throw new Error("invalid_role");
  if (!canManageRole(actorRole, role)) throw new Error("role_forbidden");

  // The email must not already be a login identity in this location (primary or alias).
  if (await emailOwnership(sb, locationId, email, null)) throw new Error("email_in_use");

  const password = cleanText(body.password); // BETA: stored plaintext for admin viewing

  const { error } = await sb.from("app_users").insert({
    location_id: locationId,
    email,
    name: cleanText(body.name),
    phone: cleanText(body.phone),
    role,
    active: body.active !== false,
    uptiq_contact_id: cleanText(body.uptiq_contact_id),
    login_password: password,
  });
  if (error) throw error;

  // Enable the standalone login door for the new user (+ set the password if provided).
  await provisionAuthUser(sb, email, password);
}

async function updateUser(sb: any, locationId: string, actorId: string, actorRole: string, body: Record<string, unknown>) {
  const user = await loadUser(sb, locationId, cleanText(body.id));
  if (!user) throw new Error("user_not_found");

  const patch: Record<string, unknown> = {};
  const selfEdit = user.id === actorId;

  if ("email" in body) {
    if (selfEdit) throw new Error("self_identity_locked");
    const email = cleanEmail(body.email);
    if (!email) throw new Error("invalid_email");
    if ((await emailOwnership(sb, locationId, email, user.id)) === "other") throw new Error("email_in_use");
    patch.email = email;
  }
  if ("name" in body) patch.name = cleanText(body.name);
  if ("phone" in body) patch.phone = cleanText(body.phone);
  if ("uptiq_contact_id" in body) patch.uptiq_contact_id = cleanText(body.uptiq_contact_id);
  if ("role" in body) {
    const role = cleanText(body.role);
    if (!role || !APP_ROLES.has(role)) throw new Error("invalid_role");
    // Admins may change their own role; canManageRole still bounds what they can grant, and
    // the last_owner_admin guard below prevents the final owner from orphaning the company.
    if (!canManageRole(actorRole, role, user.role)) throw new Error("role_forbidden");
    patch.role = role;
  }
  if ("active" in body) {
    if (selfEdit && body.active === false) throw new Error("self_deactivate_locked");
    patch.active = body.active !== false;
  }
  if ("debug_tools" in body) {
    // The debugger grant: only a dev_super may hand an Owner debug tools (or revoke them).
    // The list is validated against the known tool slugs; unknown values are rejected.
    if (actorRole !== "dev_super") throw new Error("debug_grant_forbidden");
    const raw = Array.isArray(body.debug_tools) ? body.debug_tools : [];
    const tools = [...new Set(raw)];
    if (!tools.every(isDebugTool)) throw new Error("invalid_debug_tool");
    patch.debug_tools = tools;
  }

  const nextRole = String(patch.role ?? user.role);
  const nextActive = Boolean("active" in patch ? patch.active : user.active);
  if (OWNER_ROLES.includes(user.role) && user.active && (!OWNER_ROLES.includes(nextRole) || !nextActive)) {
    const remainingOwners = await activeOwnerCount(sb, locationId, user.id);
    if (remainingOwners < 1) throw new Error("last_owner_admin");
  }

  if (Object.keys(patch).length) {
    const { error } = await sb.from("app_users").update(patch).eq("id", user.id).eq("location_id", locationId);
    if (error) throw error;
  }

  // On email change: the old primary address is replaced in app_users.email and is not an
  // alias, so it stops resolving — login access to the old address is revoked. Drop any
  // secondary alias that duplicates the new primary, then enable standalone login for it.
  if (typeof patch.email === "string" && patch.email !== user.email) {
    await sb.from("app_user_emails").delete().eq("email", patch.email);
    await provisionAuthUser(sb, patch.email);
  }
}

// Add a secondary login email (alias) to a user. It resolves to the same app_users
// identity/role via app_user_emails. Requires the actor can manage the target user.
async function addUserEmail(sb: any, locationId: string, actorRole: string, body: Record<string, unknown>) {
  const user = await loadUser(sb, locationId, cleanText(body.user_id));
  if (!user) throw new Error("user_not_found");
  if (!canManageRole(actorRole, user.role, user.role)) throw new Error("role_forbidden");

  const email = cleanEmail(body.email);
  if (!email) throw new Error("invalid_email");

  const owner = await emailOwnership(sb, locationId, email, user.id);
  if (owner === "self") throw new Error("email_already_added");
  if (owner === "other") throw new Error("email_in_use");

  const { error } = await sb.from("app_user_emails").insert({ app_user_id: user.id, email });
  if (error) {
    // Unique-violation race → the email got taken between the check and the insert.
    if (String(error.code) === "23505") throw new Error("email_in_use");
    throw error;
  }
  await provisionAuthUser(sb, email);
}

// Remove a secondary login email. The primary (== app_users.email) cannot be removed here;
// change it via updateUser instead.
async function removeUserEmail(sb: any, locationId: string, actorRole: string, body: Record<string, unknown>) {
  const emailId = cleanText(body.email_id);
  if (!emailId) throw new Error("invalid_email_id");

  const { data: row, error: loadErr } = await sb.from("app_user_emails")
    .select("id, app_user_id").eq("id", emailId).maybeSingle();
  if (loadErr) throw loadErr;
  if (!row) throw new Error("email_not_found");

  // The alias must belong to a user in the actor's location, and the actor must manage them.
  const owner = await loadUser(sb, locationId, row.app_user_id);
  if (!owner) throw new Error("email_not_found");
  if (!canManageRole(actorRole, owner.role, owner.role)) throw new Error("role_forbidden");

  const { error } = await sb.from("app_user_emails").delete().eq("id", emailId);
  if (error) throw error;
}

// Set/reset a user's login password (BETA: also stores the plaintext on app_users so an admin
// can view it later). Authoritative — setAuthPassword throws if the auth update fails, so we
// never store a password that doesn't actually log in.
async function setUserPassword(sb: any, locationId: string, actorRole: string, body: Record<string, unknown>) {
  const user = await loadUser(sb, locationId, cleanText(body.id ?? body.user_id));
  if (!user) throw new Error("user_not_found");
  if (!canManageRole(actorRole, user.role, user.role)) throw new Error("role_forbidden");

  const password = cleanText(body.password);
  if (!password) throw new Error("password_required");

  await setAuthPassword(sb, String(user.email).toLowerCase(), password);
  const { error } = await sb.from("app_users")
    .update({ login_password: password }).eq("id", user.id).eq("location_id", locationId);
  if (error) throw error;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);

  const locationId = claims.loc as string;
  const actorRole = String(claims.role ?? "");
  const actorId = String(claims.sub ?? "");
  if (!canRead(actorRole)) return json({ error: "forbidden" }, 403);

  const sb = serviceClient();

  try {
    if (req.method === "GET") {
      return json(await usersPayload(sb, locationId, canWrite(actorRole)));
    }

    if (!canWrite(actorRole)) return json({ error: "forbidden" }, 403);
    const body = await req.json().catch(() => ({}));

    if (req.method === "POST") {
      const action = cleanText(body.action);
      if (action === "add_email") {
        await addUserEmail(sb, locationId, actorRole, body);
        return json(await usersPayload(sb, locationId, true), 201);
      }
      if (action === "remove_email") {
        await removeUserEmail(sb, locationId, actorRole, body);
        return json(await usersPayload(sb, locationId, true));
      }
      if (action === "set_password") {
        await setUserPassword(sb, locationId, actorRole, body);
        return json(await usersPayload(sb, locationId, true));
      }
      await createUser(sb, locationId, actorRole, body);
      return json(await usersPayload(sb, locationId, true), 201);
    }

    if (req.method === "PATCH") {
      await updateUser(sb, locationId, actorId, actorRole, body);
      return json(await usersPayload(sb, locationId, true));
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = [
      "invalid_email",
      "invalid_email_id",
      "invalid_role",
      "role_forbidden",
      "password_required",
      "self_identity_locked",
      "self_deactivate_locked",
      "debug_grant_forbidden",
      "invalid_debug_tool",
    ].includes(message)
      ? 400
      : message === "user_not_found" || message === "email_not_found"
        ? 404
        : message === "last_owner_admin" || message === "email_in_use" || message === "email_already_added"
          ? 409
          : 500;
    return json({ error: message }, status);
  }
});
