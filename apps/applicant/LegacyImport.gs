/**
 * 旧Googleフォーム（KIKKAKE / TIE別々）の回答シートを経費データに取り込む。
 * ダッシュボードで過去分も集計できるようにするための移行用機能です。
 * 同じ回答を2回取り込まないよう、タイムスタンプ+支払者+金額で重複判定します。
 */
function menu_importLegacy() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('旧フォーム回答の取込 (1/3)', '回答が入っているスプレッドシートのID', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var r2 = ui.prompt('旧フォーム回答の取込 (2/3)', 'シート名（例：【回答】経費申請フォーム_KIKKAKE）', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var r3 = ui.prompt('旧フォーム回答の取込 (3/3)', '所属区分（KIKKAKE または TIE Coffee）', ui.ButtonSet.OK_CANCEL);
  if (r3.getSelectedButton() !== ui.Button.OK) return;
  var done = ui.alert('取り込んだデータを「freee連携済」として登録しますか？\n（既にfreeeに登録済みなら「はい」。二重登録を防げます）', ui.ButtonSet.YES_NO);

  var n = importLegacyResponses(r1.getResponseText().trim(), r2.getResponseText().trim(), r3.getResponseText().trim(),
    done === ui.Button.YES);
  ui.alert(n + ' 件を取り込みました。');
}

function importLegacyResponses(spreadsheetId, sheetName, categoryName, markExported) {
  var ss = getHomeSpreadsheet_();
  var settings = settings_get_(ss);
  var src = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  if (!src) throw new Error('シートが見つかりません: ' + sheetName);
  var values = src.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var col = function (name) { return header.indexOf(name); };
  var c = {
    ts: col('タイムスタンプ'), date: col('支払日'), payer: col('支払者（立替者）'), vendor: col('支払先/店名'),
    amount: col('金額（税込）'), account: col('勘定科目'), tax: col('税率'), receipt: col('レシート画像'),
    note: header.findIndex(function (h) { return h.indexOf('備考') === 0; })
  };

  var categories = form_getCategories_(ss, true);
  var category = categories.filter(function (x) { return x.name === categoryName; })[0] || { name: categoryName };
  var employees = employees_list_(settings, categories);
  var accounts = form_getAccounts_(ss, true);
  var taxes = form_getTaxes_(ss, true);

  var sh = records_getSheet_(ss, settings);
  var existing = {};
  records_readAll_(sh).forEach(function (r) { existing[r.submittedAt + '|' + r.payerId + '|' + r.amount] = true; });

  var count = 0;
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[c.ts]) continue;
    var amount = Number(row[c.amount]) || 0;
    var payerId = String(row[c.payer] || '').trim();
    var submittedAt = util_isDate_(row[c.ts]) ? row[c.ts] : new Date(row[c.ts]);
    var payer = employees.filter(function (e) { return e.id === payerId || e.name === payerId; })[0];
    var key = util_formatDate_(submittedAt, 'yyyy/MM/dd HH:mm:ss') + '|' + (payer ? payer.id : payerId) + '|' + amount;
    if (existing[key]) continue;
    var accLabel = String(row[c.account] || '');
    var acc = accounts.filter(function (a) { return a.label === accLabel || a.freeeName === accLabel.replace(/（.*$/, ''); })[0];
    var taxLabel = String(row[c.tax] || '');
    var rate = /8\s*%/.test(taxLabel) ? 8 : /10\s*%/.test(taxLabel) ? 10 : 0;
    var tax = taxes.filter(function (t) { return t.label === taxLabel; })[0] ||
      taxes.filter(function (t) { return t.rate === rate; })[0] || { label: taxLabel, rate: rate, freeeName: '' };
    var calc = util_computeTax_(amount, tax.rate, settings.TAX_ROUNDING);
    var receipts = String(c.receipt >= 0 ? row[c.receipt] : '').split(/[,\s]+/).filter(String);

    records_append_(sh, {
      id: util_newId_() + '-L',
      submittedAt: submittedAt,
      category: category.name,
      payerId: payer ? payer.id : payerId,
      payerName: payer ? payer.name : payerId,
      department: category.freeeSection || '',
      paymentDate: row[c.date],
      vendor: row[c.vendor],
      amount: amount,
      accountItem: acc ? acc.label : accLabel,
      freeeAccountItem: acc ? acc.freeeName : accLabel.replace(/（.*$/, ''),
      taxRateLabel: tax.label,
      taxRate: tax.rate,
      freeeTaxName: tax.freeeName,
      netAmount: calc.net,
      taxAmount: calc.tax,
      description: c.note >= 0 ? row[c.note] : '',
      receiptFileIds: receipts.map(function (u) { var m = u.match(/[-\w]{25,}/); return m ? m[0] : ''; }).join('\n'),
      receiptUrls: receipts.join('\n'),
      status: markExported ? STATUS.EXPORTED : STATUS.APPROVED,
      freeeExportBatch: markExported ? 'legacy-import' : '',
      reviewComment: '旧フォームから取込（' + sheetName + '）',
      updatedAt: new Date()
    });
    existing[key] = true;
    count++;
  }
  log_write_(ss, Session.getActiveUser().getEmail(), '旧フォーム取込', sheetName + ' ' + count + '件');
  return count;
}
