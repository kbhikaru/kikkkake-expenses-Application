/**
 * ============================================================
 *  管理者用API（画面から google.script.run で呼ばれる）
 *  すべて第1引数にセッショントークンを受け取り requireAuth_ で検証します。
 * ============================================================
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Admin').evaluate()
    .setTitle('経費申請 管理画面')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function ctx_() {
  var ss = getHomeSpreadsheet_();
  var settings = settings_get_(ss);
  return { ss: ss, settings: settings, sheet: records_getSheet_(ss, settings) };
}

function monthOf_(dateStr) { return String(dateStr || '').replace(/\//g, '-').slice(0, 7); }

/* ---------------- 初期情報 ---------------- */

function api_overview(token) {
  var who = requireAuth_(token);
  var ss = getHomeSpreadsheet_();
  var settings = settings_get_(ss);
  return {
    who: who,
    homeUrl: ss.getUrl(),
    applicantUrl: settings.APPLICANT_APP_URL || '',
    categories: form_getCategories_(ss, true).map(function (c) { return { name: c.name, color: c.color }; }),
    statuses: [STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED, STATUS.EXPORTED],
    accounts: form_getAccounts_(ss, true).map(function (a) { return { label: a.label, categories: a.categories }; }),
    taxes: form_getTaxes_(ss, true).map(function (t) { return { label: t.label, rate: t.rate }; }),
    invoiceOptions: [INVOICE_QUALIFIED, INVOICE_NON_QUALIFIED]
  };
}

/* ---------------- ダッシュボード ---------------- */

/**
 * @param {{from:string, to:string, category:string}} f  from/to は 'yyyy-MM'
 */
function api_dashboard(token, f) {
  requireAuth_(token);
  f = f || {};
  var c = ctx_();
  var all = records_readAll_(c.sheet);
  var from = f.from || '0000-00', to = f.to || '9999-99';
  var rows = all.filter(function (r) {
    var m = monthOf_(r.paymentDate);
    return m >= from && m <= to && r.status !== STATUS.REJECTED && (!f.category || r.category === f.category);
  });

  // 月の並び
  var months = [];
  if (f.from && f.to) {
    var y = Number(f.from.slice(0, 4)), mo = Number(f.from.slice(5, 7));
    while (true) {
      var key = y + '-' + ('0' + mo).slice(-2);
      if (key > f.to || months.length > 36) break;
      months.push(key);
      mo++; if (mo > 12) { mo = 1; y++; }
    }
  } else {
    rows.forEach(function (r) { var m = monthOf_(r.paymentDate); if (months.indexOf(m) < 0) months.push(m); });
    months.sort();
  }

  var categories = form_getCategories_(c.ss, true).map(function (x) { return { name: x.name, color: x.color }; });
  var monthly = months.map(function (m) {
    var o = { month: m, total: 0 };
    categories.forEach(function (cat) { o[cat.name] = 0; });
    return o;
  });
  var byAccount = {}, byPayer = {}, byStatus = {};
  var total = 0, pendingCount = 0, pendingAmount = 0;

  rows.forEach(function (r) {
    var amt = Number(r.amount) || 0;
    total += amt;
    var mi = months.indexOf(monthOf_(r.paymentDate));
    if (mi >= 0) {
      monthly[mi].total += amt;
      monthly[mi][r.category] = (monthly[mi][r.category] || 0) + amt;
    }
    var acc = r.freeeAccountItem || r.accountItem || '(未設定)';
    byAccount[acc] = byAccount[acc] || { label: acc, amount: 0, count: 0 };
    byAccount[acc].amount += amt; byAccount[acc].count++;
    var pk = r.payerId || r.payerName;
    byPayer[pk] = byPayer[pk] || { id: r.payerId, name: r.payerName, category: r.category, amount: 0, count: 0 };
    byPayer[pk].amount += amt; byPayer[pk].count++;
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (r.status === STATUS.PENDING) { pendingCount++; pendingAmount += amt; }
  });

  var sortDesc = function (a, b) { return b.amount - a.amount; };
  return {
    kpi: {
      total: total,
      count: rows.length,
      average: rows.length ? Math.round(total / rows.length) : 0,
      payers: Object.keys(byPayer).length,
      pendingCount: pendingCount,
      pendingAmount: pendingAmount
    },
    categories: categories,
    monthly: monthly,
    byAccount: Object.keys(byAccount).map(function (k) { return byAccount[k]; }).sort(sortDesc),
    byPayer: Object.keys(byPayer).map(function (k) { return byPayer[k]; }).sort(sortDesc),
    byStatus: byStatus
  };
}

