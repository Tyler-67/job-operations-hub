import { json, preflight } from "../_shared/util.ts";

// Stateless signed sessions — client just discards. Endpoint kept for parity.
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  return json({ ok: true });
});
