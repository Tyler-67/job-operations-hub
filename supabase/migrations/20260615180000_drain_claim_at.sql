-- BUG-DRAIN fix (review finding): the reaper must measure time-in-'sending', not
-- time-since-creation. The original reap_stale_sending used created_at, so a row with an
-- old created_at (e.g. a 4-day-delayed review-request tag, or any row that waited >10 min
-- in the queue) was reapable the instant it was claimed into 'sending' while still in
-- flight -> an overlapping tick could reap + re-send it (double dispatch). Add a claim
-- timestamp set at claim time and reap on THAT.
ALTER TABLE public.scheduled_notifications ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.claim_due_notifications(p_limit INT)
RETURNS TABLE (
  id UUID,
  channel public.notif_channel,
  recipient TEXT,
  template_key TEXT,
  payload JSONB,
  attempts INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.scheduled_notifications n
     SET status = 'sending', claimed_at = now()
   WHERE n.id IN (
     SELECT s.id
       FROM public.scheduled_notifications s
      WHERE s.status = 'pending'
        AND s.scheduled_for <= now()
      ORDER BY s.scheduled_for ASC
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
   )
  RETURNING n.id, n.channel, n.recipient, n.template_key, n.payload, n.attempts;
$$;
REVOKE ALL ON FUNCTION public.claim_due_notifications(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_notifications(INT) TO service_role;

CREATE OR REPLACE FUNCTION public.reap_stale_sending(p_older_than INTERVAL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH reaped AS (
    UPDATE public.scheduled_notifications
       SET status = 'pending'
     WHERE status = 'sending'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - p_older_than
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM reaped;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.reap_stale_sending(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_sending(INTERVAL) TO service_role;
