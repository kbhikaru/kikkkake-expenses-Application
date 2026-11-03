/**
 * ============================================================
 *  freee会計 連携
 *   方式A：CSV出力 →「取引のインポート」で取り込む（設定不要・おすすめ）
 *   方式B：freee API で取引＋証憑（領収書画像）を直接登録
 *          ※ freeeアプリストアで開発アプリを作成し、
 *            Client ID / Secret を管理画面から登録する必要があります。
 * ============================================================
 */

var FREEE_API = 'https://api.freee.co.jp';
var FREEE_AUTH = 'https://accounts.secure.freee.co.jp/public_api';

var FREEE_CSV_HEADER = [
  '収支区分', '管理番号', '発生日', '決済期日', '取引先コード', '取引先', '勘定科目', '税区分', '金額',
  '税計算区分', '税額', '備考', '品目', '部門', 'メモタグ（複数指定可、カンマ区切り）',
  '決済日', '決済口座', '決済金額'
];

/* ---------------- 共通：対象データの抽出 ---------------- */

function freee_targets_(sheet, opts) {
  var ids = opts.ids && opts.ids.length ? opts.ids : null;
  return records_readAll_(sheet).filter(function (r) {
    if (ids) return ids.indexOf(r.id) >= 0;
    var d = String(r.paymentDate || '').replace(/\//g, '-');
    if (opts.from && d < opts.from) return false;
    if (opts.to && d > opts.to) return false;
    if (opts.category && r.category !== opts.category) return false;
    return r.status === STATUS.APPROVED || (opts.includeExported && r.status === STATUS.EXPORTED);
  }).sort(function (a, b) { return String(a.paymentDate).localeCompare(String(b.paymentDate)); });
}

function freee_settlementAccount_(settings, paymentMethod) {
  var m = String(paymentMethod || '');
  if (m.indexOf('カード') >= 0) return settings.FREEE_CARD_ACCOUNT || '';
  if (m.indexOf('現金') >= 0) return settings.FREEE_CASH_ACCOUNT || '';
  return settings.FREEE_SETTLEMENT_ACCOUNT || '';
}

function freee_partner_(settings, r) {
  var mode = settings.FREEE_PARTNER_MODE || '支払先';
  if (mode === 'なし') return '';
  if (mode === '支払者') return r.payerName || '';
  return r.vendor || '';
}

function freee_memo_(r) {
  var paidBy = String(r.paymentMethod || '立替').indexOf('立替') >= 0 ? '立替:' + r.payerName : '支払者:' + r.payerName;
  return ['[' + r.id + ']', r.vendor, r.description, paidBy,
    r.invoiceNumber ? '登録番号:' + r.invoiceNumber : ''].filter(String).join(' / ');
}

/* ---------------- 方式A：CSV ---------------- */

/** 承認済みデータを freee「取引のインポート」用CSVにして Drive に保存 */
function api_freeeExportCsv(token, opts) {
  var who = requireAuth_(token);
  opts = opts || {};
  var c = ctx_();
  var s = c.settings;
  var targets = freee_targets_(c.sheet, opts);
  if (!targets.length) throw new Error('出力対象（承認済）のデータがありません');

  var rows = [FREEE_CSV_HEADER];
  targets.forEach(function (r) {
    var settle = freee_settlementAccount_(s, r.paymentMethod);
    var date = String(r.paymentDate).replace(/-/g, '/');
    rows.push([
      '支出', r.id, date, '', '', freee_partner_(s, r), r.freeeAccountItem || r.accountItem, r.freeeTaxName,
      r.amount, '内税', r.taxAmount, freee_memo_(r), '', r.department || '',
      [r.category, r.payerName].filter(String).join(','),
      settle ? date : '', settle, settle ? r.amount : ''
    ]);
  });
  var csv = rows.map(function (row) {
    return row.map(function (v) {
      var str = String(v == null ? '' : v);
      return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
    }).join(',');
  }).join('\r\n');

  var batch = 'CSV-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
  var sjis = (s.FREEE_CSV_ENCODING || 'UTF-8').toLowerCase().indexOf('shift') === 0;
  var blob = sjis
    ? Utilities.newBlob('').setDataFromString(csv, 'Shift_JIS').setName('freee取引_' + batch + '.csv').setContentType('text/csv')
    : Utilities.newBlob('﻿' + csv, 'text/csv', 'freee取引_' + batch + '.csv');

  var url = '';
  if (s.RECEIPT_FOLDER_ID) {
    var parent = DriveApp.getFolderById(s.RECEIPT_FOLDER_ID);
    var it = parent.getFoldersByName('freee出力');
    var folder = it.hasNext() ? it.next() : parent.createFolder('freee出力');
    url = folder.createFile(blob).getUrl();
  }

  if (opts.markExported) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      targets.forEach(function (r) {
        records_update_(c.sheet, r.id, { status: STATUS.EXPORTED, freeeExportedAt: new Date(), freeeExportBatch: batch });
      });
    } finally { lock.releaseLock(); }
  }
  log_write_(c.ss, who, 'freee CSV出力', batch + ' ' + targets.length + '件');
  return {
    count: targets.length,
    total: targets.reduce(function (sum, r) { return sum + (Number(r.amount) || 0); }, 0),
    batch: batch,
    url: url,
    fileName: blob.getName(),
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

/* ---------------- 方式B：API（OAuth2） ---------------- */

function freee_props_() { return PropertiesService.getScriptProperties(); }

function freee_redirectUri_() {
  return 'https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback';
}

function api_freeeStatus(token) {
  requireAuth_(token);
  var p = freee_props_();
  var t = JSON.parse(p.getProperty('FREEE_TOKEN') || 'null');
  return {
    hasClient: !!(p.getProperty('FREEE_CLIENT_ID') && p.getProperty('FREEE_CLIENT_SECRET')),
    connected: !!(t && t.refresh_token),
    redirectUri: freee_redirectUri_(),
    companyId: settings_get_(getHomeSpreadsheet_()).FREEE_COMPANY_ID || ''
  };
}

function api_freeeSaveClient(token, clientId, clientSecret) {
  var who = requireAuth_(token);
  if (!clientId || !clientSecret) throw new Error('Client ID と Client Secret を入力してください');
  freee_props_().setProperties({ FREEE_CLIENT_ID: String(clientId).trim(), FREEE_CLIENT_SECRET: String(clientSecret).trim() });
  freee_props_().deleteProperty('FREEE_TOKEN');
  log_write_(getHomeSpreadsheet_(), who, 'freeeアプリ登録', '');
  return true;
}

function api_freeeAuthUrl(token) {
  requireAuth_(token);
  var p = freee_props_();
  var clientId = p.getProperty('FREEE_CLIENT_ID');
  if (!clientId) throw new Error('先に Client ID / Secret を登録してください');
  var state = ScriptApp.newStateToken().withMethod('freee_authCallback').withTimeout(600).createToken();
  return FREEE_AUTH + '/authorize?response_type=code&prompt=select_company' +
    '&client_id=' + encodeURIComponent(clientId) +
    '&redirect_uri=' + encodeURIComponent(freee_redirectUri_()) +
    '&state=' + encodeURIComponent(state);
}

/** freee の認可画面から戻ってきたときに呼ばれる */
function freee_authCallback(request) {
  try {
    freee_tokenRequest_({ grant_type: 'authorization_code', code: request.parameter.code, redirect_uri: freee_redirectUri_() });
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">freeeとの連携が完了しました。このタブを閉じて管理画面に戻ってください。</p>');
  } catch (e) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">連携に失敗しました：' + String(e.message).replace(/</g, '&lt;') + '</p>');
  }
}

