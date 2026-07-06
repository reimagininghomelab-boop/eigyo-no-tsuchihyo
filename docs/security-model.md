# ERABERU セキュリティモデル

住宅営業マッチングにおいて「開示前後の情報差」が商品価値の中核であるため、
営業の個人情報・開示後情報の露出面は厳密に制御する。本書はその境界を定義する。

> 本書には Supabase の project ID・APIキー・接続情報などのシークレットは意図的に記載しない。

## salesperson_profiles と公開面の関係

| オブジェクト | 種別 | 誰が読むか | 保護機構 |
|---|---|---|---|
| `salesperson_profiles` | TABLE | 本人 / admin / （anonは安全列のみ） | RLS ＋ カラム権限 |
| `safe_salesperson_profiles` | VIEW | anon / authenticated（公開一覧） | **ビュー定義の列制限＋WHERE**（RLSではない） |
| 開示後プロフィール | RPC | 決済済みバイヤー・レビュー投稿者 | SECURITY DEFINER RPC |

## safe_salesperson_profiles のセキュリティ境界（重要）

- `safe_salesperson_profiles` は **公開営業一覧で原則使用する安全ビュー**であり、
  **postgres 所有の非 security_invoker VIEW**。
  クエリはビュー所有者（postgres）権限で実行され、**ベーステーブルの RLS・カラム権限を迂回する**。
- したがってセキュリティ境界は RLS ではなく、次の2点である：
  1. **ビュー定義に含める列**（安全列のみ）
  2. **WHERE 句** `status = 'active' AND is_visible = true`
- 公開してよい安全列：
  `id, company_name, status, is_verified, department, core_city, area_prefecture,
   available_prefectures, specialty_styles, sales_styles, qualifications,
   ai_summary, name_initials(マスク済), profile_image_url`

### 追加禁止列（絶対に VIEW / 公開面へ出さない）
`real_name`, `family_name`, `given_name`, `application_email`,
`application_company_name`, `qr_token`, `user_id`,
`bio`, `contract_count`, `experience_years`

- 前7列は個人情報・なりすまし材料（特に `qr_token` は口コミ投稿の詐称に直結）。
- `bio` / `contract_count` / `experience_years` は**開示後にのみ提供する商品価値情報**。
- `SELECT *` 化、および上記列の追加は**個人情報・商品価値の漏洩に直結するため厳禁**。

## 実名・開示後情報の提供経路

実名等は VIEW でもベーステーブル直参照でもなく、**SECURITY DEFINER RPC 経由に限定**する：
- `get_unlocked_salesperson_profile(p_agent_id)` … 決済済みバイヤー向け（単一）
- `get_my_unlocked_salesperson_profiles()` … 決済済みバイヤー向け（一覧）
- `get_salesperson_name_for_reviewer(p_salesperson_id)` … オファー/口コミ実績のある投稿者向け

## ベーステーブル直参照の制約（2026-07-05 P0 修正後）

- `salesperson_profiles` への anon 直読みは**安全列のカラム権限のみ**（秘匿列は権限なし）。
- authenticated の行可視性は **本人（user_id = auth.uid()）と admin のみ**。
  公開中の他営業行は直参照できない（公開閲覧は `safe_salesperson_profiles` 経由）。
- **営業本人による自プロフィール参照は、現状は本人行のみ許可する RLS（user_id = auth.uid()）で行う。
  将来的に専用 RPC 化を検討する。**
- 公開読取ポリシー（`anon can read safe columns` / `anon can lookup salesperson by qr_token`）は
  `TO anon` に限定済み。`TO public`（authenticated を含む）へ戻してはならない。

参照: 関連する P0/P1 対応の経緯は開発メモを参照。
