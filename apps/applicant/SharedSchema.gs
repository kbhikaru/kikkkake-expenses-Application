/**
 * ============================================================
 *  経費申請アプリ 共通スキーマ（申請者用・管理者用の両方で使用）
 *  ※ このファイルは shared/ が正本です。編集後は
 *    scripts/sync-shared.sh で apps/applicant と apps/admin にコピーしてください。
 * ============================================================
 */

/** シート名 */
var SHEETS = {
  RECORDS: '経費データ',
  SETTINGS: '設定',
  FIELDS: 'フォーム項目',
  ACCOUNTS: '勘定科目マスタ',
  TAXES: '税区分マスタ',
  CATEGORIES: '所属区分マスタ',
  VENDORS: '支払先マスタ',
  LOG: '操作ログ'
};

/** 申請ステータス */
var STATUS = {
  PENDING: '申請中',
  APPROVED: '承認済',
  REJECTED: '差戻し',
  EXPORTED: 'freee連携済',
  ARCHIVED: 'アーカイブ'   // 誤申請などを集計から外す（削除はせず、いつでも元に戻せる）
};

/**
 * 経費データ（1行 = 1申請 = freeeの1取引）
 * key はプログラム内部名、label はシートの見出し。
 * 列の並び替えをしても見出し名で判定するので壊れません。
 */
var RECORD_COLUMNS = [
  { key: 'id', label: '申請ID' },
  { key: 'submittedAt', label: '申請日時' },
  { key: 'applicantEmail', label: '申請者メール' },
  { key: 'category', label: '所属区分' },
  { key: 'payerId', label: '支払者ID' },
  { key: 'payerName', label: '支払者氏名' },
  { key: 'department', label: 'freee部門' },
  { key: 'paymentDate', label: '支払日' },
  { key: 'vendor', label: '支払先/店名' },
  { key: 'amount', label: '金額（税込）' },
  { key: 'accountItem', label: '勘定科目' },
  { key: 'freeeAccountItem', label: 'freee勘定科目' },
  { key: 'taxRateLabel', label: '税率' },
  { key: 'taxRate', label: '税率(%)' },
  { key: 'freeeTaxName', label: 'freee税区分' },
  { key: 'netAmount', label: '税抜金額' },
  { key: 'taxAmount', label: '消費税額' },
  { key: 'paymentMethod', label: '支払方法' },
  { key: 'invoiceType', label: '適格請求書' },
  { key: 'invoiceNumber', label: '登録番号' },
  { key: 'description', label: '備考・内容' },
  { key: 'receiptFileIds', label: '領収書ファイルID' },
  { key: 'receiptUrls', label: '領収書URL' },
  { key: 'status', label: 'ステータス' },
  { key: 'reviewer', label: '承認者' },
  { key: 'reviewedAt', label: '承認日時' },
  { key: 'reviewComment', label: '承認・差戻しコメント' },
  { key: 'freeeDealId', label: 'freee取引ID' },
  { key: 'freeeReceiptIds', label: 'freee証憑ID' },
  { key: 'freeeExportedAt', label: 'freee連携日時' },
  { key: 'freeeExportBatch', label: 'freee出力バッチ' },
  { key: 'statementId', label: '精算書番号' },
  { key: 'statementUrl', label: '精算書URL' },
  { key: 'statusBeforeArchive', label: 'アーカイブ前ステータス' },
  { key: 'archivedAt', label: 'アーカイブ日時' },
  { key: 'archivedBy', label: 'アーカイブ実行者' },
  { key: 'archiveReason', label: 'アーカイブ理由' },
  { key: 'extra', label: 'カスタム項目(JSON)' },
  { key: 'updatedAt', label: '更新日時' }
];

