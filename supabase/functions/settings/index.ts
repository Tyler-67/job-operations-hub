/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";

const ADMIN_ROLES = new Set(["owner_admin", "office_manager", "support_admin"]);
const WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);

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

function cleanTime(value: unknown) {
  const time = cleanText(value);
  if (!time) return null;
  const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) throw new Error("invalid_time");
  return `${match[1]}:${match[2]}`;
}

function cleanColor(value: unknown) {
  const color = cleanText(value);
  if (!color) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("invalid_color");
  return color.toLowerCase();
}

function cleanUrl(value: unknown) {
  const url = cleanText(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid_url");
    return parsed.toString();
  } catch {
    throw new Error("invalid_url");
  }
}

function cleanNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) throw new Error("invalid_number");
  return Math.round(num * 100) / 100;
}

function cleanNonNegativeInt(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) throw new Error("invalid_number");
  return num;
}

function cleanWeekday(value: unknown) {
  const day = Number(value);
  if (!Number.isInteger(day) || !WEEKDAYS.has(day)) throw new Error("invalid_weekday");
  return day;
}

function cleanWeekdays(value: unknown) {
  const raw = Array.isArray(value) ? value : [];
  const days = [...new Set(raw.map(cleanWeekday))].sort((a, b) => a - b);
  if (!days.length) throw new Error("invalid_weekdays");
  return days;
}

function validateTimezone(value: unknown) {
  const timezone = cleanText(value);
  if (!timezone) return null;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    throw new Error("invalid_timezone");
  }
}

function canAccess(role: unknown) {
  return ADMIN_ROLES.has(String(role ?? ""));
}

async function loadLocation(sb: any, locationId: string) {
  const { data, error } = await sb
    .from("locations")
    .select("id, uptiq_location_id, company_name, timezone, created_at, updated_at")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("location_not_found");
  return data;
}

async function ensureSettings(sb: any, locationId: string) {
  const { data, error } = await sb
    .from("company_settings")
    .select("*")
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: createdErr } = await sb
    .from("company_settings")
    .insert({ location_id: locationId, supply_house_pickup_time: "7AM" })
    .select("*")
    .single();
  if (createdErr) throw createdErr;
  return created;
}

async function settingsPayload(sb: any, locationId: string) {
  const [location, settingsResult, supplyResult] = await Promise.all([
    loadLocation(sb, locationId),
    ensureSettings(sb, locationId),
    sb
      .from("supply_house_contacts")
      .select("id, name, rep_name, email, phone, active")
      .eq("location_id", locationId)
      .order("active", { ascending: false })
      .order("name"),
  ]);
  if (supplyResult.error) throw supplyResult.error;

  return {
    location,
    settings: settingsResult,
    supply_houses: supplyResult.data ?? [],
  };
}

