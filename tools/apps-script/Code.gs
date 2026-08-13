/* ============================================================
   営業タイプ診断 — 受信スクリプト（Google Apps Script）

   Googleスプレッドシートに紐づけて、ウェブアプリとしてデプロイします。
   手順は SETUP.md を見てください。

   ▼ 合い言葉はこの下の1行だけ書き換えてください。
     GitHub のファイルには書かないこと（公開リポジトリです）。
     書き換えるのは Apps Script のエディタ上だけにしてください。
   ============================================================ */

var PASSCODE = 'CHANGE_ME';

var SHEET_MAIN = '診断結果';
var SHEET_RAW  = '生回答';

/* 8スキルと5職種の並び順。シートの列順になります。 */
var SKILLS = ['apo', 'hearing', 'issue', 'proposal', 'closing', 'relation', 'action', 'pipeline'];
var SKILL_LABELS = ['アポ獲得力', 'ヒアリング力', '課題発見力', '提案力', 'クロージング力', '関係構築力', '行動力', '案件管理力'];
var ROLES = ['is', 'fs', 'cs', 'am', 'mgr'];
var ROLE_LABELS = ['IS適性', 'FS適性', 'CS適性', 'AM適性', 'MGR適性'];
var TRAITS = ['新規開拓', '関係構築', 'ヒアリング', '提案力', 'クロージング', '行動量', '戦略性', '顧客管理'];

/* ------------------------------------------------------------
   GET：動作確認と、合い言葉の確認（JSONP）

   ブラウザによっては POST の応答を読めないことがあるため、
   合い言葉の確認だけは <script> で読めるJSONPも用意している。
   ------------------------------------------------------------ */
function doGet(e) {
  var q = (e && e.parameter) || {};

  if (q.action === 'verify') {
    var ok = PASSCODE !== 'CHANGE_ME' && String(q.passcode || '').trim() === String(PASSCODE).trim();
    return reply(q.callback, ok
      ? { ok: true }
      : { ok: false, error: PASSCODE === 'CHANGE_ME'
            ? 'サーバー側の合い言葉が未設定です（管理者にご連絡ください）'
            : '合い言葉が違います' });
  }

  return reply(q.callback, { ok: true, message: '営業タイプ診断の受信スクリプトは動作しています。' });
}

/* callback があれば JSONP、なければ素のJSONで返す */
function reply(callback, obj) {
  if (callback && /^[\w$]+$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json(obj);
}

/* ------------------------------------------------------------
   本体
   ------------------------------------------------------------ */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'リクエストが空です' });
    }

    var body = JSON.parse(e.postData.contents);

    if (PASSCODE === 'CHANGE_ME') {
      return json({ ok: false, error: 'サーバー側の合い言葉が未設定です（管理者にご連絡ください）' });
    }
    if (String(body.passcode || '').trim() !== String(PASSCODE).trim()) {
      return json({ ok: false, error: '合い言葉が違います' });
    }

    if (body.action === 'verify') {
      return json({ ok: true });
    }
    if (body.action === 'submit') {
      return saveRow(body);
    }
    return json({ ok: false, error: '不明なリクエストです' });

  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/* ------------------------------------------------------------
   1件ぶんを2つのシートに書く
   ------------------------------------------------------------ */