/** マスタ系テーブル定義 */
var TABLES = {
  settings: {
    sheet: SHEETS.SETTINGS,
    columns: [
      { key: 'key', label: 'キー' },
      { key: 'value', label: '値' },
      { key: 'note', label: '説明' }
    ]
  },
  fields: {
    sheet: SHEETS.FIELDS,
    columns: [
      { key: 'key', label: '項目キー' },
      { key: 'label', label: 'ラベル' },
      { key: 'type', label: '種類' },
      { key: 'required', label: '必須' },
      { key: 'options', label: '選択肢（改行区切り）' },
      { key: 'categories', label: '対象所属区分' },
      { key: 'order', label: '表示順' },
      { key: 'enabled', label: '有効' },
      { key: 'help', label: '説明文' },
      { key: 'placeholder', label: '入力例' },
      { key: 'system', label: 'システム項目' }
    ]
  },
  accounts: {
    sheet: SHEETS.ACCOUNTS,
    columns: [
      { key: 'label', label: '表示名' },
      { key: 'freeeName', label: 'freee勘定科目' },
      { key: 'freeeId', label: 'freee勘定科目ID' },
      { key: 'categories', label: '対象所属区分' },
      { key: 'defaultTax', label: '既定の税率' },
      { key: 'order', label: '表示順' },
      { key: 'enabled', label: '有効' }
    ]
  },
  taxes: {
    sheet: SHEETS.TAXES,
    columns: [
      { key: 'label', label: '表示名' },
      { key: 'rate', label: '税率(%)' },
      { key: 'freeeName', label: 'freee税区分（適格）' },
      { key: 'freeeNameNonQualified', label: 'freee税区分（非適格）' },
      { key: 'freeeCode', label: 'freee税区分コード（適格）' },
      { key: 'freeeCodeNonQualified', label: 'freee税区分コード（非適格）' },
      { key: 'order', label: '表示順' },
      { key: 'enabled', label: '有効' }
    ]
  },
  categories: {
    sheet: SHEETS.CATEGORIES,
    columns: [
      { key: 'name', label: '区分名' },
      { key: 'description', label: '説明' },
      { key: 'departments', label: '対象部署（従業員マスタ）' },
      { key: 'freeeSection', label: 'freee部門' },
      { key: 'color', label: '表示色' },
      { key: 'order', label: '表示順' },
      { key: 'enabled', label: '有効' }
    ]
  },
  vendors: {
    sheet: SHEETS.VENDORS,
    columns: [
      { key: 'name', label: '支払先名' },
      { key: 'keywords', label: '検索キーワード' },
      { key: 'invoiceNumber', label: '登録番号' },
      { key: 'accountItem', label: '勘定科目' },
      { key: 'taxRateLabel', label: '税率' },
      { key: 'categories', label: '対象所属区分' },
      { key: 'note', label: 'メモ' },
      { key: 'order', label: '表示順' },
      { key: 'enabled', label: '有効' }
    ]
  },
  log: {
    sheet: SHEETS.LOG,
    columns: [
      { key: 'at', label: '日時' },
      { key: 'actor', label: '実行者' },
      { key: 'action', label: '操作' },
      { key: 'detail', label: '内容' }
    ]
  }
};

/** フィールド種類 */
var FIELD_TYPES = {
  text: '1行テキスト',
  textarea: '複数行テキスト',
  number: '数値',
  date: '日付',
  select: 'プルダウン',
  radio: 'ラジオボタン',
  employee: '従業員（マスタ参照）',
  account: '勘定科目（マスタ参照）',
  tax: '税率（マスタ参照）',
  file: 'ファイル（領収書）'
};

/**
 * システム項目：経費データの固定列に保存される項目。
 * 削除はできませんが、ラベル・説明・表示順などは管理画面から変更できます。
 * locked=true の項目は無効化・任意化ができません（freee連携に必須のため）。
 */
var SYSTEM_FIELD_KEYS = {
  paymentDate: { type: 'date', locked: true },
  payerId: { type: 'employee', locked: true },
  vendor: { type: 'text', locked: false },
  amount: { type: 'number', locked: true },
  accountItem: { type: 'account', locked: true },
  taxRateLabel: { type: 'tax', locked: true },
  invoiceType: { type: 'radio', locked: false },
  invoiceNumber: { type: 'text', locked: false },
  paymentMethod: { type: 'select', locked: false },
  receipt: { type: 'file', locked: false },
  description: { type: 'textarea', locked: false }
};

var INVOICE_QUALIFIED = '適格請求書あり（T番号の記載あり）';
var INVOICE_NON_QUALIFIED = '適格請求書なし・不明';

