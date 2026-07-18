-- =============================================================================
-- P1-2 第二段階: Phase 1 rollback
-- 前提: Phase 2 以降を先に rollback 済みであること（列がNOT NULL/CHECKのままだと不整合）。
-- 適用: 未適用ドラフト。
-- =============================================================================
BEGIN;
REVOKE SELECT (display_state, moderation_state, review_state) ON public.anonymous_reviews FROM authenticated;

ALTER TABLE public.anonymous_reviews
  DROP COLUMN IF EXISTS display_state,
  DROP COLUMN IF EXISTS moderation_state,
  DROP COLUMN IF EXISTS review_state;

DROP TABLE IF EXISTS public.review_moderation_logs;   -- FK RESTRICT のため review_reports より先
DROP TABLE IF EXISTS public.review_reports;
DROP FUNCTION IF EXISTS public.derive_review_status(text, text, text);
COMMIT;
