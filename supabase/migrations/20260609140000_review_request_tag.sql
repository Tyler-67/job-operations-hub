-- The review-request bridge tags the customer's Uptiq contact a configurable number
-- of days after a job closes (review_request_delay_days already exists), which fires
-- Uptiq's own review-request automation. This adds the tag name to apply. Defaults to
-- 'review-request' so it works out of the box; set to NULL to disable review requests.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS review_request_tag TEXT DEFAULT 'review-request';
