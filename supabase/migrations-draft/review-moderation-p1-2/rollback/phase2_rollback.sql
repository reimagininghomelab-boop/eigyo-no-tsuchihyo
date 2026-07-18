-- =============================================================================
-- P1-2 第二段階: Phase 2 rollback（制約/INDEX撤去。列とデータは残置＝再前進が容易）
-- 適用: 未適用ドラフト。
-- =============================================================================
BEGIN;
DROP INDEX IF EXISTS public.idx_anon_reviews_active_visible;

ALTER TABLE public.anonymous_reviews
  DROP CONSTRAINT IF EXISTS anon_reviews_display_state_chk,
  DROP CONSTRAINT IF EXISTS anon_reviews_moderation_state_chk,
  DROP CONSTRAINT IF EXISTS anon_reviews_review_state_chk,
  ALTER COLUMN display_state    DROP DEFAULT, ALTER COLUMN display_state    DROP NOT NULL,
  ALTER COLUMN moderation_state DROP DEFAULT, ALTER COLUMN moderation_state DROP NOT NULL,
  ALTER COLUMN review_state     DROP DEFAULT, ALTER COLUMN review_state     DROP NOT NULL;
COMMIT;
