-- =============================================================================
-- P1-2 第二段階: Phase 5 ロックダウン
-- 前提: Phase 4（新フロント＋RPC）の動作確認が完了していること。
--       直接UPDATE剥奪・トリガ導入・RLS3軸化は必ずこの段階（フロント確認後）で行う。
-- 実行順: STEP1-2（確認・手動）→ STEP3（reconcile）→ STEP4-7（トリガ/RLS/剥奪, 単一TX）→ STEP8（確認）
-- 適用: 未適用ドラフト。
-- =============================================================================

-- === STEP 1-2: drift分布確認（想定外があれば中断） =========================
-- 手動確認。返る行が「旧admin直UPDATE由来（hidden/visible）」だけであることを目視。
-- unconfirmed 行が drift に現れたら（status<>'hidden'）異常 → 中断して調査。
--
--   SELECT status, display_state, moderation_state, review_state, count(*)
--   FROM public.anonymous_reviews
--   WHERE status <> public.derive_review_status(display_state, moderation_state, review_state)
--   GROUP BY 1,2,3,4 ORDER BY 5 DESC;

-- === STEP 3: drift reconcile（status->3軸・driftのみ・RLSフリップ前に必須） ==
BEGIN;
UPDATE public.anonymous_reviews
SET display_state = CASE WHEN status='visible' THEN 'visible'
                        WHEN status='hidden'  THEN 'concealed' ELSE display_state END,
    review_state  = CASE WHEN status='superseded' THEN 'superseded' ELSE review_state END
WHERE status <> public.derive_review_status(display_state, moderation_state, review_state);
COMMIT;
-- 続行前に checks/post_apply_checks.sql (C) が 0 であることを確認。

-- === STEP 4-7: トリガ導入 -> RLS3軸化 -> admin UPDATEポリシーDROP -> UPDATE権限REVOKE（単一TX） ==
BEGIN;

-- 4. status導出トリガ（3軸->status 一方向。直接status書換を無効化）
CREATE OR REPLACE FUNCTION public.sync_review_legacy_status()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.status := public.derive_review_status(NEW.display_state, NEW.moderation_state, NEW.review_state);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_sync_legacy_status
  BEFORE INSERT OR UPDATE ON public.anonymous_reviews
  FOR EACH ROW EXECUTE FUNCTION public.sync_review_legacy_status();

-- 5. RLSを3軸へ（旧status SELECTポリシーをDROP -> 新ポリシー）
DROP POLICY IF EXISTS "authenticated can select visible anonymous_reviews" ON public.anonymous_reviews;
CREATE POLICY "authenticated can select visible by axes" ON public.anonymous_reviews
  FOR SELECT TO authenticated
  USING (display_state='visible' AND moderation_state='none' AND review_state='active');

-- 6. admin直UPDATEポリシー削除（書込をRPC集約）
DROP POLICY IF EXISTS "admin can update anonymous_reviews"           ON public.anonymous_reviews;
DROP POLICY IF EXISTS "admin can update status of anonymous_reviews" ON public.anonymous_reviews;

-- 7. 直接UPDATE権限剥奪（table-level と column-level の両方を明示）
REVOKE UPDATE ON public.anonymous_reviews FROM authenticated;           -- table-level（残存時の保険）
REVOKE UPDATE (status) ON public.anonymous_reviews FROM authenticated;  -- column-level（P0で付与済みの status 列）

COMMIT;

-- === STEP 8: 最終確認 =====================================================
-- checks/post_apply_checks.sql の (C)(D)(F)(H)(I)(J)(K)(M) を実行し、想定どおりを確認。
