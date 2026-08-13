/* ============================================================
   記録先の設定

   ここに Google Apps Script のウェブアプリURLを貼ると、
   受検者情報の入力画面と、スプレッドシートへの記録が有効になります。

   手順は SETUP.md を見てください。
   URLが空のあいだは入力画面が出ず、診断ツールとしてだけ動きます。
   ============================================================ */

window.CONFIG = {

  // Apps Script の「デプロイ」で発行される
  // https://script.google.com/macros/s/............/exec を貼る
  endpoint: '',

  // 用途タグの既定値。
  // URLに ?src=saiyo のように付けると、そちらが優先されます。
  // 例）採用 → ?src=saiyo ／ 社内 → ?src=shanai ／ SNS → ?src=sns
  defaultTag: 'direct',

  // 問い合わせ先（同意文の中に表示されます）
  contact: 'https://insup.co.jp/',

  // 入力を求める項目。false にするとその欄を出しません。
  fields: {
    company: true,   // 会社名・組織名
    dept:    true,   // 部署・職種
    years:   true    // 営業経験年数
  }
};
