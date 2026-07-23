import * as THREE from 'three';
import { BODY, MOVE, ANIM } from '../config.js';
import { Cat } from './Cat.js';

const FOOT = BODY.footOffset;
const V = (x, y, z) => ({ x, y, z });

/* ============================================================
   Player — a character entity: Rapier body + gameplay state +
   Cat visual + selection ring + blob shadow.

   Movement controller (the "naturalness" fix): steers the body
   toward a *target velocity* with bounded acceleration for crisp,
   responsive control, while a short "knock window" after any hit
   pauses steering so knockbacks stay punchy and physical.
   ============================================================ */
export class Player {
  constructor(game, { idx, teamIdx, isBot, name, spawn }) {
    this.game = game;
    this.idx = idx;
    this.team = teamIdx;
    this.name = name;
    this.isBot = isBot;

    const t = game.teams[teamIdx];
    this.css = t.css; this.hex = t.hex;

    // visual
    this.cat = new Cat(game.assets.get('cat'), t.hex);
    this.group = new THREE.Group();
    this.tilt = new THREE.Group();
    this.tilt.add(this.cat.model);
    this.group.add(this.tilt);
    game.scene.add(this.group);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.66, 28),
      new THREE.MeshBasicMaterial({ color: t.hex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03;
    this.group.add(this.ring);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.58, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    game.scene.add(this.shadow);

    // physics body
    this.body = game.physics.createCharacterBody(spawn?.x || 0, BODY.restY, spawn?.z || 0);

    // gameplay state
    this.alive = true; this.score = 0;
    this.facing = 0; this.faceTarget = 0;
    this.moveDir = new THREE.Vector2(); this.moveMag = 0; this.onGround = true;
    this.dashCd = 0; this.dashTimer = 0; this.dashAir = false;
    this.invuln = 0; this.slamming = false; this.knockTimer = 0;
    this.grabbing = null; this.grabbedBy = null; this.grabTimer = 0; this.grabCd = 0; this.struggle = 0;
    this.tumble = 0; this.tumbleAxis = new THREE.Vector3(1, 0, 0); this.squash = 0;
    this.botTimer = 0; this.wanderA = Math.random() * 6.28;
  }

  // ---- convenience ----
  pos() { return this.body.translation(); }
  vel() { return this.body.linvel(); }
  mass() { return this.body.mass(); }
  faceVec() { return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)); }

  /** Apply an external knockback and open the knock window so the
      movement controller doesn't immediately cancel it. */
  hit(ix, iy, iz, { tumble = 0, axis = null } = {}) {
    this.body.applyImpulse(V(ix, iy, iz), true);
    this.knockTimer = MOVE.knockWindow;
    this.onGround = false;
    if (tumble > 0) {
      this.tumble = tumble;
      if (axis) this.tumbleAxis.copy(axis).normalize();
    }
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.game.scene.remove(this.shadow);
    this.game.physics.removeBody(this.body);
  }

  // ============================================================
  //  PRE-STEP — input → forces (runs once per frame, pre-physics)
  // ============================================================
  preStep(dt) {
    if (!this.alive) return;

    // being carried: follow grabber kinematically
    if (this.grabbedBy) {
      const g = this.grabbedBy, gp = g.pos(), dir = g.faceVec();
      const r = BODY.capRadius * 2.2;
      this.body.setNextKinematicTranslation(V(gp.x + dir.x * r, gp.y + 0.2, gp.z + dir.z * r));
      this.struggle += dt;
      this.faceTarget = g.facing + Math.PI;
      return;
    }

    this.onGround = this.game.physics.grounded(this.body, FOOT + 0.18);

    // timers
    if (this.knockTimer > 0) this.knockTimer -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.dashTimer > 0) this.dashTimer -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.grabCd > 0) this.grabCd -= dt;
    if (this.grabbing) { this.grabTimer -= dt; if (this.grabTimer <= 0 || !this.grabbing.alive) this.game.actions.releaseGrab(this); }

    const steerable = this.knockTimer <= 0 && this.dashTimer <= 0 && !this.slamming;
    if (steerable) this._steer(dt);

    if (this.dashTimer > 0) {
      if (Math.random() < 0.5) this.game.fx.dust(this.pos(), this.hex, 2, 0.4);
      this._dashStrike();
    }
  }

  /* Velocity-target steering with bounded acceleration. */
  _steer(dt) {
    const v = this.vel();
    const m = this.mass();
    if (this.moveMag > 0.05) {
      const targetSpeed = (this.onGround ? MOVE.speed : MOVE.airSpeed) * Math.min(1, this.moveMag);
      let dvx = this.moveDir.x * targetSpeed - v.x;
      let dvz = this.moveDir.y * targetSpeed - v.z;
      const accel = this.onGround ? MOVE.accelGround : MOVE.accelAir;
      const maxDv = accel * dt;
      const len = Math.hypot(dvx, dvz);
      if (len > maxDv) { const k = maxDv / len; dvx *= k; dvz *= k; }
      this.body.applyImpulse(V(dvx * m, 0, dvz * m), true); // impulse = m·Δv
      this.faceTarget = Math.atan2(this.moveDir.x, this.moveDir.y);
    } else if (this.onGround) {
      // ground friction → smooth stop
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0.01) {
        const dec = Math.min(sp, MOVE.frictionDecel * dt);
        const k = (sp - dec) / sp;
        this.body.setLinvel(V(v.x * k, v.y, v.z * k), true);
      }
    }
  }

  _dashStrike() {
    const me = this.pos();
    const reach = BODY.capRadius * 2 + 0.15;
    for (const o of this.game.players) {
      if (o === this || !o.alive || o.invuln > 0 || o.grabbedBy) continue;
      const op = o.pos();
      const dx = op.x - me.x, dz = op.z - me.z, d = Math.hypot(dx, dz);
      if (d < reach && d > 1e-3) {
        const nx = dx / d, nz = dz / d;
        const pw = this.dashAir ? this.game.ABIL.dashStrikeAir : this.game.ABIL.dashStrikeGround;
        const lift = this.dashAir ? this.game.ABIL.dashStrikeAirLift : 0.9;
        const om = o.mass();
        o.hit(nx * pw * om, lift * om, nz * pw * om,
          this.dashAir ? { tumble: 1, axis: new THREE.Vector3(nz, 0.3, -nx) } : {});
        this.dashTimer *= 0.4;
        this.game.fx.dust(op, this.hex, 10, 0.9);
        this.game.fx.shake(this.dashAir ? 0.6 : 0.3);
        if (o.grabbedBy) this.game.actions.releaseGrab(o.grabbedBy);
      }
    }
  }

  // ============================================================
  //  POST-STEP — resolve results (runs once per frame, post-physics)
  // ============================================================
  postStep(dt, menu) {
    const t = this.pos();
    if (this.slamming && this.onGround) { this.game.actions.slamHit(this); this.slamming = false; }

    if (t.y < this.game.ARENA.killY) {
      if (menu) { this.game.match.respawnMenu(this); return; }
      this.game.match.eliminate(this); return;
    }

    const rate = this.onGround ? MOVE.turnRateGround : MOVE.turnRateAir;
    let df = this.faceTarget - this.facing;
    while (df > Math.PI) df -= 6.283; while (df < -Math.PI) df += 6.283;
    this.facing += df * Math.min(1, dt * rate);
  }

  // ============================================================
  //  POSE — drive the visual from the body (once per frame)
  // ============================================================
  pose(dt) {
    const t = this.pos(), v = this.vel();
    this.group.position.set(t.x, t.y - FOOT, t.z);
    this.group.rotation.y = this.facing;

    this.squash += (0 - this.squash) * Math.min(1, dt * 8);
    let sx = 1, sy = 1;
    if (this.tumble > 0) {
      this.tumble = Math.max(0, this.tumble - dt * 1.1);
      this.tilt.rotation.set(0, 0, 0);
      this.tilt.rotateOnAxis(this.tumbleAxis, (1 - this.tumble) * Math.PI * 3.4);
    } else {
      const lvx = Math.cos(this.facing) * v.x - Math.sin(this.facing) * v.z;
      const lvz = Math.sin(this.facing) * v.x + Math.cos(this.facing) * v.z;
      this.tilt.rotation.x += (THREE.MathUtils.clamp(lvz * 0.05, -0.4, 0.4) - this.tilt.rotation.x) * Math.min(1, dt * 6);
      this.tilt.rotation.z += (THREE.MathUtils.clamp(-lvx * 0.05, -0.4, 0.4) - this.tilt.rotation.z) * Math.min(1, dt * 6);
      this.tilt.rotation.y += (0 - this.tilt.rotation.y) * Math.min(1, dt * 6);
      sy = 1 - this.squash; sx = 1 + this.squash * 0.5;
    }
    if (this.grabbedBy) {
      this.tilt.rotation.z = Math.sin(this.struggle * 22) * 0.4;
      this.tilt.rotation.x = Math.sin(this.struggle * 17) * 0.22;
    }
    this.tilt.scale.set(sx, sy, sx);

    const sp = Math.hypot(v.x, v.z);
    this.cat.updateAnimation(dt, sp, this.onGround, !!this.grabbedBy);
    // fallback stand-in has no clips → give it a little walk bob for life
    if (this.cat.fallback && this.tumble <= 0) {
      this.cat._bob += dt * (2 + sp * 2);
      this.cat.model.position.y = this.onGround ? Math.abs(Math.sin(this.cat._bob)) * Math.min(0.12, sp * 0.03) : 0;
    }

    const distC = Math.hypot(t.x, t.z);
    this.shadow.visible = distC <= this.game.ARENA.radius && t.y < 7;
    if (this.shadow.visible) {
      this.shadow.position.set(t.x, 0.04, t.z);
      const k = Math.max(0.3, 1 - (t.y - BODY.restY) / 6);
      this.shadow.scale.setScalar(k);
      this.shadow.material.opacity = 0.34 * k;
    }
    this.tilt.visible = this.invuln > 0 ? (Math.sin(performance.now() * 0.03) > 0) : true;
  }
}
