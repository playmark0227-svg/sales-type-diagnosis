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
  var PENDING_KEY = 'salesTypeDx.pending';

  var CFG = window.CONFIG || {};

  var state = {
    mode: 'full',          // 'full' | 'lite'
    phase: 'type',         // 'type' | 'skill'
    qType: [],
    qSkill: [],
    answers: {},
    idx: 0,
    entry: null,           // 受検者情報（記録先が未設定なら null のまま）
    sid: '',               // 受検ID
    startedAt: ''
  };

  /* ---------- utils ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function show(id) {
    ['screen-start', 'screen-entry', 'screen-quiz', 'screen-interlude', 'screen-result'].forEach(function (s) {
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

  /* ============================================================
     記録（Google スプレッドシート / Apps Script）
     ------------------------------------------------------------
     Apps Script のウェブアプリは OPTIONS を扱えないため、
     プリフライトが起きない Content-Type: text/plain で送る。
     最終レスポンス（googleusercontent.com）には
     Access-Control-Allow-Origin: * が付くので、結果は読み取れる。
     ============================================================ */
  var Recorder = (function () {
    var TIMEOUT = 20000;

    function enabled() {
      return !!(CFG.endpoint && /^https?:\/\/.+/.test(CFG.endpoint));
    }

    function tag() {
      var m = /[?&]src=([^&#]+)/.exec(location.search);
      var v = m ? decodeURIComponent(m[1]) : (CFG.defaultTag || 'direct');
      return String(v).slice(0, 40);
    }

    function post(payload) {
      var ctl = null, timer = null;
      if (typeof AbortController === 'function') {
        ctl = new AbortController();
        timer = setTimeout(function () { ctl.abort(); }, TIMEOUT);
      }
      return fetch(CFG.endpoint, {
        method: 'POST',
        // プリフライトを起こさないため、あえて text/plain にしている
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: ctl ? ctl.signal : undefined
      }).then(function (res) {
        if (timer) clearTimeout(timer);
        return res.text().then(function (t) {
          var j;
          try { j = JSON.parse(t); } catch (e) { throw new Error('応答を解釈できませんでした'); }
          return j;
        });
      }, function (e) {
        if (timer) clearTimeout(timer);
        throw e;
      });
    }

    /* JSONP。<script> で読むだけなので CORS の影響を受けない。
       応答を必ず読む必要がある合い言葉の確認は、これを最後の砦にする。 */
    var jsonpSeq = 0;
    function jsonp(params) {
      return new Promise(function (resolve, reject) {
        var cb = '__dxcb' + (++jsonpSeq) + '_' + Math.random().toString(36).slice(2, 8);
        var q = Object.keys(params).map(function (k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
        var s = document.createElement('script');
        var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, TIMEOUT);

        function cleanup() {
          clearTimeout(timer);
          try { delete window[cb]; } catch (e) { window[cb] = undefined; }
          if (s.parentNode) s.parentNode.removeChild(s);
        }
        window[cb] = function (data) { cleanup(); resolve(data); };
        s.onerror = function () { cleanup(); reject(new Error('jsonp failed')); };
        s.src = CFG.endpoint + (CFG.endpoint.indexOf('?') < 0 ? '?' : '&') + q + '&callback=' + cb;
        document.head.appendChild(s);
      });
    }

    function verify(passcode) {
      return post({ action: 'verify', passcode: passcode })
        .catch(function () { return jsonp({ action: 'verify', passcode: passcode }); });
    }

    /* 送信は、応答が読めない環境（社内プロキシなど）でも
       とりあえず届くように no-cors で投げ直す。
       この場合は受信できたかどうかまでは確認できない。 */
    function submit(payload) {
      return post(payload).catch(function (e) {
        return fetch(CFG.endpoint, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        }).then(function () {
          return { ok: true, blind: true };
        }, function () {
          throw e;
        });
      });
    }

    /* 送信できなかったぶんは端末に残し、あとから再送できるようにする */
    function savePending(payload) {
      try { localStorage.setItem(PENDING_KEY, JSON.stringify(payload)); } catch (e) {}
    }
    function loadPending() {
      try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { return null; }
    }
    function clearPending() {
      try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
    }

    return {
      enabled: enabled, tag: tag, verify: verify, submit: submit,
      savePending: savePending, loadPending: loadPending, clearPending: clearPending
    };
  })();

  function newSid() {
    var d = new Date();
    function p(n, w) { return String(n).padStart(w || 2, '0'); }
    var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
                p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    var rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
    return stamp + '-' + rnd;
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

    // 結果の表示は待たせない。送信はうしろで走らせる。
    if (Recorder.enabled() && state.entry) {
      var payload = buildPayload(type, skill, trait, roles);
      Recorder.savePending(payload);
      sendPayload(payload);
    }
  }

  function buildPayload(type, skill, trait, roles) {
    var axes = {};
    type.order.forEach(function (k) {
      var a = type.axes[k];
      axes[k] = { letter: a.letter, pct: a.firstPct, strength: a.strength };
    });

    var traits = {};
    trait.forEach(function (t) { traits[t.label] = t.stars; });

    var finishedAt = new Date();
    var started = state.startedAt ? new Date(state.startedAt) : finishedAt;

    return {
      action: 'submit',
      passcode: state.entry.passcode,
      sid: state.sid,
      tag: state.entry.tag,
      mode: state.mode,
      startedAt: state.startedAt,
      finishedAt: finishedAt.toISOString(),
      durationSec: Math.max(0, Math.round((finishedAt - started) / 1000)),
      profile: {
        name: state.entry.name,
        email: state.entry.email,
        company: state.entry.company,
        dept: state.entry.dept,
        years: state.entry.years
      },
      type: { code: type.code, name: D.types[type.code].name, axes: axes },
      traits: traits,
      skills: {
        scores: skill.scores,
        overall: skill.overall,
        top3: skill.top3,
        bottom3: skill.bottom3
      },
      roles: { scores: roles.scores, best: roles.best },
      answers: state.answers
    };
  }

  function setSendStatus(kind, text, showRetry) {
    var box = $('send-status');
    box.hidden = false;
    box.classList.remove('is-ok', 'is-fail');
    if (kind) box.classList.add(kind);
    $('send-text').textContent = text;
    $('btn-resend').hidden = !showRetry;
  }

  function sendPayload(payload) {
    setSendStatus('', '結果を送信しています…', false);
    Recorder.submit(payload).then(function (res) {
      if (res && res.ok) {
        if (res.blind) {
          // 届いたかどうかまでは確認できていないので、控えは残したまま再送も選べるようにする。
          // 二重送信になっても、受検IDが同じものはシート側で無視される。
          setSendStatus('is-ok',
            '結果を送信しました（この環境では受信の確認まではできていません）。念のため再送もできます。', true);
        } else {
          Recorder.clearPending();
          setSendStatus('is-ok', '結果を送信しました。ご協力ありがとうございました。', false);
        }
      } else {
        setSendStatus('is-fail', '送信できませんでした（' + ((res && res.error) || '原因不明') + '）', true);
      }
    }, function () {
      setSendStatus('is-fail',
        '送信できませんでした。通信環境を確認して再送してください。回答はこの端末に残しています。', true);
    });
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
    state.sid = newSid();
    state.startedAt = new Date().toISOString();
    buildQuestions(mode);
    save();
    show('screen-quiz');
    renderQuestion();
  }

  function selectedMode() {
    var c = document.querySelector('input[name="mode"]:checked');
    return c ? c.value : 'full';
  }

  /* ---------- 受検者情報の入力画面 ---------- */

  function initEntryForm() {
    // 出さない項目を消す
    var f = CFG.fields || {};
    ['company', 'dept', 'years'].forEach(function (k) {
      if (f[k] === false) {
        var el = document.querySelector('.field[data-field="' + k + '"]');
        if (el) el.remove();
      }
    });

    if (CFG.contact) $('contact-link').href = CFG.contact;

    $('btn-entry-back').addEventListener('click', function () { show('screen-start'); });

    $('entry-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitEntry();
    });
  }

  function markBad(el, bad) {
    if (el) el.classList.toggle('is-bad', !!bad);
  }

  function submitEntry() {
    var err = $('entry-error');
    var name = $('f-name').value.trim();
    var email = $('f-email').value.trim();
    var pass = $('f-pass').value.trim();
    var agree = $('f-agree').checked;

    var v = function (id) { var el = $(id); return el ? el.value.trim() : ''; };

    markBad($('f-name').closest('.field'), !name);
    markBad($('f-email').closest('.field'), !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    markBad($('f-pass').closest('.field'), !pass);
    markBad(document.querySelector('.consent'), !agree);

    var bad = document.querySelector('.is-bad');
    if (bad) {
      err.hidden = false;
      err.textContent = !name || !email ? '氏名とメールアドレスを入力してください。'
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'メールアドレスの形式を確認してください。'
        : !pass ? '合い言葉を入力してください。'
        : '内容の取り扱いに同意いただく必要があります。';
      bad.scrollIntoView({ block: 'center' });
      return;
    }

    err.hidden = true;
    var btn = $('btn-entry');
    btn.disabled = true;
    btn.textContent = '確認しています…';

    var done = function () { btn.disabled = false; btn.textContent = '診断をはじめる'; };

    Recorder.verify(pass).then(function (res) {
      if (res && res.ok) {
        state.entry = {
          name: name, email: email,
          company: v('f-company'), dept: v('f-dept'), years: v('f-years'),
          passcode: pass, tag: Recorder.tag()
        };
        done();
        startFresh(selectedMode());
      } else {
        done();
        markBad($('f-pass').closest('.field'), true);
        err.hidden = false;
        err.textContent = (res && res.error) || '合い言葉が違います。案内された文字列を確認してください。';
        $('f-pass').focus();
      }
    }, function () {
      done();
      err.hidden = false;
      err.textContent = '記録先に接続できませんでした。通信環境を確認してから、もう一度お試しください。';
    });
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

    // 記録先が未設定なら、入力画面を出さず診断ツールとしてだけ動かす。
    // 設定用の注意書きは、手元での確認時と ?setup を付けたときだけ出す
    //（公開ページを見た受検者には見せない）。
    if (!Recorder.enabled()) {
      var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
      if (isLocal || /[?&]setup\b/.test(location.search)) $('setup-warn').hidden = false;
      console.warn('[営業タイプ診断] 記録先が未設定です。js/config.js の endpoint を設定してください（SETUP.md）。');
    }

    $('btn-start').addEventListener('click', function () {
      if (Recorder.enabled()) {
        show('screen-entry');
      } else {
        startFresh(selectedMode());
      }
    });

    initEntryForm();

    $('btn-resend').addEventListener('click', function () {
      var p = Recorder.loadPending();
      if (p) sendPayload(p);
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

    // 記録が有効なときは、スタート画面の注意書きを実態に合わせて書き換える
    if (Recorder.enabled()) {
      $('start-note').innerHTML =
        '入力いただいた氏名・メールアドレス・所属と、診断結果および全設問への回答は、' +
        '株式会社Insupに送信・保存されます。<br>' +
        '直感で、少し早めに答えたほうが結果が正確になります。';
    }

    // 前回送信できなかった結果が残っていれば、拾えるようにしておく
    var pending = Recorder.enabled() ? Recorder.loadPending() : null;
    if (pending) {
      $('btn-pending').style.display = '';
      $('btn-pending').addEventListener('click', function () {
        show('screen-result');
        sendPayload(pending);
      });
    }

    // 途中再開
    var saved = load();
    if (saved && saved.answers && Object.keys(saved.answers).length > 0) {
      $('btn-resume').style.display = '';
      $('btn-resume').addEventListener('click', function () {
        state.mode = saved.mode || 'full';
        state.phase = saved.phase || 'type';
        state.answers = saved.answers || {};
        state.idx = saved.idx || 0;
        state.entry = saved.entry || null;
        state.sid = saved.sid || newSid();
        state.startedAt = saved.startedAt || new Date().toISOString();
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
