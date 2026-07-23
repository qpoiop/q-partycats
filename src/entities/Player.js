import * as THREE from 'three';
import { BODY, MOVE, ANIM, GRAB, KNOCKDOWN } from '../config.js';
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
      new THREE.RingGeometry(0.64, 0.82, 32),
      new THREE.MeshBasicMaterial({ color: t.hex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.03;
    this.group.add(this.ring);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.74, 24),
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
    this.grabbing = null; this.grabbedBy = null; this.grabCd = 0;
    this.grip = 0;        // grabber: remaining grip (drains → break)
    this.struggle = 0;    // victim: escape meter (fills by mashing → break)
    this.tumble = 0; this.tumbleAxis = new THREE.Vector3(1, 0, 0); this.squash = 0;
    this.knockdown = 0;   // >0 = downed: can't act, must get up
    this.falling = false; this._splashed = false;
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
    const impact = Math.hypot(ix, iz) / this.mass();   // horizontal Δspeed
    if (impact >= KNOCKDOWN.threshold) {
      // solid hit → knocked down (tumbles, can't act, gets up after a delay)
      this.knockdown = Math.min(KNOCKDOWN.maxTime, KNOCKDOWN.minTime + (impact - KNOCKDOWN.threshold) * KNOCKDOWN.perSpeed);
      this.tumble = 1;
      if (axis) this.tumbleAxis.copy(axis).normalize();
      else this.tumbleAxis.set(iz, 0.2, -ix).normalize();
      if (this.grabbing) this.game.actions.releaseGrab(this);
      if (this.grabbedBy) this.game.actions.releaseGrab(this.grabbedBy);
    } else if (tumble > 0) {
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

    // being carried: physical spring pull toward the grabber's hold point
    if (this.grabbedBy) { this._carriedTick(dt); return; }

    this.onGround = this.game.physics.grounded(this.body, FOOT + 0.18);

    // sudden-death storm: shoved outward if caught outside the shrinking safe zone
    if (this.game.state === 'playing' && this.game.safeRadius < this.game.ARENA.radius) {
      const t = this.pos(), d = Math.hypot(t.x, t.z), over = d - this.game.safeRadius;
      if (over > 0) {
        const nx = t.x / (d || 1), nz = t.z / (d || 1), v = this.vel();
        const target = 3 + over * 3, outV = v.x * nx + v.z * nz;
        if (outV < target) { const add = target - outV; this.body.setLinvel(V(v.x + nx * add, v.y, v.z + nz * add), true); }
      }
    }

    // timers
    if (this.knockTimer > 0) this.knockTimer -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.dashTimer > 0) this.dashTimer -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.grabCd > 0) this.grabCd -= dt;
    if (this.knockdown > 0) this.knockdown -= dt;
    // grabber: grip drains over time, faster while the victim struggles
    if (this.grabbing) {
      this.grip -= (GRAB.gripDrainBase + GRAB.gripDrainStruggle * this.grabbing.struggle) * dt;
      if (this.grip <= 0 || !this.grabbing.alive) { this.game.actions.breakFree(this); }
    }

    // air drag on a flung cat → it arcs down and lands instead of flying straight
    if (!this.onGround && (this.knockTimer > 0 || this.knockdown > 0)) {
      const v = this.vel(), k = Math.max(0, 1 - MOVE.airDrag * dt);
      this.body.setLinvel(V(v.x * k, v.y, v.z * k), true);
    }

    const downed = this.knockdown > 0;
    const steerable = !downed && this.knockTimer <= 0 && this.dashTimer <= 0 && !this.slamming;
    if (steerable) this._steer(dt);
    else if (downed && this.onGround) {
      // lying on the ground → grind to a stop (no steering fighting contacts)
      const v = this.vel(), sp = Math.hypot(v.x, v.z);
      if (sp > 0.01) { const dec = Math.min(sp, MOVE.frictionDecel * 0.7 * dt); const k = (sp - dec) / sp; this.body.setLinvel(V(v.x * k, v.y, v.z * k), true); }
    }

    if (this.dashTimer > 0) {
      if (Math.random() < 0.5) this.game.fx.dust(this.pos(), this.hex, 2, 0.4);
      this._dashStrike();
    }
  }

  /** Victim carried by a grabber: pulled to the hold point by a
      critically-damped spring (stays dynamic → collides with the world). */
  _carriedTick(dt) {
    const g = this.grabbedBy;
    if (!g || !g.alive) { this.grabbedBy = null; return; }
    const gp = g.pos();
    const hx = gp.x + Math.sin(g.facing) * GRAB.holdDist;
    const hz = gp.z + Math.cos(g.facing) * GRAB.holdDist;
    const hy = gp.y + GRAB.holdHeight;
    const p = this.pos(), v = this.vel(), m = this.mass();
    let ax = (hx - p.x) * GRAB.spring - v.x * GRAB.damp;
    let ay = (hy - p.y) * GRAB.spring - v.y * GRAB.damp;
    let az = (hz - p.z) * GRAB.spring - v.z * GRAB.damp;
    const al = Math.hypot(ax, ay, az);
    if (al > GRAB.maxForce) { const k = GRAB.maxForce / al; ax *= k; ay *= k; az *= k; }
    this.body.applyImpulse(V(ax * m * dt, ay * m * dt, az * m * dt), true);
    this.struggle = Math.max(0, this.struggle - GRAB.struggleDecay * dt);
    this.faceTarget = g.facing + Math.PI;
    this.onGround = false;
    if (this.struggle >= GRAB.struggleMax) this.game.actions.breakFree(g);
  }

  /** Victim mashing to escape (from Input while carried, or Bot). */
  addStruggle(amount) { if (this.grabbedBy) this.struggle = Math.min(GRAB.struggleMax, this.struggle + amount); }

  /* Velocity-target steering with bounded acceleration. */
  _steer(dt) {
    const v = this.vel();
    const m = this.mass();
    if (this.moveMag > 0.05) {
      const carry = this.grabbing ? GRAB.carrySpeedMul : 1;
      const targetSpeed = (this.onGround ? MOVE.speed : MOVE.airSpeed) * carry * Math.min(1, this.moveMag);
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

    const A = this.game.ARENA;
    if (menu) {
      if (t.y < A.menuKillY) { this.game.match.respawnMenu(this); return; }
    } else {
      // combat: doomed the instant we drop past the platform edge — round
      // resolves now, but the body keeps plunging into the abyss for drama.
      if (this.alive && t.y < A.doomY) { this.game.match.eliminate(this); }
      if (!this.alive && this.falling) {
        if (!this._splashed && t.y < A.waterY) { this._splashed = true; this.game.fx.splash(t); }
        if (t.y < A.waterY) {
          // submerged: water drag → slow, steady sink into the abyss (~3-4s)
          const v = this.vel();
          const k = Math.min(1, dt * A.sinkDrag);
          this.body.setLinvel(V(v.x * (1 - k), v.y + (-8 - v.y) * k, v.z * (1 - k)), true);
        }
        if (t.y < A.hideY) {
          this.body.setEnabled(false); this.group.visible = false; this.shadow.visible = false;
          this.falling = false; this._splashed = false;
          return;
        }
      }
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
    if (this.knockdown > 0) {
      // downed → lie on the ground (getup roll plays when knockdown ends)
      this.tilt.rotation.set(0, 0, 0);
      this.tilt.rotateOnAxis(this.tumbleAxis, Math.PI * 0.5);
      this.tumble = 1;
    } else if (this.tumble > 0) {
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
      // flail — amplitude scales with the struggle meter
      const now = performance.now(), amp = 0.28 + this.struggle * 0.7;
      this.tilt.rotation.z = Math.sin(now * 0.021) * 0.55 * amp;
      this.tilt.rotation.x = Math.sin(now * 0.017) * 0.34 * amp;
    } else if (this.grabbing) {
      this.tilt.rotation.x += (-0.16 - this.tilt.rotation.x) * Math.min(1, dt * 6); // lean back holding weight
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
