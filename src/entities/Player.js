import * as THREE from 'three';
import { BODY, MOVE, ANIM, GRAB, KNOCKDOWN, EDGE, ABIL } from '../config.js';
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
  constructor(game, { idx, teamIdx, isBot, name, spawn, slot, control }) {
    this.game = game;
    this.idx = idx;
    this.slot = slot ?? idx;          // network identity (stable across clients)
    this.control = control || (isBot ? 'bot' : 'local'); // local | remote | bot | net
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
    this.punchCd = 0; this.punching = 0; this.sliding = 0;
    this.invuln = 0; this.knockTimer = 0;
    this.grabbing = null; this.grabbedBy = null; this.grabCd = 0;
    this.grip = 0;        // grabber: remaining grip (drains → break)
    this.struggle = 0;    // victim: escape meter (fills by mashing → break)
    this.tumble = 0; this.tumbleAxis = new THREE.Vector3(1, 0, 0); this._axisH = new THREE.Vector3(1, 0, 0); this.squash = 0;
    this._leanX = 0; this._leanZ = 0;   // body-lean angular spring position…
    this._leanVX = 0; this._leanVZ = 0; // …and velocity (underdamped → wobble/overshoot)
    this._wasGround = true; this._prevVy = 0;   // landing-squash detection
    this._gait = 0;   // stride phase for the gait bob/weight-shift
    this._jumpT = 0;  // jump anticipation (crouch) timer
    this._koPose = 0; this._koSign = 1;   // knockdown flop ramp (smooth fall-over / get-up)
    this._mashPulse = 0;                  // struggle-mash flail spike (decays)
    this.knockdown = 0;   // >0 = downed: can't act, must get up
    this.teeter = 0; this._teetered = false;   // hanging/flailing at the ledge
    this.falling = false; this._splashed = false; this.celebrating = false;
    this.botTimer = 0; this.wanderA = Math.random() * 6.28;
  }

  // ---- convenience ----
  pos() { return this.body.translation(); }
  vel() { return this.body.linvel(); }
  mass() { return this.body.mass(); }
  faceVec() { return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)); }

  /** One step of the underdamped angular lean-spring (active-ragdoll wobble). */
  _springLean(pos, vel, target, dt) {
    const a = (target - this[pos]) * BODY.wobbleStiff - this[vel] * BODY.wobbleDamp;
    this[vel] += a * dt;
    this[pos] += this[vel] * dt;
  }

  /** Apply an external knockback and open the knock window so the
      movement controller doesn't immediately cancel it. */
  hit(ix, iy, iz, { tumble = 0, axis = null, stagger = false } = {}) {
    this.body.applyImpulse(V(ix, iy, iz), true);
    this.knockTimer = MOVE.knockWindow;
    this.onGround = false;
    const impact = Math.hypot(ix, iz) / this.mass();   // horizontal Δspeed
    // kick the lean-spring so the body jolts and wobbles from the blow
    const hmag = Math.hypot(ix, iz) || 1;
    const nfwd = (ix * Math.sin(this.facing) + iz * Math.cos(this.facing)) / hmag;
    const nside = (ix * Math.cos(this.facing) - iz * Math.sin(this.facing)) / hmag;
    this._leanVX += -nfwd * BODY.wobbleHitKick;
    this._leanVZ += nside * BODY.wobbleHitKick;
    // `stagger` = a light attack (punch): it pushes + staggers but never floors,
    // no matter how hard, so knockdowns are reserved for the heavy moves.
    if (impact >= KNOCKDOWN.threshold && !stagger) {
      // solid hit → knocked down (tumbles, can't act, gets up after a delay)
      this.knockdown = Math.min(KNOCKDOWN.maxTime, KNOCKDOWN.minTime + (impact - KNOCKDOWN.threshold) * KNOCKDOWN.perSpeed);
      this._koSign = ix >= 0 ? 1 : -1;   // flop in the direction of the blow
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

    // teetering on the lip: hang, flail, scramble inward (may recover)
    if (this.teeter > 0) {
      this.teeter -= dt;
      const t = this.pos(), v = this.vel(), d = Math.hypot(t.x, t.z) || 1;
      const nx = -t.x / d, nz = -t.z / d;
      this.body.setLinvel(V(v.x * 0.55 + nx * EDGE.teeterRecover * dt * 6, Math.max(v.y, -1.6), v.z * 0.55 + nz * EDGE.teeterRecover * dt * 6), true);
      this.onGround = false;
      if (this.knockTimer > 0) this.knockTimer -= dt;
      if (d < this.game.ARENA.radius - 0.3) this.teeter = 0;   // scrambled back to safety
      return;
    }

    this.onGround = this.game.physics.grounded(this.body, FOOT + 0.18);
    // landing squash: touching down after a fall pops a compress-and-recover
    // (scaled by how hard we hit) → jumps/plunges land with weight, not a snap.
    if (this.onGround && !this._wasGround && this._prevVy < -4 && this.knockdown <= 0) {
      this.squash = Math.min(0.45, -this._prevVy * 0.035);
    }
    this._wasGround = this.onGround;
    this._prevVy = this.vel().y;

    // timers
    if (this.knockTimer > 0) this.knockTimer -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.dashTimer > 0) this.dashTimer -= dt;
    if (this.punchCd > 0) this.punchCd -= dt;
    if (this.punching > 0) {
      this.punching -= dt;
      // land the hit mid-swing (after the wind-up), not on the button press
      if (!this._punchDone && this.punching <= ABIL.punchTime * (1 - ABIL.punchStrikeFrac)) {
        this._punchDone = true; this.game.actions.punchStrike(this);
      }
    }
    if (this.sliding > 0) this.sliding -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.grabCd > 0) this.grabCd -= dt;
    if (this.knockdown > 0) this.knockdown -= dt;
    if (this._mashPulse > 0) this._mashPulse = Math.max(0, this._mashPulse - dt * 4.5);
    // jump anticipation: hold a crouch, then launch (springy, not instant)
    if (this._jumpT > 0) {
      this._jumpT -= dt;
      this.squash = ABIL.jumpCrouch;   // compress before the leap
      if (this._jumpT <= 0) this.game.actions.jumpLaunch(this);
    }
    // grabber: grip drains over time, faster while the victim struggles
    if (this.grabbing) {
      this.grip -= (GRAB.gripDrainBase + GRAB.gripDrainStruggle * this.grabbing.struggle) * dt;
      if (this.grip <= 0 || !this.grabbing.alive) { this.game.actions.breakFree(this); }
    }

    // air drag on a flung cat → it arcs down and lands instead of flying straight
    if (!this.onGround && (this.knockTimer > 0 || this.knockdown > 0)) {
      const v = this.vel(), k = Math.max(0, 1 - MOVE.airDrag * dt);
      this.body.setLinvel(V(v.x * k, v.y, v.z * k), true);
      // a hard launch (thrown / kicked / punched off) leaves a motion trail
      const sp = Math.hypot(v.x, v.z);
      if (sp > 5) this.game.fx.streak(this, { x: v.x / sp, z: v.z / sp });
    }

    const downed = this.knockdown > 0;
    const steerable = !downed && this.knockTimer <= 0 && this.dashTimer <= 0;
    if (steerable) {
      this._steer(dt);
      // press into another cat → physically shove them (Party-Animals grind)
      if (this.moveMag > 0.3 && this.onGround && !this.grabbedBy) this._grindShove(dt);
    }
    else if (downed && this.onGround) {
      // lying on the ground → grind to a stop (no steering fighting contacts)
      const v = this.vel(), sp = Math.hypot(v.x, v.z);
      if (sp > 0.01) { const dec = Math.min(sp, MOVE.frictionDecel * 0.7 * dt); const k = (sp - dec) / sp; this.body.setLinvel(V(v.x * k, v.y, v.z * k), true); }
    }

    if (this.dashTimer > 0) {
      if (Math.random() < 0.5) this.game.fx.dust(this.pos(), this.hex, 2, 0.4);
      // trail: lay a fading speed-streak each frame along the motion → afterimage
      const v = this.vel(), sp = Math.hypot(v.x, v.z);
      if (sp > 3) this.game.fx.streak(this, { x: v.x / sp, z: v.z / sp });
      this._dashStrike();
    }
  }

  /** Victim carried by a grabber: pulled to the hold point by a
      critically-damped spring (stays dynamic → collides with the world). */
  _carriedTick(dt) {
    const g = this.grabbedBy;
    if (!g || !g.alive) { this.grabbedBy = null; return; }
    const gp = g.pos();
    // tug: the hold point pulses inward on the grabber's yank → victim jerks closer
    const tug = Math.sin(performance.now() * 0.001 * GRAB.tugFreq) * 0.5 + 0.5;
    const hd = GRAB.holdDist - tug * GRAB.tugHold;
    const hx = gp.x + Math.sin(g.facing) * hd;
    const hz = gp.z + Math.cos(g.facing) * hd;
    const hy = gp.y + GRAB.holdHeight;
    const p = this.pos(), v = this.vel(), m = this.mass();
    let ax = (hx - p.x) * GRAB.spring - v.x * GRAB.damp;
    let ay = (hy - p.y) * GRAB.spring - v.y * GRAB.damp;
    let az = (hz - p.z) * GRAB.spring - v.z * GRAB.damp;
    const al = Math.hypot(ax, ay, az);
    if (al > GRAB.maxForce) { const k = GRAB.maxForce / al; ax *= k; ay *= k; az *= k; }
    this.body.applyImpulse(V(ax * m * dt, ay * m * dt, az * m * dt), true);
    this.struggle = Math.max(0, this.struggle - GRAB.struggleDecay * dt);
    if (this._mashPulse > 0) this._mashPulse = Math.max(0, this._mashPulse - dt * 4.5);   // mash spike decays (carried path skips preStep timers)
    this.faceTarget = g.facing + Math.PI;
    this.onGround = false;
    if (this.struggle >= GRAB.struggleMax) this.game.actions.breakFree(g);
  }

  /** Victim mashing to escape (from Input while carried, or Bot). Each mash also
      punches a flail spike (tactile "손맛") and, for the local player, a tiny shake. */
  addStruggle(amount) {
    if (!this.grabbedBy) return;
    this.struggle = Math.min(GRAB.struggleMax, this.struggle + amount);
    this._mashPulse = Math.min(1, this._mashPulse + GRAB.mashPulse);
    if (this === this.game.players[0]) this.game.fx.shake(0.05);
  }

  /* Force-based steering: a velocity spring, resolved by the physics solver.
     Because it's a force (not a velocity snap), momentum carries, contacts
     push back, and the more-committed cat wins a shove. */
  _steer(dt) {
    const v = this.vel(), m = this.mass();
    const gain = this.onGround ? MOVE.gain : MOVE.gainAir;
    if (this.moveMag > 0.05) {
      const carry = this.grabbing ? GRAB.carrySpeedMul : 1;
      const target = (this.onGround ? MOVE.speed : MOVE.airSpeed) * carry * Math.min(1, this.moveMag);
      const tx = this.moveDir.x * target, tz = this.moveDir.y * target;
      // impulse = m · gain · (targetVel − vel) · dt  → a spring toward target velocity
      this.body.applyImpulse(V((tx - v.x) * gain * m * dt, 0, (tz - v.z) * gain * m * dt), true);
      this.faceTarget = Math.atan2(this.moveDir.x, this.moveDir.y);
    } else if (this.onGround) {
      // coast to a stop (a brake force, not a hard velocity kill)
      this.body.applyImpulse(V(-v.x * MOVE.brake * m * dt, 0, -v.z * MOVE.brake * m * dt), true);
    }
  }

  _grindShove(dt) {
    const me = this.pos(), dx0 = this.moveDir.x, dz0 = this.moveDir.y;
    const reach = BODY.capRadius * 2 + 0.35;
    for (const o of this.game.players) {
      if (o === this || !o.alive || o.grabbedBy || o.invuln > 0) continue;
      const op = o.pos();
      const dx = op.x - me.x, dz = op.z - me.z, d = Math.hypot(dx, dz);
      if (d < reach && d > 1e-3) {
        const dot = (dx * dx0 + dz * dz0) / d;   // am I pushing toward them?
        if (dot > 0.5) {
          const push = MOVE.shove * this.moveMag * dot * o.mass() * dt;
          o.body.applyImpulse(V((dx / d) * push, 0, (dz / d) * push), true);
        }
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
        const A = this.game.ABIL;
        const sliding = this.sliding > 0;
        // slide = a low tackle that TRIPS (knockdown), air-dash = flying kick,
        // ground-dash = a plain shove.
        const pw = sliding ? A.slideStrike : this.dashAir ? A.dashStrikeAir : A.dashStrikeGround;
        const lift = sliding ? A.slideLift : this.dashAir ? A.dashStrikeAirLift : A.dashStrikeGroundLift;
        const om = o.mass();
        o.hit(nx * pw * om, lift * om, nz * pw * om,
          (this.dashAir || sliding) ? { tumble: 1, axis: new THREE.Vector3(nz, 0.3, -nx) } : {});
        this.dashTimer *= 0.4;
        this.game.fx.dust(op, this.hex, 10, 0.9);
        this.game.fx.shake(this.dashAir ? 0.6 : sliding ? 0.5 : 0.3);
        if (o.grabbedBy) this.game.actions.releaseGrab(o.grabbedBy);
      }
    }
  }

  // ============================================================
  //  POST-STEP — resolve results (runs once per frame, post-physics)
  // ============================================================
  postStep(dt, menu) {
    const t = this.pos();

    const A = this.game.ARENA;
    if (menu) {
      if (t.y < A.menuKillY) { this.game.match.respawnMenu(this); return; }
    } else {
      // catch the ledge: sliding off slowly → teeter (a hard shove skips it)
      if (this.alive && !this.onGround && this.teeter <= 0 && !this._teetered && !this.falling && t.y > A.doomY) {
        const d = Math.hypot(t.x, t.z);
        if (d > A.radius && d < A.radius + EDGE.teeterBand + 1) {
          const v = this.vel(), outV = (v.x * t.x + v.z * t.z) / (d || 1);
          if (outV < EDGE.teeterOutSpeed && v.y > -7) { this.teeter = EDGE.teeterTime; this._teetered = true; this.game.fx.dust(t, this.hex, 6, 0.5); }
        }
      }
      if (this.alive && Math.hypot(t.x, t.z) < A.radius - 2) this._teetered = false;   // safely inside → re-armed
      // combat: doomed the instant we drop past the platform edge — round
      // resolves now, but the body keeps plunging into the abyss for drama.
      if (this.alive && this.teeter <= 0 && t.y < A.doomY) { this.game.match.eliminate(this); }
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

    // victory: jump + wave the front paws (not just a spin)
    if (this.celebrating) {
      const now = performance.now() * 0.001;
      this.group.rotation.y = now * 1.1;                 // slow turn to show off
      const hop = Math.abs(Math.sin(now * 3.4));
      this.cat.model.position.y = hop * 0.75;            // clear jumps
      this.tilt.rotation.set(-1.1, 0, 0);               // stand upright on hind legs (만세)
      this.tilt.scale.set(1 + (1 - hop) * 0.14, 1 - (1 - hop) * 0.14, 1 + (1 - hop) * 0.14);
      this.cat.updateAnimation(dt, { speed: 0, onGround: true, cheer: 1 });
      this.shadow.visible = true;
      this.shadow.position.set(this.group.position.x, 0.04, this.group.position.z);
      this.shadow.scale.setScalar(1); this.shadow.material.opacity = 0.34;
      return;
    }

    this.squash += (0 - this.squash) * Math.min(1, dt * 8);
    this.cat.model.position.y = 0;   // default; branches (knockdown/fallback) may lift
    // knockdown ramp → flops over and gets up smoothly instead of snapping flat
    const koTarget = this.knockdown > 0 ? 1 : 0;
    this._koPose += (koTarget - this._koPose) * Math.min(1, dt * (koTarget ? 11 : 6));
    let sx = 1, sy = 1;
    if (this.teeter > 0) {
      // hanging on the lip → flail
      const now = performance.now() * 0.001;
      this.tilt.rotation.set(Math.sin(now * 22) * 0.3, 0, Math.sin(now * 30) * 0.5);
    } else if (this.grabbedBy) {
      // hauled up onto the hind legs, struggling (persistent lerp → stands tall,
      // no velocity-lean fighting it). Front-paw flail is layered in Cat.
      const now = performance.now(), amp = 0.3 + this.struggle * 0.7;
      this.tilt.rotation.x += (-1.2 - this.tilt.rotation.x) * Math.min(1, dt * 9);
      this.tilt.rotation.z = Math.sin(now * 0.02) * 0.5 * amp;
      this.tilt.rotation.y += (0 - this.tilt.rotation.y) * Math.min(1, dt * 6);
      sy = 1 - this.squash; sx = 1 + this.squash * 0.5;
    } else if (this.grabbing) {
      // standing tall on hind legs, holding the victim out in front
      this.tilt.rotation.x += (-1.15 - this.tilt.rotation.x) * Math.min(1, dt * 9);
      this.tilt.rotation.z += (0 - this.tilt.rotation.z) * Math.min(1, dt * 6);
      this.tilt.rotation.y += (0 - this.tilt.rotation.y) * Math.min(1, dt * 6);
      sy = 1 - this.squash; sx = 1 + this.squash * 0.5;
    } else if (this._koPose > 0.02) {
      // downed → FLOP onto the side (roll about the forward axis) and lift the
      // model by half its width so it lies flat ON the grass — no head-in-floor.
      // Ramped by _koPose so it topples over and rises smoothly, not a snap.
      const e = this._koPose;
      this.tilt.rotation.set(0, 0, (Math.PI * 0.5) * this._koSign * e);
      this.cat.model.position.y = 0.7 * e;
      this.tumble = 1;
    } else if (this.tumble > 0) {
      // a stagger/tip in the knock direction that rights itself — horizontal
      // axis only, capped, so it never flips head-first into the floor.
      this.tumble = Math.max(0, this.tumble - dt * (this.onGround ? 4.5 : 2.4));
      this._axisH.set(this.tumbleAxis.x, 0, this.tumbleAxis.z);
      if (this._axisH.lengthSq() < 1e-4) this._axisH.set(1, 0, 0);
      this._axisH.normalize();
      this.tilt.rotation.set(0, 0, 0);
      this.tilt.rotateOnAxis(this._axisH, Math.min(0.9, this.tumble * 0.9));
    } else if (this.sliding > 0) {
      // SLIDE — belly-low tackle, nose down, held for the slide window
      const s = Math.min(1, this.sliding / ABIL.slideTime);
      this.tilt.rotation.set(0, 0, 0);
      this.tilt.rotation.x = 0.75 * s;
      sy = 1 - this.squash; sx = 1 + this.squash * 0.5;
    } else if (this.dashAir && this.dashTimer > 0) {
      // FLYING KICK — clean lunge: lean back, legs thrust forward (Cat kick pose).
      // Override the velocity lean so it reads as a kick, not a tumble/roll.
      this.tilt.rotation.set(-0.7, 0, 0);
      sy = 1 - this.squash; sx = 1 + this.squash * 0.5;
    } else {
      // Persistent velocity-lean lives in _leanX/_leanZ; transient action offsets
      // (strain, punch lunge) are added on top and the body rotation is set
      // ABSOLUTELY — so the offsets never compound frame-to-frame into a faceplant.
      const lvx = Math.cos(this.facing) * v.x - Math.sin(this.facing) * v.z;
      const lvz = Math.sin(this.facing) * v.x + Math.cos(this.facing) * v.z;
      // underdamped angular spring → the body overshoots and jiggles to a stop
      // (weighty, Party-Animals-y) instead of snapping to the target lean.
      this._springLean('_leanX', '_leanVX', THREE.MathUtils.clamp(lvz * 0.05, -0.4, 0.4), dt);
      this._springLean('_leanZ', '_leanVZ', THREE.MathUtils.clamp(-lvx * 0.05, -0.4, 0.4), dt);
      let ox = this._leanX, oz = this._leanZ;
      if (this.moveMag > 0.5 && this.onGround) {
        const blocked = Math.max(0, 1 - Math.hypot(v.x, v.z) / (MOVE.speed * 0.55));
        ox += 0.42 * blocked;   // strain-lean into a shove
      }
      if (this.punching > 0) ox += 0.35 * Math.sin(Math.min(1, this.punching / ABIL.punchTime) * Math.PI);   // jab lunge
      // GAIT: bob + weight-shift with the stride so it walks with weight (not gliding)
      const gsp = Math.hypot(v.x, v.z);
      if (this.onGround && gsp > 0.5) {
        this._gait += dt * BODY.gaitFreq * gsp;
        const sf = Math.min(1, gsp / MOVE.speed);
        this.cat.model.position.y = Math.abs(Math.sin(this._gait)) * BODY.gaitBounce * sf;
        oz += Math.sin(this._gait * 0.5) * BODY.gaitRoll * sf;   // rock side to side
      }
      this.tilt.rotation.set(ox, 0, oz);
      sy = 1 - this.squash; sx = 1 + this.squash * 0.5;
    }
    this.tilt.scale.set(sx, sy, sx);

    const sp = Math.hypot(v.x, v.z);
    // body turn rate (rad/s) → drives head secondary motion (lag)
    let df2 = this.facing - (this._prevFacing ?? this.facing);
    while (df2 > Math.PI) df2 -= 6.283; while (df2 < -Math.PI) df2 += 6.283;
    this._turnRate = df2 / Math.max(dt, 1e-3);
    this._prevFacing = this.facing;
    const rear = (this.grabbedBy || this.grabbing) ? 1 : 0;   // stand on hind legs to grab/struggle
    // knocked down → limp ragdoll (loose settle), NOT energetic flail
    const flail = this.grabbedBy ? Math.min(1.4, 0.4 + this.struggle * 0.6 + this._mashPulse * 0.6) : this.teeter > 0 ? 1 : this.knockdown > 0 ? 0 : this.tumble > 0 ? this.tumble : 0;
    this.cat.updateAnimation(dt, {
      speed: sp, onGround: this.onGround, grabbed: !!this.grabbedBy, flail, rear,
      punch: this.punching > 0 ? Math.min(1, this.punching / ABIL.punchTime) : 0,
      kick:  (this.dashAir && this.dashTimer > 0) ? Math.min(1, this.dashTimer / ABIL.dashTime) : 0,
      slide: this.sliding > 0 ? Math.min(1, this.sliding / ABIL.slideTime) : 0,
      pull:  this.grabbing ? (Math.sin(performance.now() * 0.001 * GRAB.tugFreq) * 0.5 + 0.5) : 0,
      turn:  this._turnRate,
      limp:  this._koPose,
    });
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
    this.tilt.visible = true;   // no i-frame flicker (it read as a bug during combat)
  }
}
