import { TEAMS, BOT_NAMES, MATCH, ABIL } from '../config.js';

const $ = s => document.querySelector(s);

/* ============================================================
   UI — all DOM: screen transitions, lobby, HUD, banners, the
   countdown, results, and cooldown meters. Talks to the rest of
   the game only through the injected `game` facade, so gameplay
   never touches the DOM directly.
   ============================================================ */
export class UI {
  constructor(game) {
    this.game = game;
    this.screens = { home: $('#home'), lobby: $('#lobby'), hud: $('#hud'), results: $('#results') };
    this.bannerT = 0;
    this._struggleBar = $('#grabUI .gbar.struggle');
    this._gripBar = $('#grabUI .gbar.grip');
    this._struggleFill = this._struggleBar.querySelector('.fill');
    this._gripFill = this._gripBar.querySelector('.fill');
    this._dark = $('#dark');
    this._injectKeyframes();
    this._wireButtons();
  }

  _injectKeyframes() {
    const kf = document.createElement('style');
    kf.textContent = `@keyframes cd{0%{transform:scale(.3);opacity:0}45%{transform:scale(1.12);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes bpop{0%{opacity:0;transform:scale(.4) rotate(-5deg)}60%{opacity:1;transform:scale(1.08) rotate(1.5deg)}100%{opacity:1;transform:scale(1)}}
@keyframes bout{to{opacity:0;transform:scale(1.25)}}`;
    document.head.appendChild(kf);
  }

  // ---------- screen transitions ----------
  showScreen(name) {
    for (const k in this.screens) {
      const el = this.screens[k];
      const want = (k === name) || (name === 'playing' && k === 'hud');
      if (want) { el.classList.remove('hide'); setTimeout(() => el.classList.remove('out'), 16); }
      else { el.classList.add('out'); setTimeout(() => { if (el.classList.contains('out')) el.classList.add('hide'); }, 500); }
    }
  }

  wipe(mid) {
    const w = $('#wipe');
    w.style.transition = 'none'; w.style.clipPath = 'inset(0 100% 0 0)';
    setTimeout(() => { w.style.transition = 'clip-path .42s cubic-bezier(.7,0,.3,1)'; w.style.clipPath = 'inset(0 0 0 0)'; }, 16);
    setTimeout(() => { try { mid && mid(); } catch (e) { console.error('wipe mid', e); } w.style.clipPath = 'inset(0 0 0 100%)'; }, 450);
    setTimeout(() => { w.style.clipPath = 'inset(0 100% 0 0)'; }, 900);
  }

  // ---------- loader ----------
  setLoad(p, txt) { $('#loadFill').style.width = Math.round(p * 100) + '%'; if (txt) $('#loadTxt').textContent = txt; }
  hideLoader(onGone) {
    const el = $('#loader'); el.style.opacity = 0;
    setTimeout(() => { el.classList.add('hide'); onGone && onGone(); }, 600);
  }

  // ---------- lobby ----------
  setRoomCode(code) { $('#roomCode').textContent = code; }

  renderLobby() {
    const g = this.game;
    const slots = $('#slots'); slots.innerHTML = '';
    const order = this._teamOrder();
    for (let i = 0; i < g.config.count; i++) {
      const isYou = i === 0; const ti = order[i]; const t = TEAMS[ti];
      const slot = document.createElement('div');
      slot.className = 'slot filled' + (isYou ? ' you' : '');
      slot.innerHTML = `<div class="badge">P${i + 1}</div><div class="glow" style="background:${t.css}"></div>
        <img class="portrait" src="${g.thumbs[ti] || ''}" alt="">
        <div class="who">${isYou ? '나' : BOT_NAMES[(i * 2) % BOT_NAMES.length]}</div>
        <div class="tag">${isYou ? '플레이어' : '봇 (자동 참가)'}</div>`;
      slots.appendChild(slot);
    }
    const cw = $('#colorPick');
    cw.innerHTML = TEAMS.map((tt, ci) => `<button class="sw ${ci === g.humanColor ? 'on' : ''}" data-c="${ci}" style="background:${tt.css};color:${tt.css}" aria-label="${tt.name}"></button>`).join('');
    cw.querySelectorAll('.sw').forEach(s => s.addEventListener('click', () => { g.humanColor = +s.dataset.c; this.renderLobby(); }));
    this.renderPills();
  }

  _teamOrder() { const h = this.game.humanColor; return [h, ...[0, 1, 2, 3].filter(c => c !== h)]; }

  renderPills() {
    const g = this.game;
    const cp = $('#countPills'); cp.innerHTML = '';
    MATCH.countOptions.forEach(n => {
      const b = document.createElement('button');
      b.className = 'pill' + (g.config.count === n ? ' on' : ''); b.textContent = n + '인';
      b.onclick = () => { g.config.count = n; this.renderLobby(); }; cp.appendChild(b);
    });
    const rp = $('#roundPills'); rp.innerHTML = '';
    MATCH.roundOptions.forEach(n => {
      const b = document.createElement('button');
      b.className = 'pill' + (g.config.rounds === n ? ' on' : ''); b.textContent = n;
      b.onclick = () => { g.config.rounds = n; this.renderPills(); }; rp.appendChild(b);
    });
  }

