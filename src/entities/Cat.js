import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BODY, ANIM, BONEMAP, GRAB } from '../config.js';

/* ============================================================
   Cat — one character's visual: a team-tinted clone of the cat
   glTF, normalised to a fixed height, plus an animation controller.

   Naturalness fix: the Walking clip's playback speed now tracks
   the body's real ground speed (timeScale = speed / refSpeed),
   so paws stop sliding, and idle/walk cross-fade by speed instead
   of the prototype's disconnected fixed timeScale.
   ============================================================ */
export class Cat {
  constructor(proto, hex, boneSpec) {
    this.fallback = proto.fallback;
    this.boneSpec = boneSpec || BONEMAP[proto.modelId] || BONEMAP.cat;
    const inner = SkeletonUtils.clone(proto.scene);
    this._tint(inner, hex);

    const holder = new THREE.Group();
    holder.add(inner);
    this.model = holder;

    this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._hy = 0; this._hyV = 0;   // head-yaw secondary-motion spring (lag)
    this._ty = 0; this._tyV = 0;   // tail-sway secondary-motion spring
    this._mapBones(inner);
    this._mapGaitLegs(inner);
    this._normalise(holder);

    this.mixer = new THREE.AnimationMixer(inner);
    this.clips = {};
    (proto.animations || []).forEach(a => { this.clips[a.name] = this.mixer.clipAction(a); });

    this.walk = this.clips['Walking'];
    this.sit = this.clips['Sitting'];
    if (this.walk) { this.walk.play(); this.walk.setEffectiveWeight(0); }
    if (this.sit) { this.sit.play(); this.sit.setEffectiveWeight(0); }
    this._bob = 0;

  }

  /* Bone mapping — decoupled from any one model. Roles are tagged by the
     model's BONEMAP regexes (config), so adding/swapping a character is a
     config change, not a code change. A spatial heuristic is the last-resort
     fallback when the regexes tag nothing (best-effort; skips leaf `_end` bones
     which cluster and mislead). Procedural motion tolerates a partial map. */
  _mapBones(inner) {
    this.legs = []; this.frontLegs = []; this.backLegs = []; this.head = null; this.tail = [];
    const spec = this.boneSpec;
    const bones = [];
    inner.traverse(o => { if (o.isBone) bones.push(o); });

    // 1) role tagging by the model's declared name patterns
    for (const o of bones) {
      if (spec.frontLeg.test(o.name)) { this.legs.push(o); this.frontLegs.push(o); }
      else if (spec.backLeg.test(o.name)) { this.legs.push(o); this.backLegs.push(o); }
      else if (!this.head && spec.head.test(o.name)) this.head = o;
      else if (spec.tail && spec.tail.test(o.name)) this.tail.push(o);
    }
    if (this.frontLegs.length && this.backLegs.length && this.head) return;

    // 2) spatial best-effort fallback (unknown rig): the lowest non-leaf bones
    // are legs, split front/back by local Z; the highest non-leaf bone is head.
    const trunk = bones.filter(b => !/_end(_|$)/i.test(b.name));
    if (!trunk.length) return;
    const v = new THREE.Vector3(), pos = trunk.map(b => { b.getWorldPosition(v); return { b, y: v.y, z: v.z }; });
    const ys = pos.map(p => p.y).slice().sort((a, c) => a - c);
    const legCut = ys[Math.min(ys.length - 1, 3)];
    if (!this.legs.length) {
      const legBones = pos.filter(p => p.y <= legCut + 1e-3);
      const zMid = legBones.reduce((s, p) => s + p.z, 0) / (legBones.length || 1);
      for (const p of legBones) { this.legs.push(p.b); (p.z >= zMid ? this.frontLegs : this.backLegs).push(p.b); }
    }
    if (!this.head) this.head = pos.reduce((a, c) => (c.y > a.y ? c : a)).b;
  }