/** 初期データ：フォーム項目（既存Googleフォームと同じ並び） */
var DEFAULT_FIELDS = [
  { key: 'paymentDate', label: '支払日', type: 'date', required: true, order: 10, help: 'レシートに記載された日付を選択してください。' },
  { key: 'payerId', label: '支払者（立替者）', type: 'employee', required: true, order: 20, help: '実際にお金を支払った方を選択してください。' },
  { key: 'vendor', label: '支払先/店名', type: 'text', required: true, order: 30, placeholder: '例）株式会社〇〇/△△パーキング' },
  { key: 'amount', label: '金額（税込）', type: 'number', required: true, order: 40, placeholder: '例）1100' },
  { key: 'accountItem', label: '勘定科目', type: 'account', required: true, order: 50, help: '迷ったら一番近いものを選んでください。管理者が確認します。' },
  { key: 'taxRateLabel', label: '税率', type: 'tax', required: true, order: 60 },
  { key: 'invoiceType', label: '適格請求書（インボイス）', type: 'radio', required: true, order: 70,
    options: [INVOICE_QUALIFIED, INVOICE_NON_QUALIFIED].join('\n'),
    help: 'レシートに「T」から始まる13桁の登録番号があれば「あり」を選んでください。' },
  { key: 'invoiceNumber', label: '登録番号（T+13桁）', type: 'text', required: false, order: 80, placeholder: 'T1234567890123', help: '分かる場合のみ入力してください。' },
  { key: 'paymentMethod', label: '支払方法', type: 'select', required: true, order: 90,
    options: ['立替（自分のお金で支払った）', '会社カード', '会社の現金・小口現金'].join('\n') },
  { key: 'receipt', label: 'レシート画像', type: 'file', required: true, order: 100, help: '写真またはPDFをアップロードしてください（複数可）。' },
  { key: 'description', label: '備考・内容（購入した品物や目的など）', type: 'textarea', required: true, order: 110, placeholder: '例）〇〇様との打合せ時の駐車場代' }
];

/**
 * 初期データ：勘定科目
 * [表示名, freee勘定科目名, freee勘定科目ID, 対象所属区分, 既定の税率]
 * ※ freee勘定科目名・IDは 株式会社KIKKAKE（事業所ID 12373860）の実データから取得済み。
 *   管理画面「freee連携 > マスタ同期」で再取得できます。
 */
var DEFAULT_ACCOUNTS = [
  ['旅費交通費（電車・バス・タクシー・駐車場代）', '旅費交通費', 1002515563, 'ALL', '10%（通常のもの、外食など）'],
  ['消耗品費（10万円未満の備品・日用品）', '消耗品費', 1002515567, 'ALL', '10%（通常のもの、外食など）'],
  ['事務用品費（文房具・コピー用紙など）', '事務用品費', 1002515568, 'ALL', '10%（通常のもの、外食など）'],
  ['会議費（打合せ時の飲食・会場代）', '会議費', 1002515562, 'ALL', '10%（通常のもの、外食など）'],
  ['交際費（取引先との飲食・贈答品）', '交際費', 1002515561, 'KIKKAKE', '10%（通常のもの、外食など）'],
  ['通信費（切手・電話・ネット）', '通信費', 1002515564, 'ALL', '10%（通常のもの、外食など）'],
  ['荷造運賃（宅配便・送料）', '荷造運賃', 1002515559, 'ALL', '10%（通常のもの、外食など）'],
  ['新聞図書費（書籍・雑誌）', '新聞図書費', 1002515571, 'ALL', '10%（通常のもの、外食など）'],
  ['研修費（セミナー・講座）', '研修費', 1002515621, 'ALL', '10%（通常のもの、外食など）'],
  ['広告宣伝費（チラシ・広告）', '広告宣伝費', 1002515560, 'ALL', '10%（通常のもの、外食など）'],
  ['支払手数料（振込手数料など）', '支払手数料', 1002515573, 'ALL', '10%（通常のもの、外食など）'],
  ['仕入高（コーヒー豆・牛乳・食材など）', '仕入高', 1002515542, 'TIE Coffee', '8%（軽減税率：飲食料品・新聞）'],
  ['福利厚生費（従業員向けの飲食・備品）', '福利厚生費', 1002515555, 'ALL', '10%（通常のもの、外食など）'],
  ['雑費（上記に当てはまらないもの）', '雑費', 1002515588, 'ALL', '10%（通常のもの、外食など）']
];

/**
 * 初期データ：税区分
 * [表示名, 税率, freee税区分名（適格）, freee税区分名（非適格）, コード（適格）, コード（非適格）]
 * 非適格（インボイスなし）は 2026/10/1〜2029/9/30 の経過措置で「控50」。
 * 2029/10 以降は管理画面で「控除なし（対象外 等）」に変更してください。
 */
var DEFAULT_TAXES = [
  ['10%（通常のもの、外食など）', 10, '課対仕入10%', '課対仕入（控50）10%', 136, 190],
  ['8%（軽減税率：飲食料品・新聞）', 8, '課対仕入8%（軽）', '課対仕入（控50）8%（軽）', 163, 188],
  ['非課税（切手・印紙・保険料など）', 0, '非課仕入', '非課仕入', 37, 37],
  ['対象外（慶弔費・税金・寄付など）', 0, '対象外', '対象外', 2, 2]
];