/* ---------------- 申請一覧・承認 ---------------- */

/**
 * @param {{from:string,to:string,category:string,status:string,q:string}} f  from/to は 'yyyy-MM-dd'
 */
function api_listRecords(token, f) {
  requireAuth_(token);
  f = f || {};
  var c = ctx_();
  var q = String(f.q || '').toLowerCase();
  var rows = records_readAll_(c.sheet).filter(function (r) {
    var d = String(r.paymentDate || '').replace(/\//g, '-');
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.status && r.status !== f.status) return false;
    if (q) {
      var hay = [r.id, r.payerName, r.payerId, r.vendor, r.description, r.accountItem].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  rows.sort(function (a, b) { return String(b.submittedAt).localeCompare(String(a.submittedAt)); });
  var truncated = rows.length > 1000;
  return {
    rows: rows.slice(0, 1000).map(function (r) { delete r._row; return r; }),
    truncated: truncated,
    total: rows.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0)
  };
}

function api_setStatus(token, ids, status, comment) {
  var who = requireAuth_(token);
  var allowed = [STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED, STATUS.EXPORTED];
  if (allowed.indexOf(status) < 0) throw new Error('不正なステータスです');
  if (status === STATUS.REJECTED && !comment) throw new Error('差戻し理由を入力してください');
  var c = ctx_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    (ids || []).forEach(function (id) {
      var patch = { status: status, reviewer: who, reviewedAt: new Date() };
      if (comment != null) patch.reviewComment = comment;
      records_update_(c.sheet, id, patch);
    });
  } finally {
    lock.releaseLock();
  }
  log_write_(c.ss, who, 'ステータス変更:' + status, (ids || []).join(','));
  return (ids || []).length;
}

/** 管理者による申請内容の修正（勘定科目の付け替えなど） */
function api_updateRecord(token, id, values) {
  var who = requireAuth_(token);
  var c = ctx_();
  var editable = ['category', 'payerId', 'paymentDate', 'vendor', 'amount', 'accountItem', 'taxRateLabel',
    'invoiceType', 'invoiceNumber', 'paymentMethod', 'description', 'reviewComment'];
  var patch = {};
  editable.forEach(function (k) { if (k in values) patch[k] = values[k]; });

  var current = records_readAll_(c.sheet).filter(function (r) { return r.id === id; })[0];
  if (!current) throw new Error('申請が見つかりません');
  var merged = {};
  Object.keys(current).forEach(function (k) { merged[k] = current[k]; });
  Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });

  var amount = Number(String(merged.amount).replace(/[,，円¥\s]/g, ''));
  if (!(amount > 0)) throw new Error('金額が正しくありません');
  patch.amount = amount;
  if (patch.paymentDate) patch.paymentDate = new Date(String(patch.paymentDate).replace(/\//g, '-') + 'T00:00:00+09:00');

  var categories = form_getCategories_(c.ss, true);
  var cat = categories.filter(function (x) { return x.name === merged.category; })[0];
  if (!cat) throw new Error('所属区分が不正です');
  patch.department = cat.freeeSection || '';

  if ('payerId' in patch && patch.payerId !== current.payerId) {
    var emp = employees_list_(c.settings, categories).filter(function (e) { return e.id === patch.payerId; })[0];
    if (!emp) throw new Error('支払者が従業員マスタに見つかりません');
    patch.payerName = emp.name;
  }
  var acc = form_getAccounts_(c.ss, true).filter(function (a) { return a.label === merged.accountItem; })[0];
  if (!acc) throw new Error('勘定科目が不正です');
  patch.freeeAccountItem = acc.freeeName || acc.label;
  var tax = form_getTaxes_(c.ss, true).filter(function (t) { return t.label === merged.taxRateLabel; })[0];
  if (!tax) throw new Error('税率が不正です');
  var qualified = merged.invoiceType ? merged.invoiceType === INVOICE_QUALIFIED : true;
  patch.taxRate = tax.rate;
  patch.freeeTaxName = qualified ? tax.freeeName : (tax.freeeNameNonQualified || tax.freeeName);
  var calc = util_computeTax_(amount, tax.rate, c.settings.TAX_ROUNDING);
  patch.netAmount = calc.net;
  patch.taxAmount = calc.tax;

  records_update_(c.sheet, id, patch);
  log_write_(c.ss, who, '申請内容修正', id + ' ' + JSON.stringify(values));
  return true;
}

/* ---------------- 設定・フォーム編集 ---------------- */

function api_getConfig(token) {
  requireAuth_(token);
  var ss = getHomeSpreadsheet_();
  var notes = {};
  DEFAULT_SETTINGS.forEach(function (r) { notes[r[0]] = r[2]; });
  var settings = settings_get_(ss);
  return {
    settings: DEFAULT_SETTINGS.map(function (r) {
      return { key: r[0], value: r[0] in settings ? settings[r[0]] : r[1], note: notes[r[0]] };
    }),
    fields: form_getFields_(ss, true),
    accounts: form_getAccounts_(ss, true),
    taxes: form_getTaxes_(ss, true),
    categories: form_getCategories_(ss, true),
    fieldTypes: FIELD_TYPES,
    systemFields: SYSTEM_FIELD_KEYS,
    adminEmails: PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || ''
  };
}

function api_saveSettings(token, patch) {
  var who = requireAuth_(token);
  var ss = getHomeSpreadsheet_();
  var allowed = DEFAULT_SETTINGS.map(function (r) { return r[0]; });
  var clean = {};
  Object.keys(patch || {}).forEach(function (k) {
    if (allowed.indexOf(k) >= 0) clean[k] = String(patch[k] == null ? '' : patch[k]).trim();
  });
  // 保存前に接続確認（誤ったIDで申請が止まるのを防ぐ）
  var problems = checkSettings_(Object.assign({}, settings_get_(ss), clean));
  if (problems.length) throw new Error(problems.join('\n'));
  settings_set_(ss, clean);
  log_write_(ss, who, '設定変更', Object.keys(clean).join(','));
  return true;
}

function api_saveAdminEmails(token, emails) {
  var who = requireAuth_(token);
  var list = util_list_(emails);
  var me = currentEmail_();
  if (list.length && me && list.map(function (e) { return e.toLowerCase(); }).indexOf(me.toLowerCase()) < 0) {
    throw new Error('自分自身（' + me + '）を含めてください。締め出されてしまいます。');
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_EMAILS', list.join(','));
  log_write_(getHomeSpreadsheet_(), who, '管理者メール変更', list.join(','));
  return true;
}

function checkSettings_(s) {
  var problems = [];
  if (s.RECEIPT_FOLDER_ID) {
    try { DriveApp.getFolderById(s.RECEIPT_FOLDER_ID).getName(); }
    catch (e) { problems.push('領収書フォルダにアクセスできません（RECEIPT_FOLDER_ID）'); }
  }
  if (s.DATA_SPREADSHEET_ID) {
    try { SpreadsheetApp.openById(s.DATA_SPREADSHEET_ID); }
    catch (e) { problems.push('保存先スプレッドシートにアクセスできません（DATA_SPREADSHEET_ID）'); }
  }
  if (s.EMPLOYEE_SPREADSHEET_ID) {
    try {
      var sh = SpreadsheetApp.openById(s.EMPLOYEE_SPREADSHEET_ID).getSheetByName(s.EMPLOYEE_SHEET_NAME);
      if (!sh) problems.push('従業員マスタに「' + s.EMPLOYEE_SHEET_NAME + '」シートがありません');
      else {
        var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
        ['EMPLOYEE_ID_COLUMN', 'EMPLOYEE_NAME_COLUMN'].forEach(function (k) {
          if (header.indexOf(s[k]) < 0) problems.push('従業員マスタに「' + s[k] + '」列がありません（' + k + '）');
        });
      }
    } catch (e) { problems.push('従業員マスタにアクセスできません（EMPLOYEE_SPREADSHEET_ID）'); }
  }
  if (['なし', '月別', '月別+所属区分'].indexOf(s.RECEIPT_SUBFOLDER_MODE || '月別') < 0) problems.push('RECEIPT_SUBFOLDER_MODE は「なし / 月別 / 月別+所属区分」のいずれかです');
  if (['切り捨て', '四捨五入', '切り上げ'].indexOf(s.TAX_ROUNDING || '切り捨て') < 0) problems.push('TAX_ROUNDING は「切り捨て / 四捨五入 / 切り上げ」のいずれかです');
  return problems;
}

function api_testConnections(token) {
  requireAuth_(token);
  var c = ctx_();
  var s = c.settings;
  var problems = checkSettings_(s);
  var employees = [];
  try { employees = employees_list_(s, form_getCategories_(c.ss, false)); } catch (e) { problems.push(String(e.message)); }
  var byCat = {};
  employees.forEach(function (e) { byCat[e.category || '(区分なし)'] = (byCat[e.category || '(区分なし)'] || 0) + 1; });
  if (!s.RECEIPT_FOLDER_ID) problems.push('領収書フォルダ（RECEIPT_FOLDER_ID）が未設定です');
  return {
    ok: !problems.length,
    problems: problems,
    employeeCounts: byCat,
    dataSheetUrl: c.sheet.getParent().getUrl() + '#gid=' + c.sheet.getSheetId(),
    folderUrl: s.RECEIPT_FOLDER_ID ? 'https://drive.google.com/drive/folders/' + s.RECEIPT_FOLDER_ID : ''
  };
}

/**
 * フォーム項目の保存
 * システム項目は削除不可・種類変更不可。locked の項目は必須・有効を強制。
 */
function api_saveFields(token, fields) {
  var who = requireAuth_(token);
  var ss = getHomeSpreadsheet_();
  var existing = form_getFields_(ss, true);
  var seen = {};
  var rows = [];
  (fields || []).forEach(function (f, i) {
    var key = String(f.key || '').trim();
    if (!key) key = 'c_' + Utilities.getUuid().slice(0, 8);
    if (seen[key]) throw new Error('項目キーが重複しています：' + key);
    seen[key] = true;
    var sys = SYSTEM_FIELD_KEYS[key];
    if (!String(f.label || '').trim()) throw new Error((i + 1) + '番目の項目のラベルが空です');
    var type = sys ? sys.type : String(f.type || 'text');
    if (!FIELD_TYPES[type]) throw new Error('種類が不正です：' + type);
    if (!sys && ['employee', 'account', 'tax', 'file'].indexOf(type) >= 0) throw new Error('「' + FIELD_TYPES[type] + '」は追加できません（システム項目専用）');
    var options = Array.isArray(f.options) ? f.options : String(f.options || '').split('\n');
    options = options.map(function (o) { return String(o).trim(); }).filter(String);
    if ((type === 'select' || type === 'radio') && !options.length) throw new Error('「' + f.label + '」の選択肢を入力してください');
    var cats = Array.isArray(f.categories) ? f.categories : util_list_(f.categories);
    rows.push({
      key: key,
      label: String(f.label).trim(),
      type: type,
      required: sys && sys.locked ? true : !!f.required,
      options: options.join('\n'),
      categories: (sys && sys.locked) || !cats.length ? 'ALL' : cats.join(','),
      order: (i + 1) * 10,
      enabled: sys && sys.locked ? true : !!f.enabled,
      help: f.help || '',
      placeholder: f.placeholder || '',
      system: !!sys
    });
  });
  // 送られてこなかったシステム項目は元の設定のまま残す
  existing.forEach(function (f) {
    if (f.system && !seen[f.key]) {
      rows.push({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options.join('\n'),
        categories: f.categories.join(','), order: 9999, enabled: f.enabled, help: f.help, placeholder: f.placeholder, system: true });
    }
  });
  table_replaceAll_(ss, TABLES.fields, rows);
  log_write_(ss, who, 'フォーム項目変更', rows.length + '項目');
  return form_getFields_(ss, true);
}

/** 勘定科目・税区分・所属区分マスタの保存 */
function api_saveMaster(token, name, rows) {
  var who = requireAuth_(token);
  var ss = getHomeSpreadsheet_();
  var def = { accounts: TABLES.accounts, taxes: TABLES.taxes, categories: TABLES.categories }[name];
  if (!def) throw new Error('不正なマスタ名です');
  var keyField = name === 'categories' ? 'name' : 'label';
  var seen = {};
  var clean = (rows || []).map(function (r, i) {
    var k = String(r[keyField] || '').trim();
    if (!k) throw new Error((i + 1) + '行目の名称が空です');
    if (seen[k]) throw new Error('名称が重複しています：' + k);
    seen[k] = true;
    var o = {};
    def.columns.forEach(function (c) {
      var v = r[c.key];
      if (Array.isArray(v)) v = v.join(',');
      o[c.key] = v == null ? '' : v;
    });
    o[keyField] = k;
    o.order = (i + 1) * 10;
    o.enabled = r.enabled === undefined ? true : !!r.enabled;
    if (name === 'taxes') {
      o.rate = Number(r.rate);
      if (isNaN(o.rate) || o.rate < 0 || o.rate > 100) throw new Error('「' + k + '」の税率が不正です');
    }
    if (name === 'accounts' && !String(o.freeeName).trim()) o.freeeName = k.replace(/（.*$/, '');
    return o;
  });
  if (!clean.length) throw new Error('1件以上登録してください');
  table_replaceAll_(ss, def, clean);
  log_write_(ss, who, 'マスタ変更:' + def.sheet, clean.length + '件');
  return true;
}
