/**
 * 管理者用アプリ（単独GAS）は、スクリプトプロパティ HOME_SPREADSHEET_ID の
 * スプレッドシート（＝申請者用GASが紐づく経費DB）を読み書きします。
 */
function getHomeSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('HOME_SPREADSHEET_ID');
  if (!id) throw new Error('HOME_SPREADSHEET_ID が未設定です。README の「管理者用アプリのセットアップ」を参照してください。');
  return SpreadsheetApp.openById(id);
}