/** 初期データ：所属区分 [区分名, 説明, 対象部署, freee部門, 表示色]（freeeには「TIE Coffee」部門のみ存在） */
var DEFAULT_CATEGORIES = [
  ['KIKKAKE', '社員用', '*', '', '#2a78d6'],
  ['TIE Coffee', '店舗にいるバリスタ用', 'TIE Coffee', 'TIE Coffee', '#eb6834']
];

/** 初期データ：設定 */
var DEFAULT_SETTINGS = [
  ['APP_TITLE', '経費申請', '申請画面のタイトル'],
  ['DATA_SPREADSHEET_ID', '', '経費データの保存先スプレッドシートID（空欄 = このスプレッドシート）'],
  ['DATA_SHEET_NAME', SHEETS.RECORDS, '経費データの保存先シート名'],
  ['RECEIPT_FOLDER_ID', '', '領収書の保存先フォルダID（共有ドライブ可）'],
  ['RECEIPT_SUBFOLDER_MODE', '月別+支払者', 'フォルダの分け方：なし / 月別 / 月別+所属区分 / 月別+支払者（＝月フォルダの中に「社員ID_氏名」フォルダ）'],
  ['RECEIPT_SUBFOLDER_FORMAT', 'yyyy年MM月_経費精算', '月別フォルダ名の書式'],
  ['RECEIPT_MONTH_BASIS', '支払日', 'どの月のフォルダ・精算書に入れるか：支払日 / 申請日（会計上は支払日がおすすめ）'],
  ['STATEMENT_INCLUDE_PENDING', 'いいえ', '精算書に「申請中」（未承認）も含めるか：はい / いいえ'],
  ['STATEMENT_AUTO_DAY', '5', '精算書を自動作成する日（毎月この日に前月分を作成。自動作成は管理画面でオン/オフ）'],
  ['EMPLOYEE_SPREADSHEET_ID', '1yIZ5WyJ-4IYqdoie_f1YpgArGjwvp6uVzlAz-4LbZyk', '従業員マスタのスプレッドシートID'],
  ['EMPLOYEE_SHEET_NAME', '従業員', '従業員マスタのシート名'],
  ['EMPLOYEE_ID_COLUMN', '社員ID', '従業員マスタ：IDの列名'],
  ['EMPLOYEE_NAME_COLUMN', '氏名', '従業員マスタ：氏名の列名'],
  ['EMPLOYEE_DEPT_COLUMN', '部署・チーム', '従業員マスタ：部署の列名（所属区分の振り分けに使用）'],
  ['EMPLOYEE_STATUS_COLUMN', '稼働ステータス', '従業員マスタ：在籍状況の列名'],
  ['EMPLOYEE_EXCLUDE_STATUS', '退職', 'この値の従業員は選択肢に出さない（カンマ区切り）'],
  ['TAX_ROUNDING', '切り捨て', '消費税額の端数処理：切り捨て / 四捨五入 / 切り上げ（freeeの設定に合わせる）'],
  ['MAX_FILE_MB', '10', '1ファイルあたりの上限サイズ(MB)'],
  ['NOTIFY_EMAILS', '', '申請時に通知するメールアドレス（カンマ区切り・空欄で通知なし）'],
  ['APPLICANT_APP_URL', '', '申請者用WebアプリのURL（管理画面からのリンク用）'],
  ['FREEE_COMPANY_ID', '12373860', 'freee事業所ID（株式会社KIKKAKE）'],
  ['FREEE_SETTLEMENT_ACCOUNT', '', '「立替」の決済口座名（空欄 = 未決済で登録し、精算時にfreeeで消込）'],
  ['FREEE_CARD_ACCOUNT', '', '「会社カード」の決済口座名（freeeの口座名。空欄 = 未決済）'],
  ['FREEE_CASH_ACCOUNT', '', '「会社の現金」の決済口座名（例：現金・小口現金。空欄 = 未決済）'],
  ['FREEE_CSV_ENCODING', 'UTF-8', 'freee取込CSVの文字コード：UTF-8 / Shift_JIS'],
  ['FREEE_GROUPING', '精算書ごと', 'freeeへの登録単位：精算書ごと（支払者×月でまとめる）/ 申請ごと'],
  ['FREEE_PARTNER_MODE', '支払先', 'freee取引先に入れる値：支払先 / 支払者 / なし']
];