  /* Map the real limb chains (hip→knee→…→foot) for the procedural walk step.
     Each entry: { hip, knee, phase, isFront }. Trot gait pairs diagonals
     (FL+BR vs FR+BL) 180° out of phase. Classified by the foot's local pos. */
  _mapGaitLegs(inner) {
    this.gaitLegs = [];
    const spec = this.boneSpec;
    if (!spec.legRoot) return;
    inner.updateWorldMatrix(true, true);
    const wInv = this.model.matrixWorld.clone().invert();
    const v = new THREE.Vector3();
    inner.traverse(o => {
      if (!o.isBone || !spec.legRoot.test(o.name)) return;
      // walk the single-child chain to the foot
      let knee = null, cur = o, foot = o, depth = 0;
      while (true) { const k = cur.children.filter(c => c.isBone); if (k.length !== 1) break; cur = k[0]; depth++; if (depth === 1) knee = cur; foot = cur; }
      if (!knee) return;
      foot.getWorldPosition(v); v.applyMatrix4(wInv);
      const isFront = (o.getWorldPosition(new THREE.Vector3()).applyMatrix4(wInv).z) > -0.12;
      const isLeft = v.x < 0;
      const phase = ((isFront && isLeft) || (!isFront && !isLeft)) ? 0 : Math.PI;   // diagonal trot
      this.gaitLegs.push({ hip: o, knee, phase, isFront });
    });
  }

