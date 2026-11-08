/**
 * ============================================================
 *  経費申請アプリ【申請者用】
 *  ・経費DBスプレッドシートの「拡張機能 > Apps Script」で作成するコンテナバインド型
 *  ・Webアプリとして「自分（オーナー）として実行」でデプロイするため、
 *    申請者に共有ドライブの権限が無くても領収書を保存できます。
 * ============================================================
 */

/* ---------------- スプレッドシートのメニュー ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('経費申請アプリ')
    .addItem('① 初期セットアップ（シート作成）', 'menu_setup')
    .addItem('② 申請画面のURLを表示', 'menu_showUrl')
    .addSeparator()
    .addItem('旧Googleフォームの回答を取り込む', 'menu_importLegacy')
    .addItem('キャッシュをクリア（設定をすぐ反映）', 'menu_clearCache')
    .addToUi();
}

function menu_setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('HOME_SPREADSHEET_ID', ss.getId());
  var created = schema_ensureAll_(ss);
  log_write_(ss, Session.getActiveUser().getEmail(), '初期セットアップ', created.join(','));
  SpreadsheetApp.getUi().alert(
    '初期セットアップが完了しました。\n\n' +
    (created.length ? '作成したシート：' + created.join('、') + '\n\n' : '') +
    'このスプレッドシートのID（管理者用アプリの設定に使います）：\n' + ss.getId() + '\n\n' +
    '次に「設定」シートの RECEIPT_FOLDER_ID に領収書の保存先フォルダIDを入力し、\n' +
    'Apps Script の「デプロイ > 新しいデプロイ > ウェブアプリ」で公開してください。'
  );
}

function menu_showUrl() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url ? '申請画面のURL：\n' + url : 'まだWebアプリとしてデプロイされていません。');
}

/* ---------------- Webアプリ ---------------- */

