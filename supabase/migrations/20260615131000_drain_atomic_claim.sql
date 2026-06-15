-- BUG-DRAIN: make the notification drain idempotent under overlapping runs.
-- Run the ALTER TYPE in its own execute_sql call FIRST (commit), then the two functions.

-- 1. Transient claim state.
ALTER TYPE public.notif_status ADD VALUE IF NOT EXISTS 'sending';

-- 2. Atomic claimer: move up to p_limit due+pending rows to 'sending' and return them.
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
     SET status = 'sending'
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

-- 3. Reaper: return rows stranded in 'sending' (crash mid-send) back to 'pending'.
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
       AND created_at < now() - p_older_than
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM reaped;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.reap_stale_sending(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_sending(INTERVAL) TO service_role;
