-- =============================================================================
-- P1-2 第二段階: Phase 5 rollback（RLSを旧statusへ・トリガ撤去・直接UPDATE復活）
-- 注意: statusはPhase5でトリガ導出済み＝display_state='visible'&none&active と一致するため、
--       戻しても可視集合は整合し、意図せぬ本文露出は発生しない。
-- 適用: 未適用ドラフト。
-- =============================================================================
BEGIN;

-- RLSを旧statusベースへ
DROP POLICY IF EXISTS "authenticated can select visible by axes" ON public.anonymous_reviews;
CREATE POLICY "authenticated can select visible anonymous_reviews" ON public.anonymous_reviews
  FOR SELECT TO authenticated USING (status = 'visible');

-- トリガ撤去
DROP TRIGGER  IF EXISTS trg_sync_legacy_status ON public.anonymous_reviews;
DROP FUNCTION IF EXISTS public.sync_review_legacy_status();

-- 直接UPDATE権限を元の付与状態（column-levelのみ）へ復元
--   table-level UPDATE は元々未付与のため復活しない。
GRANT UPDATE (status) ON public.anonymous_reviews TO authenticated;

-- admin直UPDATEポリシー復活（現行定義）
CREATE POLICY "admin can update status of anonymous_reviews" ON public.anonymous_reviews
  FOR UPDATE TO authenticated
  USING      (auth.email() IN ('reimagining.home.lab@gmail.com','1989yo55@gmail.com'))
  WITH CHECK (auth.email() IN ('reimagining.home.lab@gmail.com','1989yo55@gmail.com'));

COMMIT;