function freee_tokenRequest_(params) {
  var p = freee_props_();
  params.client_id = p.getProperty('FREEE_CLIENT_ID');
  params.client_secret = p.getProperty('FREEE_CLIENT_SECRET');
  var res = UrlFetchApp.fetch(FREEE_AUTH + '/token', { method: 'post', payload: params, muteHttpExceptions: true });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300 || !body.access_token) {
    throw new Error('freeeトークン取得失敗: ' + (body.error_description || body.error || res.getResponseCode()));
  }
  body.expires_at = Date.now() + (Number(body.expires_in) || 21600) * 1000 - 60000;
  p.setProperty('FREEE_TOKEN', JSON.stringify(body));
  return body;
}

function freee_accessToken_() {
  var t = JSON.parse(freee_props_().getProperty('FREEE_TOKEN') || 'null');
  if (!t || !t.refresh_token) throw new Error('freeeと未連携です。「freee連携」タブから連携してください');
  if (Date.now() > t.expires_at) t = freee_tokenRequest_({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  return t.access_token;
}

function freee_fetch_(method, path, opts) {
  opts = opts || {};
  var params = {
    method: method,
    headers: { Authorization: 'Bearer ' + freee_accessToken_() },
    muteHttpExceptions: true
  };
  if (opts.json) { params.contentType = 'application/json'; params.payload = JSON.stringify(opts.json); }
  if (opts.form) params.payload = opts.form; // Blob を含むと multipart/form-data で送信される
  var url = FREEE_API + path + (opts.query ? '?' + Object.keys(opts.query).map(function (k) {
    return k + '=' + encodeURIComponent(opts.query[k]);
  }).join('&') : '');
  var res = UrlFetchApp.fetch(url, params);
  var text = res.getContentText();
  var body = text ? JSON.parse(text) : {};
  if (res.getResponseCode() >= 300) {
    var msg = (body.errors || []).map(function (e) { return (e.messages || []).join(' '); }).join(' ') || body.message || text;
    throw new Error('freee API ' + res.getResponseCode() + ': ' + msg);
  }
  return body;
}

function freee_companyId_(settings) {
  var id = Number(settings.FREEE_COMPANY_ID);
  if (!id) throw new Error('設定 FREEE_COMPANY_ID（freee事業所ID）を入力してください');
  return id;
}

/** freee の勘定科目ID・税区分コード・部門をマスタに反映 */
function api_freeeSyncMasters(token) {
  var who = requireAuth_(token);
  var ss = getHomeSpreadsheet_();
  var settings = settings_get_(ss);
  var companyId = freee_companyId_(settings);

  var items = freee_fetch_('get', '/api/1/account_items', { query: { company_id: companyId } }).account_items || [];
  var itemByName = {};
  items.forEach(function (a) { itemByName[a.name] = a.id; });
  var taxes = freee_fetch_('get', '/api/1/taxes/companies/' + companyId).taxes || [];
  var taxByName = {};
  taxes.forEach(function (t) { taxByName[t.name_ja] = t.code; });
  var sections = freee_fetch_('get', '/api/1/sections', { query: { company_id: companyId } }).sections || [];

  var missing = [];
  var accounts = form_getAccounts_(ss, true).map(function (a) {
    if (itemByName[a.freeeName]) a.freeeId = itemByName[a.freeeName];
    else missing.push('勘定科目「' + a.freeeName + '」');
    return a;
  });
  table_replaceAll_(ss, TABLES.accounts, accounts.map(function (a) {
    a.categories = a.categories.join(','); return a;
  }));
  var taxRows = form_getTaxes_(ss, true).map(function (t) {
    if (taxByName[t.freeeName] != null) t.freeeCode = taxByName[t.freeeName]; else missing.push('税区分「' + t.freeeName + '」');
    if (taxByName[t.freeeNameNonQualified] != null) t.freeeCodeNonQualified = taxByName[t.freeeNameNonQualified];
    else if (t.freeeNameNonQualified) missing.push('税区分「' + t.freeeNameNonQualified + '」');
    return t;
  });
  table_replaceAll_(ss, TABLES.taxes, taxRows);
  var sectionNames = sections.map(function (x) { return x.name; });
  form_getCategories_(ss, true).forEach(function (c) {
    if (c.freeeSection && sectionNames.indexOf(c.freeeSection) < 0) missing.push('部門「' + c.freeeSection + '」');
  });
  freee_props_().setProperty('FREEE_SECTIONS', JSON.stringify(sections.map(function (x) { return { id: x.id, name: x.name }; })));
  log_write_(ss, who, 'freeeマスタ同期', missing.join(','));
  return { accounts: accounts.length, taxes: taxRows.length, sections: sectionNames, missing: missing };
}

/**
 * 承認済みの申請を freee に取引として登録（領収書はファイルボックスに証憑として添付）
 * GASの実行時間制限（6分）対策として1回あたり最大20件。残りは画面側で再実行します。
 */
function api_freeeSendDeals(token, opts) {
  var who = requireAuth_(token);
  opts = opts || {};
  var c = ctx_();
  var s = c.settings;
  var companyId = freee_companyId_(s);
  var accounts = form_getAccounts_(c.ss, true);
  var taxes = form_getTaxes_(c.ss, true);
  var sections = JSON.parse(freee_props_().getProperty('FREEE_SECTIONS') || '[]');

  var targets = freee_targets_(c.sheet, opts).filter(function (r) { return !r.freeeDealId; });
  var batchSize = 20;
  var batch = 'API-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
  var results = [];
  var started = Date.now();

  for (var i = 0; i < targets.length && i < batchSize; i++) {
    if (Date.now() - started > 4.5 * 60 * 1000) break;
    var r = targets[i];
    try {
      var acc = accounts.filter(function (a) { return a.label === r.accountItem || a.freeeName === r.freeeAccountItem; })[0];
      if (!acc || !acc.freeeId) throw new Error('勘定科目IDが未設定です（マスタ同期を実行してください）');
      var tax = taxes.filter(function (t) { return t.label === r.taxRateLabel; })[0];
      if (!tax) throw new Error('税区分が見つかりません');
      var qualified = r.invoiceType ? r.invoiceType === INVOICE_QUALIFIED : true;
      var taxCode = qualified ? tax.freeeCode : (tax.freeeCodeNonQualified !== '' ? tax.freeeCodeNonQualified : tax.freeeCode);
      if (taxCode === '' || taxCode == null) throw new Error('税区分コードが未設定です（マスタ同期を実行してください）');
      var section = sections.filter(function (x) { return x.name === r.department; })[0];

      // 証憑（領収書）のアップロード
      var receiptIds = [];
      util_list_(r.receiptFileIds).forEach(function (fileId) {
        var blob = DriveApp.getFileById(fileId).getBlob();
        var up = freee_fetch_('post', '/api/1/receipts', {
          form: { company_id: String(companyId), receipt: blob, description: r.id + ' ' + (r.vendor || ''), issue_date: String(r.paymentDate).replace(/\//g, '-') }
        });
        receiptIds.push(up.receipt.id);
      });

      var detail = {
        account_item_id: Number(acc.freeeId),
        tax_code: Number(taxCode),
        amount: Number(r.amount),
        description: freee_memo_(r).slice(0, 250)
      };
      if (section) detail.section_id = section.id;
      var deal = freee_fetch_('post', '/api/1/deals', {
        json: {
          company_id: companyId,
          issue_date: String(r.paymentDate).replace(/\//g, '-'),
          type: 'expense',
          ref_number: r.id,
          details: [detail],
          receipt_ids: receiptIds
        }
      }).deal;

      records_update_(c.sheet, r.id, {
        status: STATUS.EXPORTED, freeeDealId: deal.id, freeeReceiptIds: receiptIds.join('\n'),
        freeeExportedAt: new Date(), freeeExportBatch: batch
      });
      results.push({ id: r.id, ok: true, dealId: deal.id });
    } catch (e) {
      results.push({ id: r.id, ok: false, error: String(e.message || e) });
    }
  }
  log_write_(c.ss, who, 'freee API登録', batch + ' 成功' + results.filter(function (x) { return x.ok; }).length + '件');
  return { results: results, remaining: Math.max(0, targets.length - results.length) };
}