function doGet() {
  var ss = getHomeSpreadsheet_();
  var settings = settings_get_(ss);
  var t = HtmlService.createTemplateFromFile('Index');
  t.appTitle = settings.APP_TITLE || '経費申請';
  // 初期データをHTMLに埋め込み、画面表示までの通信を1往復減らす
  var boot = null;
  try { boot = buildBootstrap_(ss, settings); } catch (e) { console.warn('bootstrap inline failed', e); }
  t.bootJson = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return t.evaluate()
    .setTitle(t.appTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** 画面の初期表示に必要なデータをまとめて返す（埋め込みに失敗したときの予備） */
function api_bootstrap() {
  var ss = getHomeSpreadsheet_();
  return buildBootstrap_(ss, settings_get_(ss));
}

function buildBootstrap_(ss, settings) {
  var cfg = appConfig_(ss, settings);
  var employees = [];
  var employeeError = '';
  try {
    employees = appEmployees_(settings, cfg.categories);
  } catch (e) {
    employeeError = String(e.message || e);
  }
  return {
    title: settings.APP_TITLE || '経費申請',
    today: util_formatDate_(new Date(), 'yyyy-MM-dd'),
    maxFileMb: Number(settings.MAX_FILE_MB) || 10,
    taxRounding: settings.TAX_ROUNDING || '切り捨て',
    invoiceQualified: INVOICE_QUALIFIED,
    categories: cfg.categories.map(function (c) {
      return { name: c.name, description: c.description, color: c.color };
    }),
    fields: cfg.fields,
    accounts: cfg.accounts.map(function (a) {
      return { label: a.label, categories: a.categories, defaultTax: a.defaultTax };
    }),
    taxes: cfg.taxes.map(function (t) { return { label: t.label, rate: t.rate }; }),
    vendors: cfg.vendors.map(function (v) {
      return { name: v.name, keywords: v.keywords || '', invoiceNumber: v.invoiceNumber, accountItem: v.accountItem || '',
        taxRateLabel: v.taxRateLabel || '', categories: v.categories };
    }),
    employees: employees,
    employeeError: employeeError,
    userEmail: Session.getActiveUser().getEmail() || ''
  };
}

/* ---------------- 領収書の先行アップロード ----------------
 * 画像を選んだ時点で一時保存フォルダにアップロードしておき、
 * 申請ボタンを押したら正しいフォルダへ移動＋名前変更するだけにする（送信が速くなる）
 */
var STAGING_FOLDER_NAME = '_アップロード一時保存';

function stagingFolder_(settings) {
  if (!settings.RECEIPT_FOLDER_ID) throw new Error('領収書の保存先が未設定です。管理者に連絡してください。');
  return drive_getOrCreateFolder_(DriveApp.getFolderById(settings.RECEIPT_FOLDER_ID), STAGING_FOLDER_NAME);
}

/** @param {{name:string,mimeType:string,data:string}} f */
function api_uploadReceipt(f) {
  var settings = settings_get_(getHomeSpreadsheet_());
  var maxBytes = (Number(settings.MAX_FILE_MB) || 10) * 1024 * 1024;
  if (!f || !f.data) throw new Error('ファイルが空です');
  if (!/^(image\/|application\/pdf$)/.test(f.mimeType || '')) throw new Error('画像またはPDFのみアップロードできます');
  if (f.data.length * 0.75 > maxBytes) throw new Error('ファイルサイズが上限（' + settings.MAX_FILE_MB + 'MB）を超えています');
  var blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.mimeType, 'upload_' + Date.now() + '_' + sanitizeFileName_(f.name));
  var file = stagingFolder_(settings).createFile(blob);
  file.setDescription('申請前の一時ファイル（' + (Session.getActiveUser().getEmail() || '') + '）');
  return { id: file.getId() };
}

/** 一時保存フォルダのファイルだけを受け付ける（他のDriveファイルを動かされないように） */
function takeStagedFiles_(settings, ids) {
  var staging = stagingFolder_(settings);
  var stagingId = staging.getId();
  return ids.map(function (id) {
    var file;
    try { file = DriveApp.getFileById(String(id)); } catch (e) { throw new Error('アップロードしたファイルが見つかりません。もう一度選び直してください。'); }
    var parents = file.getParents();
    var ok = false;
    while (parents.hasNext()) { if (parents.next().getId() === stagingId) ok = true; }
    if (!ok || file.isTrashed()) throw new Error('アップロードしたファイルが見つかりません。もう一度選び直してください。');
    return file;
  });
}

/** 申請されずに残った一時ファイル（1日以上前）を片付ける */
function cleanupStaging_(settings, limit) {
  try {
    var it = stagingFolder_(settings).getFiles();
    var border = Date.now() - 24 * 3600 * 1000;
    var n = 0;
    while (it.hasNext() && n < (limit || 20)) {
      var f = it.next();
      if (f.getDateCreated().getTime() < border) { f.setTrashed(true); n++; }
    }
  } catch (e) {
    console.warn('cleanup failed', e);
  }
}

/**
 * 申請を保存する
 * @param {{category:string, values:Object, files:Array<{name:string,mimeType:string,data:string}>}} payload
 */
function api_submit(payload) {
  var ss = getHomeSpreadsheet_();
  var settings = settings_get_(ss);
  var cfg = appConfig_(ss, settings);
  var categories = cfg.categories;
  var category = categories.filter(function (c) { return c.name === payload.category; })[0];
  if (!category) throw new Error('所属区分を選択してください。');

  var fields = cfg.fields.filter(function (f) { return matchesCategory_(f.categories, category.name); });
  var values = payload.values || {};
  var files = payload.files || [];          // 旧方式（画像データを直接送る）
  var uploadIds = payload.uploads || [];    // 新方式（先にアップロード済みのファイルID）

  // ---- 入力チェック ----
  var errors = [];
  fields.forEach(function (f) {
    if (!f.required) return;
    if (f.type === 'file') {
      if (!files.length && !uploadIds.length) errors.push(f.label + 'をアップロードしてください。');
    } else if (values[f.key] === '' || values[f.key] == null) {
      errors.push(f.label + 'を入力してください。');
    }
  });

  var amount = Number(String(values.amount || '').replace(/[,，円¥\s]/g, ''));
  if (!(amount > 0) || Math.floor(amount) !== amount) errors.push('金額は1円以上の整数で入力してください。');

  var payDate = values.paymentDate ? new Date(values.paymentDate + 'T00:00:00+09:00') : null;
  if (!payDate || isNaN(payDate.getTime())) errors.push('支払日が正しくありません。');
  else if (payDate.getTime() > Date.now() + 24 * 3600 * 1000) errors.push('支払日に未来の日付は指定できません。');

  var payer = appEmployees_(settings, categories).filter(function (e) { return e.id === values.payerId; })[0];
  if (!payer) errors.push('支払者が従業員マスタに見つかりません。');

  var account = cfg.accounts.filter(function (a) {
    return a.label === values.accountItem && matchesCategory_(a.categories, category.name);
  })[0];
  if (!account) errors.push('勘定科目を選択してください。');

  var tax = cfg.taxes.filter(function (t) { return t.label === values.taxRateLabel; })[0];
  if (!tax) errors.push('税率を選択してください。');

  if (values.invoiceNumber) values.invoiceNumber = util_normalizeInvoice_(values.invoiceNumber);
  if (values.invoiceNumber && !/^T\d{13}$/.test(values.invoiceNumber)) {
    errors.push('登録番号は「T」+13桁の数字で入力してください。');
  }

  var maxBytes = (Number(settings.MAX_FILE_MB) || 10) * 1024 * 1024;
  files.forEach(function (f) {
    if (!/^(image\/|application\/pdf$)/.test(f.mimeType || '')) errors.push(f.name + '：画像またはPDFのみアップロードできます。');
    if (f.data && f.data.length * 0.75 > maxBytes) errors.push(f.name + '：ファイルサイズが上限を超えています。');
  });
  if (files.length + uploadIds.length > 10) errors.push('添付できるファイルは10個までです。');
  if (!settings.RECEIPT_FOLDER_ID && (files.length || uploadIds.length)) errors.push('領収書の保存先が未設定です。管理者に連絡してください。');
  var staged = [];
  if (!errors.length && uploadIds.length) {
    try { staged = takeStagedFiles_(settings, uploadIds); } catch (e) { errors.push(e.message); }
  }

  if (errors.length) throw new Error(errors.join('\n'));

  // ---- 金額計算 ----
  var calc = util_computeTax_(amount, tax.rate, settings.TAX_ROUNDING);
  var qualified = values.invoiceType ? values.invoiceType === INVOICE_QUALIFIED : true;
  var id = util_newId_();

  // ---- 領収書の保存 ----
  var info = { id: id, date: payDate, category: category.name, payerId: payer.id, payerName: payer.name, vendor: values.vendor, amount: amount };
  var saved = (files.length || staged.length) ? saveReceipts_(settings, files, info, staged) : [];

  // ---- カスタム項目 ----
  var extra = {};
  fields.forEach(function (f) {
    if (!f.system && f.type !== 'file' && values[f.key] != null && values[f.key] !== '') extra[f.label] = values[f.key];
  });

  var now = new Date();
  var record = {
    id: id,
    submittedAt: now,
    applicantEmail: Session.getActiveUser().getEmail() || '',
    category: category.name,
    payerId: payer.id,
    payerName: payer.name,
    department: category.freeeSection || '',
    paymentDate: payDate,
    vendor: String(values.vendor || '').trim(),
    amount: amount,
    accountItem: account.label,
    freeeAccountItem: account.freeeName || account.label,
    taxRateLabel: tax.label,
    taxRate: tax.rate,
    freeeTaxName: qualified ? tax.freeeName : (tax.freeeNameNonQualified || tax.freeeName),
    netAmount: calc.net,
    taxAmount: calc.tax,
    paymentMethod: values.paymentMethod || '',
    invoiceType: values.invoiceType || '',
    invoiceNumber: values.invoiceNumber || '',
    description: String(values.description || '').trim(),
    receiptFileIds: saved.map(function (s) { return s.id; }).join('\n'),
    receiptUrls: saved.map(function (s) { return s.url; }).join('\n'),
    status: STATUS.PENDING,
    extra: Object.keys(extra).length ? JSON.stringify(extra) : '',
    updatedAt: now
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    records_append_(records_getSheet_(ss, settings), record);
  } finally {
    lock.releaseLock();
  }

  notifySubmission_(settings, record);
  if (staged.length) cleanupStaging_(settings, 10);
  return { id: id, amount: amount, payerName: payer.name };
}

/* ---------------- 領収書の保存 ---------------- */

function saveReceipts_(settings, files, info, staged) {
  staged = staged || [];
  // 例：大元 > 2026年10月_経費精算 > K-001_山田太郎 > 2026年10月_K-001_山田太郎_20261015_支払先_800円.jpg
  var monthDate = drive_basisDate_(settings, info.date, new Date());
  var folder = drive_receiptFolder_(settings, {
    date: monthDate, category: info.category, payerId: info.payerId, payerName: info.payerName
  });
  var base = [
    drive_monthLabel_(monthDate),
    drive_payerFolderName_(info.payerId, info.payerName),
    Utilities.formatDate(info.date, TZ, 'yyyyMMdd'),
    sanitizeFileName_(info.vendor),
    info.amount + '円'
  ].filter(String).join('_');

  var total = files.length + staged.length;
  function extOf(name, mime) {
    return ((String(name).match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0] || (mime === 'application/pdf' ? '.pdf' : '.jpg')).toLowerCase();
  }
  var moved = staged.map(function (file, i) {
    file.setName(base + (total > 1 ? '_' + (i + 1) : '') + extOf(file.getName(), file.getMimeType()));
    file.moveTo(folder);
    file.setDescription('申請ID: ' + info.id);
    return { id: file.getId(), url: file.getUrl() };
  });
  return moved.concat(files.map(function (f, j) {
    var i = staged.length + j;
    var ext = extOf(f.name, f.mimeType);
    var name = base + (total > 1 ? '_' + (i + 1) : '') + ext;
    var blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.mimeType, name);
    var file = folder.createFile(blob);
    file.setDescription('申請ID: ' + info.id);
    return { id: file.getId(), url: file.getUrl() };
  }));
}

function sanitizeFileName_(s) {
  return String(s == null ? '' : s).replace(/[\\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/* ---------------- 通知 ---------------- */

function notifySubmission_(settings, r) {
  var to = util_list_(settings.NOTIFY_EMAILS).join(',');
  if (!to) return;
  try {
    MailApp.sendEmail({
      to: to,
      subject: '【経費申請】' + r.category + '／' + r.payerName + '／¥' + r.amount.toLocaleString(),
      body: [
        '新しい経費申請がありました。', '',
        '申請ID：' + r.id,
        '所属区分：' + r.category,
        '支払者：' + r.payerName + '（' + r.payerId + '）',
        '支払日：' + util_formatDate_(r.paymentDate),
        '支払先：' + r.vendor,
        '金額：¥' + r.amount.toLocaleString() + '（' + r.taxRateLabel + '）',
        '勘定科目：' + r.accountItem,
        '内容：' + r.description,
        '領収書：' + (r.receiptUrls || 'なし')
      ].join('\n')
    });
  } catch (e) {
    console.warn('通知メールの送信に失敗', e);
  }
}
