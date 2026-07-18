-- =============================================================================
-- P1-2 第二段階: Phase 3 rollback 用 現行定義の復元セット
-- 位置づけ: rollback/phase3_pre_snapshot.sql の出力で「自動生成・上書き」される想定のファイル。
--           下記は 2026-07-13 時点の現行定義を手動採録したフォールバック（そのまま実行可能）。
--           本番適用直前に pre_snapshot で再生成し、内容を突き合わせること。
-- 注意: 4引数版/5引数版の submit_email_verified_review も復元する（Phase3でDROPしたため）。
-- =============================================================================

-- get_salesperson_review_stats（第一段階版・status IN ('visible','hidden')）
CREATE OR REPLACE FUNCTION public.get_salesperson_review_stats(p_salesperson_id uuid)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT json_build_object(
    'total',   COUNT(*) FILTER (WHERE status IN ('visible','hidden')),
    'visible', COUNT(*) FILTER (WHERE status = 'visible'),
    'hidden',  COUNT(*) FILTER (WHERE status = 'hidden'),
    'rate',    CASE WHEN COUNT(*) FILTER (WHERE status IN ('visible','hidden'))=0 THEN NULL
                    ELSE ROUND(COUNT(*) FILTER (WHERE status='visible')::numeric
                               / COUNT(*) FILTER (WHERE status IN ('visible','hidden')) * 100) END,
    'avg_rating', CASE WHEN COUNT(*) FILTER (WHERE status IN ('visible','hidden'))=0 THEN NULL
                       ELSE ROUND(AVG(rating) FILTER (WHERE status IN ('visible','hidden'))::numeric,1) END
  )
  FROM public.anonymous_reviews
  WHERE salesperson_id = p_salesperson_id;
$function$;

-- submit_anonymous_review（現行: search_path 'public'・status='visible'）
CREATE OR REPLACE FUNCTION public.submit_anonymous_review(
  p_token uuid, p_rating integer, p_content text, p_ip text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_salesperson_id UUID;
  v_review_id      UUID;
BEGIN
  SELECT id INTO v_salesperson_id
  FROM salesperson_profiles
  WHERE qr_token = p_token AND status = 'active'
  LIMIT 1;

  IF v_salesperson_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  IF EXISTS (
    SELECT 1 FROM anonymous_reviews
    WHERE ip_address = p_ip AND salesperson_id = v_salesperson_id
  ) THEN
    RETURN jsonb_build_object('error', 'duplicate_ip');
  END IF;

  INSERT INTO anonymous_reviews
    (salesperson_id, qr_token, rating, content, ip_address, phase, source, status)
  VALUES
    (v_salesperson_id, p_token, p_rating, p_content, p_ip,
     'pre_contract', 'qr_anonymous', 'visible')
  RETURNING id INTO v_review_id;

  RETURN jsonb_build_object('success', true, 'reviewId', v_review_id);
END;
$function$;

-- submit_authenticated_review（現行: status!='superseded' 重複判定・status='visible'）
CREATE OR REPLACE FUNCTION public.submit_authenticated_review(
  p_salesperson_id uuid, p_phase text, p_rating integer, p_content text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_review_id UUID;
BEGIN
  IF p_phase NOT IN ('post_contract', 'after_start', 'after_handover') THEN
    RAISE EXCEPTION 'invalid_phase';
  END IF;

  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'invalid_rating';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.salesperson_profiles WHERE id = p_salesperson_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'salesperson_not_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.anonymous_reviews
    WHERE user_id = auth.uid()
      AND salesperson_id = p_salesperson_id
      AND phase = p_phase
      AND status != 'superseded'
  ) THEN
    RAISE EXCEPTION 'duplicate_review';
  END IF;

  INSERT INTO public.anonymous_reviews (salesperson_id, rating, content, user_id, phase, source, status, ip_address)
  VALUES (p_salesperson_id, p_rating, p_content, auth.uid(), p_phase, 'authenticated_user', 'visible', 'authenticated_user')
  RETURNING id INTO v_review_id;

  RETURN v_review_id;
END;
$function$;

-- submit_email_verified_review 4引数版（現行）
CREATE OR REPLACE FUNCTION public.submit_email_verified_review(
  p_token uuid, p_rating integer, p_content text, p_email_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_salesperson_id UUID;
  v_review_id      UUID;
BEGIN
  SELECT id INTO v_salesperson_id
  FROM public.salesperson_profiles
  WHERE qr_token = p_token AND status = 'active'
  LIMIT 1;

  IF v_salesperson_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.anonymous_reviews
    WHERE email_hash = p_email_hash AND salesperson_id = v_salesperson_id
  ) THEN
    RETURN jsonb_build_object('error', 'duplicate_email');
  END IF;

  INSERT INTO public.anonymous_reviews
    (salesperson_id, qr_token, rating, content, ip_address, email_hash, phase, source, status)
  VALUES
    (v_salesperson_id, p_token, p_rating, p_content, 'email_verified', p_email_hash,
     'pre_contract', 'qr_email_verified', 'visible')
  RETURNING id INTO v_review_id;

  RETURN jsonb_build_object('success', true, 'reviewId', v_review_id);
END;
$function$;

-- submit_email_verified_review 5引数版（現行・p_phase DEFAULT）
CREATE OR REPLACE FUNCTION public.submit_email_verified_review(
  p_token uuid, p_rating integer, p_content text, p_email_hash text, p_phase text DEFAULT 'pre_contract'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_salesperson_id UUID;
  v_review_id      UUID;
BEGIN
  SELECT id INTO v_salesperson_id
  FROM public.salesperson_profiles
  WHERE qr_token = p_token AND status = 'active'
  LIMIT 1;

  IF v_salesperson_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.anonymous_reviews
    WHERE email_hash = p_email_hash AND salesperson_id = v_salesperson_id AND phase = p_phase
  ) THEN
    RETURN jsonb_build_object('error', 'duplicate_email');
  END IF;

  INSERT INTO public.anonymous_reviews
    (salesperson_id, qr_token, rating, content, ip_address, email_hash, phase, source, status)
  VALUES
    (v_salesperson_id, p_token, p_rating, p_content, 'email_verified', p_email_hash,
     p_phase, 'qr_email_verified', 'visible')
  RETURNING id INTO v_review_id;

  RETURN jsonb_build_object('success', true, 'reviewId', v_review_id);
END;
$function$;

-- submit_email_verified_review 6引数版（現行・p_phase/p_user_id DEFAULT・superseded上書き）
CREATE OR REPLACE FUNCTION public.submit_email_verified_review(
  p_token uuid, p_rating integer, p_content text, p_email_hash text,
  p_phase text DEFAULT 'pre_contract'::text, p_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  v_salesperson_id UUID;
  v_review_id      UUID;
BEGIN
  SELECT id INTO v_salesperson_id
  FROM public.salesperson_profiles
  WHERE qr_token = p_token AND status = 'active'
  LIMIT 1;

  IF v_salesperson_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  UPDATE public.anonymous_reviews
  SET status = 'superseded'
  WHERE email_hash = p_email_hash AND salesperson_id = v_salesperson_id
    AND phase = p_phase AND status != 'superseded';

  INSERT INTO public.anonymous_reviews
    (salesperson_id, qr_token, rating, content, ip_address, email_hash, phase, source, status, user_id)
  VALUES
    (v_salesperson_id, p_token, p_rating, p_content, 'email_verified', p_email_hash,
     p_phase, 'qr_email_verified', 'visible', p_user_id)
  RETURNING id INTO v_review_id;

  RETURN jsonb_build_object('success', true, 'reviewId', v_review_id);
END;
$function$;
