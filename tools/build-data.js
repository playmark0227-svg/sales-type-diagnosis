#!/usr/bin/env node
/* ============================================================
   content/*.json  →  js/data.js を生成する

     node tools/build-data.js

   文章を直したいときは content/ のJSONを編集して、
   このスクリプトを再実行してください。js/data.js は手で触らないこと。
   ============================================================ */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var SRC = path.join(ROOT, 'content');
var OUT = path.join(ROOT, 'js', 'data.js');

var CODES = [];
['H', 'F'].forEach(function (a) {
  ['L', 'E'].forEach(function (b) {
    ['P', 'D'].forEach(function (c) {
      ['S', 'C'].forEach(function (d) { CODES.push(a + b + c + d); });
    });
  });
});

var SKILL_KEYS = ['apo', 'hearing', 'issue', 'proposal', 'closing', 'relation', 'action', 'pipeline'];
var ROLE_KEYS = ['is', 'fs', 'cs', 'am', 'mgr'];
var AXIS_KEYS = ['HF', 'LE', 'PD', 'SC'];

var errors = [];
var warnings = [];

function err(m) { errors.push(m); }
function warn(m) { warnings.push(m); }

function read(name) {
  var p = path.join(SRC, name);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    err(name + ' を読めません: ' + e.message);
    return null;
  }
}

function need(obj, keys, where) {
  keys.forEach(function (k) {
    if (obj == null || obj[k] == null || obj[k] === '') err(where + ': "' + k + '" がありません');
  });
}

function len(arr, n, where) {
  if (!Array.isArray(arr)) { err(where + ': 配列ではありません'); return; }
  if (arr.length !== n) warn(where + ': ' + n + '件のはずが ' + arr.length + '件です');
}

function pairs(arr, keys, where) {
  if (!Array.isArray(arr)) return;
  arr.forEach(function (it, i) { need(it, keys, where + '[' + i + ']'); });
}

/* ---------- 16タイプ ---------- */

var types = {};
['HL', 'HE', 'FL', 'FE'].forEach(function (g) {
  var d = read('types-' + g + '.json');
  if (!d) return;
  var list = d.types || d;
  if (!Array.isArray(list)) { err('types-' + g + '.json: types 配列がありません'); return; }
  list.forEach(function (t) {
    if (!t.code) { err('types-' + g + '.json: code のないタイプがあります'); return; }
    if (types[t.code]) err('コード重複: ' + t.code);
    types[t.code] = t;
  });
});

CODES.forEach(function (c) { if (!types[c]) err('タイプ ' + c + ' がありません'); });
Object.keys(types).forEach(function (c) { if (CODES.indexOf(c) < 0) err('未知のコード: ' + c); });

Object.keys(types).forEach(function (c) {
  var t = types[c];
  var w = c;
  need(t, ['code', 'name', 'catchphrase', 'oneLine', 'description', 'management'], w);

  len(t.strengths, 5, w + '.strengths');   pairs(t.strengths, ['title', 'detail'], w + '.strengths');
  len(t.weaknesses, 4, w + '.weaknesses'); pairs(t.weaknesses, ['title', 'detail'], w + '.weaknesses');
  len(t.bestJobs, 4, w + '.bestJobs');     pairs(t.bestJobs, ['job', 'reason'], w + '.bestJobs');
  len(t.goodJobs, 3, w + '.goodJobs');     pairs(t.goodJobs, ['job', 'reason'], w + '.goodJobs');
  len(t.hardJobs, 4, w + '.hardJobs');     pairs(t.hardJobs, ['job', 'reason'], w + '.hardJobs');
  len(t.growth, 3, w + '.growth');         pairs(t.growth, ['title', 'detail'], w + '.growth');

  if (t.management) {
    need(t.management, ['summary', 'firstWeek'], w + '.management');
    len(t.management.effective, 4, w + '.management.effective');
    pairs(t.management.effective, ['title', 'detail'], w + '.management.effective');
    len(t.management.ineffective, 4, w + '.management.ineffective');
    pairs(t.management.ineffective, ['title', 'detail'], w + '.management.ineffective');
  }

  len(t.partners, 2, w + '.partners');
  (t.partners || []).forEach(function (p, i) {
    need(p, ['code', 'reason'], w + '.partners[' + i + ']');
    if (p.code && CODES.indexOf(p.code) < 0) err(w + '.partners[' + i + ']: 存在しないコード ' + p.code);
    if (p.code === c) err(w + '.partners[' + i + ']: 自分自身を指しています');
  });
  if (t.friction) {
    need(t.friction, ['code', 'reason'], w + '.friction');
    if (t.friction.code && CODES.indexOf(t.friction.code) < 0) err(w + '.friction: 存在しないコード ' + t.friction.code);
    if (t.friction.code === c) err(w + '.friction: 自分自身を指しています');
  } else {
    err(w + ': friction がありません');
  }

  // 職種名の重複（◎と○に同じ職種が入っていないか）
  var bs = (t.bestJobs || []).map(function (x) { return x.job; });
  (t.goodJobs || []).forEach(function (x) {
    if (bs.indexOf(x.job) >= 0) warn(w + ': "' + x.job + '" が bestJobs と goodJobs の両方にあります');
  });
  (t.hardJobs || []).forEach(function (x) {
    if (bs.indexOf(x.job) >= 0) err(w + ': "' + x.job + '" が bestJobs と hardJobs の両方にあります');
  });
});

