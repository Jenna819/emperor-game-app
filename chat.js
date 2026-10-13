/* 皇帝后宫养成 · AI 实时聊天模块（依赖本地 ai_proxy.py，线上无代理时自动隐藏） */
(function () {
  'use strict';
  var PROXY = (function () {
    var h = (typeof location !== 'undefined' && location.hostname) || '';
    if (!h || h === 'localhost' || h.indexOf('.github.io') >= 0) return 'http://127.0.0.1:8787';
    return 'http://' + h + ':8787'; // 局域网访问时，代理跟随页面所在主机（如手机打开 Mac 的地址）
  })();
  var TURN_LIMIT = 10;      // 每妃每自然月最多回合
  var DELTA_CAP = 15;       // 每妃每自然月宠爱变动上限
  var REQUEST_TIMEOUT = 20000;

  var MOODS = { '喜': 1, '怒': 1, '哀': 1, '惧': 1, '中性': 1 };
  var MOOD_FALLBACK_DELTA = { '喜': 2, '怒': -2, '哀': -1, '惧': -1, '中性': 0 };

  // 六大性格系的说话风格指南（app.js getPersonalityGroup 的 fallback 名）
  var STYLE_GUIDE = {
    '温婉': '语气体贴柔软，句句带着对皇上的关心，常主动嘘寒问暖、念叨汤药衣裳饮食。',
    '贤淑': '端庄周到，说话离不开操持后宫、照顾皇上起居，贤惠中带一点盼皇上多留心的小女儿态。',
    '娇媚': '声音软糯带钩子，会撒娇、会撩、会邀宠，喜欢用"嘛""呢""呀"和波浪式的语气，明着要宠爱。',
    '活泼': '活泼跳脱，说话又甜又快，常分享宫里的新鲜事和小吃货，会拉着皇上说有的没的。',
    '端庄': '持重守礼，措辞正式大气，关心社稷与后宫秩序，情绪不外露，但字里行间盼被敬重。',
    '心机': '话里有话，表面关心皇上实则引导争宠、暗贬其他妃嫔，滴水不漏，被点破会立刻换一副委屈面孔。',
    '清冷': '清冷寡言，回话极短（十个字上下），不迎不避，若皇上话语无礼数会直言不讳；偶尔一句软话格外珍贵。',
    'default': '性情中人，回话贴合自身位分与处境，不卑不亢。'
  };

  var state = { available: false, openId: null, busy: false, turnsUsed: {} };

  // ---------- 存档结构保障 ----------
  function ensureChats() {
    var s = api().state();
    if (!s.chats) s.chats = {};
    return s;
  }
  function curKey() { var s = api().state(); return (s.year || 1) + '-' + (s.month || 1); }
  function chatFor(id) {
    ensureChats();
    var s = api().state();
    if (!s.chats[id] || s.chats[id].key !== curKey()) {
      s.chats[id] = { key: curKey(), history: [], turns: 0, favorDelta: 0 };
    }
    return s.chats[id];
  }

  // ---------- 人设与局势 ----------
  function findC(id) {
    var s = api().state();
    return s.concubines.find(function (c) { return c.id === id; })
      || s.coldPalaceList.find(function (c) { return c.id === id; })
      || null;
  }
  function inColdPalace(c) {
    return api().state().coldPalaceList.indexOf(c) >= 0;
  }
  function favorWord(v) {
    if (v >= 1500) return '你待她极尽宠爱，她满心满眼都是你';
    if (v >= 800) return '你近期频繁临幸于她，她正受宠';
    if (v >= 400) return '她对你情深意重';
    if (v >= 150) return '她对你颇有好感';
    if (v >= 60) return '她对你印象平平';
    return '你许久未曾理会她，她心里有怨';
  }
  function stressWord(v) {
    if (v >= 80) return '她精神压力极大，几近崩溃边缘，说话可能失态';
    if (v >= 60) return '她心中烦闷压抑';
    if (v >= 40) return '她略感疲惫';
    return '';
  }
  function recentMention(c) {
    var s = api().state();
    var keys = [c.name];
    if (c.name.length >= 2) keys.push(c.rank + c.name.slice(-2), c.name.slice(-2), c.name.charAt(0) + c.rank);
    var evs = (s.eventLog || []).filter(function (e) {
      if (!e.detail) return false;
      for (var i = 0; i < keys.length; i++) if (e.detail.indexOf(keys[i]) >= 0) return true;
      return false;
    }).slice(0, 3);
    var bl = (c.behaviorLog || []).slice(-2).map(function (b) { return b.eventType; });
    var parts = evs.map(function (e) { return e.type + '：' + e.detail; });
    if (bl.length) parts.push('近月行迹：' + bl.join('、'));
    return parts.slice(0, 4).join('；') || '近期无大事';
  }

  function buildSystemPrompt(c) {
    var s = api().state();
    var grp = c.personality && c.personality.fallback ? c.personality.fallback : 'default';
    var pname = c.personality ? c.personality.name : '温婉';
    var kids = (s.children || []).filter(function (ch) {
      return (ch.motherId === c.id || ch.adoptiveMotherId === c.id) && ch.health > 0;
    });
    var kidDesc = kids.length
      ? kids.map(function (ch) { return ch.name + '(' + (ch.gender === '皇子' ? '皇子' : '公主') + ',' + ch.age + '岁,健康' + ch.health + ')'; }).join('、')
      : '无所出';
    var lines = [];
    lines.push('你扮演古风宫廷文字游戏《皇帝后宫养成》中的妃嫔，正在与皇帝（玩家，由用户扮演）闲聊。');
    lines.push('角色卡：' + (inColdPalace(c) ? '已被打入冷宫的' : '') + c.rank + c.name + '，' + c.age + '岁，'
      + (c.pregnant ? '有孕' + c.pregMonth + '个月' : '无所出') + '，特长' + c.trait + '，家世' + c.family.name + '，性格' + pname + '。');
    lines.push('说话风格：' + (STYLE_GUIDE[grp] || STYLE_GUIDE['default']));
    lines.push('处境：宠爱方面——' + favorWord(c.favor) + '。' + (stressWord(c.stress) || '心情平顺') + '。'
      + (c.health < 40 ? '她身染病恙，气息不足。' : '') + (inColdPalace(c) ? '她身居冷宫，日子凄清。' : '')
      + '子嗣：' + kidDesc + '。');
    lines.push('近况（可自然提起一两句，勿堆砌）：' + recentMention(c));
    lines.push('规则：1)始终不出戏，绝不知晓AI、模型、游戏设定之外的现代事物；2)自称臣妾，称对方皇上；3)白话古风、口语化，不超过60字；4)禁止现代词（手机、公司、电影等）；5)只输出一个JSON对象，格式严格为 {"reply":"你说的话","mood":"喜|怒|哀|惧|中性","delta":-3到3的整数}，mood是你此刻情绪，delta是这句对话后你对皇上宠爱的真实变化（讨你欢心为正，冒犯你或戳你痛处为负），除此之外不输出任何多余字符。');
    return lines.join('\n');
  }

  function buildMessages(c, userText) {
    var chat = chatFor(c.id);
    var msgs = [{ role: 'system', content: buildSystemPrompt(c) }];
    chat.history.slice(-20).forEach(function (h) {
      msgs.push({ role: h.r === 'u' ? 'user' : 'assistant', content: h.t });
    });
    msgs.push({ role: 'user', content: userText });
    return msgs;
  }

  // ---------- AI 回复解析 ----------
  function extractJSON(cands) {
    for (var i = 0; i < cands.length; i++) {
      try { var o = JSON.parse(cands[i]); if (o && typeof o === 'object') return o; } catch (e) { }
    }
    var s = '';
    for (var i = 0; i < cands.length; i++) if (cands[i].length > s.length) s = cands[i];
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { } }
    return null;
  }

  function parseAIReply(raw) {
    try {
      raw = String(raw);
      var cands = [];
      if (/^\s*\{[\s\S]*\}\s*$/.test(raw)) cands.push(raw.trim());
      var fm = raw.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fm) cands.push(fm[1].trim());
      var re = /\{[^{}]*\}/g, m;
      while ((m = re.exec(raw))) cands.push(m[0]);
      var o = extractJSON(cands);
      if (o && typeof o.reply === 'string' && o.reply.length) {
        var mood = MOODS[o.mood] ? o.mood : '中性';
        var d = parseInt(o.delta, 10);
        if (isNaN(d) || d < -3 || d > 3) d = MOOD_FALLBACK_DELTA[mood];
        return { reply: o.reply.slice(0, 120), mood: mood, delta: d, ok: true };
      }
    } catch (e) { }
    return { reply: '', mood: '中性', delta: 0, ok: false };
  }

  // ---------- 网络 ----------
  function ping() {
    return fetch(PROXY + '/ping', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (j) { return !!(j.ok && j.configured); })
      .catch(function () { return false; });
  }
  function callChat(messages) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, REQUEST_TIMEOUT);
    return fetch(PROXY + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages, temperature: 0.9 }),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    }, function (err) { clearTimeout(timer); throw err; });
  }

  // ---------- UI ----------
  var CSS = [
    '#chat-overlay{position:fixed;inset:0;z-index:9990;background:rgba(40,20,10,0.55);display:flex;align-items:center;justify-content:center;}',
    '#chat-modal{width:min(94vw,430px);height:min(86vh,620px);background:linear-gradient(160deg,#fbf3e2,#f1e2c8);border:1px solid rgba(150,110,60,0.45);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,0.45);display:flex;flex-direction:column;overflow:hidden;}',
    '.chat-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(150,105,55,0.14);border-bottom:1px solid rgba(150,110,60,0.3);}',
    '.chat-head img{width:44px;height:56px;object-fit:cover;border-radius:8px;border:1px solid rgba(150,110,60,0.5);}',
    '.chat-head .who{flex:1;min-width:0;}',
    '.chat-head .who b{color:#5a3e28;font-size:15px;}',
    '.chat-head .who .sub{color:#96714a;font-size:11px;margin-top:2px;}',
    '.chat-close{background:none;border:none;color:#7a5a3a;font-size:22px;cursor:pointer;line-height:1;padding:2px 8px;}',
    '.chat-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;}',
    '.chat-bubble{max-width:80%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.65;word-break:break-word;}',
    '.chat-bubble.ai{align-self:flex-start;background:#fffdf6;color:#4a3421;border:1px solid rgba(150,110,60,0.25);border-bottom-left-radius:3px;}',
    '.chat-bubble.me{align-self:flex-end;background:#b9852f;color:#fff;border-bottom-right-radius:3px;}',
    '.chat-bubble.sys{align-self:center;background:none;color:#9a7a55;font-size:11.5px;padding:0;}',
    '.chat-topics{display:flex;flex-wrap:wrap;gap:6px;padding:6px 12px;}',
    '.chat-topics button{background:rgba(150,105,55,0.1);border:1px solid rgba(150,105,55,0.3);color:#6d4d2c;font-size:11.5px;border-radius:14px;padding:4px 10px;cursor:pointer;font-family:inherit;}',
    '.chat-inputbar{display:flex;gap:8px;padding:10px 12px 14px;border-top:1px solid rgba(150,110,60,0.3);}',
    '.chat-inputbar input{flex:1;border:1px solid rgba(150,110,60,0.4);border-radius:10px;padding:9px 12px;font-size:13px;background:#fffdf6;color:#4a3421;font-family:inherit;outline:none;}',
    '.chat-inputbar button{background:#8a5a2b;border:none;color:#fdf3e0;border-radius:10px;padding:0 18px;font-size:13px;cursor:pointer;font-family:inherit;}',
    '.chat-inputbar button:disabled{opacity:0.5;cursor:default;}',
    '.chat-turn{font-size:10.5px;color:#96714a;margin-top:1px;}',
    'button.chat-action{border-color:rgba(185,133,47,0.55)!important;background:rgba(185,133,47,0.12)!important;color:#8a5a2b!important;}'
  ].join('\n');

  var TOPICS = [
    { t: '关心今日起居', m: '今日宫里可好？朕瞧你气色不佳。' },
    { t: '夸她的才艺', m: '朕听闻你的' },
    { t: '聊聊宫中趣事', m: '近日宫里可有什么新鲜事？说与朕听听。' },
    { t: '问她想吃什么', m: '御膳房新进了些时鲜，你想吃什么，朕吩咐他们去做。' }
  ];

  function traitWord(c) {
    var map = { '刺绣': '女红', '厨艺': '手艺', '医术': '医道', '香道': '调香', '茶道': '茶艺', '书法': '字', '绘画': '画', '音律': '琴艺', '女红': '女红', '插花': '瓶花', '围棋': '棋艺', '古筝': '筝艺', '琵琶': '琵琶', '笛箫': '箫笛', '古琴': '古琴', '舞蹈': '舞姿', '诗词歌赋': '诗才', '琴棋书画': '才学' };
    return map[c.trait] || '才艺';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function buildModal(c) {
    var old = document.getElementById('chat-overlay');
    if (old) old.parentNode.removeChild(old);
    var ov = document.createElement('div');
    ov.id = 'chat-overlay';
    ov.innerHTML =
      '<div id="chat-modal" onclick="event.stopPropagation()">' +
      '<div class="chat-head">' +
      '<img src="' + (c._chatAvatar || '') + '" alt="">' +
      '<div class="who"><b>' + esc(c.name) + '</b><div class="sub">' + esc(c.rank) + ' · ' + esc(c.personality ? c.personality.name : '') + '</div><div class="chat-turn" id="chat-turn"></div></div>' +
      '<button class="chat-close" onclick="HaremChat.close()">×</button>' +
      '</div>' +
      '<div class="chat-msgs" id="chat-msgs"></div>' +
      '<div class="chat-topics" id="chat-topics"></div>' +
      '<div class="chat-inputbar">' +
      '<input id="chat-input" placeholder="与她说说话…" maxlength="60">' +
      '<button id="chat-send" onclick="HaremChat.send()">发送</button>' +
      '</div></div>';
    ov.addEventListener('click', function () { HaremChat.close(); });
    document.body.appendChild(ov);
    var input = document.getElementById('chat-input');
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') HaremChat.send(); });
    renderTopics(c);
    renderTurn(c);
  }

  function renderTopics(c) {
    var el = document.getElementById('chat-topics'); if (!el) return;
    var html = '';
    TOPICS.forEach(function (tp, i) {
      var msg = tp.m;
      if (i === 1) msg = '朕听闻你的' + traitWord(c) + '在宫里是一绝，今日可得空演给朕看看？';
      html += '<button onclick="HaremChat.topic(' + i + ')">' + esc(tp.t) + '</button>';
    });
    if (inColdPalace(c)) html = '<button onclick="HaremChat.topic(4)">许诺接她出去</button>' + html;
    el.innerHTML = html;
    el._topics = TOPICS.map(function (tp, i) {
      return i === 1 ? '朕听闻你的' + traitWord(c) + '在宫里是一绝，今日可得空演给朕看看？' : tp.m;
    });
    if (inColdPalace(c)) el._topics[4] = '等朕料理完这桩冤案，便接你出去。';
  }

  function renderTurn(c) {
    var chat = chatFor(c.id);
    var el = document.getElementById('chat-turn');
    if (el) el.textContent = '本月已聊 ' + chat.turns + '/' + TURN_LIMIT + ' 回合 · 宠爱变动 ' + (chat.favorDelta >= 0 ? '+' : '') + chat.favorDelta;
    var btn = document.getElementById('chat-send');
    if (btn) btn.disabled = state.busy || chat.turns >= TURN_LIMIT;
  }

  function appendBubble(kind, text) {
    var box = document.getElementById('chat-msgs'); if (!box) return null;
    var d = document.createElement('div');
    d.className = 'chat-bubble ' + kind;
    d.textContent = text;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
  }

  function typewrite(el, text, done) {
    if (!el) { if (done) done(); return; }
    var i = 0;
    var iv = setInterval(function () {
      i += 2;
      el.textContent = text.slice(0, i);
      var box = document.getElementById('chat-msgs');
      if (box) box.scrollTop = box.scrollHeight;
      if (i >= text.length) { clearInterval(iv); el.textContent = text; if (done) done(); }
    }, 28);
  }

  function applyEffect(c, delta, mood) {
    if (!delta) return '';
    var chat = chatFor(c.id);
    var room = delta > 0 ? (DELTA_CAP - chat.favorDelta) : (DELTA_CAP + chat.favorDelta);
    var applied = Math.max(0, Math.min(Math.abs(delta), Math.max(0, room))) * (delta > 0 ? 1 : -1);
    if (!applied) return '';
    chat.favorDelta += applied;
    api().adjustFavor(c.id, applied);
    if (mood === '喜' && applied > 0) api().adjustStress(c.id, -3);
    if ((mood === '怒' || mood === '哀') && applied < 0) api().adjustStress(c.id, 2);
    return (applied > 0 ? '+' : '') + applied;
  }

  function afterFail(c) {
    var greet = c.personality && c.personality.greetings && c.personality.greetings.length
      ? c.personality.greetings[Math.floor(Math.random() * c.personality.greetings.length)]
      : '……';
    appendBubble('ai', greet);
    appendBubble('sys', '（她似乎心不在焉，此番对话未计入）');
  }

  function sendText(c, text) {
    var chat = chatFor(c.id);
    if (chat.turns >= TURN_LIMIT) { appendBubble('sys', '本月已聊了许多，她说："皇上，臣妾乏了，来日再叙吧。"'); return; }
    if (state.busy) return;
    state.busy = true;
    appendBubble('me', text);
    var thinking = appendBubble('ai', '……');
    renderTurn(c);
    callChat(buildMessages(c, text)).then(function (res) {
      var d = '';
      if (res && res.status === 200 && res.body && typeof res.body.content === 'string') {
        var p = parseAIReply(res.body.content);
        if (p.ok) d = p.delta + '|' + p.mood + '|' + p.reply;
      } else if (res && res.status === 403) {
        d = '0|中性|皇上莫拿这些混话逗臣妾了。';
      }
      finishTurn(c, thinking, d, text);
    }, function () {
      finishTurn(c, thinking, '', text);
    });
  }

  function finishTurn(c, thinking, payload, userText) {
    state.busy = false;
    if (thinking && thinking.parentNode) thinking.parentNode.removeChild(thinking);
    if (!payload) {
      afterFail(c);
      renderTurn(c);
      return;
    }
    var ps = payload.split('|');
    var delta = parseInt(ps[0], 10) || 0, mood = ps[1], reply = ps.slice(2).join('|');
    var chat = chatFor(c.id);
    chat.history.push({ r: 'u', t: userText }, { r: 'a', t: reply });
    if (chat.history.length > 60) chat.history = chat.history.slice(-60);
    chat.turns++;
    var shown = applyEffect(c, delta, mood);
    api().save();
    typewrite(appendBubble('ai', ''), reply, function () {
      if (shown) appendBubble('sys', '她对你的态度：宠爱 ' + shown);
      var box = document.getElementById('chat-msgs');
      if (box) box.scrollTop = box.scrollHeight;
    });
    renderTurn(c);
  }

  // ---------- 对外接口 ----------
  function open(id) {
    var c = findC(id); if (!c) return;
    state.openId = id;
    try {
      if (typeof PORTRAIT_DATA !== 'undefined' && typeof c.portraitIdx === 'number' && c.portraitIdx > 0) {
        c._chatAvatar = PORTRAIT_DATA[c.portraitIdx - 1] || '';
      }
    } catch (e) { }
    buildModal(c);
    var chat = chatFor(id);
    var box = document.getElementById('chat-msgs');
    if (box && chat.history.length) {
      chat.history.slice(-8).forEach(function (h) {
        appendBubble(h.r === 'u' ? 'me' : 'ai', h.t);
      });
      appendBubble('sys', '——— 以上为近期对话，继续聊吧 ———');
    } else {
      var greet = c.personality && c.personality.greetings && c.personality.greetings.length
        ? c.personality.greetings[0] : '臣妾给皇上请安。';
      appendBubble('ai', greet);
    }
    var input = document.getElementById('chat-input');
    if (input) input.focus();
  }
  function close() {
    var ov = document.getElementById('chat-overlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    state.openId = null;
  }
  function send() {
    if (!state.openId) return;
    var input = document.getElementById('chat-input');
    var text = (input && input.value || '').trim();
    if (!text) return;
    input.value = '';
    sendText(findC(state.openId), text);
  }
  function topic(i) {
    if (!state.openId) return;
    var el = document.getElementById('chat-topics');
    var msg = el && el._topics ? el._topics[i] : null;
    if (!msg) return;
    sendText(findC(state.openId), msg);
  }

  // ---------- 入口按钮注入（详情页每次渲染后补一颗「闲谈」） ----------
  var injectTimer = null;
  function tryInject() {
    var dc = document.getElementById('detail-content');
    if (!dc || !state.available) return;
    var cards = dc.querySelectorAll('.action-card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].querySelector('.chat-action')) return;
    }
    if (cards.length) {
      var id = dc.getAttribute('data-chat-id') || detectIdFrom(dc);
      if (!id) return;
      var b = document.createElement('button');
      b.className = 'btn-action chat-action';
      b.innerHTML = '💬 闲谈<br><span class="btn-cost">说说话，涨些体己情分</span>';
      b.onclick = function (e) { e.stopPropagation(); open(id); };
      cards[cards.length - 1].appendChild(b);
    }
  }
  function detectIdFrom(dc) {
    var btns = dc.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var oc = btns[i].getAttribute('onclick') || '';
      var m = oc.match(/'([^']+)'/);
      if (m && findC(m[1])) return m[1];
    }
    return null;
  }
  function hookDetail() {
    var dc = document.getElementById('detail-content');
    if (!dc) { setTimeout(hookDetail, 500); return; }
    new MutationObserver(function () {
      clearTimeout(injectTimer);
      injectTimer = setTimeout(function () {
        var id = detectIdFrom(dc);
        if (id) dc.setAttribute('data-chat-id', id);
        tryInject();
      }, 100);
    }).observe(dc, { childList: true, subtree: true });
  }

  function api() {
    if (typeof Game !== 'undefined' && Game._api) return Game._api;
    throw new Error('Game._api missing');
  }

  var HaremChat = {
    open: open, close: close, send: send, topic: topic,
    _internal: {
      buildSystemPrompt: buildSystemPrompt, buildMessages: buildMessages, traitWord: traitWord, STYLE_GUIDE: STYLE_GUIDE,
      parseAIReply: parseAIReply, chatFor: chatFor, curKey: curKey, applyEffect: applyEffect,
      findC: findC, state: function () { return state; }
    }
  };
  window.HaremChat = HaremChat;

  function boot() {
    if (typeof document === 'undefined' || typeof Game === 'undefined') return; // 测试模式手动 boot
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    ping().then(function (ok) {
      state.available = ok;
      if (ok) hookDetail();
    });
  }
  if (typeof document !== 'undefined' && typeof Game !== 'undefined') {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }
  }
})();
