-- Multi-link asks (inspection PASS/FAIL, walkthrough APPROVE/PUNCH LIST/RESCHEDULE, the
-- finish-walkthrough YES/NO) mint one single-use token per option. batch_id groups the
-- options minted for ONE text, so consuming any one of them burns the unused siblings —
-- a stale leftover link then shows "already used" instead of soft-no-op'ing (or, in the
-- one real hazard, cross-firing: a leftover inspection FAIL matching the walkthrough
-- fail edge after PASS had already advanced the job).
ALTER TABLE public.action_tokens ADD COLUMN IF NOT EXISTS batch_id UUID;

-- The burn touches rows by batch on every decision tap; partial index keeps it cheap
-- (single-link tokens — check-ins, date forms, quick logs — stay NULL and unindexed).
CREATE INDEX IF NOT EXISTS action_tokens_batch_id_idx
  ON public.action_tokens (batch_id) WHERE batch_id IS NOT NULL;
