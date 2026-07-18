-- =============================================================================
-- P1-2 第二段階: Phase 3 RPC群（CREATE OR REPLACE）
-- 前提: Phase 1/2 適用済み。RLSはまだ旧statusベースのまま（切替はPhase 5）。
-- 方針: submit系・状態変更RPCとも 3軸＋status を dual-write（Phase2〜4はトリガ不在のため必須）。
--       status導出は必ず public.derive_review_status() を使用。
-- rollback前提: 適用直前に rollback/phase3_pre_snapshot.sql で現行定義を退避すること。
-- 適用: 未適用ドラフト。
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 3-1. 営業の表示変更（一方向のみ・conceal理由必須・status同時更新）
-- 許可遷移: unconfirmed->visible / unconfirmed->concealed / visible->concealed
--   concealed->visible は運営のみ（admin_moderate_review.restore_visible）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salesperson_set_review_display(
  p_review_id uuid, p_target text, p_reason_category text DEFAULT NULL, p_reason_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.anonymous_reviews%ROWTYPE;
BEGIN
  IF p_target NOT IN ('visible','concealed') THEN RAISE EXCEPTION 'invalid_target'; END IF;

  SELECT * INTO r FROM public.anonymous_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.salesperson_profiles
                 WHERE id = r.salesperson_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden'; END IF;

  IF r.moderation_state = 'violation' OR r.review_state <> 'active' THEN
    RAISE EXCEPTION 'locked'; END IF;

  IF NOT ( (r.display_state='unconfirmed' AND p_target IN ('visible','concealed'))
        OR (r.display_state='visible'     AND p_target = 'concealed') ) THEN
    RAISE EXCEPTION 'transition_not_allowed'; END IF;

  IF p_target = 'concealed' AND (p_reason_category IS NULL OR btrim(p_reason_category) = '') THEN
    RAISE EXCEPTION 'reason_required'; END IF;

  UPDATE public.anonymous_reviews
  SET display_state = p_target,
      status = public.derive_review_status(p_target, r.moderation_state, r.review_state)
  WHERE id = p_review_id;

  INSERT INTO public.review_moderation_logs(
    review_id, review_id_snapshot, salesperson_id_snapshot, action,
    actor_user_id, actor_role, axis, previous_status, new_status,
    rating_snapshot, display_state_snapshot, moderation_state_snapshot, review_state_snapshot,
    reason_category)
  VALUES (p_review_id, p_review_id, r.salesperson_id,
    CASE p_target WHEN 'visible' THEN 'confirm_visible' ELSE 'conceal' END,
    auth.uid(), 'salesperson', 'display_state', r.display_state, p_target,
    r.rating, p_target, r.moderation_state, r.review_state,   -- 変更後の3軸＋評価値
    CASE WHEN p_target='concealed' THEN p_reason_category ELSE NULL END);
END; $$;

-- ---------------------------------------------------------------------------
-- 3-2. 運営モデレーション（p_report_id対応・ログINSERT時にreport_id保存・後追いUPDATEなし）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_moderate_review(
  p_review_id uuid, p_action text, p_reason_category text, p_admin_note text,
  p_report_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.anonymous_reviews%ROWTYPE;
        v_prev text; v_new text; v_axis text; v_newstatus text;
        v_disp text; v_mod text; v_rev text;   -- 変更後の3軸（snapshot用）
BEGIN
  IF auth.email() NOT IN ('reimagining.home.lab@gmail.com','1989yo55@gmail.com') THEN
    RAISE EXCEPTION 'forbidden'; END IF;
  IF p_admin_note IS NULL OR btrim(p_admin_note) = '' THEN RAISE EXCEPTION 'admin_note_required'; END IF;

  SELECT * INTO r FROM public.anonymous_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  -- 既定は変更なしの現状態。各分岐で変更軸のみ上書き。
  v_disp := r.display_state; v_mod := r.moderation_state; v_rev := r.review_state;

  IF p_action = 'mark_violation' THEN
    IF r.moderation_state = 'violation' THEN RAISE EXCEPTION 'already_violation'; END IF;
    IF p_reason_category IS NULL OR btrim(p_reason_category) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
    v_axis:='moderation_state'; v_prev:='none'; v_new:='violation'; v_mod:='violation';
    v_newstatus := public.derive_review_status(r.display_state, 'violation', r.review_state);
    UPDATE public.anonymous_reviews SET moderation_state='violation', status=v_newstatus WHERE id=p_review_id;

  ELSIF p_action = 'clear_violation' THEN
    IF r.moderation_state <> 'violation' THEN RAISE EXCEPTION 'not_violation'; END IF;
    v_axis:='moderation_state'; v_prev:='violation'; v_new:='none'; v_mod:='none';
    v_newstatus := public.derive_review_status(r.display_state, 'none', r.review_state);
    UPDATE public.anonymous_reviews SET moderation_state='none', status=v_newstatus WHERE id=p_review_id;

  ELSIF p_action = 'restore_visible' THEN                       -- concealed->visible は運営のみ
    IF r.display_state <> 'concealed' OR r.review_state <> 'active' THEN RAISE EXCEPTION 'invalid_state'; END IF;
    v_axis:='display_state'; v_prev:='concealed'; v_new:='visible'; v_disp:='visible';
    v_newstatus := public.derive_review_status('visible', r.moderation_state, r.review_state);
    UPDATE public.anonymous_reviews SET display_state='visible', status=v_newstatus WHERE id=p_review_id;

  ELSE RAISE EXCEPTION 'invalid_action'; END IF;

  INSERT INTO public.review_moderation_logs(
    review_id, review_id_snapshot, salesperson_id_snapshot, report_id, action,
    actor_user_id, actor_role, axis, previous_status, new_status,
    rating_snapshot, display_state_snapshot, moderation_state_snapshot, review_state_snapshot,
    reason_category, admin_note)
  VALUES (p_review_id, p_review_id, r.salesperson_id, p_report_id, p_action,
    auth.uid(), 'admin', v_axis, v_prev, v_new,
    r.rating, v_disp, v_mod, v_rev,   -- 変更後の3軸＋評価値
    p_reason_category, p_admin_note);
END; $$;

-- ---------------------------------------------------------------------------
-- 3-3. 通報起票
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_review(
  p_review_id uuid, p_reason_category text, p_reason_detail text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_sp uuid; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_reason_category IS NULL OR btrim(p_reason_category) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT salesperson_id INTO v_sp FROM public.anonymous_reviews WHERE id = p_review_id;
  IF v_sp IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  INSERT INTO public.review_reports(review_id, reported_by_user_id, reported_salesperson_id,
    reason_category, reason_detail, status)
  VALUES (p_review_id, auth.uid(), v_sp, p_reason_category, p_reason_detail, 'pending')
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- ---------------------------------------------------------------------------
-- 3-4. 通報解決（upheld->p_report_id を渡して違反認定連動・後追いUPDATEなし）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_review_report(
  p_report_id uuid, p_resolution text, p_admin_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rep public.review_reports%ROWTYPE;
BEGIN
  IF auth.email() NOT IN ('reimagining.home.lab@gmail.com','1989yo55@gmail.com') THEN
    RAISE EXCEPTION 'forbidden'; END IF;
  IF p_resolution NOT IN ('upheld','rejected') THEN RAISE EXCEPTION 'invalid_resolution'; END IF;
  IF p_admin_note IS NULL OR btrim(p_admin_note) = '' THEN RAISE EXCEPTION 'admin_note_required'; END IF;

  SELECT * INTO rep FROM public.review_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF rep.status <> 'pending' THEN RAISE EXCEPTION 'already_resolved'; END IF;

  UPDATE public.review_reports SET status = p_resolution, resolved_at = now() WHERE id = p_report_id;

  IF p_resolution = 'upheld' THEN
    -- ログINSERT時点で report_id を保存（同一トランザクション・後追いUPDATEなし）
    PERFORM public.admin_moderate_review(
      rep.review_id, 'mark_violation', rep.reason_category, p_admin_note, p_report_id);
  END IF;
END; $$;

-- ---------------------------------------------------------------------------
-- 3-5. 運営キュー
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_review_reports()
RETURNS TABLE(report_id uuid, review_id uuid, salesperson_id uuid,
              reason_category text, reason_detail text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT id, review_id, reported_salesperson_id, reason_category, reason_detail, created_at
  FROM public.review_reports
  WHERE status = 'pending'
    AND (SELECT auth.email()) IN ('reimagining.home.lab@gmail.com','1989yo55@gmail.com')
  ORDER BY created_at ASC;
$$;

-- ---------------------------------------------------------------------------
-- 3-6. 統計（キー据え置き total/visible/rate/avg_rating ＋ 内訳キー追加）
--   母数条件の単一定義: base CTE = review_state='active' AND moderation_state='none'。
--   total（母数）・avg_rating（対象）・rate（分母）はすべて base を唯一の母数とし、条件を一致させる。
--   display_state は total / avg_rating の条件に使わない（unconfirmed/visible/concealed を算入）。
--   除外は moderation_state='violation' と review_state='superseded' のみ。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_salesperson_review_stats(p_salesperson_id uuid)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH base AS (
    SELECT rating, display_state FROM public.anonymous_reviews
    WHERE salesperson_id = p_salesperson_id AND review_state='active' AND moderation_state='none'
  )
  SELECT json_build_object(
    'total',             (SELECT count(*) FROM base),
    'visible',           (SELECT count(*) FROM base WHERE display_state='visible'),
    'rate',              (SELECT CASE WHEN count(*)=0 THEN NULL
                            ELSE round(count(*) FILTER (WHERE display_state='visible')::numeric/count(*)*100) END FROM base),
    'avg_rating',        (SELECT CASE WHEN count(*)=0 THEN NULL ELSE round(avg(rating)::numeric,1) END FROM base),
    'concealed_count',   (SELECT count(*) FROM base WHERE display_state='concealed'),
    'unconfirmed_count', (SELECT count(*) FROM base WHERE display_state='unconfirmed'),
    'not_visible_count', (SELECT count(*) FROM base WHERE display_state IN ('concealed','unconfirmed'))
  );
$$;

-- ---------------------------------------------------------------------------
-- 3-7a. QR匿名投稿（search_path='' に統一・全テーブル public. 修飾）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_anonymous_review(
  p_token uuid, p_rating integer, p_content text, p_ip text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_salesperson_id UUID; v_review_id UUID;
BEGIN
  SELECT id INTO v_salesperson_id FROM public.salesperson_profiles
  WHERE qr_token = p_token AND status = 'active' LIMIT 1;
  IF v_salesperson_id IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;

  IF EXISTS (SELECT 1 FROM public.anonymous_reviews
             WHERE ip_address = p_ip AND salesperson_id = v_salesperson_id) THEN
    RETURN jsonb_build_object('error','duplicate_ip'); END IF;

  INSERT INTO public.anonymous_reviews
    (salesperson_id, qr_token, rating, content, ip_address, phase, source,
     display_state, moderation_state, review_state, status)
  VALUES
    (v_salesperson_id, p_token, p_rating, p_content, p_ip, 'pre_contract', 'qr_anonymous',
     'unconfirmed', 'none', 'active', public.derive_review_status('unconfirmed','none','active'))
  RETURNING id INTO v_review_id;

  RETURN jsonb_build_object('success', true, 'reviewId', v_review_id);
END; $$;

-- ---------------------------------------------------------------------------
-- 3-7b. ログイン施主の成約後投稿
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_authenticated_review(
  p_salesperson_id uuid, p_phase text, p_rating integer, p_content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_review_id UUID;
BEGIN
  IF p_phase NOT IN ('post_contract','after_start','after_handover') THEN RAISE EXCEPTION 'invalid_phase'; END IF;
  IF p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION 'invalid_rating'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.salesperson_profiles WHERE id = p_salesperson_id AND status='active') THEN
    RAISE EXCEPTION 'salesperson_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM public.anonymous_reviews
             WHERE user_id = auth.uid() AND salesperson_id = p_salesperson_id
               AND phase = p_phase AND review_state <> 'superseded') THEN
    RAISE EXCEPTION 'duplicate_review'; END IF;

  INSERT INTO public.anonymous_reviews
    (salesperson_id, rating, content, user_id, phase, source,
     display_state, moderation_state, review_state, status, ip_address)
  VALUES
    (p_salesperson_id, p_rating, p_content, auth.uid(), p_phase, 'authenticated_user',
     'unconfirmed', 'none', 'active', public.derive_review_status('unconfirmed','none','active'), 'authenticated_user')
  RETURNING id INTO v_review_id;

  RETURN v_review_id;
END; $$;

-- ---------------------------------------------------------------------------
-- 3-7c. メール認証投稿: オーバーロード統合
--   潜在的な関数解決の曖昧性を排除するため、未使用の 4引数版/5引数版を DROP し、
--   呼び出し元（常に6引数フル送信）が使う 6引数版のみを正とする。
--   rollback は pre_snapshot が3版すべてを退避しているため復元可能。
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_email_verified_review(uuid, integer, text, text);
DROP FUNCTION IF EXISTS public.submit_email_verified_review(uuid, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_email_verified_review(
  p_token uuid, p_rating integer, p_content text, p_email_hash text,
  p_phase text DEFAULT 'pre_contract', p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_salesperson_id UUID; v_review_id UUID;
BEGIN
  SELECT id INTO v_salesperson_id FROM public.salesperson_profiles
  WHERE qr_token = p_token AND status='active' LIMIT 1;
  IF v_salesperson_id IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;

  -- 同一(email_hash,担当,phase)の現行を superseded 化（status同時更新）
  UPDATE public.anonymous_reviews
  SET review_state = 'superseded',
      status = public.derive_review_status(display_state, moderation_state, 'superseded')
  WHERE email_hash = p_email_hash AND salesperson_id = v_salesperson_id
    AND phase = p_phase AND review_state <> 'superseded';

  INSERT INTO public.anonymous_reviews
    (salesperson_id, qr_token, rating, content, ip_address, email_hash, phase, source,
     display_state, moderation_state, review_state, status, user_id)
  VALUES
    (v_salesperson_id, p_token, p_rating, p_content, 'email_verified', p_email_hash, p_phase, 'qr_email_verified',
     'unconfirmed','none','active', public.derive_review_status('unconfirmed','none','active'), p_user_id)
  RETURNING id INTO v_review_id;

  RETURN jsonb_build_object('success', true, 'reviewId', v_review_id);
END; $$;

-- ---------------------------------------------------------------------------
-- 3-8. EXECUTE 権限
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.salesperson_set_review_display(uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_moderate_review(uuid,text,text,text,uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_review(uuid,text,text)                        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_review_report(uuid,text,text)                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pending_review_reports()                         FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.salesperson_set_review_display(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_moderate_review(uuid,text,text,text,uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_review(uuid,text,text)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_review_report(uuid,text,text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_review_reports()                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_salesperson_review_stats(uuid)                   TO anon, authenticated;
-- submit系のEXECUTEは現行付与を維持（anon/authenticated）。6引数版のみ存在。

COMMIT;