async function supplyHouseBelongsToLocation(sb: any, locationId: string, supplyHouseId: string | null) {
  if (!supplyHouseId) return true;
  const { data, error } = await sb
    .from("supply_house_contacts")
    .select("id")
    .eq("id", supplyHouseId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function updateSettings(sb: any, locationId: string, body: Record<string, unknown>) {
  const locationBody = typeof body.location === "object" && body.location ? body.location as Record<string, unknown> : {};
  const settingsBody = typeof body.settings === "object" && body.settings ? body.settings as Record<string, unknown> : body;

  const locationPatch: Record<string, unknown> = {};
  if ("company_name" in locationBody) {
    const companyName = cleanText(locationBody.company_name);
    if (!companyName) throw new Error("company_name_required");
    locationPatch.company_name = companyName;
  }
  if ("timezone" in locationBody) {
    const timezone = validateTimezone(locationBody.timezone);
    if (!timezone) throw new Error("timezone_required");
    locationPatch.timezone = timezone;
  }
  if (Object.keys(locationPatch).length) {
    const { error } = await sb.from("locations").update(locationPatch).eq("id", locationId);
    if (error) throw error;
  }

  const patch: Record<string, unknown> = { location_id: locationId };
  const textFields = [
    "owner_name",
    "owner_contact_id",
    "owner_phone",
    "office_contact_id",
    "office_phone",
    "supply_house_pickup_time",
    "inspections_calendar_id",
  ];
  for (const key of textFields) {
    if (key in settingsBody) patch[key] = cleanText(settingsBody[key]);
  }
  if ("brand_font" in settingsBody) {
    const brandFont = cleanText(settingsBody.brand_font);
    if (!brandFont) throw new Error("brand_font_required");
    patch.brand_font = brandFont;
  }
  if ("owner_email" in settingsBody) patch.owner_email = cleanEmail(settingsBody.owner_email);
  if ("office_email" in settingsBody) patch.office_email = cleanEmail(settingsBody.office_email);
  if ("check_in_send_time" in settingsBody) {
    const time = cleanTime(settingsBody.check_in_send_time);
    if (!time) throw new Error("invalid_time");
    patch.check_in_send_time = time;
  }
  if ("inspection_reminder_time" in settingsBody) {
    const time = cleanTime(settingsBody.inspection_reminder_time);
    if (!time) throw new Error("invalid_time");
    patch.inspection_reminder_time = time;
  }
  if ("weekly_report_time" in settingsBody) {
    const time = cleanTime(settingsBody.weekly_report_time);
    if (!time) throw new Error("invalid_time");
    patch.weekly_report_time = time;
  }
  if ("weekly_report_day" in settingsBody) patch.weekly_report_day = cleanWeekday(settingsBody.weekly_report_day);
  if ("check_in_weekdays" in settingsBody) patch.check_in_weekdays = cleanWeekdays(settingsBody.check_in_weekdays);
  if ("review_request_delay_days" in settingsBody) {
    const days = cleanNonNegativeInt(settingsBody.review_request_delay_days);
    if (days === null) throw new Error("invalid_number");
    patch.review_request_delay_days = days;
  }
  if ("parts_cost_ceiling" in settingsBody) {
    const ceiling = cleanNonNegativeNumber(settingsBody.parts_cost_ceiling);
    if (ceiling === null) throw new Error("invalid_number");
    patch.parts_cost_ceiling = ceiling;
  }
  if ("brand_primary_color" in settingsBody) {
    const color = cleanColor(settingsBody.brand_primary_color);
    if (!color) throw new Error("invalid_color");
    patch.brand_primary_color = color;
  }
  if ("brand_secondary_color" in settingsBody) {
    const color = cleanColor(settingsBody.brand_secondary_color);
    if (!color) throw new Error("invalid_color");
    patch.brand_secondary_color = color;
  }
  if ("brand_logo_url" in settingsBody) patch.brand_logo_url = cleanUrl(settingsBody.brand_logo_url);

  if ("default_supply_house_contact_id" in settingsBody) {
    const supplyHouseId = cleanText(settingsBody.default_supply_house_contact_id);
    if (!await supplyHouseBelongsToLocation(sb, locationId, supplyHouseId)) throw new Error("invalid_supply_house");
    patch.default_supply_house_contact_id = supplyHouseId;
  }

  const { error } = await sb
    .from("company_settings")
    .upsert(patch, { onConflict: "location_id" });
  if (error) throw error;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);
  if (!canAccess(claims.role)) return json({ error: "forbidden" }, 403);

  const locationId = claims.loc as string;
  const sb = serviceClient();

  try {
    if (req.method === "GET") {
      return json(await settingsPayload(sb, locationId));
    }

    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      await updateSettings(sb, locationId, body);
      return json(await settingsPayload(sb, locationId));
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = [
      "company_name_required",
      "timezone_required",
      "invalid_timezone",
      "invalid_email",
      "invalid_time",
      "invalid_weekday",
      "invalid_weekdays",
      "invalid_number",
      "invalid_color",
      "invalid_url",
      "invalid_supply_house",
      "brand_font_required",
    ].includes(message)
      ? 400
      : message === "location_not_found"
        ? 404
        : 500;
    return json({ error: message }, status);
  }
});
