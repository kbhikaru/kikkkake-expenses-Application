/**
 * ============================================================
 *  月次精算書
 *  ・支払者ごとに1枚の精算書（スプレッドシートのシート＋PDF）を作成
 *  ・各明細に「領収書」と「元データ（経費データの該当行）」へのリンクを入れる
 *  ・保存先：大元 > 2026年10月_経費精算 >
 *      【精算書】2026年10月_一覧（スプレッドシート / PDF）
 *      K-001_山田太郎 > 【精算書】2026年10月_K-001_山田太郎.pdf
 *  ・freeeには精算書単位でまとめて登録し、このPDFを証憑として添付する想定
 * ============================================================
 */

var STATEMENT_DETAIL_HEADER = ['No', '支払日', '支払先/店名', '内容', '勘定科目', '税区分', '金額（税込）', '消費税',
  '支払方法', '適格請求書', '申請ID', '領収書', '元データ', 'ステータス'];

function statement_id_(month, payerId) {
  return 'STMT-' + month.replace('-', '') + '-' + util_sanitize_(payerId, 30);
}

function statement_monthDate_(month) { return new Date(month + '-01T00:00:00+09:00'); }

/** 精算書の対象となる申請を集める */
function statement_targets_(c, month, includePending) {
  var ok = [STATUS.APPROVED, STATUS.EXPORTED];
  if (includePending) ok.push(STATUS.PENDING);
  return records_readAll_(c.sheet).filter(function (r) {
    return ok.indexOf(r.status) >= 0 && drive_recordMonth_(c.settings, r) === month;
  }).sort(function (a, b) {
    return String(a.paymentDate).localeCompare(String(b.paymentDate)) || String(a.submittedAt).localeCompare(String(b.submittedAt));
  });
}

function api_statementPreview(token, month) {
  requireAuth_(token);
  var c = ctx_();
  var include = util_toBool_(c.settings.STATEMENT_INCLUDE_PENDING);
  var all = records_readAll_(c.sheet).filter(function (r) { return drive_recordMonth_(c.settings, r) === month; });
  var targets = statement_targets_(c, month, include);
  var payers = {};
  targets.forEach(function (r) { payers[r.payerId] = (payers[r.payerId] || 0) + 1; });
  return {
    month: month,
    basis: c.settings.RECEIPT_MONTH_BASIS || '支払日',
    count: targets.length,
    total: targets.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0),
    payers: Object.keys(payers).length,
    pending: all.filter(function (r) { return r.status === STATUS.PENDING; }).length,
    includePending: include,
    existing: targets.filter(function (r) { return r.statementId; }).length
  };
}

function api_generateStatements(token, month) {
  var who = requireAuth_(token);
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new Error('対象月を選択してください');
  return statement_generate_(ctx_(), month, who);
}

