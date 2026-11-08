/**
 * ============================================================
 *  経費申請アプリ 共通データ操作（申請者用・管理者用の両方で使用）
 *  ※ shared/ が正本。編集後は scripts/sync-shared.sh を実行してください。
 *
 *  どちらのアプリも「ホームスプレッドシート」（申請者用GASが紐づく
 *  スプレッドシート）に設定・マスタを置き、そこを読み書きします。
 *  ホームの取得方法だけ各アプリの Env.gs で実装します（getHomeSpreadsheet_）。
 * ============================================================
 */

var TZ = 'Asia/Tokyo';

/* ---------------- 汎用ユーティリティ ---------------- */

function util_toBool_(v) {
  if (v === true || v === false) return v;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'はい' || s === '○' || s === '◯' || s === 'on';
}

function util_list_(v) {
  return String(v == null ? '' : v).split(/[,、\n]/).map(function (s) { return s.trim(); }).filter(String);
}

function util_isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function util_formatDate_(v, pattern) {
  if (v === '' || v == null) return '';
  var d = util_isDate_(v) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, TZ, pattern || 'yyyy/MM/dd');
}

/** シートの値をクライアントに渡せる形（Date→文字列）にする */
function util_plain_(v, key) {
  if (util_isDate_(v)) {
    return key === 'paymentDate' ? util_formatDate_(v, 'yyyy-MM-dd') : util_formatDate_(v, 'yyyy/MM/dd HH:mm:ss');
  }
  return v;
}

function util_newId_() {
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyMMdd-HHmmss');
  var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'EXP-' + stamp + '-' + rand;
}

/** 消費税額（内税）を計算。rounding: 切り捨て / 四捨五入 / 切り上げ */
function util_computeTax_(amount, rate, rounding) {
  amount = Number(amount) || 0;
  rate = Number(rate) || 0;
  if (!rate) return { net: amount, tax: 0 };
  var raw = amount * rate / (100 + rate);
  var tax = rounding === '四捨五入' ? Math.round(raw) : rounding === '切り上げ' ? Math.ceil(raw) : Math.floor(raw);
  return { net: amount - tax, tax: tax };
}

/* ---------------- テーブル読み書き ---------------- */

