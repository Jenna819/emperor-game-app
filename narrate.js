/* 皇帝后宫养成 · AI 叙事模块（复用本地 ai_proxy.py 的 /narrate；无代理时零感静默）
   作用：在「妃嫔死亡场景」和「终局」处，把结构化事实编年史交给模型，
   生成逻辑连贯的史官笔法长文，补在模板内容之前；模板兜底不删。 */
(function () {
  'use strict';
  var PROXY = (function () {
    var h = (typeof location !== 'undefined' && location.hostname) || '';
    if (!h || h === 'localhost' || h.indexOf('.github.io') >= 0) return 'http://127.0.0.1:8787';
    return 'http://' + h + ':8787'; // 局域网访问时，代理跟随页面所在主机（如手机打开 Mac 的地址）
  })();
  var DEATH_TIMEOUT = 30000;
  var SHILU_TIMEOUT = 60000;

  var st = { available: false, busy: false };

  function api() { return (typeof Game !== 'undefined' && Game._api) ? Game._api : null; }
  function state() { var a = api(); return a ? a.state() : null; }
  function findC(id) {
    var s = state(); if (!s) return null;
    return (s.concubines || []).find(function (c) { return c.id === id; })
      || (s.coldPalaceList || []).find(function (c) { return c.id === id; }) || null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  // ---------- 事实收集 ----------
  function favorWord(v) {
    v = v || 0;
    if (v >= 1500) return '盛宠冠绝后宫';
    if (v >= 800) return '常年得宠';
    if (v >= 400) return '颇蒙眷顾';
    if (v >= 150) return '恩宠平平';
    if (v >= 60) return '日渐冷落';
    return '久失圣心';
  }
  function kidList(momId) {
    var s = state(); if (!s) return [];
    return (s.children || []).filter(function (ch) {
      return (ch.motherId === momId || ch.adoptiveMotherId === momId);
    });
  }
  function chronFor(name, limit) {
    var s = state(); if (!s || !s.chronicle) return [];
    var rel = s.chronicle.filter(function (e) {
      return (e.d && e.d.indexOf(name) >= 0) || (e.t && e.t.indexOf(name) >= 0);
    });
    if (rel.length < 3 && s.chronicle.length) {
      // 该人无直接记录时，补上全局要事做背景
      rel = rel.concat(s.chronicle.slice(-limit).filter(function (e) { return rel.indexOf(e) < 0; }));
    }
    return rel.slice(-limit);
  }
  function chronText(name, limit) {
    var arr = chronFor(name, limit || 12);
    if (!arr.length) return '（无可考之事）';
    return arr.map(function (e) { return e.y + '年' + e.m + '月·' + e.t + '：' + e.d; }).join('\n');
  }

  function personaCard(c) {
    if (!c) return '';
    var kids = kidList(c.id);
    var kidDesc = kids.length ? kids.map(function (ch) {
      return ch.name + '(' + (ch.gender === '皇子' ? '皇子' : '公主') + ',' + ch.age + '岁' + (ch.health <= 0 ? ',已殇' : '') + ')';
    }).join('、') : '无所出';
    var grudge = '';
    if (c.grudge && c.grudge.targetId) {
      var g = findC(c.grudge.targetId);
      if (g) grudge = '，与' + g.name + '结有仇怨';
    }
    return [
      c.rank + (c.title ? c.title : '') + c.name + '，' + (c.age || '?') + '岁',
      '性格' + (c.personality ? c.personality.name : '温婉'),
      '特长' + (c.trait || '无'),
      '家世' + (c.family ? c.family.name : '平民'),
      favorWord(c.favor),
      c.pregnant ? ('有孕' + (c.pregMonth || 0) + '月') : ('子嗣' + kids.length + '人：' + kidDesc),
      '健康' + Math.round(c.health || 0),
      grudge ? grudge.replace(/^，/, '，') : ''
    ].filter(Boolean).join('；') + '。';
  }

  // ---------- 网络 ----------
  function ping() {
    return fetch(PROXY + '/ping', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (j) { return !!(j && j.ok && j.configured); })
      .catch(function () { return false; });
  }
  function narrate(system, user, maxTokens, timeout) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeout);
    return fetch(PROXY + '/narrate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: system, user: user, temperature: 1.0, max_tokens: maxTokens }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) { clearTimeout(timer); return r.json(); },
      function (e) { clearTimeout(timer); throw e; });
  }

  var CSS = [
    '.ai-rec{margin:0 0 14px;padding:12px 14px;background:linear-gradient(160deg,rgba(120,70,30,0.10),rgba(180,130,60,0.08));border:1px solid rgba(150,110,60,0.35);border-left:3px solid #8a5a2b;border-radius:10px;}',
    '.ai-rec-title{font-size:13px;font-weight:bold;color:#8a5a2b;margin-bottom:8px;display:flex;align-items:center;gap:6px;}',
    '.ai-rec-title .ai-tag{font-size:10px;color:#a0866a;font-weight:normal;letter-spacing:1px;}',
    '.ai-rec-text{font-size:13px;color:#4a3421;line-height:1.95;text-indent:2em;white-space:pre-wrap;}',
    '.ai-rec-loading{font-size:12px;color:#96714a;line-height:1.8;}',
    '.ai-rec-err{font-size:12px;color:#9a6a5a;}',
    '.ai-rec-reroll{margin-top:9px;background:rgba(150,105,55,0.12);border:1px solid rgba(150,110,60,0.4);color:#7a5324;font-size:11.5px;border-radius:14px;padding:4px 13px;cursor:pointer;font-family:inherit;}',
    '.ai-rec-reroll:disabled{opacity:.5;cursor:default;}',
    '.ai-shilu-btn{display:block;width:100%;margin:16px 0;padding:12px;font-size:14px;font-weight:bold;color:#fdf3e0;background:linear-gradient(180deg,#a9782f,#8a5a2b);border:none;border-radius:12px;cursor:pointer;font-family:inherit;letter-spacing:2px;}',
    '.ai-shilu-btn:disabled{opacity:.6;cursor:default;}',
    '.ai-shilu-panel{margin:16px 0;padding:16px 18px;background:linear-gradient(160deg,#fbf3e2,#f0e1c6);border:1px solid rgba(150,110,60,0.4);border-radius:12px;}',
    '.ai-shilu-panel h3{text-align:center;color:#8a5a2b;letter-spacing:4px;margin:0 0 12px;font-size:16px;}',
    '.ai-shilu-body{font-size:13px;color:#4a3421;line-height:2.05;text-indent:2em;white-space:pre-wrap;}'
  ].join('\n');

  // ---------- 死亡场景增强 ----------
  var DEATH_SYS = '你是一款古风宫廷文字游戏的史官，负责撰写妃嫔临终传记。要求：1)纯中文，不出现任何现代词（手机、公司、逻辑、角色、玩家等）；2)只用【给定事实】里的人物、事件与因果，不得虚构新的人名、罪名或情节；3)把她的身世、性情、恩宠起落与今日之死串成一段因果通顺、首尾连贯的文字，语气克制苍凉，忌狗血堆砌；4)可分2-4句成段但不加小标题；5)不超过200字，只输出正文。';
  function deathUser(ctx, card) {
    var lines = [];
    lines.push('【人物】' + (card || (ctx.name + '，位分' + ctx.rank)));
    if (ctx.evt && ctx.evt.eventType) {
      lines.push('【今日之罪/变故】' + ctx.evt.eventType);
    }
    lines.push('【赐死方式】' + ctx.method);
    lines.push('【生平可考之事（编年）】\n' + chronText(ctx.name, 12));
    lines.push('请用史官笔法为' + ctx.name + '写临终与盖棺之论，点明她因何一步步走到今日。');
    return lines.join('\n');
  }
  function mountDeath() {
    var s = state();
    if (!s || !s._narrateCtx) return;
    var box = document.getElementById('death-scene-content');
    if (!box || document.getElementById('ai-death-rec')) return;
    var ctx = s._narrateCtx;
    var c = findC(ctx.targetId);
    var card = c ? personaCard(c) : '';
    var holder = document.createElement('div');
    holder.className = 'ai-rec'; holder.id = 'ai-death-rec';
    holder.innerHTML = '<div class="ai-rec-title">📜 史官新录<span class="ai-tag">AI·据本局史实</span></div>' +
      '<div class="ai-rec-loading">史官正展卷秉笔……</div>';
    box.insertBefore(holder, box.firstChild);
    runDeath(holder, ctx, card);
  }
  function runDeath(holder, ctx, card) {
    var body = holder.querySelector('.ai-rec-loading') || holder.querySelector('.ai-rec-text');
    if (st.busy) return;
    st.busy = true;
    body.className = 'ai-rec-loading'; body.textContent = '史官正展卷秉笔……';
    narrate(DEATH_SYS, deathUser(ctx, card), 400, DEATH_TIMEOUT).then(function (j) {
      st.busy = false;
      if (j && typeof j.content === 'string' && j.content.trim()) {
        holder.innerHTML = '<div class="ai-rec-title">📜 史官新录<span class="ai-tag">AI·据本局史实</span></div>' +
          '<div class="ai-rec-text">' + esc(j.content.trim()) + '</div>' +
          '<button class="ai-rec-reroll" onclick="HaremNarrate.rerollDeath()">换个写法</button>';
      } else { removeDeath(holder); }
    }, function () { st.busy = false; removeDeath(holder); });
  }
  function removeDeath(holder) {
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
  }
  function rerollDeath() {
    var s = state(); if (!s || !s._narrateCtx) return;
    var holder = document.getElementById('ai-death-rec'); if (!holder) return;
    var c = findC(s._narrateCtx.targetId);
    runDeath(holder, s._narrateCtx, c ? personaCard(c) : '');
  }

  // ---------- 终局《实录》 ----------
  var SHILU_SYS = '你是一款古风宫廷文字游戏的史官，为刚驾崩/亡国的皇帝撰写本朝《实录》结语。要求：1)纯中文史传笔法，不出现现代词；2)只用【给定史实】中的年份、人物与事件，不得虚构；3)通览其一生（在位年数、后宫兴废、子嗣传承、重大变故），写成800-1200字、逻辑连贯的一篇，含起承转合，客观中带感慨；4)不要分条、不要小标题，用流畅段落；5)只输出正文。';
  function shiluUser() {
    var s = state(); if (!s) return '';
    var lines = [];
    var moms = (s.concubines || []).length + (s.coldPalaceList || []).length;
    var kids = (s.children || []).length;
    lines.push('【本朝】国号' + (s.dynasty || '某') + '，末于' + s.year + '年' + s.month + '月，皇帝享年' + (s._emperorAge || '?') + '岁，在位约' + s.year + '年。后宫妃嫔约' + moms + '人，子嗣' + kids + '人。国库' + s.treasury + '两。');
    if (s.crownPrinceId) {
      var cp = (s.children || []).find(function (x) { return x.id === s.crownPrinceId; });
      if (cp) lines.push('【储君】太子' + cp.name + '。');
    }
    var ch = (s.chronicle || []);
    var brief = ch.length ? ch.map(function (e) { return e.y + '年' + e.m + '月·' + e.t + '：' + e.d; }).join('\n') : '（无编年记录）';
    if (brief.length > 2200) brief = brief.slice(-2200); // 控制 token，保后段
    lines.push('【编年史实】\n' + brief);
    lines.push('请据以上史实为本朝撰《实录》结语。');
    return lines.join('\n');
  }
  function mountShilu() {
    var content = document.getElementById('gameover-content');
    if (!content || document.getElementById('ai-shilu-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'ai-shilu-btn'; btn.className = 'ai-shilu-btn'; btn.textContent = '📜 命史官修本朝《实录》';
    btn.onclick = runShilu;
    content.insertBefore(btn, content.firstChild);
  }
  function runShilu() {
    var btn = document.getElementById('ai-shilu-btn'); if (!btn) return;
    var content = document.getElementById('gameover-content');
    btn.disabled = true; btn.textContent = '史官闭关修撰中，约需半分钟……';
    var panel = document.createElement('div');
    panel.className = 'ai-shilu-panel'; panel.id = 'ai-shilu-panel';
    panel.innerHTML = '<h3>《实录》</h3><div class="ai-shilu-body" id="ai-shilu-body">正在铺纸研墨……</div>';
    content.insertBefore(panel, btn.nextSibling);
    narrate(SHILU_SYS, shiluUser(), 1400, SHILU_TIMEOUT).then(function (j) {
      if (j && typeof j.content === 'string' && j.content.trim()) {
        var b = document.getElementById('ai-shilu-body');
        if (b) { b.textContent = j.content.trim(); }
        btn.textContent = '📜 另请一位史官重撰'; btn.disabled = false;
      } else { failShilu(btn, panel); }
    }, function () { failShilu(btn, panel); });
  }
  function failShilu(btn, panel) {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    btn.disabled = false; btn.textContent = '📜 命史官修本朝《实录》（重写一次）';
    var content = document.getElementById('gameover-content');
    var msg = document.createElement('div');
    msg.className = 'ai-rec-err'; msg.style.cssText = 'text-align:center;margin:8px 0;';
    msg.textContent = '史官搁笔（模型无响应或超时），可再试一次。';
    content.insertBefore(msg, btn.nextSibling);
    setTimeout(function () { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 4000);
  }

  // ---------- DOM 观察 ----------
  function observeModals() {
    var dm = document.getElementById('modal-death-scene');
    if (dm) new MutationObserver(function () {
      if (dm.classList.contains('show')) setTimeout(mountDeath, 120);
      else { var h = document.getElementById('ai-death-rec'); if (h) removeDeath(h); }
    }).observe(dm, { attributes: true, attributeFilter: ['class'] });

    var gp = document.getElementById('page-gameover');
    if (gp) new MutationObserver(function () {
      if (gp.classList.contains('active')) tryMountShilu(0);
    }).observe(gp, { attributes: true, attributeFilter: ['class'] });
  }
  function tryMountShilu(tries) {
    if (document.getElementById('ai-shilu-btn')) return;
    var content = document.getElementById('gameover-content');
    if (content && content.innerHTML.length > 40) { mountShilu(); return; }
    if (tries < 15) setTimeout(function () { tryMountShilu(tries + 1); }, 200);
  }

  function boot() {
    if (typeof document === 'undefined' || typeof Game === 'undefined') return;
    var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    ping().then(function (ok) {
      st.available = ok;
      if (ok) observeModals();
    });
  }
  window.HaremNarrate = { rerollDeath: rerollDeath, _test: { personaCard: personaCard, chronText: chronText, deathUser: deathUser, shiluUser: shiluUser, narrate: narrate, state: function () { return st; } } };
  if (typeof document !== 'undefined' && typeof Game !== 'undefined') {
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
