# 倉庫 貸出・返却 管理アプリ（本番版）

iPhone / Android 両対応の PWA（Web アプリ）。バックエンドは Supabase（PostgreSQL）。
**すべて無料枠で運用できます（費用 $0）。**

---

## 全体構成（無料）

| 役割 | サービス | 無料枠 |
|---|---|---|
| データベース・認証・API | **Supabase** Free | DB 500MB / 認証 5万人/月 / API 無制限 |
| フロント配信 | **Cloudflare Pages** Free | 帯域無制限・商用利用OK |

> ストレージについて：Google Drive のような「ファイル置き場」は、貸出・返却のように
> 行を更新し続け、同時アクセスの整合性が必要なデータには向きません。
> 必要なのは「データベース」で、それを無料で担うのが Supabase です。

---

## セットアップ手順

### 1. Supabase プロジェクトを作る（無料）
1. https://supabase.com にサインアップ
2. 「New project」→ 名前・パスワード・リージョン（Tokyo 推奨）を設定して作成

### 2. データベースを構築する
1. 左メニュー「SQL Editor」を開く
2. 同梱の **`schema.sql`** の中身を全部貼り付けて **Run**
   （テーブル・権限・在庫の原子的処理・初期データ10件が入ります）

### 3. メール認証を有効化
1. 「Authentication」→「Providers」→ **Email** を有効化
2. テスト中はメール確認をオフにすると楽（Authentication → Sign In / Providers の設定）

### 4. 接続情報を設定
1. 「Project Settings」→「API」から **Project URL** と **anon public key** をコピー
2. `warehouse-app/.env.example` を `.env` にコピーして値を貼り付け
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGci...
   ```

### 5. 自分を管理者にする
アプリでアカウント作成後、SQL Editor で（メールを自分のものに）：
```sql
update profiles set role = 'admin'
where id = (select id from auth.users where email = 'あなたのメール');
```

### 6. ローカルで起動
```bash
cd warehouse-app
npm install
npm run dev      # http://localhost:5173
```

### 7. 公開（Cloudflare Pages・無料）
1. このフォルダを GitHub リポジトリに push
2. Cloudflare Pages で「Connect to Git」→ ビルド設定：
   - Build command: `npm run build`
   - Output directory: `dist`
   - 環境変数に `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を登録
3. デプロイ後の URL をスマホで開き、「ホーム画面に追加」でアプリ化

---

## 無料枠の注意点と対策

- **1週間アクセスが無いとプロジェクトが一時停止**
  → 使う時にダッシュボードから再開すればOK。常時起こしたい場合は GitHub Actions の
  cron（無料）や UptimeRobot（無料）で定期的に URL を叩く。
- **自動バックアップが無い**
  → アプリの「CSV出力」で定期的にエクスポート、または GitHub Actions で定期バックアップ。

内部利用（部活・係の備品管理など）であれば、無料枠で十分実用になります。

---

## 安全性について（在庫の二重貸出防止）

貸出・返却は Supabase 側の関数 `lend_item` / `return_loan` で実行され、
在庫の減算は「在庫が足りる時だけ更新する」条件付き更新＋行ロックで**原子的**に処理されます。
複数人が同時に最後の1個を借りようとしても、成立するのは1人だけ・売り越しは発生しません。
（この挙動はローカル PostgreSQL での並行実行テストで検証済み）

## ファイル構成
```
schema.sql                 … Supabase に流すDB定義（これが本番の核）
warehouse-app/
  ├─ src/App.jsx           … 画面
  ├─ src/api.js            … Supabase 呼び出し層
  ├─ src/supabaseClient.js … 接続
  ├─ .env.example          … 接続情報テンプレ
  └─ package.json
```
