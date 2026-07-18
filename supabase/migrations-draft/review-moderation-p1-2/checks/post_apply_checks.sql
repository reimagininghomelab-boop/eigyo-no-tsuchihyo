-- =============================================================================
-- P1-2 第二段階: 適用後 確認クエリ（read-only）
-- 本文・IP・メール・実名は出力しない（件数/状態/権限のみ）。
-- =============================================================================

-- (B) バックフィル後 NULL残存（0件）
SELECT count(*) AS null_rows FROM public.anonymous_reviews
WHERE display_state IS NULL OR moderation_state IS NULL OR review_state IS NULL;

-- (C) drift: status = 3軸導出（RPC経由なら0。Phase2〜4は旧admin直UPDATE分のみ>0 -> Phase5-STEP3で解消）
SELECT count(*) AS drift FROM public.anonymous_reviews
WHERE status <> public.derive_review_status(display_state, moderation_state, review_state);

-- (D) 新規unconfirmedが漏れない（unconfirmed行の status が全て 'hidden'）（0件）
SELECT count(*) AS leaking FROM public.anonymous_reviews
WHERE display_state='unconfirmed' AND status <> 'hidden';

-- (E) マッピング分布（件数のみ）
SELECT status, display_state, moderation_state, review_state, count(*)
FROM public.anonymous_reviews GROUP BY 1,2,3,4 ORDER BY 1,2,3,4;

-- (F) CHECK外の不正値（0件）
SELECT count(*) AS invalid FROM public.anonymous_reviews
WHERE display_state NOT IN ('unconfirmed','visible','concealed')
   OR moderation_state NOT IN ('none','violation')
   OR review_state NOT IN ('active','superseded');

-- (G) 既存公開レビューの維持（still_public / total_rows）
SELECT count(*) FILTER (WHERE display_state='visible' AND moderation_state='none' AND review_state='active') AS still_public,
       count(*) AS total_rows FROM public.anonymous_reviews;

-- (H) Phase5後 column-level UPDATE権限（authenticated が status で並ばないこと）
SELECT grantee, column_name, privilege_type FROM information_schema.column_privileges
WHERE table_name='anonymous_reviews' AND privilege_type='UPDATE'
ORDER BY grantee, column_name;

-- (I) 監査の削除耐性: logs/reports に anon/authenticated の UPDATE/DELETE が無い（0件）
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name IN ('review_moderation_logs','review_reports')
  AND grantee IN ('anon','authenticated') AND privilege_type IN ('UPDATE','DELETE');

-- (J) FKが RESTRICT（CASCADEでない）
SELECT tc.constraint_name, rc.delete_rule
FROM information_schema.referential_constraints rc
JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name IN ('review_moderation_logs','review_reports');

-- (K) 新テーブル RLS 有効
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('review_reports','review_moderation_logs') AND relnamespace='public'::regnamespace;

-- (L) report連動の紐付け確認（upheld後: mark_violationログに report_id が入っている件数）
SELECT count(*) AS linked FROM public.review_moderation_logs
WHERE action='mark_violation' AND report_id IS NOT NULL;

-- (M) table-level INSERT/UPDATE/DELETE 権限（Phase5後: authenticated が並ばないこと）
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='anonymous_reviews'
  AND privilege_type IN ('INSERT','UPDATE','DELETE')
ORDER BY grantee, privilege_type;

-- (N) submit_email_verified_review が6引数版の単一に統合されたこと（Phase3後）
SELECT p.oid::regprocedure AS signature
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='submit_email_verified_review'
ORDER BY p.pronargs;

-- (O) 集計条件の一致検証（営業別）: total と avg_rating の対象がズレていないこと。
--   total_count = avg_target_count（両者とも review_state='active' AND moderation_state='none'）であること。
--   rating_non_null_count は avg の実効対象（rating NULL があれば avg から自然除外される想定の可視化）。
--   visible+concealed+unconfirmed = total_count（display_stateは母数条件に使わない）を確認できる。
SELECT
  salesperson_id,
  count(*) FILTER (WHERE review_state='active' AND moderation_state='none')                        AS total_count,
  count(*) FILTER (WHERE review_state='active' AND moderation_state='none')                        AS avg_target_count,
  count(rating) FILTER (WHERE review_state='active' AND moderation_state='none')                   AS rating_non_null_count,
  count(*) FILTER (WHERE review_state='active' AND moderation_state='none' AND display_state='visible')     AS visible_count,
  count(*) FILTER (WHERE review_state='active' AND moderation_state='none' AND display_state='concealed')   AS concealed_count,
  count(*) FILTER (WHERE review_state='active' AND moderation_state='none' AND display_state='unconfirmed') AS unconfirmed_count,
  count(*) FILTER (WHERE moderation_state='violation')                                             AS violation_count,
  count(*) FILTER (WHERE review_state='superseded')                                                AS superseded_count
FROM public.anonymous_reviews
GROUP BY salesperson_id
ORDER BY salesperson_id;

-- (P) あり得ない組み合わせの検出（全体の3軸×status分布。目視用）
SELECT display_state, moderation_state, review_state, status, count(*)
FROM public.anonymous_reviews
GROUP BY 1,2,3,4
ORDER BY 1,2,3,4;

-- (Q) status矛盾の明示検出（各行が0件であること）
SELECT 'superseded_status_mismatch' AS check, count(*) AS bad FROM public.anonymous_reviews
  WHERE review_state='superseded' AND status <> 'superseded'
UNION ALL
SELECT 'unconfirmed_status_mismatch', count(*) FROM public.anonymous_reviews
  WHERE display_state='unconfirmed' AND status <> 'hidden'
UNION ALL
SELECT 'violation_status_mismatch', count(*) FROM public.anonymous_reviews
  WHERE moderation_state='violation' AND status <> 'hidden'
UNION ALL
SELECT 'visible_status_mismatch', count(*) FROM public.anonymous_reviews
  WHERE review_state='active' AND moderation_state='none' AND display_state='visible' AND status <> 'visible';
