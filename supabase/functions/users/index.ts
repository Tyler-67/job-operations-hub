/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";

const READ_ROLES = new Set(["owner_admin", "office_manager", "support_admin"]);
const WRITE_ROLES = new Set(["owner_admin", "support_admin"]);
const APP_ROLES = new Set(["owner_admin", "office_manager", "crew", "viewer", "support_admin"]);

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

function canManageRole(actorRole: string, targetRole: string, existingRole?: string | null) {
  if (actorRole === "support_admin") return true;
  if (targetRole === "support_admin" || existingRole === "support_admin") return false;
  return actorRole === "owner_admin";
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
    .eq("role", "owner_admin")
    .eq("active", true);
  if (exceptId) query = query.neq("id", exceptId);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function usersPayload(sb: any, locationId: string) {
  const { data, error } = await sb
    .from("app_users")
    .select("id, location_id, email, name, phone, role, active, last_seen_at, created_at, updated_at")
    .eq("location_id", locationId)
    .order("active", { ascending: false })
    .order("role")
    .order("name", { nullsFirst: false })
    .order("email");
  if (error) throw error;

  const users = data ?? [];
  const roleCounts: Record<string, number> = {};
  for (const user of users) {
    roleCounts[user.role] = (roleCounts[user.role] ?? 0) + 1;
  }

  return {
    users,
    metrics: {
      total_user_count: users.length,
      active_user_count: users.filter((user: any) => user.active).length,
      inactive_user_count: users.filter((user: any) => !user.active).length,
      owner_admin_count: users.filter((user: any) => user.active && user.role === "owner_admin").length,
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

  const { error } = await sb.from("app_users").insert({
    location_id: locationId,
    email,
    name: cleanText(body.name),
    phone: cleanText(body.phone),
    role,
    active: body.active !== false,
  });
  if (error) throw error;
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
    patch.email = email;
  }
  if ("name" in body) patch.name = cleanText(body.name);
  if ("phone" in body) patch.phone = cleanText(body.phone);
  if ("role" in body) {
    const role = cleanText(body.role);
    if (!role || !APP_ROLES.has(role)) throw new Error("invalid_role");
    if (selfEdit) throw new Error("self_role_locked");
    if (!canManageRole(actorRole, role, user.role)) throw new Error("role_forbidden");
    patch.role = role;
  }
  if ("active" in body) {
    if (selfEdit && body.active === false) throw new Error("self_deactivate_locked");
    patch.active = body.active !== false;
  }

  const nextRole = String(patch.role ?? user.role);
  const nextActive = Boolean("active" in patch ? patch.active : user.active);
  if (user.role === "owner_admin" && user.active && (nextRole !== "owner_admin" || !nextActive)) {
    const remainingOwners = await activeOwnerCount(sb, locationId, user.id);
    if (remainingOwners < 1) throw new Error("last_owner_admin");
  }

  if (Object.keys(patch).length) {
    const { error } = await sb.from("app_users").update(patch).eq("id", user.id).eq("location_id", locationId);
    if (error) throw error;
  }
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
      return json(await usersPayload(sb, locationId));
    }

    if (!canWrite(actorRole)) return json({ error: "forbidden" }, 403);
    const body = await req.json().catch(() => ({}));

    if (req.method === "POST") {
      await createUser(sb, locationId, actorRole, body);
      return json(await usersPayload(sb, locationId), 201);
    }

    if (req.method === "PATCH") {
      await updateUser(sb, locationId, actorId, actorRole, body);
      return json(await usersPayload(sb, locationId));
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = [
      "invalid_email",
      "invalid_role",
      "role_forbidden",
      "self_identity_locked",
      "self_role_locked",
      "self_deactivate_locked",
    ].includes(message)
      ? 400
      : message === "user_not_found"
        ? 404
        : message === "last_owner_admin"
          ? 409
          : 500;
    return json({ error: message }, status);
  }
});
