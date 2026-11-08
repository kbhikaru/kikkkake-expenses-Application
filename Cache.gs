/**
 * ============================================================
 *  高速化のためのキャッシュ
 *  ・フォーム項目・各マスタ・従業員一覧を CacheService に保存し、
 *    毎回スプレッドシートを読みに行かないようにする
 *  ・管理画面で設定やマスタを保存すると「設定」シートの CONFIG_VERSION が
 *    変わるので、次のアクセスで自動的に読み直される
 *  ・スプレッドシートのマスタを手で編集した場合も onEdit で CONFIG_VERSION を更新
 *  ・従業員マスタ（別ファイル）は最大15分で読み直す
 * ============================================================
 */

var CONFIG_TTL_SEC = 6 * 60 * 60;
var EMPLOYEE_TTL_SEC = 15 * 60;
var CACHE_CHUNK = 90 * 1000; // CacheService は1キー100KBまで

function cache_get_(key) {
  var cache = CacheService.getScriptCache();
  var head = cache.get(key);
  if (!head) return null;
  try {
    if (head.indexOf('chunks:') !== 0) return JSON.parse(head);
    var n = Number(head.slice(7));
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + ':' + i);
    var parts = cache.getAll(keys);
    var text = '';
    for (var j = 0; j < n; j++) {
      if (parts[key + ':' + j] == null) return null;
      text += parts[key + ':' + j];
    }
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function cache_put_(key, value, ttl) {
  try {
    var cache = CacheService.getScriptCache();
    var text = JSON.stringify(value);
    if (text.length <= CACHE_CHUNK) { cache.put(key, text, ttl); return; }
    var map = {};
    var n = Math.ceil(text.length / CACHE_CHUNK);
    for (var i = 0; i < n; i++) map[key + ':' + i] = text.slice(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK);
    cache.putAll(map, ttl);
    cache.put(key, 'chunks:' + n, ttl);
  } catch (e) {
    console.warn('cache put failed', e);
  }
}

/** フォーム項目・マスタ（CONFIG_VERSION 単位でキャッシュ） */
function appConfig_(ss, settings) {
  var key = 'cfg:' + (settings.CONFIG_VERSION || '0');
  var cfg = cache_get_(key);
  if (cfg) return cfg;
  cfg = {
    fields: form_getFields_(ss, false),
    accounts: form_getAccounts_(ss, false),
    taxes: form_getTaxes_(ss, false),
    categories: form_getCategories_(ss, false),
    vendors: form_getVendors_(ss, false)
  };
  cache_put_(key, cfg, CONFIG_TTL_SEC);
  return cfg;
}

/** 従業員一覧（ID・氏名・区分のみ） */
function appEmployees_(settings, categories) {
  var key = 'emp:' + (settings.CONFIG_VERSION || '0') + ':' + (settings.EMPLOYEE_SPREADSHEET_ID || '');
  var list = cache_get_(key);
  if (list) return list;
  list = employees_list_(settings, categories).map(function (e) {
    return { id: e.id, name: e.name, category: e.category };
  });
  cache_put_(key, list, EMPLOYEE_TTL_SEC);
  return list;
}

/**
 * スプレッドシートを手で編集したとき（シンプルトリガー）
 * マスタ・設定・フォーム項目の変更なら CONFIG_VERSION を更新してキャッシュを無効化
 */
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    var watched = [SHEETS.SETTINGS, SHEETS.FIELDS, SHEETS.ACCOUNTS, SHEETS.TAXES, SHEETS.CATEGORIES, SHEETS.VENDORS];
    if (watched.indexOf(name) < 0) return;
    if (name === SHEETS.SETTINGS && e.range.getRow() > 1) {
      var key = String(e.range.getSheet().getRange(e.range.getRow(), 1).getValue());
      if (key === 'CONFIG_VERSION') return;
    }
    settings_set_(e.source, { CONFIG_VERSION: String(Date.now()) });
  } catch (err) {
    console.warn('onEdit', err);
  }
}

/** 手動でキャッシュを捨てたいとき用（メニューから実行） */
function menu_clearCache() {
  settings_set_(SpreadsheetApp.getActiveSpreadsheet(), { CONFIG_VERSION: String(Date.now()) });
  SpreadsheetApp.getUi().alert('キャッシュをクリアしました。申請画面は次に開いたときに最新の設定で表示されます。');
}
