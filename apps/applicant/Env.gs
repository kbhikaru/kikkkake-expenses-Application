/**
 * 申請者用アプリの「ホームスプレッドシート」= このスクリプトが紐づくスプレッドシート
 */
function getHomeSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  // 念のため：Webアプリ実行時に取得できない環境向けのフォールバック
  var id = PropertiesService.getScriptProperties().getProperty('HOME_SPREADSHEET_ID');
  if (!id) throw new Error('ホームスプレッドシートが特定できません。メニュー「経費申請アプリ > 初期セットアップ」を実行してください。');
  return SpreadsheetApp.openById(id);
}
