/* eslint-disable @typescript-eslint/no-explicit-any */
// Supply Houses admin CRUD over public.supply_house_contacts.
// Direct location scoping (claims.loc); all admin roles read + write; soft-delete via active
// (a hard delete would violate the RESTRICT FK on purchase_orders.supply_house_id).
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";

const ADMIN_ROLES = new Set(["dev_super", "owner_admin", "office_manager", "support_admin"]);

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function cleanEmail(value: unknown) {
  const email = cleanText(value)?.toLowerCase() ?? null;
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid_email");
  return email;
}

// Email is required for a supply house (parts orders are emailed to it). Validates the format
// and rejects an empty value. NOTE: this guards the admin CRUD only — the Uptiq contact pull
// writes supply_house_contacts directly and stays lenient (a pulled house may lack an email).
function requireEmail(value: unknown): string {
  const email = cleanEmail(value);
  if (!email) throw new Error("email_required");
  return email;
}

function boolValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

const SELECT_COLS =
  "id, location_id, name, rep_name, address, phone, email, account_number, uptiq_contact_id, notes, active, created_at, updated_at";

async function loadSupplyHouse(sb: any, locationId: string, id: string | null) {
  if (!id) return null;
  const { data, error } = await sb
    .from("supply_house_contacts")
    .select(SELECT_COLS)
    .eq("location_id", locationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// Enforce name uniqueness per location in-code (no DB constraint, to avoid failing on any
// pre-existing duplicate rows). ilike gives a case-insensitive match.
async function assertNameFree(sb: any, locationId: string, name: string, exceptId?: string | null) {
  let query = sb
    .from("supply_house_contacts")
    .select("id")
    .eq("location_id", locationId)
    .ilike("name", name);
  if (exceptId) query = query.neq("id", exceptId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (data) throw new Error("name_in_use");
}

async function supplyHousesPayload(sb: any, locationId: string) {
  const { data, error } = await sb
    .from("supply_house_contacts")
    .select(SELECT_COLS)
    .eq("location_id", locationId)
    .order("active", { ascending: false })
    .order("name");
  if (error) throw error;
  const houses = data ?? [];
  return {
    supply_houses: houses,
    metrics: {
      total_count: houses.length,
      active_count: houses.filter((house: any) => house.active).length,
    },
  };
}

// Optional text fields the admin manages (name + active handled separately).
const TEXT_FIELDS = ["rep_name", "address", "phone", "account_number", "uptiq_contact_id", "notes"];

function housePatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  // Email is required: setting it always demands a valid, non-empty address (can't blank it out).
  if ("email" in body) patch.email = requireEmail(body.email);
  for (const key of TEXT_FIELDS) {
    if (key in body) patch[key] = cleanText(body[key]);
  }
  if ("active" in body) patch.active = boolValue(body.active, true);
  return patch;
}

async function createSupplyHouse(sb: any, locationId: string, body: Record<string, unknown>) {
  const name = cleanText(body.name);
  if (!name) throw new Error("name_required");
  const email = requireEmail(body.email); // required on create (also rejects a malformed address)
  await assertNameFree(sb, locationId, name);

  const patch = housePatch(body);
  const { error } = await sb.from("supply_house_contacts").insert({
    location_id: locationId,
    name,
    ...patch,
    email,
    active: patch.active ?? true,
  });
  if (error) throw error;
}

async function updateSupplyHouse(sb: any, locationId: string, body: Record<string, unknown>) {
  const house = await loadSupplyHouse(sb, locationId, cleanText(body.id));
  if (!house) throw new Error("not_found");

  const patch = housePatch(body);
  if ("name" in body) {
    const name = cleanText(body.name);
    if (!name) throw new Error("name_required");
    if (name.toLowerCase() !== String(house.name).toLowerCase()) {
      await assertNameFree(sb, locationId, name, house.id);
    }
    patch.name = name;
  }

  if (Object.keys(patch).length) {
    const { error } = await sb
      .from("supply_house_contacts")
      .update(patch)
      .eq("id", house.id)
      .eq("location_id", locationId);
    if (error) throw error;
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);
  if (!ADMIN_ROLES.has(String(claims.role ?? ""))) return json({ error: "forbidden" }, 403);

  const locationId = claims.loc as string;
  const sb = serviceClient();

  try {
    if (req.method === "GET") {
      return json(await supplyHousesPayload(sb, locationId));
    }

    const body = await req.json().catch(() => ({}));

    if (req.method === "POST") {
      await createSupplyHouse(sb, locationId, body);
      return json(await supplyHousesPayload(sb, locationId), 201);
    }

    if (req.method === "PATCH") {
      await updateSupplyHouse(sb, locationId, body);
      return json(await supplyHousesPayload(sb, locationId));
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = ["name_required", "email_required", "invalid_email"].includes(message)
      ? 400
      : message === "not_found"
        ? 404
        : message === "name_in_use"
          ? 409
          : 500;
    return json({ error: message }, status);
  }
});
