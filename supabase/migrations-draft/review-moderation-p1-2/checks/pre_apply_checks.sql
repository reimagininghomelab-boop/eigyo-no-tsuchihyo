-- =============================================================================
-- P1-2 第二段階: 適用前 確認クエリ（read-only）
-- 本文・IP・メール・実名は出力しない（件数/状態のみ）。
-- =============================================================================

-- (A) 想定外status（Phase2適用前提。0件で続行）
SELECT status, count(*) AS cnt
FROM public.anonymous_reviews
WHERE status NOT IN ('visible','hidden','superseded')
GROUP BY status;

-- submit_email_verified_review の現行シグネチャ（Phase3の統合前確認）
SELECT p.oid::regprocedure AS signature
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='submit_email_verified_review'
ORDER BY p.pronargs;