function table_getSheet_(ss, def, create) {
  var sh = ss.getSheetByName(def.sheet);
  if (!sh && create) {
    sh = ss.insertSheet(def.sheet);
    sh.getRange(1, 1, 1, def.columns.length).setValues([def.columns.map(function (c) { return c.label; })])
      .setFontWeight('bold').setBackground('#f1f3f4');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 見出し行 → key の配列（未知の列は null） */
function table_headerKeys_(sh, columns) {
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return [];
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var byLabel = {};
  columns.forEach(function (c) { byLabel[c.label] = c.key; });
  return headers.map(function (h) { return byLabel[String(h).trim()] || null; });
}

function table_read_(ss, def) {
  var sh = table_getSheet_(ss, def, false);
  if (!sh || sh.getLastRow() < 2) return [];
  var keys = table_headerKeys_(sh, def.columns);
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, keys.length).getValues();
  return values.filter(function (row) {
    return row.some(function (v) { return v !== '' && v != null; });
  }).map(function (row) {
    var o = {};
    keys.forEach(function (k, i) { if (k) o[k] = util_plain_(row[i], k); });
    return o;
  });
}

/** マスタを丸ごと書き換える（件数が少ないマスタ用） */
function table_replaceAll_(ss, def, rows) {
  var sh = table_getSheet_(ss, def, true);
  var labels = def.columns.map(function (c) { return c.label; });
  sh.clearContents();
  sh.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold').setBackground('#f1f3f4');
  if (rows.length) {
    var values = rows.map(function (r) {
      return def.columns.map(function (c) {
        var v = r[c.key];
        return v == null ? '' : v;
      });
    });
    sh.getRange(2, 1, values.length, labels.length).setValues(values);
  }
}

/* ---------------- 初期化 ---------------- */

function schema_ensureAll_(ss) {
  var created = [];
  function ensure(def, seedRows) {
    var exists = !!ss.getSheetByName(def.sheet);
    var sh = table_getSheet_(ss, def, true);
    if (!exists) created.push(def.sheet);
    if (seedRows && sh.getLastRow() < 2) {
      sh.getRange(2, 1, seedRows.length, seedRows[0].length).setValues(seedRows);
    }
    return sh;
  }

  ensure(TABLES.settings, DEFAULT_SETTINGS);
  // 既存の設定シートに無いキーを追記（アップデート時用）
  var current = settings_get_(ss);
  var missing = DEFAULT_SETTINGS.filter(function (r) { return !(r[0] in current); });
  if (missing.length) {
    var sh = ss.getSheetByName(SHEETS.SETTINGS);
    sh.getRange(sh.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  }

  ensure(TABLES.fields, DEFAULT_FIELDS.map(function (f) {
    return [f.key, f.label, f.type, f.required, f.options || '', 'ALL', f.order, true, f.help || '', f.placeholder || '', true];
  }));
  ensure(TABLES.accounts, DEFAULT_ACCOUNTS.map(function (a, i) {
    return [a[0], a[1], a[2], a[3], a[4], (i + 1) * 10, true];
  }));
  ensure(TABLES.taxes, DEFAULT_TAXES.map(function (t, i) {
    return [t[0], t[1], t[2], t[3], t[4], t[5], (i + 1) * 10, true];
  }));
  ensure(TABLES.categories, DEFAULT_CATEGORIES.map(function (c, i) {
    return [c[0], c[1], c[2], c[3], c[4], (i + 1) * 10, true];
  }));
  ensure(TABLES.vendors, null);
  ensure(TABLES.log, null);
  records_getSheet_(ss, settings_get_(ss));
  return created;
}

/* ---------------- 設定 ---------------- */

function settings_get_(ss) {
  var o = {};
  table_read_(ss, TABLES.settings).forEach(function (r) {
    if (r.key) o[String(r.key).trim()] = r.value == null ? '' : String(r.value).trim();
  });
  return o;
}

function settings_set_(ss, patch) {
  var sh = table_getSheet_(ss, TABLES.settings, true);
  var last = sh.getLastRow();
  var keys = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  Object.keys(patch).forEach(function (k) {
    var idx = keys.indexOf(k);
    if (idx >= 0) {
      sh.getRange(idx + 2, 2).setValue(patch[k]);
    } else {
      sh.appendRow([k, patch[k], '']);
      keys.push(k);
    }
  });
}

/* ---------------- フォーム定義 ---------------- */

function sortByOrder_(a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); }

function form_getFields_(ss, includeDisabled) {
  return table_read_(ss, TABLES.fields).map(function (f) {
    f.required = util_toBool_(f.required);
    f.enabled = util_toBool_(f.enabled);
    f.system = util_toBool_(f.system) || !!SYSTEM_FIELD_KEYS[f.key];
    f.locked = !!(SYSTEM_FIELD_KEYS[f.key] && SYSTEM_FIELD_KEYS[f.key].locked);
    if (f.locked) { f.enabled = true; f.required = true; }
    f.options = String(f.options || '').split('\n').map(function (s) { return s.trim(); }).filter(String);
    f.categories = util_list_(f.categories || 'ALL');
    return f;
  }).filter(function (f) { return includeDisabled || f.enabled; }).sort(sortByOrder_);
}

function form_getAccounts_(ss, includeDisabled) {
  return table_read_(ss, TABLES.accounts).map(function (a) {
    a.enabled = util_toBool_(a.enabled);
    a.categories = util_list_(a.categories || 'ALL');
    return a;
  }).filter(function (a) { return includeDisabled || a.enabled; }).sort(sortByOrder_);
}

function form_getTaxes_(ss, includeDisabled) {
  return table_read_(ss, TABLES.taxes).map(function (t) {
    t.enabled = util_toBool_(t.enabled);
    t.rate = Number(t.rate) || 0;
    return t;
  }).filter(function (t) { return includeDisabled || t.enabled; }).sort(sortByOrder_);
}

function form_getCategories_(ss, includeDisabled) {
  return table_read_(ss, TABLES.categories).map(function (c) {
    c.enabled = util_toBool_(c.enabled);
    return c;
  }).filter(function (c) { return includeDisabled || c.enabled; }).sort(sortByOrder_);
}

/** 支払先マスタ（よく使う支払先。申請画面で選ぶと登録番号・勘定科目・税率を自動入力） */
function form_getVendors_(ss, includeDisabled) {
  return table_read_(ss, TABLES.vendors).map(function (v) {
    v.name = String(v.name || '').trim();
    v.enabled = v.enabled === '' || v.enabled == null ? true : util_toBool_(v.enabled);
    v.categories = util_list_(v.categories || 'ALL');
    v.invoiceNumber = util_normalizeInvoice_(v.invoiceNumber);
    return v;
  }).filter(function (v) { return v.name && (includeDisabled || v.enabled); }).sort(sortByOrder_);
}

/** 登録番号の表記ゆれをそろえる（全角・ハイフン・空白を除去、先頭Tを大文字に） */
function util_normalizeInvoice_(v) {
  var s = String(v == null ? '' : v).normalize('NFKC').replace(/[\s\-ー－]/g, '').toUpperCase();
  if (/^\d{13}$/.test(s)) s = 'T' + s;
  return s;
}

function matchesCategory_(list, category) {
  return !list || !list.length || list.indexOf('ALL') >= 0 || list.indexOf(category) >= 0;
}

/* ---------------- 従業員マスタ ---------------- */

/**
 * 従業員マスタから「ID・氏名・部署」だけを読み出す。
 * ※ マスタにはマイナンバーや口座などの機微情報があるため、
 *    必要な列以外は絶対に返さないこと。
 */
function employees_list_(settings, categories) {
  var id = settings.EMPLOYEE_SPREADSHEET_ID;
  if (!id) return [];
  var sh = SpreadsheetApp.openById(id).getSheetByName(settings.EMPLOYEE_SHEET_NAME || '従業員');
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var col = function (name) { return header.indexOf(String(name || '').trim()); };
  var cId = col(settings.EMPLOYEE_ID_COLUMN || '社員ID');
  var cName = col(settings.EMPLOYEE_NAME_COLUMN || '氏名');
  var cDept = col(settings.EMPLOYEE_DEPT_COLUMN || '部署・チーム');
  var cStatus = col(settings.EMPLOYEE_STATUS_COLUMN || '稼働ステータス');
  if (cId < 0) throw new Error('従業員マスタに「' + settings.EMPLOYEE_ID_COLUMN + '」列が見つかりません');
  var excluded = util_list_(settings.EMPLOYEE_EXCLUDE_STATUS);

  // 部署 → 所属区分。'*' の区分は「他の区分に割り当てられていない部署すべて」
  var deptToCat = {};
  var wildcard = null;
  categories.forEach(function (c) {
    util_list_(c.departments).forEach(function (d) {
      if (d === '*') wildcard = wildcard || c.name; else deptToCat[d] = c.name;
    });
  });

  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var empId = String(r[cId] || '').trim();
    if (!empId) continue;
    if (cStatus >= 0 && excluded.indexOf(String(r[cStatus]).trim()) >= 0) continue;
    var dept = cDept >= 0 ? String(r[cDept] || '').trim() : '';
    var name = cName >= 0 ? String(r[cName] || '').trim() : '';
    out.push({ id: empId, name: name || empId, dept: dept, category: deptToCat[dept] || wildcard || '' });
  }
  return out;
}

