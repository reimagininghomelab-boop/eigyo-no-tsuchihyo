-- =============================================================================
-- P1-2 第二段階: 口コミモデレーション恒久設計
-- Phase 1: 追加DDL・新テーブル・RLS/GRANT・derive_review_status()
-- 種別: additive（後方互換。既存の読み書きに影響しない）
-- 適用: 未適用ドラフト。SQL適用は行わない。
-- =============================================================================
BEGIN;

-- 1-0. 導出ヘルパー（RPC・Phase5トリガ・確認クエリが共通参照）
CREATE OR REPLACE FUNCTION public.derive_review_status(
  p_display text, p_moderation text, p_review text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_review = 'superseded' THEN 'superseded'
    WHEN p_display = 'visible' AND p_moderation = 'none' THEN 'visible'
    ELSE 'hidden'
  END;
$$;

-- 1-1. 通報テーブル（証跡保持のため CASCADE 不使用・RESTRICT）
CREATE TABLE public.review_reports (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id                uuid NOT NULL REFERENCES public.anonymous_reviews(id) ON DELETE RESTRICT,
  reported_by_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_salesperson_id  uuid NOT NULL REFERENCES public.salesperson_profiles(id) ON DELETE RESTRICT,
  reason_category          text NOT NULL,            -- CHECK制約は付けない（カテゴリ体系未確定）
  reason_detail            text,
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','upheld','rejected')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  resolved_at              timestamptz
);

-- 1-2. 監査ログ（追記専用・RESTRICT＋非FKスナップショット）
CREATE TABLE public.review_moderation_logs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id               uuid NOT NULL REFERENCES public.anonymous_reviews(id) ON DELETE RESTRICT,
  review_id_snapshot      uuid NOT NULL,             -- 非FK。将来SET NULL運用へ移行しても残す
  salesperson_id_snapshot uuid NOT NULL,             -- 非FK。営業識別を証跡側に保持
  report_id               uuid REFERENCES public.review_reports(id) ON DELETE SET NULL,
  action                  text NOT NULL,
  actor_user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role              text NOT NULL CHECK (actor_role IN ('salesperson','admin','system')),
  axis                    text NOT NULL CHECK (axis IN ('display_state','moderation_state','review_state')),
  previous_status         text NOT NULL,
  new_status              text NOT NULL,
  -- 判断時点のレビュー本体スナップショット（本文/個人情報は複製しない）。
  -- レビュー本体が後で変わっても、判断時点の評価値・3軸状態をログ単体で追える。
  rating_snapshot           integer,
  display_state_snapshot    text,
  moderation_state_snapshot text,
  review_state_snapshot     text,
  reason_category         text,
  admin_note              text,                      -- admin操作ではRPCで非空を強制
  result                  text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- 1-3. 新テーブルの RLS/GRANT（直アクセスなし・adminのみSELECT・書込はRPCのみ）
ALTER TABLE public.review_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_moderation_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.review_reports         FROM PUBLIC;
REVOKE ALL ON public.review_reports         FROM anon, authenticated;
REVOKE ALL ON public.review_moderation_logs FROM PUBLIC;
REVOKE ALL ON public.review_moderation_logs FROM anon, authenticated;

-- adminのみ直SELECT可（監査閲覧）。UPDATE/DELETEは付与しない＝追記専用
GRANT SELECT ON public.review_reports         TO authenticated;
GRANT SELECT ON public.review_moderation_logs TO authenticated;

CREATE POLICY "admin can select review_reports" ON public.review_reports
  FOR SELECT TO authenticated
  USING (auth.email() IN ('reimagining.home.lab@gmail.com','1989yo55@gmail.com'));
CREATE POLICY "admin can select review_moderation_logs" ON public.review_moderation_logs
  FOR SELECT TO authenticated
  USING (auth.email() IN ('reimagining.home.lab@gmail.com','1989yo55@gmail.com'));
-- INSERT/UPDATE/DELETE ポリシー・権限は付与しない → 書込は SECURITY DEFINER RPC（所有者権限でRLSバイパス）のみ

-- 1-4. anonymous_reviews に3軸追加（default/NOT NULL/CHECK は Phase 2）
ALTER TABLE public.anonymous_reviews
  ADD COLUMN display_state    text,
  ADD COLUMN moderation_state text,
  ADD COLUMN review_state     text;

-- 1-5. 3軸の列SELECT付与（UPDATEは付与しない）
GRANT SELECT (display_state, moderation_state, review_state) ON public.anonymous_reviews TO authenticated;

COMMIT;
