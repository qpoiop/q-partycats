import { ARENA, BODY, BOT_NAMES, MATCH } from '../config.js';
import { Player } from '../entities/Player.js';

const V = (x, y, z) => ({ x, y, z });

/* ============================================================
   Match — match/round lifecycle: roster building, spawns,
   countdown, elimination, scoring, best-of-N rounds, results.
   ============================================================ */
export class Match {
  constructor(game) {
    this.game = game;
    this.roundNum = 1;
    this.roundActive = false;
    this.roundEndTimer = 0;
  }

  _spawnRingPos(i, total) { const a = (i / total) * 6.28 + 0.3, r = ARENA.radius * 0.55; return { x: Math.cos(a) * r, z: Math.sin(a) * r }; }

  buildPlayers() {
    this.disposePlayers();
    const g = this.game;
    const h = g.humanColor;
    const order = [h, ...[0, 1, 2, 3].filter(c => c !== h)];
    for (let i = 0; i < g.config.count; i++) {
      g.players.push(new Player(g, {
        idx: i, teamIdx: order[i], isBot: i > 0,
        name: i > 0 ? BOT_NAMES[(i * 2) % BOT_NAMES.length] : '나',
      }));
    }
  }

  disposePlayers() {
    this.game.players.forEach(p => p.dispose());
    this.game.players.length = 0;
  }

  placeAll() {
    const RB = this.game.physics.RAPIER.RigidBodyType;
    const players = this.game.players, total = players.length;
    players.forEach((p, i) => {
      const sp = this._spawnRingPos(i, total);
      p.body.setEnabled(true);
      p.body.setBodyType(RB.Dynamic, true);
      p.body.setTranslation(V(sp.x, BODY.restY, sp.z), true);
      p.body.setLinvel(V(0, 0, 0), true);
      p.alive = true; p.falling = false; p.dashCd = 0; p.dashTimer = 0; p.invuln = 0; p.slamming = false;
      p.grabbing = null; p.grabbedBy = null; p.tumble = 0; p.squash = 0; p.knockTimer = 0;
      p.facing = Math.atan2(-sp.x, -sp.z); p.faceTarget = p.facing;
      p.group.visible = true; p.moveMag = 0; p.moveDir.set(0, 0);
    });
  }

  startMatch() {
    this.roundNum = 1;
    this.game.players.forEach(p => p.score = 0);
    this.game.state = 'playing';
    this.game.ui.showScreen('playing');
    this.game.ui.buildHUD();
    this.startRound();
  }

  startRound() {
    this.placeAll();
    this.game.ui.updateHUD();
    this.game.ui.roundTag(`ROUND ${this.roundNum} / ${this.game.config.rounds}`);
    this.roundActive = false;
    this.game.state = 'countdown';
    this.game.ui.countdown(['3', '2', '1', 'FIGHT!'], () => {
      this.roundActive = true; this.game.state = 'playing';
    });
  }

  eliminate(p) {
    if (!p.alive) return;
    p.alive = false;
    const a = this.game.actions;
    if (p.grabbing) a.releaseGrab(p);
    if (p.grabbedBy) a.releaseGrab(p.grabbedBy);
    // don't freeze — let the body tumble into the abyss (Player hides it at abyssY)
    p.falling = true;
    p.tumble = 1; p.tumbleAxis.set(Math.random() - 0.5, 0.15, Math.random() - 0.5).normalize();
    this.game.fx.flash(0.3); this.game.fx.shake(0.6);
    this.game.ui.showBanner(`${p.name} 아웃!`, p.css, 0.9);
    this.game.ui.updateHUD();
    this._checkRoundEnd();
  }

  respawnMenu(p) {
    const a = this.game.actions;
    if (p.grabbing) a.releaseGrab(p);
    if (p.grabbedBy) a.releaseGrab(p.grabbedBy);
    const ang = Math.random() * 6.28, r = ARENA.radius * 0.4;
    p.body.setTranslation(V(Math.cos(ang) * r, BODY.restY + 3, Math.sin(ang) * r), true);
    p.body.setLinvel(V(0, 0, 0), true); p.tumble = 0.6;
  }

  _checkRoundEnd() {
    if (this.roundEndTimer > 0) return;
    const alive = this.game.players.filter(p => p.alive);
    if (alive.length <= 1) {
      this.roundActive = false;
      const w = alive[0];
      if (w) w.score++;
      this.game.ui.updateHUD();
      this.roundEndTimer = MATCH.roundEndDelay;
      setTimeout(() => {
        if (w) this.game.ui.showBanner(`${w.name} 라운드 승리!`, w.css, 1.8);
        else this.game.ui.showBanner('무승부!', '#fff', 1.8);
      }, 450);
    }
  }

  update(dt) {
    if (this.roundEndTimer > 0) {
      this.roundEndTimer -= dt;
      if (this.roundEndTimer <= 0) this._nextRoundOrEnd();
    }
    this.game.ui.updateCooldowns();
  }

  _nextRoundOrEnd() {
    this.roundEndTimer = 0;
    if (this.roundNum >= this.game.config.rounds) this.endMatch();
    else { this.roundNum++; this.startRound(); }
  }

  endMatch() {
    this.game.state = 'results';
    this.game.players.forEach(p => { if (p.alive) p.body.setEnabled(false); });
    const ranked = [...this.game.players].sort((a, b) => b.score - a.score);
    this.game.ui.showResults(ranked, ranked[0]);
  }
}