/* ---------------- 経費データ ---------------- */

function records_getSpreadsheet_(ss, settings) {
  return settings.DATA_SPREADSHEET_ID ? SpreadsheetApp.openById(settings.DATA_SPREADSHEET_ID) : ss;
}

function records_getSheet_(ss, settings) {
  var target = records_getSpreadsheet_(ss, settings);
  var name = settings.DATA_SHEET_NAME || SHEETS.RECORDS;
  var sh = target.getSheetByName(name);
  if (!sh) {
    sh = target.insertSheet(name);
    sh.getRange(1, 1, 1, RECORD_COLUMNS.length).setValues([RECORD_COLUMNS.map(function (c) { return c.label; })])
      .setFontWeight('bold').setBackground('#f1f3f4');
    sh.setFrozenRows(1);
    sh.getRange('H:H').setNumberFormat('yyyy/mm/dd');
    sh.getRange('J:J').setNumberFormat('#,##0');
  } else {
    // 見出しが不足していれば右端に追加（バージョンアップ時用）
    var keys = table_headerKeys_(sh, RECORD_COLUMNS);
    var missing = RECORD_COLUMNS.filter(function (c) { return keys.indexOf(c.key) < 0; });
    if (missing.length) {
      sh.getRange(1, keys.length + 1, 1, missing.length).setValues([missing.map(function (c) { return c.label; })])
        .setFontWeight('bold').setBackground('#f1f3f4');
    }
  }
  return sh;
}

function records_append_(sh, record) {
  var keys = table_headerKeys_(sh, RECORD_COLUMNS);
  var row = keys.map(function (k) { return k && record[k] != null ? record[k] : ''; });
  sh.appendRow(row);
}

function records_readAll_(sh) {
  if (sh.getLastRow() < 2) return [];
  var keys = table_headerKeys_(sh, RECORD_COLUMNS);
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, keys.length).getValues();
  var out = [];
  values.forEach(function (row, i) {
    var o = { _row: i + 2 };
    keys.forEach(function (k, j) { if (k) o[k] = util_plain_(row[j], k); });
    if (o.id) out.push(o);
  });
  return out;
}

