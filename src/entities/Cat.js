import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BODY, ANIM, BONEMAP } from '../config.js';

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
    this._mapBones(inner);
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
    this.legs = []; this.frontLegs = []; this.backLegs = []; this.head = null;
    const spec = this.boneSpec;
    const bones = [];
    inner.traverse(o => { if (o.isBone) bones.push(o); });

    // 1) role tagging by the model's declared name patterns
    for (const o of bones) {
      if (spec.frontLeg.test(o.name)) { this.legs.push(o); this.frontLegs.push(o); }
      else if (spec.backLeg.test(o.name)) { this.legs.push(o); this.backLegs.push(o); }
      else if (!this.head && spec.head.test(o.name)) this.head = o;
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
  }

  /* Drive the visual from a semantic pose STATE (not a positional arg list) so
     new/swapped models just consume the same fields:
       { speed, onGround, grabbed, flail, rear, punch, kick, slide, cheer } (all 0..1 except bools).
     Clip layer (walk/sit) first, then procedural bone poses layered on top. */
  updateAnimation(dt, s) {
    const speed = s.speed || 0, onGround = !!s.onGround;
    const flail = s.flail || 0, rear = s.rear || 0;
    const punch = s.punch || 0, kick = s.kick || 0, slide = s.slide || 0, cheer = s.cheer || 0;
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

    // PUNCH (주먹치기) — lead paw swings forward in the sagittal plane (no head
    // wobble, no wild twist — a clean straight jab)
    if (punch > 0.02 && fl.length) {
      const sw = Math.sin(Math.min(1, punch) * Math.PI);   // 0→1→0 over the swing
      this._rot(fl[0], -1.35 * sw, 0, 0);
    }

    // FLYING KICK (날라차기) — front paws thrust forward, hind legs kick back
    if (kick > 0.02 && fl.length) {
      for (const leg of fl) this._rot(leg, -1.5 * kick, 0, 0);
      for (const leg of bl) this._rot(leg, 0.8 * kick, 0, 0);
    }

    // SLIDE (슬라이딩) — low tackle, front paws reach forward flat
    if (slide > 0.02 && fl.length) {
      for (const leg of fl) this._rot(leg, -1.0 * slide, 0, 0);
    }

    // VICTORY CHEER — both paws thrown up high (만세) and opened/closed together
    if (cheer > 0.02 && fl.length) {
      const wv = Math.sin(t * 7);
      for (let i = 0; i < fl.length; i++) {
        const side = i === 0 ? 1 : -1;
        this._rot(fl[i], (-1.7 + wv * 0.35) * cheer, 0, side * (0.35 + wv * 0.35) * cheer);
      }
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
  }

  _rot(bone, x, y, z) {
    this._e.set(x, y, z);
    bone.quaternion.multiply(this._q.setFromEuler(this._e));
  }
}