function statement_generate_(c, month, who) {
  var s = c.settings;
  var targets = statement_targets_(c, month, util_toBool_(s.STATEMENT_INCLUDE_PENDING));
  if (!targets.length) throw new Error(month + ' の精算書に載せる申請（承認済）がありません');

  var monthDate = statement_monthDate_(month);
  var label = drive_monthLabel_(monthDate);
  var monthFolder = drive_monthFolder_(s, monthDate);
  var perPayerFolder = (s.RECEIPT_SUBFOLDER_MODE || '月別+支払者') === '月別+支払者';
  var dataUrlBase = c.sheet.getParent().getUrl() + '#gid=' + c.sheet.getSheetId() + '&range=A';

  // 支払者ごとにまとめる
  var groups = [];
  var byPayer = {};
  targets.forEach(function (r) {
    var key = r.payerId || r.payerName;
    if (!byPayer[key]) {
      byPayer[key] = { id: statement_id_(month, key), payerId: r.payerId, payerName: r.payerName, category: r.category, rows: [] };
      groups.push(byPayer[key]);
    }
    byPayer[key].rows.push(r);
  });
  groups.forEach(function (g) {
    g.total = g.rows.reduce(function (t, r) { return t + (Number(r.amount) || 0); }, 0);
    g.reimburse = g.rows.filter(function (r) { return String(r.paymentMethod || '立替').indexOf('立替') >= 0; })
      .reduce(function (t, r) { return t + (Number(r.amount) || 0); }, 0);
  });

  // ---- スプレッドシートを作り直す ----
  var bookName = '【精算書】' + label + '_一覧';
  var old = monthFolder.getFilesByName(bookName);
  while (old.hasNext()) old.next().setTrashed(true);
  var book = SpreadsheetApp.create(bookName);
  DriveApp.getFileById(book.getId()).moveTo(monthFolder);
  var now = new Date();
  var nowText = util_formatDate_(now, 'yyyy/MM/dd HH:mm');

  var summary = book.getSheets()[0].setName('サマリー');
  groups.forEach(function (g) {
    g.sheet = book.insertSheet(drive_payerFolderName_(g.payerId, g.payerName).slice(0, 90) || g.id);
    statement_writePayerSheet_(g.sheet, g, label, nowText, s, dataUrlBase);
  });
  statement_writeSummary_(summary, groups, label, nowText, who, s);
  SpreadsheetApp.flush();

  // ---- PDF ----
  groups.forEach(function (g, i) {
    if (i) Utilities.sleep(1200); // エクスポートの連続実行制限対策
    var folder = perPayerFolder ? drive_getOrCreateFolder_(monthFolder, drive_payerFolderName_(g.payerId, g.payerName)) : monthFolder;
    var pdfName = '【精算書】' + label + '_' + drive_payerFolderName_(g.payerId, g.payerName) + '.pdf';
    var file = drive_replaceFile_(folder, statement_pdf_(book.getId(), g.sheet.getSheetId(), pdfName));
    file.setDescription(g.id);
    g.pdfId = file.getId();
    g.pdfUrl = file.getUrl();
  });
  // サマリーにPDFリンクを入れてから一覧PDFを作る
  groups.forEach(function (g, i) {
    summary.getRange(11 + i, 8).setFormula('=HYPERLINK("' + g.pdfUrl + '","PDFを開く")');
  });
  SpreadsheetApp.flush();
  Utilities.sleep(1200);
  var summaryPdf = drive_replaceFile_(monthFolder, statement_pdf_(book.getId(), summary.getSheetId(), '【精算書】' + label + '_一覧.pdf'));

  // ---- 経費データに精算書番号を記録 ----
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    groups.forEach(function (g) {
      g.rows.forEach(function (r) { records_update_(c.sheet, r.id, { statementId: g.id, statementUrl: g.pdfUrl }); });
    });
  } finally { lock.releaseLock(); }

  log_write_(c.ss, who, '月次精算書作成', month + ' ' + groups.length + '名 ' + targets.length + '件');
  return {
    month: month,
    label: label,
    count: targets.length,
    total: groups.reduce(function (t, g) { return t + g.total; }, 0),
    spreadsheetUrl: book.getUrl(),
    summaryPdfUrl: summaryPdf.getUrl(),
    folderUrl: monthFolder.getUrl(),
    statements: groups.map(function (g) {
      return { id: g.id, payerId: g.payerId, payerName: g.payerName, category: g.category,
        count: g.rows.length, total: g.total, reimburse: g.reimburse, pdfUrl: g.pdfUrl };
    })
  };
}

function statement_hyperlink_(url, text) {
  return url ? '=HYPERLINK("' + String(url).replace(/"/g, '') + '","' + text + '")' : '';
}