/** 申請IDで行を探して部分更新 */
function records_update_(sh, id, patch) {
  var keys = table_headerKeys_(sh, RECORD_COLUMNS);
  var idCol = keys.indexOf('id');
  var last = sh.getLastRow();
  if (last < 2) throw new Error('データがありません');
  var ids = sh.getRange(2, idCol + 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
  var idx = ids.indexOf(String(id));
  if (idx < 0) throw new Error('申請IDが見つかりません: ' + id);
  var rowNum = idx + 2;
  patch.updatedAt = new Date();
  Object.keys(patch).forEach(function (k) {
    var c = keys.indexOf(k);
    if (c >= 0) sh.getRange(rowNum, c + 1).setValue(patch[k]);
  });
  return rowNum;
}

/* ---------------- ログ ---------------- */

function log_write_(ss, actor, action, detail) {
  try {
    var sh = table_getSheet_(ss, TABLES.log, true);
    sh.appendRow([new Date(), actor || '', action, typeof detail === 'string' ? detail : JSON.stringify(detail)]);
  } catch (e) {
    console.warn('log failed', e);
  }
}

/* ---------------- Drive フォルダ構成 ----------------
 *  RECEIPT_FOLDER_ID（大元）
 *    └ 2026年10月_経費精算        … 月フォルダ（自動作成）
 *        ├ 【精算書】2026年10月_一覧  … 月の精算書（スプレッドシート＋PDF）
 *        └ K-001_山田太郎           … 支払者フォルダ（RECEIPT_SUBFOLDER_MODE=月別+支払者）
 *            ├ 2026年10月_K-001_山田太郎_20261015_支払先_800円.jpg
 *            └ 【精算書】2026年10月_K-001_山田太郎.pdf
 */

function util_sanitize_(s, max) {
  return String(s == null ? '' : s).replace(/[\\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, '').trim().slice(0, max || 40);
}

function drive_getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** フォルダ・精算書の「月」を決める日付（設定 RECEIPT_MONTH_BASIS） */
function drive_basisDate_(settings, paymentDate, submittedAt) {
  var useSubmitted = settings.RECEIPT_MONTH_BASIS === '申請日';
  var v = useSubmitted ? (submittedAt || new Date()) : paymentDate;
  if (util_isDate_(v)) return v;
  var d = new Date(String(v).replace(/\//g, '-').replace(' ', 'T') + (String(v).length <= 10 ? 'T00:00:00+09:00' : '+09:00'));
  return isNaN(d.getTime()) ? new Date() : d;
}

/** レコード（シートから読んだもの）の対象月 'yyyy-MM' */
function drive_recordMonth_(settings, r) {
  return util_formatDate_(drive_basisDate_(settings, r.paymentDate, r.submittedAt), 'yyyy-MM');
}

function drive_monthLabel_(date) { return Utilities.formatDate(date, TZ, 'yyyy年MM月'); }

function drive_payerFolderName_(payerId, payerName) {
  return [util_sanitize_(payerId, 30), util_sanitize_(payerName, 30)].filter(String).join('_');
}

function drive_monthFolder_(settings, date) {
  if (!settings.RECEIPT_FOLDER_ID) throw new Error('領収書の保存先（RECEIPT_FOLDER_ID）が未設定です');
  var root = DriveApp.getFolderById(settings.RECEIPT_FOLDER_ID);
  return drive_getOrCreateFolder_(root, Utilities.formatDate(date, TZ, settings.RECEIPT_SUBFOLDER_FORMAT || 'yyyy年MM月_経費精算'));
}

/** 領収書の保存先フォルダ（設定 RECEIPT_SUBFOLDER_MODE に従う） */
function drive_receiptFolder_(settings, info) {
  var mode = settings.RECEIPT_SUBFOLDER_MODE || '月別+支払者';
  if (mode === 'なし') return DriveApp.getFolderById(settings.RECEIPT_FOLDER_ID);
  var folder = drive_monthFolder_(settings, info.date);
  if (mode === '月別+所属区分') folder = drive_getOrCreateFolder_(folder, info.category);
  if (mode === '月別+支払者') folder = drive_getOrCreateFolder_(folder, drive_payerFolderName_(info.payerId, info.payerName));
  return folder;
}

/** 同名ファイルがあればゴミ箱へ移してから作成（精算書の作り直し用） */
function drive_replaceFile_(folder, blob) {
  var it = folder.getFilesByName(blob.getName());
  while (it.hasNext()) it.next().setTrashed(true);
  return folder.createFile(blob);
}