// タイプ名・キャッチの重複
var seenName = {}, seenCatch = {};
Object.keys(types).forEach(function (c) {
  var n = types[c].name, k = types[c].catchphrase;
  if (seenName[n]) err('タイプ名が重複: "' + n + '" (' + seenName[n] + ' / ' + c + ')');
  seenName[n] = c;
  if (seenCatch[k]) warn('キャッチが重複: "' + k + '" (' + seenCatch[k] + ' / ' + c + ')');
  seenCatch[k] = c;
});

/* ---------- 設問 ---------- */

var qt = read('questions-type.json');
var questionsType = (qt && qt.questions) || [];
if (questionsType.length !== 40) err('タイプ設問が40問ではありません（' + questionsType.length + '問）');

var axCount = {};
AXIS_KEYS.forEach(function (k) { axCount[k] = { n: 0, rev: 0, lite: 0 }; });
questionsType.forEach(function (q, i) {
  need(q, ['id', 'axis', 'text'], 'questions-type[' + i + ']');
  if (AXIS_KEYS.indexOf(q.axis) < 0) { err('questions-type[' + i + ']: 未知の軸 ' + q.axis); return; }
  if (q.dir !== 1 && q.dir !== -1) err('questions-type[' + i + ']: dir は 1 か -1 です');
  axCount[q.axis].n++;
  if (q.dir === -1) axCount[q.axis].rev++;
  if (q.lite) axCount[q.axis].lite++;
});
AXIS_KEYS.forEach(function (k) {
  var a = axCount[k];
  if (a.n !== 10) err('軸 ' + k + ' が10問ではありません（' + a.n + '問）');
  if (a.lite !== 5) err('軸 ' + k + ' のライト版が5問ではありません（' + a.lite + '問）');
  if (a.rev < 3) warn('軸 ' + k + ' の逆転項目が少なめです（' + a.rev + '問）');
});

var qs = read('questions-skill.json');
var questionsSkill = (qs && qs.questions) || [];
if (questionsSkill.length !== 24) err('スキル設問が24問ではありません（' + questionsSkill.length + '問）');

var skCount = {};
SKILL_KEYS.forEach(function (k) { skCount[k] = { n: 0, lite: 0, levels: [] }; });
questionsSkill.forEach(function (q, i) {
  need(q, ['id', 'skill', 'text'], 'questions-skill[' + i + ']');
  if (SKILL_KEYS.indexOf(q.skill) < 0) { err('questions-skill[' + i + ']: 未知のスキル ' + q.skill); return; }
  if ([1, 2, 3].indexOf(q.level) < 0) err('questions-skill[' + i + ']: level は 1〜3 です');
  skCount[q.skill].n++;
  skCount[q.skill].levels.push(q.level);
  if (q.lite) skCount[q.skill].lite++;
});
SKILL_KEYS.forEach(function (k) {
  var s = skCount[k];
  if (s.n !== 3) err('スキル ' + k + ' が3問ではありません（' + s.n + '問）');
  if (s.lite !== 2) err('スキル ' + k + ' のライト版が2問ではありません（' + s.lite + '問）');
  if (s.levels.sort().join('') !== '123') warn('スキル ' + k + ' の難易度が 1/2/3 になっていません（' + s.levels.join('') + '）');
});

// ID重複
var ids = {};
questionsType.concat(questionsSkill).forEach(function (q) {
  if (ids[q.id]) err('設問ID重複: ' + q.id);
  ids[q.id] = 1;
});

/* ---------- アドバイス ---------- */

var advice = read('advice.json') || { skills: {}, roles: {} };
SKILL_KEYS.forEach(function (k) {
  var s = advice.skills && advice.skills[k];
  if (!s) { err('advice.skills.' + k + ' がありません'); return; }
  need(s, ['label', 'short', 'high', 'low'], 'advice.skills.' + k);
  len(s.actions, 3, 'advice.skills.' + k + '.actions');
  pairs(s.actions, ['title', 'detail'], 'advice.skills.' + k + '.actions');
});
ROLE_KEYS.forEach(function (k) {
  var r = advice.roles && advice.roles[k];
  if (!r) { err('advice.roles.' + k + ' がありません'); return; }
  need(r, ['label', 'summary', 'fitReason'], 'advice.roles.' + k);
});

/* ---------- 出力 ---------- */

if (errors.length) {
  console.error('\n✖ エラー ' + errors.length + '件\n');
  errors.forEach(function (e) { console.error('  - ' + e); });
  if (warnings.length) {
    console.error('\n△ 警告 ' + warnings.length + '件');
    warnings.forEach(function (w) { console.error('  - ' + w); });
  }
  process.exit(1);
}

var ordered = {};
CODES.forEach(function (c) { ordered[c] = types[c]; });

var payload = {
  types: ordered,
  questionsType: questionsType,
  questionsSkill: questionsSkill,
  advice: advice
};

var banner = '/* 自動生成ファイル — 直接編集しないでください。\n' +
             '   content/*.json を編集して `node tools/build-data.js` を実行してください。 */\n';

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + 'window.DATA = ' + JSON.stringify(payload, null, 1) + ';\n', 'utf8');

console.log('✔ js/data.js を生成しました');
console.log('  タイプ       : ' + Object.keys(ordered).length + '種');
console.log('  タイプ設問   : ' + questionsType.length + '問（ライト版 ' + questionsType.filter(function (q) { return q.lite; }).length + '問）');
console.log('  スキル設問   : ' + questionsSkill.length + '問（ライト版 ' + questionsSkill.filter(function (q) { return q.lite; }).length + '問）');
console.log('  ファイルサイズ: ' + Math.round(fs.statSync(OUT).size / 1024) + ' KB');
if (warnings.length) {
  console.log('\n△ 警告 ' + warnings.length + '件（生成はできています）');
  warnings.forEach(function (w) { console.log('  - ' + w); });
}