function saveRow(b) {
  // 同時受信で行が混ざらないようにロックを取る
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var p  = b.profile || {};
    var t  = b.type || {};
    var ax = t.axes || {};
    var sk = (b.skills || {});
    var sc = sk.scores || {};
    var ro = (b.roles || {}).scores || {};
    var tr = b.traits || {};

    /* --- サマリのシート --- */
    var mainHead = ['受検ID', '受検日時', '用途タグ', '氏名', 'メールアドレス', '会社・組織', '部署・職種', '営業経験',
                '版', '所要（分）',
                'タイプコード', 'タイプ名', 'H/F', 'H%', 'L/E', 'L%', 'P/D', 'P%', 'S/C', 'S%',
                '総合スコア'];
    mainHead = mainHead.concat(SKILL_LABELS).concat(ROLE_LABELS).concat(['推奨職種', '強みTOP3', '伸びしろTOP3'])
               .concat(TRAITS.map(function (x) { return '★' + x; }));

    var main = ensureSheet(ss, SHEET_MAIN, mainHead);

    /* 同じ受検IDが既にあれば書かない。
       応答が読めない環境では、届いているのに再送されることがあるため。 */
    if (b.sid && hasSid(main, b.sid)) {
      return json({ ok: true, sid: b.sid, duplicate: true });
    }

    var row = [
      b.sid || '',
      toDate(b.finishedAt),
      b.tag || '',
      p.name || '',
      p.email || '',
      p.company || '',
      p.dept || '',
      p.years || '',
      b.mode === 'lite' ? 'ライト版' : 'フル版',
      Math.round((Number(b.durationSec) || 0) / 6) / 10,
      t.code || '',
      t.name || '',
      pick(ax, 'HF', 'letter'), pick(ax, 'HF', 'pct'),
      pick(ax, 'LE', 'letter'), pick(ax, 'LE', 'pct'),
      pick(ax, 'PD', 'letter'), pick(ax, 'PD', 'pct'),
      pick(ax, 'SC', 'letter'), pick(ax, 'SC', 'pct'),
      sk.overall == null ? '' : sk.overall
    ];
    SKILLS.forEach(function (k) { row.push(sc[k] == null ? '' : sc[k]); });
    ROLES.forEach(function (k) { row.push(ro[k] == null ? '' : ro[k]); });
    row.push(roleLabel((b.roles || {}).best));
    row.push(labelList(sk.top3));
    row.push(labelList(sk.bottom3));
    TRAITS.forEach(function (k) { row.push(tr[k] == null ? '' : tr[k]); });

    main.appendRow(row);

    /* --- 生回答のシート --- */
    var ids = [];
    for (var i = 1; i <= 40; i++) ids.push('T' + pad2(i));
    for (var j = 1; j <= 24; j++) ids.push('S' + pad2(j));

    var rawHead = ['受検ID', '受検日時', '氏名', 'メールアドレス', '版'].concat(ids);
    var a = b.answers || {};
    var rawRow = [b.sid || '', toDate(b.finishedAt), p.name || '', p.email || '',
                  b.mode === 'lite' ? 'ライト版' : 'フル版'];
    ids.forEach(function (id) { rawRow.push(a[id] == null ? '' : a[id]); });

    ensureSheet(ss, SHEET_RAW, rawHead).appendRow(rawRow);

    return json({ ok: true, sid: b.sid || '' });

  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------
   小道具
   ------------------------------------------------------------ */
function ensureSheet(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  if (sh.getLastRow() === 0) {
    sh.appendRow(head);
    var h = sh.getRange(1, 1, 1, head.length);
    h.setFontWeight('bold');
    h.setBackground('#000000');
    h.setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setFrozenColumns(2);
  }
  return sh;
}

/* 受検IDが既に記録されているか（A列を走査） */
function hasSid(sh, sid) {
  var last = sh.getLastRow();
  if (last < 2) return false;
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(sid)) return true;
  }
  return false;
}

function pick(obj, key, prop) {
  return obj && obj[key] && obj[key][prop] != null ? obj[key][prop] : '';
}

function roleLabel(key) {
  var i = ROLES.indexOf(key);
  return i < 0 ? '' : ROLE_LABELS[i].replace('適性', '');
}

function labelList(keys) {
  if (!keys || !keys.length) return '';
  return keys.map(function (k) {
    var i = SKILLS.indexOf(k);
    return i < 0 ? k : SKILL_LABELS[i];
  }).join(' / ');
}

function toDate(iso) {
  if (!iso) return new Date();
  var d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
