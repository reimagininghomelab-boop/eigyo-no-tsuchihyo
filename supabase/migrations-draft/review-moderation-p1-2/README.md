# P1-2 第二段階: 口コミ非公開・モデレーション恒久設計（未適用ドラフト）

**状態: 未適用ドラフト。** SQLは未適用。commit/push前。カテゴリ体系は未確定。

このディレクトリは `supabase/migrations/`（自動適用パス）には**置いていない**。
Phase間に手動検証・フロントデプロイ（Phase 4）が挟まり、単一の `supabase db push` では流せないため。
各Phaseを実行する段になって、該当SQLを正式な timestamped migration として `supabase/migrations/` へ昇格させる。

## 状態モデル（3軸独立）
- `display_state`: unconfirmed / visible / concealed（営業操作。復帰 concealed→visible は運営のみ）
- `moderation_state`: none / violation（運営のみ。violation時も display_state は保持）
- `review_state`: active / superseded（システムのみ。再投稿上書き）
- 母数/平均/総件数 = `review_state='active' AND moderation_state='none'`（unconfirmed/visible/concealed を算入）
- 施主本文表示 = `display_state='visible' AND moderation_state='none' AND review_state='active'`
- status（レガシー）は `derive_review_status()` で3軸から導出（dual-write）

### 集計条件の統一（get_salesperson_review_stats）
total（母数）・avg_rating（対象）・rate（分母）は **同一条件 `review_state='active' AND moderation_state='none'`**
（base CTE 一箇所に集約）。`display_state` は total / avg_rating の条件に使わない。
- 平均・母数に**含める**: unconfirmed / visible / concealed
- 平均・母数から**除外**: `moderation_state='violation'` / `review_state='superseded'`
検証は `checks/post_apply_checks.sql` の (O)（営業別 total_count=avg_target_count 等）で行う。

### 既存データの移行マッピング（phase2_backfill.sql）
| 旧 status | display_state | moderation_state | review_state |
|---|---|---|---|
| visible    | visible   | none | active |
| hidden     | concealed | none | active |
| superseded | concealed | none | superseded |

superseded の display は `visible` ではなく **`concealed`**（防御的）。review_state で集計除外されるが、
display_state 単体を見るコードが将来出ても露出しないよう「見せない側」へ寄せる。数値影響はない。

### derive_review_status() 導出表（旧status互換値）
| 条件 | status |
|---|---|
| `review_state='superseded'` | `superseded` |
| `display_state='visible' AND moderation_state='none' AND review_state='active'` | `visible` |
| それ以外 | `hidden` |

### 移行期における旧 status の多義性（重要）
移行期間中、旧 `status='hidden'` は複数状態を同時に表す：`display_state='unconfirmed'` /
`display_state='concealed'` / `moderation_state='violation'`。
そのため **Phase 3 以降、旧 status は「意味判断」に使わず、互換・RLS移行用の派生値としてのみ扱う**。
未確認・営業非公開・違反の区別には必ず3軸を参照する。

### 監査ログの snapshot 列（採用）
`review_moderation_logs` に判断時点の状態を複製する snapshot 列を持たせる（本文は複製しない）：
`review_id_snapshot`, `salesperson_id_snapshot`, `rating_snapshot`,
`display_state_snapshot`, `moderation_state_snapshot`, `review_state_snapshot`。
状態変更RPC（salesperson_set_review_display / admin_moderate_review）が**変更後の3軸＋評価値**を記録する。
本文（content）は複製しない — 個人情報・削除対応・保管範囲の拡大を避けるため。

## Phase 進行順
1. **phase1_additive.sql** — 追加DDL・新テーブル・RLS/GRANT・`derive_review_status()`（後方互換）
2. **phase2_backfill.sql** — 既存データ移行＋制約/INDEX（トリガは入れない）
3. **phase3_rpc.sql** — RPC群。submit系/状態変更RPCとも3軸＋status dual-write。
   `submit_email_verified_review` は6引数版へ統合（4/5引数版DROP）。RLSはまだ旧statusベース。
4. **Phase 4（SQLなし）** — フロントを新RPC・3軸へ切替＋本番動作確認（旧status RLSのまま両立確認）。
   完了後、**観測期間（数日〜1週間）**を置き drift が増えないことを確認する（下記運用ルール参照）。
5. **phase5_lockdown.sql** — **Phase 4完了＋観測期間後**にロックダウン（即日実施しない）。
   drift確認→reconcile→トリガ導入→RLS3軸化→admin UPDATEポリシーDROP→UPDATE権限REVOKE（table+column）

> 直接UPDATE剥奪・トリガ導入・RLS3軸化は必ず Phase 5（Phase 4のフロント確認＋観測期間後）。
> Phase 2で旧status更新を無効化しないことで、旧admin画面が途中で壊れる時間帯を作らない。

### Phase 3〜4 運用ルール（旧admin直UPDATEの扱い）
Fable 5指摘のとおり、Phase 3〜4は旧admin直UPDATE経路が残るため status↔3軸の drift が発生し得る。
直UPDATE剥奪は Phase 5（フロント確認後）に行う方針は維持しつつ、期間中は以下を守る：
- Phase 3〜4の間は、**旧admin画面からの口コミ status 直接変更を原則禁止**（新RPC/新フロント経由のみ）。
- やむを得ず旧admin画面で変更した場合は、`checks/post_apply_checks.sql` (C) の drift 確認クエリを実行し、
  **Phase 5 前の reconcile 対象として記録**する。
- Phase 4 確認完了後、**数日〜1週間の観測期間**を置き、drift が増えないことを確認してから Phase 5 へ進む。

### Phase 4 動作確認チェックリスト
- [ ] 営業ダッシュボード: unconfirmed→visible / unconfirmed→concealed（理由必須）がRPCで成功。concealed→visible は営業UIに出さない
- [ ] admin: mark_violation / clear_violation / restore_visible がRPCで成功し監査ログに記録（snapshot列含む）
- [ ] 通報: report_review 起票 → get_pending_review_reports に出る → resolve_review_report(upheld) で違反認定＆ログに report_id 保存
- [ ] 新規投稿が display_state='unconfirmed' かつ status='hidden'（(D)）
- [ ] 施主画面に unconfirmed / concealed / violation / superseded の本文が出ない
- [ ] get_salesperson_review_stats の total/visible/rate/avg_rating が想定どおり（(O) で total_count=avg_target_count）
- [ ] drift=0 に近い（(C)。残るのは旧admin直UPDATE分のみ・記録済み）

## ディレクトリ
- `checks/` — 適用前後の確認クエリ（read-only。本文/個人情報を出さない）
- `rollback/` — 各Phaseのrollback。`phase3_rollback_psql.sql` は psql `\i` 前提の運用手順で、
  migration本体とは分離。`phase3_pre_snapshot.sql` で現行定義を退避 →
  `phase3_restore_functions.sql`（現行定義のフォールバックを手動採録済み）で復元。

## 未確定・保留
- **reason_category 体系は未確定。** 初回は `text` のまま、conceal/mark_violation 時は空文字禁止のみRPCで強制。
  違反カテゴリによる自動 review_reports 起票はカテゴリ確定後に別テーマで追加。
- `get_salesperson_name_for_reviewer` も現行 `search_path 'public'`。今回対象外（別migrationで統一候補）。

## 適用時の注意
- 本番適用は各Phaseを個別に。Phase境界ごとに `checks/` で検証。
- 適用・commit・push は本ドラフト確定後、明示の指示で実施する。
