-- =============================================================================
-- P1-2 第二段階: Phase 3 適用「直前」に実行する退避スナップショット
-- 目的: 現行のRPC定義を実行可能な CREATE OR REPLACE 文として出力し、
--       rollback/phase3_restore_functions.sql として保存する。
-- 使い方(psql例):
--   psql "$DATABASE_URL" -At -f rollback/phase3_pre_snapshot.sql > rollback/phase3_restore_functions.sql
-- 注意: 出力を必ず目視確認してから rollback に使用すること。
-- =============================================================================
SELECT pg_get_functiondef(p.oid) || E';\n'
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.prokind='f'
  AND p.proname IN ('get_salesperson_review_stats',
                    'submit_anonymous_review',
                    'submit_authenticated_review',
                    'submit_email_verified_review')
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);
