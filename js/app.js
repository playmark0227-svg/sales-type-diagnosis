/* ============================================================
   営業タイプ診断 — 画面制御と結果描画
   ============================================================ */

(function () {
  'use strict';

  var D = window.DATA;
  var S = window.Scoring;

  var LIKERT = [
    { v: 1, label: '全く当てはまらない' },
    { v: 2, label: 'あまり当てはまらない' },
    { v: 3, label: 'どちらでもない' },
    { v: 4, label: '当てはまる' },
    { v: 5, label: '非常に当てはまる' }
  ];

  var STORE_KEY = 'salesTypeDx.v1';

  var state = {
    mode: 'full',          // 'full' | 'lite'
    phase: 'type',         // 'type' | 'skill'
    qType: [],
    qSkill: [],
    answers: {},
    idx: 0
  };

  /* ---------- utils ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function show(id) {
    ['screen-start', 'screen-quiz', 'screen-interlude', 'screen-result'].forEach(function (s) {
      $(s).classList.toggle('is-active', s === id);
    });
    window.scrollTo(0, 0);
    document.body.classList.toggle('no-bg', id !== 'screen-start');
    bg.setActive(id === 'screen-start');
  }

  /* ---------- 背景（コーポレートサイトのヒーローに合わせた点と線） ----------
     読み物になる設問・結果画面では動かさず、1枚描いて止める。 */
  var bg = (function () {
    var cv, ctx, pts = [], W = 0, H = 0, dpr = 1, raf = null, animate = true, reduce = false;
    var LINK = 88;

    function build() {
      W = cv.clientWidth; H = cv.clientHeight;
      if (!W || !H) return;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(112, Math.max(34, (W * H) / 6000)));
      pts = [];
      for (var i = 0; i < n; i++) {
        pts.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - .5) * .12,
          vy: (Math.random() - .5) * .12
        });
      }
    }

    function step(move) {
      var i, j, a, b, dx, dy, d;
      if (move) {
        for (i = 0; i < pts.length; i++) {
          a = pts[i];
          a.x += a.vx; a.y += a.vy;
          if (a.x < 0) a.x += W; else if (a.x > W) a.x -= W;
          if (a.y < 0) a.y += H; else if (a.y > H) a.y -= H;
        }
      }
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      for (i = 0; i < pts.length; i++) {
        a = pts[i];
        for (j = i + 1; j < pts.length; j++) {
          b = pts[j];
          dx = a.x - b.x; dy = a.y - b.y;
          d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK) {
            ctx.strokeStyle = 'rgba(255,255,255,' + ((1 - d / LINK) * .22).toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      for (i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, .9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop() {
      step(true);
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }

    return {
      init: function () {
        cv = document.getElementById('bg-canvas');
        if (!cv || !cv.getContext) return;
        ctx = cv.getContext('2d');
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        build();
        step(false);
        if (animate && !reduce) loop();

        var t = null;
        window.addEventListener('resize', function () {
          clearTimeout(t);
          t = setTimeout(function () {
            stop();
            build();
            step(false);
            if (animate && !reduce) loop();
          }, 200);
        });
      },
      setActive: function (on) {
        animate = on;
        if (!ctx) return;
        stop();
        if (on && !reduce) loop();
      }
    };
  })();

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }
  function clearSave() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  /* ---------- 出題セットの構築 ---------- */

  function buildQuestions(mode) {
    var pick = function (arr) { return mode === 'lite' ? arr.filter(function (q) { return q.lite; }) : arr.slice(); };
    state.qType = pick(D.questionsType);
    state.qSkill = pick(D.questionsSkill);
  }

  function currentList() { return state.phase === 'type' ? state.qType : state.qSkill; }

  /* ---------- 設問描画 ---------- */

  function renderQuestion() {
    var list = currentList();
    var q = list[state.idx];
    if (!q) return;

    var isType = state.phase === 'type';

    $('q-step').textContent = isType ? 'STEP 1｜性格・行動特性' : 'STEP 2｜営業スキル';
    $('q-now').textContent = state.idx + 1;
    $('q-total').textContent = list.length;
    $('q-progress').style.width = ((state.idx) / list.length * 100) + '%';
    $('q-index').textContent = (isType ? 'Q' : 'S') + (state.idx + 1);
    $('q-text').textContent = q.text;

    var cur = state.answers[q.id];
    var html = LIKERT.map(function (l) {
      return '<button class="lk' + (cur === l.v ? ' is-on' : '') + '" data-v="' + l.v + '">' +
             '<span class="lk-dot"></span><span>' + esc(l.label) + '</span></button>';
    }).join('');
    $('q-likert').innerHTML = html;

    Array.prototype.forEach.call($('q-likert').querySelectorAll('.lk'), function (b) {
      b.addEventListener('click', function () { answer(q.id, parseInt(b.dataset.v, 10)); });
    });

    $('btn-prev').disabled = (state.idx === 0 && state.phase === 'type');
    $('btn-next').disabled = typeof cur !== 'number';
    $('btn-next').textContent = (state.idx === list.length - 1)
      ? (isType ? 'STEP1 を終える →' : '結果を見る →')
      : '次へ →';
  }

  // 選択→自動送りの 210ms のあいだに次の設問へ入力が届くと、
  // 連打やダブルタップで次の設問まで勝手に答えてしまうため、遷移中は入力を止める。
  var locked = false;

  function answer(id, v) {
    if (locked) return;
    locked = true;

    state.answers[id] = v;
    save();
    Array.prototype.forEach.call($('q-likert').querySelectorAll('.lk'), function (b) {
      b.classList.toggle('is-on', parseInt(b.dataset.v, 10) === v);
    });
    $('btn-next').disabled = false;
    setTimeout(function () { locked = false; next(); }, 210);
  }

  function next() {
    var list = currentList();
    if (typeof state.answers[list[state.idx].id] !== 'number') return;

    if (state.idx < list.length - 1) {
      state.idx++;
      save();
      renderQuestion();
      return;
    }

    if (state.phase === 'type') {
      state.phase = 'skill';
      state.idx = 0;
      save();
      show('screen-interlude');
    } else {
      save();
      finish();
    }
  }

  function prev() {
    if (state.idx > 0) {
      state.idx--;
    } else if (state.phase === 'skill') {
      state.phase = 'type';
      state.idx = state.qType.length - 1;
    } else {
      return;
    }
    save();
    renderQuestion();
  }

  /* ============================================================
     結果
     ============================================================ */

  function finish() {
    var type = S.scoreType(state.qType, state.answers);
    var skill = S.scoreSkills(state.qSkill, state.answers);
    var trait = S.traits(type);
    var roles = S.roleFit(type, skill);

    $('result-body').innerHTML = renderResult(type, skill, trait, roles);
    show('screen-result');

    // バーのアニメーション
    setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll('[data-w]'), function (el) {
        el.style.width = el.dataset.w + '%';
      });
    }, 60);
  }

  function stars(n) {
    var s = '';
    for (var i = 1; i <= 5; i++) s += (i <= n ? '<b>★</b>' : '☆');
    return s;
  }

  function radar(skill) {
    var keys = S.SKILL_KEYS;
    var cx = 200, cy = 196, R = 122;
    var n = keys.length;
    var svg = [];

    function pt(i, r) {
      var a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    }

    // グリッド
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var d = keys.map(function (_, i) {
        var p = pt(i, R * f);
        return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      }).join(' ') + ' Z';
      svg.push('<path class="grid" d="' + d + '"/>');
    });

    // スポーク
    keys.forEach(function (_, i) {
      var p = pt(i, R);
      svg.push('<line class="spoke" x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>');
    });

    // 面
    var area = keys.map(function (k, i) {
      var p = pt(i, R * (skill.scores[k] / 100));
      return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ') + ' Z';
    svg.push('<path class="area" d="' + area + '"/>');

    // 頂点と数値
    keys.forEach(function (k, i) {
      var p = pt(i, R * (skill.scores[k] / 100));
      svg.push('<circle class="pt" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3"/>');
    });

    // ラベル
    keys.forEach(function (k, i) {
      var p = pt(i, R + 26);
      var anchor = (p[0] > cx + 6) ? 'start' : (p[0] < cx - 6 ? 'end' : 'middle');
      var name = (D.advice.skills[k] && D.advice.skills[k].label) || k;
      svg.push('<text class="lbl" x="' + p[0].toFixed(1) + '" y="' + p[1].toFixed(1) + '" text-anchor="' + anchor + '">' + esc(name) + '</text>');
      svg.push('<text class="val" x="' + p[0].toFixed(1) + '" y="' + (p[1] + 13).toFixed(1) + '" text-anchor="' + anchor + '">' + skill.scores[k] + '</text>');
    });

    return '<div class="radar-wrap"><svg class="radar" viewBox="0 0 400 400" role="img" aria-label="営業スキル レーダーチャート">' + svg.join('') + '</svg></div>';
  }

  function plist(items, warn) {
    return '<ul class="plist' + (warn ? ' warn' : '') + '">' + items.map(function (it) {
      return '<li><div class="t"><span class="mark">—</span><span>' + esc(it.title) + '</span></div>' +
             '<p class="d">' + esc(it.detail) + '</p></li>';
    }).join('') + '</ul>';
  }

  function jobList(items, cls, mark) {
    return '<ul class="job-list ' + cls + '">' + items.map(function (it) {
      return '<li><div class="n"><span class="mk">' + mark + '</span>' + esc(it.job) + '</div>' +
             '<p class="r">' + esc(it.reason) + '</p></li>';
    }).join('') + '</ul>';
  }

  function renderResult(type, skill, trait, roles) {
    var t = D.types[type.code];
    var h = [];

    /* ---- ヒーロー ---- */
    h.push('<div class="result-hero">');
    h.push('<div class="rh-label">YOUR SALES TYPE</div>');
    h.push('<div class="rh-code">' + esc(type.code) + '</div>');
    h.push('<div class="rh-name">' + esc(t.name) + '</div>');
    h.push('<div class="rh-catch">' + esc(t.catchphrase) + '</div>');
    h.push('<p class="rh-one">' + esc(t.oneLine) + '</p>');
    if (state.mode === 'lite') h.push('<span class="rh-flag">ライト版（36問）の結果です</span>');
    h.push('</div>');

    /* ---- 4軸 ---- */
    h.push('<h2 class="section-title">4つの軸のバランス <span class="sub">AXES</span></h2>');
    h.push('<div class="card">');
    type.order.forEach(function (k) {
      var a = type.axes[k], d = a.def;
      var firstWin = a.firstPct >= 50;
      h.push('<div class="axis-row">');
      h.push('<div class="axis-meta"><span class="theme">' + esc(d.theme) + '</span>' +
             '<span class="verdict">' + esc(a.strengthLabel) + '</span></div>');
      h.push('<div class="axis-labels">' +
        '<span class="side' + (firstWin ? ' win' : '') + '"><em>' + d.first + '</em> ' + esc(d.firstLabel) +
        '<small>' + esc(d.firstJa) + '　' + a.firstPct + '%</small></span>' +
        '<span class="side' + (!firstWin ? ' win' : '') + '" style="text-align:right"><em>' + d.second + '</em> ' + esc(d.secondLabel) +
        '<small>' + esc(d.secondJa) + '　' + a.secondPct + '%</small></span></div>');
      // 中央（互角）を起点に、寄っている側へ伸ばす。片側いっぱいで幅50%。
      h.push('<div class="axis-track"><i class="' + (firstWin ? 'to-left' : 'to-right') +
             '" data-w="' + (a.dominance / 2) + '"></i></div>');
      h.push('</div>');
    });
    var balanced = type.order.filter(function (k) { return type.axes[k].strength === 'balanced'; });
    if (balanced.length) {
      h.push('<p class="note" style="margin-top:14px">' +
        balanced.map(function (k) { return type.axes[k].def.first + '/' + type.axes[k].def.second; }).join('・') +
        ' の軸はほぼ互角でした。状況によって両方の顔を使い分けられる、ということでもあります。' +
        '結果を読むときは、隣のタイプ（この文字だけ入れ替えたコード）の説明も見てみてください。</p>');
    }
    h.push('</div>');

    /* ---- タイプ説明 ---- */
    h.push('<h2 class="section-title">このタイプはどう売るか <span class="sub">PROFILE</span></h2>');
    h.push('<div class="card"><p style="margin:0;font-size:.95rem">' + esc(t.description) + '</p></div>');

    /* ---- 営業特性★ ---- */
    h.push('<h2 class="section-title">営業特性 <span class="sub">STYLE</span></h2>');
    h.push('<div class="card">');
    trait.forEach(function (tr) {
      h.push('<div class="trait"><span class="trait-name">' + esc(tr.label) + '</span>' +
             '<span class="stars">' + stars(tr.stars) + '</span></div>');
    });
    h.push('<p class="note" style="margin-top:12px">★はタイプ（スタイル）から算出しています。' +
           '「得意なやり方の傾向」であって、能力の高さではありません。能力はこの下のスキルスコアで見てください。</p>');
    h.push('</div>');

    /* ---- 強み・弱み ---- */
    h.push('<h2 class="section-title">強み <span class="sub">STRENGTHS</span></h2>');
    h.push('<div class="card">' + plist(t.strengths, false) + '</div>');

    h.push('<h2 class="section-title">気をつけたいクセ <span class="sub">WATCH OUT</span></h2>');
    h.push('<div class="card">' + plist(t.weaknesses, true) + '</div>');

    /* ---- スキルスコア ---- */
    h.push('<h2 class="section-title">営業スキル <span class="sub">SALES SKILL</span></h2>');
    h.push('<div class="card">');
    h.push('<div class="overall"><span class="big-num">' + skill.overall + '</span>' +
           '<span class="cap">総合スコア<br>100点満点</span></div>');
    h.push(radar(skill));
    S.SKILL_KEYS.forEach(function (k) {
      var sc = skill.scores[k];
      var cls = sc <= 45 ? ' lo' : '';
      h.push('<div class="score-row"><div class="score-head"><span>' + esc(D.advice.skills[k].label) + '</span>' +
             '<span class="v">' + sc + '</span></div>' +
             '<div class="score-track' + cls + '"><i data-w="' + sc + '"></i></div></div>');
    });
    h.push('<p class="note" style="margin-top:14px">スコアは15〜95の範囲に収まるように設計しています。' +
           '自己申告なので、他人と比べるより「自分の中でどこが高くどこが低いか」を見てください。</p>');
    h.push('</div>');

    /* ---- 強みTOP3 ---- */
    h.push('<h2 class="section-title">武器になっている力 TOP3 <span class="sub">TOP 3</span></h2>');
    h.push('<div class="card"><div class="rank">');
    skill.top3.forEach(function (k, i) {
      var sk = D.advice.skills[k];
      h.push('<div class="rank-item"><span class="rank-no">' + (i + 1) + '</span><div class="rank-body">' +
             '<div class="rank-name">' + esc(sk.label) + '<span>' + skill.scores[k] + '</span></div>' +
             '<p class="rank-desc">' + esc(sk.high) + '</p></div></div>');
    });
    h.push('</div></div>');

    /* ---- 改善TOP3 ---- */
    h.push('<h2 class="section-title">伸びしろ TOP3 <span class="sub">NEXT</span></h2>');
    h.push('<div class="card"><div class="rank low">');
    skill.bottom3.forEach(function (k, i) {
      var sk = D.advice.skills[k];
      h.push('<div class="rank-item"><span class="rank-no">' + (i + 1) + '</span><div class="rank-body">' +
             '<div class="rank-name">' + esc(sk.label) + '<span>' + skill.scores[k] + '</span></div>' +
             '<p class="rank-desc">' + esc(sk.low) + '</p></div></div>');
    });
    h.push('</div></div>');

    /* ---- 職種適性 ---- */
    h.push('<h2 class="section-title">職種適性 <span class="sub">ROLE FIT</span></h2>');
    h.push('<div class="card">');
    roles.ranked.forEach(function (rk, i) {
      var r = D.advice.roles[rk], sc = roles.scores[rk];
      h.push('<div class="role"><div class="role-head">' +
             '<span class="role-name">' + (i === 0 ? '<span class="crown">★</span>' : '') + esc(r.label) + '</span>' +
             '<span class="role-v">' + sc + '</span></div>' +
             '<p class="role-sum">' + esc(r.summary) + '</p>' +
             '<div class="score-track"><i data-w="' + sc + '"></i></div></div>');
    });
    h.push('<div class="callout" style="margin-top:18px;margin-bottom:0"><b>' +
           esc(D.advice.roles[roles.best].label) + '</b>：' + esc(D.advice.roles[roles.best].fitReason) + '</div>');
    h.push('<p class="note" style="margin-top:12px">適性スコアはスキル7割・タイプ3割で算出しています。' +
           'タイプが合っているだけでスコアが上がらないようにしているので、実力がつくほど数字も上がります。</p>');
    h.push('</div>');

    /* ---- 向いている営業 ---- */
    h.push('<h2 class="section-title">向いている営業 <span class="sub">GOOD FIT</span></h2>');
    h.push('<div class="card">');
    h.push('<div class="job-block"><div class="job-label">◎ 非常に向いています</div>' + jobList(t.bestJobs, 'best', '◎') + '</div>');
    h.push('<div class="job-block"><div class="job-label">○ 向いています</div>' + jobList(t.goodJobs, 'good', '○') + '</div>');
    h.push('</div>');

    h.push('<h2 class="section-title">苦手になりやすい仕事 <span class="sub">CAUTION</span></h2>');
    h.push('<div class="card">' + jobList(t.hardJobs, 'hard', '▲') +
           '<p class="note" style="margin-top:12px">「できない」ではありません。' +
           '意識しないと消耗しやすい、という意味です。ここに就くなら仕組みでカバーする前提で設計してください。</p></div>');

    /* ---- マネジメント ---- */
    h.push('<h2 class="section-title">このタイプの育て方 <span class="sub">FOR MANAGERS</span></h2>');
    h.push('<div class="card">');
    h.push('<div class="callout">' + esc(t.management.summary) + '</div>');
    h.push('<div class="mg-grid">');
    h.push('<div class="mg-box ok"><div class="mg-title">◎ 効果的</div>' + plist(t.management.effective, false) + '</div>');
    h.push('<div class="mg-box ng"><div class="mg-title">▲ 逆効果</div>' + plist(t.management.ineffective, true) + '</div>');
    h.push('</div>');
    h.push('<div class="callout" style="margin:16px 0 0"><b>配属直後の1ヶ月でやること：</b>' + esc(t.management.firstWeek) + '</div>');
    h.push('</div>');

    /* ---- 成長アドバイス ---- */
    h.push('<h2 class="section-title">成長アドバイス <span class="sub">GROWTH</span></h2>');
    h.push('<div class="card">');
    h.push('<div class="job-label" style="margin-bottom:10px">タイプとしての伸ばし方</div>');
    h.push(plist(t.growth, false));
    h.push('</div>');

    skill.bottom3.forEach(function (k) {
      var sk = D.advice.skills[k];
      h.push('<div class="card"><div class="job-label" style="margin-bottom:4px">' +
             esc(sk.label) + ' を上げる（現在 ' + skill.scores[k] + ' 点）</div>' +
             '<p class="note" style="margin:0 0 8px">' + esc(sk.short) + '</p>' +
             plist(sk.actions, false) + '</div>');
    });

    /* ---- 相性 ---- */
    h.push('<h2 class="section-title">組むとうまくいくタイプ <span class="sub">PARTNERS</span></h2>');
    h.push('<div class="card">');
    t.partners.forEach(function (p) {
      var pt = D.types[p.code];
      h.push('<div class="pair"><span class="pair-code">' + esc(p.code) + '</span><div class="pair-body">' +
             '<div class="pn">' + esc(pt ? pt.name : p.code) + '</div>' +
             '<p class="pr">' + esc(p.reason) + '</p></div></div>');
    });
    if (t.friction) {
      var ft = D.types[t.friction.code];
      h.push('<div class="pair ng"><span class="pair-code">' + esc(t.friction.code) + '</span><div class="pair-body">' +
             '<div class="pn-tag">摩擦が起きやすい</div>' +
             '<div class="pn">' + esc(ft ? ft.name : t.friction.code) + '</div>' +
             '<p class="pr">' + esc(t.friction.reason) + '</p></div></div>');
    }
    h.push('</div>');

    return h.join('');
  }

  /* ============================================================
     初期化
     ============================================================ */

  function startFresh(mode) {
    state.mode = mode;
    state.phase = 'type';
    state.answers = {};
    state.idx = 0;
    buildQuestions(mode);
    save();
    show('screen-quiz');
    renderQuestion();
  }

  function init() {
    bg.init();

    // 版の選択
    Array.prototype.forEach.call(document.querySelectorAll('.mode'), function (el) {
      el.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.mode'), function (o) { o.classList.remove('is-on'); });
        el.classList.add('is-on');
        el.querySelector('input').checked = true;
      });
    });

    $('btn-start').addEventListener('click', function () {
      var checked = document.querySelector('input[name="mode"]:checked');
      startFresh(checked ? checked.value : 'full');
    });

    $('btn-next').addEventListener('click', next);
    $('btn-prev').addEventListener('click', prev);
    $('btn-step2').addEventListener('click', function () {
      show('screen-quiz');
      renderQuestion();
    });
    $('btn-print').addEventListener('click', function () { window.print(); });
    $('btn-retry').addEventListener('click', function () {
      clearSave();
      show('screen-start');
    });

    // キーボード（1〜5で回答、←→で移動）
    document.addEventListener('keydown', function (e) {
      if (!$('screen-quiz').classList.contains('is-active')) return;
      if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4' || e.key === '5') {
        answer(currentList()[state.idx].id, parseInt(e.key, 10));
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (!$('btn-next').disabled) next();
      } else if (e.key === 'ArrowLeft') {
        prev();
      }
    });

    // 途中再開
    var saved = load();
    if (saved && saved.answers && Object.keys(saved.answers).length > 0) {
      $('btn-resume').style.display = '';
      $('btn-resume').addEventListener('click', function () {
        state.mode = saved.mode || 'full';
        state.phase = saved.phase || 'type';
        state.answers = saved.answers || {};
        state.idx = saved.idx || 0;
        buildQuestions(state.mode);
        var list = currentList();
        if (state.idx >= list.length) state.idx = list.length - 1;
        show('screen-quiz');
        renderQuestion();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