function statement_writePayerSheet_(sh, g, label, nowText, s, dataUrlBase) {
  var head = [
    ['経費精算書', ''],
    ['精算書番号', g.id],
    ['対象月', label + '分（' + (s.RECEIPT_MONTH_BASIS || '支払日') + '基準）'],
    ['支払者', g.payerName + '（' + g.payerId + '）'],
    ['所属区分', g.category],
    ['合計金額（税込）', g.total],
    ['うち立替精算額', g.reimburse],
    ['作成日時', nowText]
  ];
  sh.getRange(1, 1, head.length, 2).setValues(head);
  sh.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  sh.getRange(2, 1, head.length - 1, 1).setFontWeight('bold');
  sh.getRange(6, 2, 2, 1).setNumberFormat('¥#,##0');

  var start = head.length + 2;
  var rows = g.rows.map(function (r, i) {
    return [i + 1, String(r.paymentDate).replace(/-/g, '/'), r.vendor, r.description, r.freeeAccountItem || r.accountItem,
      r.freeeTaxName, Number(r.amount) || 0, Number(r.taxAmount) || 0, r.paymentMethod, r.invoiceType ? (r.invoiceType.indexOf('あり') >= 0 ? 'あり' : 'なし') : '',
      r.id, '', statement_hyperlink_(dataUrlBase + r._row, '元データ'), r.status];
  });
  sh.getRange(start, 1, 1, STATEMENT_DETAIL_HEADER.length).setValues([STATEMENT_DETAIL_HEADER])
    .setFontWeight('bold').setBackground('#f1f3f4');
  sh.getRange(start + 1, 1, rows.length, STATEMENT_DETAIL_HEADER.length).setValues(rows);

  // 領収書リンク（複数枚にも対応するためリッチテキストで設定）
  var receiptCells = g.rows.map(function (r) {
    var urls = String(r.receiptUrls || '').split('\n').filter(String);
    if (!urls.length) return [SpreadsheetApp.newRichTextValue().setText('なし').build()];
    var text = urls.map(function (u, i) { return urls.length > 1 ? '領収書' + (i + 1) : '領収書'; }).join(' ');
    var b = SpreadsheetApp.newRichTextValue().setText(text);
    var pos = 0;
    urls.forEach(function (u, i) {
      var t = urls.length > 1 ? '領収書' + (i + 1) : '領収書';
      b.setLinkUrl(pos, pos + t.length, u);
      pos += t.length + 1;
    });
    return [b.build()];
  });
  sh.getRange(start + 1, 12, receiptCells.length, 1).setRichTextValues(receiptCells);

  var totalRow = start + rows.length + 1;
  sh.getRange(totalRow, 6, 1, 3).setValues([['合計', g.total, g.rows.reduce(function (t, r) { return t + (Number(r.taxAmount) || 0); }, 0)]])
    .setFontWeight('bold');
  sh.getRange(start + 1, 7, rows.length + 1, 2).setNumberFormat('¥#,##0');
  sh.getRange(totalRow + 2, 1).setValue('※ 領収書・元データの各リンクから、申請時の原本（電子データ）を確認できます。');
  sh.setColumnWidths(1, 1, 36);
  sh.setColumnWidths(2, 1, 84);
  sh.setColumnWidths(3, 2, 170);
  sh.setColumnWidths(5, 2, 120);
  sh.setColumnWidths(7, 8, 84);
}

function statement_writeSummary_(sh, groups, label, nowText, who, s) {
  var total = groups.reduce(function (t, g) { return t + g.total; }, 0);
  var reimburse = groups.reduce(function (t, g) { return t + g.reimburse; }, 0);
  var count = groups.reduce(function (t, g) { return t + g.rows.length; }, 0);
  sh.getRange(1, 1, 8, 2).setValues([
    ['経費精算書 一覧', ''],
    ['対象月', label + '分（' + (s.RECEIPT_MONTH_BASIS || '支払日') + '基準）'],
    ['件数', count],
    ['合計金額（税込）', total],
    ['うち立替精算額', reimburse],
    ['作成日時', nowText],
    ['作成者', who],
    ['', '']
  ]);
  sh.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  sh.getRange(4, 2, 2, 1).setNumberFormat('¥#,##0');
  sh.getRange(10, 1, 1, 8).setValues([['精算書番号', '社員ID', '氏名', '所属区分', '件数', '合計金額', '立替精算額', '精算書PDF']])
    .setFontWeight('bold').setBackground('#f1f3f4');
  sh.getRange(11, 1, groups.length, 7).setValues(groups.map(function (g) {
    return [g.id, g.payerId, g.payerName, g.category, g.rows.length, g.total, g.reimburse];
  }));
  sh.getRange(11, 6, groups.length, 2).setNumberFormat('¥#,##0');

  // 勘定科目×税区分×部門の集計（freeeにまとめて登録するときの内訳）
  var agg = {};
  groups.forEach(function (g) {
    g.rows.forEach(function (r) {
      var k = [r.freeeAccountItem || r.accountItem, r.freeeTaxName, r.department || ''].join('\u0001');
      agg[k] = agg[k] || { n: 0, amt: 0, tax: 0 };
      agg[k].n++; agg[k].amt += Number(r.amount) || 0; agg[k].tax += Number(r.taxAmount) || 0;
    });
  });
  var keys = Object.keys(agg).sort();
  var at = 11 + groups.length + 2;
  sh.getRange(at, 1, 1, 6).setValues([['勘定科目', '税区分', '部門', '件数', '金額（税込）', '消費税']])
    .setFontWeight('bold').setBackground('#f1f3f4');
  sh.getRange(at + 1, 1, keys.length, 6).setValues(keys.map(function (k) {
    var p = k.split('\u0001');
    return [p[0], p[1], p[2], agg[k].n, agg[k].amt, agg[k].tax];
  }));
  sh.getRange(at + 1, 5, keys.length, 2).setNumberFormat('¥#,##0');
  sh.setColumnWidths(1, 1, 180);
  sh.setColumnWidths(2, 7, 110);
}

