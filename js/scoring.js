/* ============================================================
   営業タイプ診断 — 採点ロジック
   ------------------------------------------------------------
   設計方針
   - STEP1（タイプ）と STEP2（スキル）は完全に独立して採点する。
     「新規開拓型だから営業力が高い」にならないようにするため。
   - タイプ判定は 4軸それぞれ 0〜100% の連続値で持ち、
     文字（H/F など）はそこから導く。境界値は「ほぼ互角」として明示する。
   - スキルは 15〜95 点に写像する。0点や100点は診断体験として意味がないため。
   ============================================================ */

(function (global) {
  'use strict';

  var AXES = [
    { key: 'HF', first: 'H', second: 'F', firstLabel: 'Hunter', secondLabel: 'Farmer', firstJa: '新規開拓型', secondJa: '既存深耕型', theme: 'どこに向かうか' },
    { key: 'LE', first: 'L', second: 'E', firstLabel: 'Logic', secondLabel: 'Emotion', firstJa: '論理型', secondJa: '共感型', theme: '何で相手を動かすか' },
    { key: 'PD', first: 'P', second: 'D', firstLabel: 'Push', secondLabel: 'Discover', firstJa: '主導型', secondJa: '探索型', theme: 'どう商談を進めるか' },
    { key: 'SC', first: 'S', second: 'C', firstLabel: 'Speed', secondLabel: 'Careful', firstJa: '即行動型', secondJa: '慎重型', theme: 'どう意思決定するか' }
  ];

  var SKILL_KEYS = ['apo', 'hearing', 'issue', 'proposal', 'closing', 'relation', 'action', 'pipeline'];

  /* 難易度による重み。level3（できる人しか5をつけない設問）を重く見る。 */
  var LEVEL_WEIGHT = { 1: 1.0, 2: 1.15, 3: 1.32 };

  /* ---------- 営業特性★（タイプ由来・1〜5） ----------
     軸の値 v は -1（後者側）〜 +1（前者側）の連続値。
     スタイルの話であって能力の話ではない、という前提で係数を置いている。 */
  var TRAIT_DEFS = [
    { key: 'shinki',   label: '新規開拓',   f: function (a) { return 3 + 1.3 * a.HF + 0.5 * a.SC + 0.2 * a.PD; } },
    { key: 'kankei',   label: '関係構築',   f: function (a) { return 3 - 0.5 * a.HF - 1.5 * a.LE; } },
    { key: 'hearing',  label: 'ヒアリング', f: function (a) { return 3 - 1.2 * a.PD - 0.8 * a.LE; } },
    { key: 'teian',    label: '提案力',     f: function (a) { return 3 + 1.1 * a.PD + 0.4 * a.LE - 0.2 * a.SC; } },
    { key: 'closing',  label: 'クロージング', f: function (a) { return 3 + 1.0 * a.PD + 0.8 * a.SC + 0.2 * a.HF; } },
    { key: 'kodo',     label: '行動量',     f: function (a) { return 3 + 1.4 * a.SC + 0.6 * a.HF; } },
    { key: 'senryaku', label: '戦略性',     f: function (a) { return 3 + 0.7 * a.LE - 0.8 * a.SC; } },
    { key: 'kanri',    label: '顧客管理',   f: function (a) { return 3 - 0.7 * a.HF - 0.8 * a.SC; } }
  ];

  /* ---------- 職種適性 ----------
     skills: 8スキルの重み（合計1.0）
     axes  : タイプの寄与。+ は前者側（H/L/P/S）が有利という意味。 */
  var ROLE_DEFS = {
    is:  { skills: { apo: .30, hearing: .20, action: .20, pipeline: .15, issue: .15 },
           axes:   { HF: .5, SC: .6, PD: .2, LE: -.1 } },
    fs:  { skills: { closing: .25, proposal: .22, apo: .18, action: .18, relation: .17 },
           axes:   { HF: .5, PD: .5, SC: .4, LE: 0 } },
    cs:  { skills: { relation: .28, hearing: .22, issue: .20, pipeline: .16, proposal: .14 },
           axes:   { HF: -.8, LE: -.5, PD: -.5, SC: -.2 } },
    am:  { skills: { relation: .24, proposal: .22, pipeline: .20, issue: .18, closing: .16 },
           axes:   { HF: -.7, PD: .2, SC: -.3, LE: .2 } },
    mgr: { skills: { pipeline: .26, issue: .20, proposal: .18, relation: .18, hearing: .18 },
           axes:   { LE: .4, SC: -.4, PD: .2, HF: -.1 } }
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ============================================================
     STEP1 — タイプ判定
     answers: { T01: 1..5, ... }
     questions: [{ id, axis:'HF', dir: 1|-1 }, ...]（実際に出題したものだけ）
     ============================================================ */
  function scoreType(questions, answers) {
    var acc = {};
    AXES.forEach(function (a) { acc[a.key] = { sum: 0, n: 0 }; });

    questions.forEach(function (q) {
      var v = answers[q.id];
      if (typeof v !== 'number') return;
      // dir=1 は「当てはまるほど前者側」。中央値3を0点として ±2 に写す。
      acc[q.axis].sum += q.dir * (v - 3);
      acc[q.axis].n += 1;
    });

    var axesResult = {};
    var code = '';

    AXES.forEach(function (a) {
      var s = acc[a.key];
      var pct = s.n === 0 ? 50 : ((s.sum + 2 * s.n) / (4 * s.n)) * 100; // 0〜100（100=完全に前者側）
      pct = clamp(pct, 0, 100);

      var isFirst = pct >= 50;
      var letter = isFirst ? a.first : a.second;
      var dominance = Math.abs(pct - 50) * 2; // 0〜100 の「はっきり度」

      var strength;
      if (dominance >= 50) strength = 'strong';
      else if (dominance >= 25) strength = 'moderate';
      else strength = 'balanced';

      axesResult[a.key] = {
        key: a.key,
        letter: letter,
        pct: Math.round(pct),                 // 前者側の割合
        firstPct: Math.round(pct),
        secondPct: 100 - Math.round(pct),
        dominance: Math.round(dominance),
        strength: strength,
        strengthLabel: strength === 'strong' ? 'はっきりしています'
                     : strength === 'moderate' ? 'やや寄っています'
                     : 'ほぼ互角です',
        // ★算出用の連続値。判定した文字の向きを保ちつつ、最低 0.45 の強度を与えて
        // 境界値の人でもタイプ像がぼやけないようにする。
        v: (isFirst ? 1 : -1) * Math.max(Math.abs(pct - 50) / 50, 0.45),
        def: a
      };

      code += letter;
    });

    return { code: code, axes: axesResult, order: AXES.map(function (a) { return a.key; }) };
  }

  /* ============================================================
     STEP2 — スキル採点
     ============================================================ */
  function scoreSkills(questions, answers) {
    var acc = {};
    SKILL_KEYS.forEach(function (k) { acc[k] = { w: 0, sum: 0, n: 0 }; });

    questions.forEach(function (q) {
      var v = answers[q.id];
      if (typeof v !== 'number') return;
      var w = LEVEL_WEIGHT[q.level] || 1;
      acc[q.skill].sum += w * v;
      acc[q.skill].w += w;
      acc[q.skill].n += 1;
    });

    var scores = {};
    SKILL_KEYS.forEach(function (k) {
      var s = acc[k];
      if (s.n === 0) { scores[k] = 50; return; }
      var norm = (s.sum - s.w * 1) / (s.w * 4); // 0〜1
      scores[k] = Math.round(15 + clamp(norm, 0, 1) * 80); // 15〜95
    });

    var total = 0;
    SKILL_KEYS.forEach(function (k) { total += scores[k]; });
    var overall = Math.round(total / SKILL_KEYS.length);

    var ranked = SKILL_KEYS.slice().sort(function (a, b) {
      if (scores[b] !== scores[a]) return scores[b] - scores[a];
      return SKILL_KEYS.indexOf(a) - SKILL_KEYS.indexOf(b); // 同点は定義順で安定させる
    });

    return {
      scores: scores,
      overall: overall,
      top3: ranked.slice(0, 3),
      bottom3: ranked.slice(-3).reverse(), // 低い順
      ranked: ranked
    };
  }

  /* ============================================================
     営業特性★（タイプ由来）
     ============================================================ */
  function traits(typeResult) {
    var a = {};
    Object.keys(typeResult.axes).forEach(function (k) { a[k] = typeResult.axes[k].v; });
    return TRAIT_DEFS.map(function (t) {
      var raw = t.f(a);
      return { key: t.key, label: t.label, stars: clamp(Math.round(raw), 1, 5), raw: Math.round(raw * 10) / 10 };
    });
  }

  /* ============================================================
     職種適性（0〜100）
     スキル7 : タイプ3 の比率で合成する。
     能力（スキル）を主、志向（タイプ）を従にしないと、
     「タイプが良いだけで適性が高い」という誤読が起きるため。
     ============================================================ */
  function roleFit(typeResult, skillResult) {
    var av = {};
    Object.keys(typeResult.axes).forEach(function (k) { av[k] = typeResult.axes[k].v; });

    var out = {};
    Object.keys(ROLE_DEFS).forEach(function (rk) {
      var def = ROLE_DEFS[rk];

      var sw = 0, ss = 0;
      Object.keys(def.skills).forEach(function (k) {
        ss += def.skills[k] * skillResult.scores[k];
        sw += def.skills[k];
      });
      var skillFit = sw ? ss / sw : 50; // 15〜95

      var an = 0, ad = 0;
      Object.keys(def.axes).forEach(function (k) {
        an += def.axes[k] * av[k];
        ad += Math.abs(def.axes[k]);
      });
      var typeFit = ad ? 50 + 50 * (an / ad) : 50; // 0〜100

      out[rk] = Math.round(clamp(0.7 * skillFit + 0.3 * typeFit, 0, 100));
    });

    var ranked = Object.keys(out).sort(function (a, b) {
      if (out[b] !== out[a]) return out[b] - out[a];
      return Object.keys(ROLE_DEFS).indexOf(a) - Object.keys(ROLE_DEFS).indexOf(b);
    });

    return { scores: out, ranked: ranked, best: ranked[0] };
  }

  global.Scoring = {
    AXES: AXES,
    SKILL_KEYS: SKILL_KEYS,
    ROLE_DEFS: ROLE_DEFS,
    scoreType: scoreType,
    scoreSkills: scoreSkills,
    traits: traits,
    roleFit: roleFit
  };
})(window);
