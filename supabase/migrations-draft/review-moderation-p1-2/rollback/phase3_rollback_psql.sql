-- =============================================================================
-- P1-2 第二段階: Phase 3 rollback（psql 運用手順・migration本体とは分離）
-- 注意: このファイルは psql の \i を使う運用スクリプト。
--       Supabase の通常 migration（supabase db push / dashboard SQL）ではそのまま使えない。
--       Supabase 経由で戻す場合は phase3_restore_functions.sql の中身を貼り付けて実行し、
--       末尾の DROP FUNCTION 群を続けて実行すること。
-- 前提: Phase 5 未適用（RLSが旧statusベース）であること。Phase5適用後に3を戻す場合は
--       先に phase5_rollback.sql を実行する。
-- 使い方: psql "$DATABASE_URL" -f rollback/phase3_rollback_psql.sql
-- =============================================================================
BEGIN;

-- (a) 現行定義を復元（submit系・stats を Phase3前へ）
\i phase3_restore_functions.sql

-- (b) Phase3で新設したRPCを削除
DROP FUNCTION IF EXISTS public.salesperson_set_review_display(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.admin_moderate_review(uuid, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.report_review(uuid, text, text);
DROP FUNCTION IF EXISTS public.resolve_review_report(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_pending_review_reports();

COMMIT;