/** スプレッドシートの1シートをPDFにする */
function statement_pdf_(spreadsheetId, gid, name) {
  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?format=pdf&gid=' + gid +
    '&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=CENTER' +
    '&top_margin=0.5&bottom_margin=0.5&left_margin=0.4&right_margin=0.4';
  for (var attempt = 0; attempt < 4; attempt++) {
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) return res.getBlob().setName(name);
    if (res.getResponseCode() !== 429) throw new Error('PDFの作成に失敗しました（' + res.getResponseCode() + '）');
    Utilities.sleep(3000 * (attempt + 1));
  }
  throw new Error('PDFの作成が混み合っています。少し時間をおいて再実行してください');
}

/* ---------------- 毎月の自動作成 ---------------- */

var STATEMENT_TRIGGER_FN = 'scheduled_monthlyStatements';

function api_statementAutoStatus(token) {
  requireAuth_(token);
  var s = settings_get_(getHomeSpreadsheet_());
  return {
    enabled: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === STATEMENT_TRIGGER_FN; }),
    day: Number(s.STATEMENT_AUTO_DAY) || 5
  };
}

function api_setStatementAuto(token, enabled) {
  var who = requireAuth_(token);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === STATEMENT_TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
  var day = Math.min(28, Math.max(1, Number(settings_get_(getHomeSpreadsheet_()).STATEMENT_AUTO_DAY) || 5));
  if (enabled) ScriptApp.newTrigger(STATEMENT_TRIGGER_FN).timeBased().onMonthDay(day).atHour(6).create();
  log_write_(getHomeSpreadsheet_(), who, '精算書の自動作成', enabled ? '毎月' + day + '日' : 'オフ');
  return { enabled: !!enabled, day: day };
}

/** 時間主導トリガーから実行：前月分の精算書を作成し、通知先へメール */
function scheduled_monthlyStatements() {
  var c = ctx_();
  var now = new Date();
  var prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  var month = util_formatDate_(prev, 'yyyy-MM');
  var to = util_list_(c.settings.NOTIFY_EMAILS).join(',');
  try {
    var res = statement_generate_(c, month, '自動作成');
    if (to) {
      MailApp.sendEmail(to, '【経費精算】' + res.label + '分の精算書を作成しました',
        res.label + '分の精算書を作成しました（' + res.statements.length + '名・' + res.count + '件・¥' + res.total.toLocaleString() + '）\n\n' +
        '一覧：' + res.spreadsheetUrl + '\nフォルダ：' + res.folderUrl + '\n\n' +
        res.statements.map(function (x) { return '・' + x.payerName + '（' + x.payerId + '）¥' + x.total.toLocaleString() + '  ' + x.pdfUrl; }).join('\n'));
    }
  } catch (e) {
    log_write_(c.ss, '自動作成', '月次精算書作成エラー', month + ' ' + e.message);
    if (to) MailApp.sendEmail(to, '【経費精算】' + month + ' 精算書の自動作成ができませんでした', String(e.message));
  }
}
