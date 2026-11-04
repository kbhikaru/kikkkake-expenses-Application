# kikkkake-expenses-Application

KIKKAKE / TIE Coffee 共通の経費申請アプリ（Google Apps Script）。
Googleフォームのファイルアップロードが共有ドライブで使えなくなった問題を解消し、
申請 → 承認 → freee会計への連携 → ダッシュボード分析 までを一つにまとめます。

管理者：https://script.google.com/a/macros/souvenir.ink/s/AKfycbzwcZwfwqkx4TSLRN2N13cIEZw44RPChtlJB1Qb3KuBqa-mLe7rIVl-DUBJK3U1yHQSFQ/exec
申請者：https://script.google.com/a/macros/souvenir.ink/s/AKfycbxAUFa6CV5ht8p7QLkNnnW7PzBzy5ATz9BxBtBAMz_q7v_FTxxPe1SeK4nC2lnuFL8/exec

## 構成

```
┌──────────────────────────┐      ┌──────────────────────────────┐
│ 申請者用（コンテナバインド） │      │ 管理者用（単独GAS）            │
│ 経費DBスプレッドシートの     │      │ パスワード認証                 │
│ 拡張機能 > Apps Script      │      │ ・ダッシュボード               │
│ ・申請フォーム（Webアプリ）  │      │ ・申請一覧／承認／差戻し／修正  │
│ ・領収書を共有ドライブへ保存 │      │ ・freee連携（CSV / API）       │
└────────────┬─────────────┘      │ ・フォーム編集／マスタ／設定    │
             │                    └──────────────┬───────────────┘
             ▼                                   ▼
   ┌──────────────────────────────────────────────────────┐
   │ 経費DBスプレッドシート（ホーム）                         │
   │  経費データ / 設定 / フォーム項目 / 勘定科目マスタ /       │
   │  税区分マスタ / 所属区分マスタ / 操作ログ                 │
   └──────────────────────────────────────────────────────┘
        ▲ 参照のみ（社員ID・氏名・部署だけ）      │ 領収書
   【マスタ】会社全体_KIKKAKE「従業員」シート      ▼ 共有ドライブ/yyyy年MM月_経費精算/
```

| フォルダ | 内容 |
|---|---|
| `apps/applicant/` | 申請者用GAS（経費DBスプレッドシートに紐づけ） |
| `apps/admin/` | 管理者用GAS（単独のApps Scriptプロジェクト） |
| `shared/` | 両方で使う共通コード（スキーマ・データ操作）の正本 |
| `scripts/sync-shared.sh` | `shared/` を両アプリにコピー |
| `docs/設計書.md` | データベース設計・freeeとの対応・運用フロー |

> `shared/*.gs` を編集したら `./scripts/sync-shared.sh` を実行してください（各アプリにコピー済みのファイルもコミットします）。

## セットアップ手順

### 1. 経費DBスプレッドシート ＋ 申請者用アプリ

1. 共有ドライブに新しいスプレッドシートを作成（例：「【記録DB】経費申請」）
2. 「拡張機能 > Apps Script」を開き、`apps/applicant/` の全ファイルを同じ名前で作成して貼り付け
   - `.gs` はスクリプト、`.html` は HTML ファイルとして追加
   - 「プロジェクトの設定」で「appsscript.json をエディタで表示」をオンにして `appsscript.json` も上書き
3. スプレッドシートを再読み込み → メニュー「経費申請アプリ > ① 初期セットアップ」を実行（権限を許可）
4. 「設定」シートの `RECEIPT_FOLDER_ID` に領収書を保存する共有ドライブのフォルダIDを入力
   （フォルダURL `https://drive.google.com/drive/folders/XXXX` の `XXXX` 部分）
5. Apps Script で「デプロイ > 新しいデプロイ > 種類：ウェブアプリ」
   - 次のユーザーとして実行：**自分**（← 申請者に共有ドライブ権限がなくても保存できる）
   - アクセスできるユーザー：**souvenir.ink 内の全員**（バリスタが会社アカウントを持っていない場合は「全員」）
6. 発行されたURLを社員・バリスタに共有（「設定」シートの `APPLICANT_APP_URL` にも入れておくと管理画面からリンクされます）

### 2. 管理者用アプリ

1. [script.google.com](https://script.google.com) で「新しいプロジェクト」を作成（例：「経費申請 管理画面」）
2. `apps/admin/` の全ファイルを貼り付け（`appsscript.json` も）
3. 「プロジェクトの設定 > スクリプト プロパティ」に追加
   - `HOME_SPREADSHEET_ID`：手順1で作ったスプレッドシートのID
   - `INITIAL_PASSWORD`：管理画面の初期パスワード（8文字以上）
4. エディタで関数 `initialSetup` を選んで実行 → パスワードはハッシュ化され、`INITIAL_PASSWORD` は自動で削除されます
5. 「デプロイ > 新しいデプロイ > ウェブアプリ」（実行：自分 / アクセス：souvenir.ink 内の全員）
6. URLを開いてパスワードでログイン → 「設定」タブの「接続テスト」で問題がないか確認

> さらに安全にしたい場合は、管理画面「設定 > 管理者アカウント制限」にメールアドレスを登録すると、
> パスワード＋指定のGoogleアカウントの二重チェックになります。

### clasp を使う場合（任意）

```bash
npm i -g @google/clasp && clasp login
```

```bash
cd apps/applicant && clasp clone <申請者用スクリプトID> --rootDir . && clasp push
```

```bash
cd apps/admin && clasp clone <管理者用スクリプトID> --rootDir . && clasp push
```

## 日々の運用

1. 社員・バリスタが申請画面から申請（所属区分 → 内容入力 → レシート撮影）
2. 管理者が「申請一覧」で内容を確認 → 勘定科目などを必要に応じて修正 → 承認（差戻しは理由付き）
3. 月末に「freee連携」で承認済をCSV出力し、freee会計［取引 → 取引のインポート］で取り込み
   （または API 方式でボタン一つで取引＋証憑を登録）
4. 「ダッシュボード」で月別・所属区分別・勘定科目別・個人別の利用状況を確認

### 旧Googleフォームの回答を取り込む

経費DBスプレッドシートのメニュー「経費申請アプリ > 旧Googleフォームの回答を取り込む」で、
`【マスタ】フォーム回答` の「【回答】経費申請フォーム_KIKKAKE」「【回答】経費申請フォーム_TIE」を取り込めます。
過去分もダッシュボードで集計できるようになります（freee登録済みなら「freee連携済」として取込可）。
