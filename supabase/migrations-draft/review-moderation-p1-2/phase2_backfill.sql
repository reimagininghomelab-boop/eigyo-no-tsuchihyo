-- =============================================================================
-- P1-2 第二段階: Phase 2 既存データ移行 + 制約付与（トリガは入れない）
-- 前提: Phase 1 適用済み。事前に checks/pre_apply_checks.sql (A) を実行し想定外statusが0件であること。
-- 適用: 未適用ドラフト。
-- =============================================================================
BEGIN;

-- 2-0. 事前検出（想定外statusがあれば中断）
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.anonymous_reviews
  WHERE status NOT IN ('visible','hidden','superseded');
  IF v_bad > 0 THEN RAISE EXCEPTION 'unexpected status values: % rows', v_bad; END IF;
END $$;

-- 2-1. バックフィル（冪等・確定マッピング）
--   visible    -> display=visible   / none / active
--   hidden     -> display=concealed / none / active
--   superseded -> display=concealed / none / review=superseded
--   ※ superseded は旧版レビューで施主非表示。review_state で集計除外されるが、
--     display_state 単体で見るコードが将来出ても露出しないよう「見せない側(concealed)」へ寄せる（防御的）。
UPDATE public.anonymous_reviews
SET display_state = CASE status
        WHEN 'visible'    THEN 'visible'
        WHEN 'hidden'     THEN 'concealed'
        WHEN 'superseded' THEN 'concealed'
      END,
    moderation_state = 'none',
    review_state = CASE WHEN status='superseded' THEN 'superseded' ELSE 'active' END
WHERE display_state IS NULL;

-- 2-2. NULL残存で中断
DO $$
DECLARE v_null int;
BEGIN
  SELECT count(*) INTO v_null FROM public.anonymous_reviews
  WHERE display_state IS NULL OR moderation_state IS NULL OR review_state IS NULL;
  IF v_null > 0 THEN RAISE EXCEPTION 'null remains after backfill: % rows', v_null; END IF;
END $$;

-- 2-3. DEFAULT/NOT NULL/CHECK（DEFAULT 'unconfirmed' は新規INSERTのみに作用）
ALTER TABLE public.anonymous_reviews
  ALTER COLUMN display_state    SET DEFAULT 'unconfirmed', ALTER COLUMN display_state    SET NOT NULL,
  ALTER COLUMN moderation_state SET DEFAULT 'none',        ALTER COLUMN moderation_state SET NOT NULL,
  ALTER COLUMN review_state     SET DEFAULT 'active',      ALTER COLUMN review_state     SET NOT NULL,
  ADD CONSTRAINT anon_reviews_display_state_chk    CHECK (display_state    IN ('unconfirmed','visible','concealed')),
  ADD CONSTRAINT anon_reviews_moderation_state_chk CHECK (moderation_state IN ('none','violation')),
  ADD CONSTRAINT anon_reviews_review_state_chk     CHECK (review_state     IN ('active','superseded'));

-- 2-4. 集計/表示フィルタ用の部分インデックス
CREATE INDEX idx_anon_reviews_active_visible
  ON public.anonymous_reviews (salesperson_id)
  WHERE review_state='active' AND moderation_state='none';

COMMIT;
