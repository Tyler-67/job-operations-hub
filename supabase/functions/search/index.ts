// Cross-entity search: jobs (address/scope/notes), contacts, POs, expenses.
import { json, preflight, serviceClient, verifySession } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const claims = await verifySession(req.headers.get("x-app-session"));
  if (!claims) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return json({ jobs: [], contacts: [], pos: [], expenses: [] });

  const sb = serviceClient();
  const like = `%${q}%`;
  const locId = claims.loc as string;
  const { data: locationJobs, error: jobIdErr } = await sb
    .from("jobs")
    .select("id")
    .eq("location_id", locId);
  if (jobIdErr) return json({ error: jobIdErr.message }, 500);
  const jobIds = (locationJobs ?? []).map((job) => job.id);

  const [jobs, contacts, pos, expenses] = await Promise.all([
    sb.from("jobs").select("id, address, notes, scope_of_work, current_state_id, total_expenses, total_hours")
      .eq("location_id", locId).or(`address.ilike.${like},notes.ilike.${like},scope_of_work.ilike.${like}`).limit(25),
    sb.from("contacts").select("id, name, email, phone, role").eq("location_id", locId)
      .or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like}`).limit(25),
    jobIds.length
      ? sb.from("purchase_orders").select("id, job_id, status, estimated_amount, final_amount, description")
        .in("job_id", jobIds).or(`description.ilike.${like}`).limit(25)
      : Promise.resolve({ data: [], error: null }),
    jobIds.length
      ? sb.from("job_expenses").select("id, job_id, vendor, description, amount")
        .in("job_id", jobIds).or(`vendor.ilike.${like},description.ilike.${like}`).limit(25)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const err of [jobs.error, contacts.error, pos.error, expenses.error]) {
    if (err) return json({ error: err.message }, 500);
  }
  return json({
    jobs: jobs.data ?? [], contacts: contacts.data ?? [],
    pos: pos.data ?? [], expenses: expenses.data ?? [],
  });
});