  _tint(inner, hex) {
    const team = new THREE.Color(hex);
    inner.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const mat = o.material.clone();
      mat.color = new THREE.Color(0xffffff);
      mat.roughness = 0.72; mat.metalness = 0;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTeam = { value: team };
        sh.fragmentShader = 'uniform vec3 uTeam;\n' + sh.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float _lum = dot(diffuseColor.rgb, vec3(0.299,0.587,0.114));
           float _m = smoothstep(0.86, 0.66, _lum) * (1.0 - smoothstep(0.30, 0.12, _lum));
           diffuseColor.rgb = mix(diffuseColor.rgb, uTeam * (0.5 + 0.7*_lum), _m);`,
        );
      };
      mat.customProgramCacheKey = () => 'team' + hex;
      o.material = mat;
    });
  }

  _normalise(holder) {
    holder.updateWorldMatrix(true, true);
    const measure = () => {
      const box = new THREE.Box3();
      holder.traverse(o => {
        if (o.isMesh && o.geometry) {
          o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox.clone();
          bb.applyMatrix4(o.matrixWorld);
          box.union(bb);
        }
      });
      return box;
    };
    let box = measure();
    const size = box.getSize(new THREE.Vector3());
    holder.scale.setScalar(BODY.visualHeight / size.y);
    holder.updateWorldMatrix(true, true);
    box = measure();
    const c = box.getCenter(new THREE.Vector3());
    holder.position.x -= c.x;
    holder.position.z -= c.z;
    holder.position.y -= box.min.y;
    // Centre the ring/shadow on the stance (paw centroid), not the mesh bbox
    // (the tail biases the bbox → ring drifts toward the head). Model-agnostic.
    if (this.legs && this.legs.length) {
      holder.updateWorldMatrix(true, true);
      const v = new THREE.Vector3(); let sx = 0, sz = 0;
      for (const leg of this.legs) { leg.getWorldPosition(v); sx += v.x; sz += v.z; }
      holder.position.x -= sx / this.legs.length;
      holder.position.z -= sz / this.legs.length;
    }
    // Base vertical offset (feet on the ground). pose() resets model.position.y
    // to this each frame and adds bob/hop on top — resetting to 0 (as it did)
    // wiped this offset and sank the lower body into the floor.
    this._baseY = holder.position.y;
  }

  /* Drive the visual from a semantic pose STATE (not a positional arg list) so
     new/swapped models just consume the same fields:
       { speed, onGround, grabbed, flail, rear, punch, kick, slide, cheer } (all 0..1 except bools).
     Clip layer (walk/sit) first, then procedural bone poses layered on top. */
  updateAnimation(dt, s) {
    const speed = s.speed || 0, onGround = !!s.onGround;
    const flail = s.flail || 0, rear = s.rear || 0;
    const punch = s.punch || 0, kick = s.kick || 0, slide = s.slide || 0, cheer = s.cheer || 0, pull = s.pull || 0, limp = s.limp || 0;
    const acting = punch + kick + slide + cheer;

    this.mixer.update(dt);
    if (this.walk) {
      let w;
      if (!onGround) w = 0.15;
      else w = THREE.MathUtils.clamp((speed - ANIM.idleSpeed) / (ANIM.walkBlendSpeed - ANIM.idleSpeed), 0, 1);
      this.walk.setEffectiveWeight(w);
      this.walk.timeScale = onGround
        ? THREE.MathUtils.clamp(speed / ANIM.refSpeed, ANIM.timeScaleMin, ANIM.timeScaleMax)
        : 0.5;
    }
    if (this.sit) {
      this.sit.setEffectiveWeight(onGround && speed < ANIM.idleSpeed && !s.grabbed && flail < 0.05 && acting < 0.05 ? 0.7 : 0);
    }

    const t = performance.now() * 0.001;
    const fl = this.frontLegs, bl = this.backLegs;

    // rear up on hind legs (grab / struggle) — front paws lift like hands
    if (rear > 0.02) for (const leg of fl) this._rot(leg, -1.25 * rear + Math.sin(t * 12) * 0.25 * rear, 0, 0);
    // grabber tug — yank the raised paws in on the pull beat (drags the victim)
    if (pull > 0.02) for (const leg of fl) this._rot(leg, -pull * GRAB.tugArm, 0, 0);

    // PUNCH (주먹치기) — cock the paw back (anticipation) then drive it forward
    // through the strike, then return. The wind-up is what sells the hit.
    if (punch > 0.02 && fl.length) {
      const phase = 1 - Math.min(1, punch);                       // 0→1 elapsed
      const cock = Math.max(0, 1 - phase / 0.3);                  // 1 at start → 0 by 30%
      const swing = Math.sin(THREE.MathUtils.clamp(phase / 0.8, 0, 1) * Math.PI);  // peaks at the strike frame
      this._rot(fl[0], 0.6 * cock - 1.6 * swing, 0, 0);           // back, then forward
      if (fl[1]) this._rot(fl[1], 0.3 * cock, 0, 0);              // off paw loads with the wind-up
    }

    // FLYING KICK (날라차기) — front paws thrust forward, hind legs kick back
    if (kick > 0.02 && fl.length) {
      for (const leg of fl) this._rot(leg, -1.5 * kick, 0, 0);
      for (const leg of bl) this._rot(leg, 0.8 * kick, 0, 0);
    }

    // SLIDE (슬라이딩) — superman dive: front paws stretch forward, hind legs
    // stretch back, all four extended along the flat prone body
    if (slide > 0.02) {
      for (const leg of fl) this._rot(leg, -1.5 * slide, 0, 0);
      for (const leg of bl) this._rot(leg, 1.1 * slide, 0, 0);
    }

    // AIRBORNE (jump) — tuck the legs so a leap reads as a leap, not a slide-up
    if (!onGround && acting < 0.05 && flail < 0.05 && limp < 0.05 && rear < 0.5 && !s.grabbed) {
      for (const leg of fl) this._rot(leg, -ANIM.airTuckFront, 0, 0);
      for (const leg of bl) this._rot(leg, ANIM.airTuckBack, 0, 0);
    }

    // VICTORY CHEER — both paws thrown up high (만세) and opened/closed together
    if (cheer > 0.02 && fl.length) {
      const wv = Math.sin(t * 7);
      for (let i = 0; i < fl.length; i++) {
        const side = i === 0 ? 1 : -1;
        this._rot(fl[i], (-1.7 + wv * 0.35) * cheer, 0, side * (0.35 + wv * 0.35) * cheer);
      }
    }

    // KNOCKED-OUT LIMP (active-ragdoll phase 3): loose limbs sprawl and settle
    // with a heavy low-frequency jiggle, head/tail droop — reads limp, not flailing.
    if (limp > 0.05) {
      for (let i = 0; i < this.legs.length; i++) {
        this._rot(this.legs[i], Math.sin(t * 3 + i * 1.7) * 0.18 * limp, 0, (i % 2 ? 1 : -1) * ANIM.limpLegSplay * limp + Math.sin(t * 2.3 + i) * 0.12 * limp);
      }
      if (this.head) this._rot(this.head, (ANIM.limpHeadLoll + Math.sin(t * 2.4) * 0.1) * limp, 0, 0);
      if (this.tail.length) this._rot(this.tail[0], ANIM.limpTailDroop * limp, Math.sin(t * 1.8) * 0.15 * limp, 0);
    }

    // procedural limb flail (knocked / teetering / struggling)
    if (flail > 0.02 && this.legs.length) {
      const set = rear > 0.5 ? fl : this.legs;   // reared → only front paws flail (grappling)
      for (let i = 0; i < set.length; i++) {
        const ph = i * 1.9;
        this._rot(set[i], Math.sin(t * 17 + ph) * 1.2 * flail, Math.sin(t * 11 + ph) * 0.5 * flail, Math.cos(t * 14 + ph) * 0.9 * flail);
      }
      if (this.head) this._rot(this.head, Math.sin(t * 10) * 0.5 * flail, Math.sin(t * 8) * 0.5 * flail, 0);
    }

    // PROCEDURAL WALK STEP — swing the real hip chains and bend the knees in a
    // trot, so the legs actually step (with a knee!) instead of gliding.
    if (this.gaitLegs && this.gaitLegs.length && s.stride != null && onGround &&
        speed > ANIM.idleSpeed && acting < 0.05 && flail < 0.05 && limp < 0.05 && rear < 0.5 && !s.grabbed) {
      const amp = Math.min(1, speed / ANIM.refSpeed);
      for (const L of this.gaitLegs) {
        const ph = s.stride + L.phase;
        const swing = Math.sin(ph);
        const lift = Math.max(0, Math.sin(ph));
        this._rot(L.hip, swing * ANIM.legSwing * amp, 0, 0);
        this._rot(L.knee, -lift * ANIM.kneeBend * amp, 0, 0);
      }
    }

    // SECONDARY MOTION (active-ragdoll phase 2): during ordinary locomotion the
    // head lags the body's turn (spring) and bobs with the stride → alive, not stiff.
    if (this.head && acting < 0.05 && flail < 0.05 && rear < 0.5 && limp < 0.05) {
      const tgtYaw = -THREE.MathUtils.clamp((s.turn || 0) * ANIM.headYawGain, -0.5, 0.5);
      const acc = (tgtYaw - this._hy) * ANIM.headLagStiff - this._hyV * ANIM.headLagDamp;
      this._hyV += acc * dt; this._hy += this._hyV * dt;
      const bob = (onGround && speed > ANIM.idleSpeed) ? Math.sin(t * (8 + speed)) * ANIM.headBob * Math.min(1, speed / ANIM.refSpeed) : 0;
      this._rot(this.head, bob, this._hy, 0);
    }

    // tail sway (secondary motion) — lazy idle swish that swings out on turns
    if (this.tail.length && flail < 0.05 && limp < 0.05) {
      const move = (onGround && speed > ANIM.idleSpeed) ? Math.sin(t * (5 + speed)) * ANIM.tailBob * Math.min(1, speed / ANIM.refSpeed) : 0;
      const tgt = THREE.MathUtils.clamp((s.turn || 0) * ANIM.tailTurnGain, -0.2, 0.2) + Math.sin(t * 1.3) * ANIM.tailIdle + move;
      this._tyV += ((tgt - this._ty) * ANIM.tailStiff - this._tyV * ANIM.tailDamp) * dt;
      this._ty += this._tyV * dt;
      this._rot(this.tail[0], 0, this._ty, 0);
    }
  }

  _rot(bone, x, y, z) {
    this._e.set(x, y, z);
    bone.quaternion.multiply(this._q.setFromEuler(this._e));
  }
}
