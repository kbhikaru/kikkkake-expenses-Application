/**
 * ============================================================
 *  管理者認証
 *  ・パスワードはソルト付きSHA-256（反復）でスクリプトプロパティに保存
 *    （スプレッドシートには置かないので、シートの編集者からも見えません）
 *  ・ログインに成功するとセッショントークンを発行（6時間有効）
 *  ・連続失敗でロック（15分）
 *  ・スクリプトプロパティ ADMIN_EMAILS を設定すると、
 *    そのGoogleアカウントからのアクセスのみ許可（パスワードと併用）
 * ============================================================
 */

var SESSION_TTL_SEC = 6 * 60 * 60;
var MAX_FAILS = 5;
var LOCK_SEC = 15 * 60;

/**
 * 【最初に1回だけ Apps Script エディタから実行】
 * 事前に「プロジェクトの設定 > スクリプト プロパティ」に以下を登録してください。
 *   HOME_SPREADSHEET_ID : 経費DBスプレッドシートのID
 *   INITIAL_PASSWORD    : 管理画面の初期パスワード（実行後に自動削除されます）
 */
function initialSetup() {
  var props = PropertiesService.getScriptProperties();
  var pw = props.getProperty('INITIAL_PASSWORD');
  if (!props.getProperty('HOME_SPREADSHEET_ID')) throw new Error('スクリプトプロパティ HOME_SPREADSHEET_ID を設定してください');
  if (pw) {
    if (pw.length < 8) throw new Error('パスワードは8文字以上にしてください');
    setPassword_(pw);
    props.deleteProperty('INITIAL_PASSWORD');
    console.log('管理者パスワードを設定しました（INITIAL_PASSWORD は削除済み）');
  } else if (!props.getProperty('ADMIN_PW_HASH')) {
    throw new Error('スクリプトプロパティ INITIAL_PASSWORD を設定してください');
  }
  var created = schema_ensureAll_(getHomeSpreadsheet_());
  console.log('シート確認完了。新規作成：' + (created.join(', ') || 'なし'));
}

function hashPassword_(password, salt) {
  var value = salt + ':' + password;
  for (var i = 0; i < 300; i++) {
    value = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value + salt, Utilities.Charset.UTF_8));
  }
  return value;
}

function setPassword_(password) {
  var salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    ADMIN_PW_SALT: salt,
    ADMIN_PW_HASH: hashPassword_(password, salt)
  });
}

function currentEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function checkEmailAllowed_() {
  var allowed = util_list_(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS'));
  if (!allowed.length) return;
  var email = currentEmail_().toLowerCase();
  var ok = allowed.some(function (a) { return a.toLowerCase() === email; });
  if (!ok) throw new Error('このアカウント（' + (email || '不明') + '）には管理者権限がありません');
}

function api_login(password) {
  checkEmailAllowed_();
  var props = PropertiesService.getScriptProperties();
  var hash = props.getProperty('ADMIN_PW_HASH');
  if (!hash) throw new Error('管理者パスワードが未設定です（initialSetup を実行してください）');
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('login_fails') || 0);
  if (fails >= MAX_FAILS) throw new Error('ログインに続けて失敗したため、15分間ロックされています');

  if (hashPassword_(String(password || ''), props.getProperty('ADMIN_PW_SALT')) !== hash) {
    cache.put('login_fails', String(fails + 1), LOCK_SEC);
    Utilities.sleep(800);
    throw new Error('パスワードが違います（残り' + (MAX_FAILS - fails - 1) + '回）');
  }
  cache.remove('login_fails');
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  var who = currentEmail_() || 'admin';
  cache.put('sess:' + token, who, SESSION_TTL_SEC);
  log_write_(getHomeSpreadsheet_(), who, '管理画面ログイン', '');
  return { token: token, email: who };
}

/** すべての管理API の先頭で呼ぶ。実行者名を返す */
function requireAuth_(token) {
  checkEmailAllowed_();
  if (!token) throw new Error('AUTH: ログインしてください');
  var cache = CacheService.getScriptCache();
  var who = cache.get('sess:' + token);
  if (!who) throw new Error('AUTH: セッションの有効期限が切れました。再度ログインしてください');
  cache.put('sess:' + token, who, SESSION_TTL_SEC); // 操作があれば延長
  return who;
}

function api_logout(token) {
  if (token) CacheService.getScriptCache().remove('sess:' + token);
  return true;
}

function api_changePassword(token, current, next) {
  var who = requireAuth_(token);
  var props = PropertiesService.getScriptProperties();
  if (hashPassword_(String(current || ''), props.getProperty('ADMIN_PW_SALT')) !== props.getProperty('ADMIN_PW_HASH')) {
    throw new Error('現在のパスワードが違います');
  }
  if (!next || String(next).length < 8) throw new Error('新しいパスワードは8文字以上にしてください');
  setPassword_(String(next));
  log_write_(getHomeSpreadsheet_(), who, 'パスワード変更', '');
  return true;
}