  // ---------- HUD ----------
  buildHUD() {
    const wrap = $('#playerCards'); wrap.innerHTML = '';
    this.game.players.forEach(p => {
      const c = document.createElement('div'); c.className = 'pcard'; c.id = 'pc' + p.idx;
      c.innerHTML = `<span class="av" style="background:${p.css};color:${p.css}"></span><span class="nm">${p.name}${p.isBot ? ' · 봇' : ''}</span><span class="sc" id="sc${p.idx}">0</span>`;
      wrap.appendChild(c);
    });
  }

  updateHUD() {
    this.game.players.forEach(p => {
      const c = $('#pc' + p.idx); if (!c) return;
      c.classList.toggle('dead', !p.alive);
      const s = $('#sc' + p.idx); if (s) s.textContent = p.score;
    });
  }

  roundTag(text) { $('#roundTag').textContent = text; }

  updateCooldowns() {
    const p = this.game.players[0]; if (!p) return;
    const set = (a, v) => { const el = document.querySelector(`[data-cool="${a}"]`); if (el) el.style.transform = 'scaleY(' + Math.max(0, Math.min(1, v)) + ')'; };
    set('dash', p.dashCd / ABIL.dashCd);
    set('grab', p.grabCd / ABIL.grabCd);
    set('jump', p.onGround ? 0 : 0.6);
    set('slam', p.onGround ? 0 : 0);
  }

  /** grip/struggle bars for the local player's grab state */
  updateGrab() {
    const p = this.game.players[0];
    const carried = p && p.grabbedBy, carrying = p && p.grabbing;
    this._struggleBar.classList.toggle('on', !!carried);
    this._gripBar.classList.toggle('on', !carried && !!carrying);
    if (carried) this._struggleFill.style.width = (p.struggle * 100) + '%';
    else if (carrying) this._gripFill.style.width = (p.grip * 100) + '%';
  }

  /** underwater/abyss screen darkening (0..1) */
  setDark(v) { this._dark.style.opacity = v; }

  // ---------- banner / countdown ----------
  showBanner(text, color, dur) {
    const el = $('#banner .txt'); el.textContent = text; el.style.color = color;
    el.style.animation = 'none'; void el.offsetWidth;
    el.style.animation = 'bpop .55s cubic-bezier(.2,1.5,.4,1) forwards'; this.bannerT = dur;
  }
  updateBanner(dt) {
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) { const el = $('#banner .txt'); el.style.animation = 'bout .3s forwards'; } }
  }

  countdown(seq, onDone) {
    const el = $('#countdown'), n = el.querySelector('.n'); el.classList.remove('hide');
    let i = 0;
    const step = () => {
      if (i >= seq.length) { el.classList.add('hide'); onDone && onDone(); return; }
      n.textContent = seq[i]; n.style.animation = 'none'; void n.offsetWidth;
      n.style.animation = 'cd .6s cubic-bezier(.2,1.5,.4,1)'; i++; setTimeout(step, 640);
    };
    step();
  }

  // ---------- results ----------
  showResults(ranked, win) {
    $('#champName').textContent = win.name; $('#champName').style.color = win.css;
    const list = $('#rankList'); list.innerHTML = '';
    const bg = ['linear-gradient(180deg,#ffe08a,#f0b52d)', 'linear-gradient(180deg,#e8edf5,#b9c3d6)', 'linear-gradient(180deg,#ffb583,#e0824a)', 'rgba(255,255,255,.12)'];
    ranked.forEach((p, i) => {
      const row = document.createElement('div'); row.className = 'rrow';
      row.innerHTML = `<span class="rk" style="background:${bg[i] || bg[3]}">${i + 1}</span><span class="dot" style="background:${p.css};color:${p.css}"></span><span>${p.name}${p.isBot ? ' <span style="opacity:.55;font-size:14px">봇</span>' : ''}</span><span class="sc">${p.score}</span>`;
      list.appendChild(row);
    });
    this.showScreen('results');
    this.game.fx.confetti($('#results'));
  }

  // ---------- buttons ----------
  _wireButtons() {
    const g = this.game;
    $('#goPlay').onclick = () => g.enterLobby();
    $('#joinBtn').onclick = () => {
      let v = ($('#joinInput').value || '').trim().toUpperCase();
      if (!v) { $('#joinInput').focus(); return; }
      if (!/^CAT-/.test(v)) v = 'CAT-' + v.replace(/[^0-9A-Z]/g, '').slice(0, 3);
      g.enterLobby(v); this.showBanner('방 ' + v + ' 입장!', '#ffd98a', 1.6);
    };
    $('#joinInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });
    $('#copyCode').onclick = () => {
      const c = $('#roomCode').textContent;
      navigator.clipboard && navigator.clipboard.writeText(c);
      const b = $('#copyCode'); b.textContent = '복사됨!'; setTimeout(() => b.textContent = '복사', 1200);
    };
    $('#goHow').onclick = () => this.showBanner('밀치고 던져서 떨어뜨려라!', '#fff', 2.4);
    $('#backHome').onclick = () => { g.state = 'home'; this.showScreen('home'); };
    $('#startGame').onclick = () => this.wipe(() => { g.match.buildPlayers(); g.match.startMatch(); });
    $('#resHome').onclick = () => this.wipe(() => { g.match.disposePlayers(); g.state = 'home'; this.showScreen('home'); });
    $('#resAgain').onclick = () => this.wipe(() => { g.players.forEach(p => p.body.setEnabled(true)); g.match.startMatch(); });
  }
}
