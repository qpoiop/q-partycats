import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BODY, ANIM } from '../config.js';

/* ============================================================
   Cat — one character's visual: a team-tinted clone of the cat
   glTF, normalised to a fixed height, plus an animation controller.

   Naturalness fix: the Walking clip's playback speed now tracks
   the body's real ground speed (timeScale = speed / refSpeed),
   so paws stop sliding, and idle/walk cross-fade by speed instead
   of the prototype's disconnected fixed timeScale.
   ============================================================ */
export class Cat {
  constructor(proto, hex) {
    this.fallback = proto.fallback;
    const inner = SkeletonUtils.clone(proto.scene);
    this._tint(inner, hex);

    const holder = new THREE.Group();
    holder.add(inner);
    this._normalise(holder);
    this.model = holder;

    this.mixer = new THREE.AnimationMixer(inner);
    this.clips = {};
    (proto.animations || []).forEach(a => { this.clips[a.name] = this.mixer.clipAction(a); });

    this.walk = this.clips['Walking'];
    this.sit = this.clips['Sitting'];
    if (this.walk) { this.walk.play(); this.walk.setEffectiveWeight(0); }
    if (this.sit) { this.sit.play(); this.sit.setEffectiveWeight(0); }
    this._bob = 0;

    // bone refs for procedural motion (the model IS rigged — use it)
    this.legs = []; this.head = null; this.tail = [];
    inner.traverse(o => {
      if (!o.isBone) return;
      if (o.name.indexOf('fingers') === 0) this.legs.push(o);   // the 4 legs (root→paw)
      else if (o.name === 'head1_019') this.head = o;
    });
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
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
    // the idle/sit pose shifts the body ~0.4 behind the bind centre → nudge it
    // forward so the body sits over the selection ring & shadow.
    holder.position.z += 0.4;
  }

  updateAnimation(dt, speed, onGround, grabbed, flail = 0) {
    this.mixer.update(dt);
    if (this.walk) {
      // cross-fade idle → walk by speed; airborne keeps a faint paddle
      let w;
      if (!onGround) w = 0.15;
      else w = THREE.MathUtils.clamp((speed - ANIM.idleSpeed) / (ANIM.walkBlendSpeed - ANIM.idleSpeed), 0, 1);
      this.walk.setEffectiveWeight(w);
      // stride tracks real velocity → no foot sliding
      this.walk.timeScale = onGround
        ? THREE.MathUtils.clamp(speed / ANIM.refSpeed, ANIM.timeScaleMin, ANIM.timeScaleMax)
        : 0.5;
    }
    if (this.sit) {
      this.sit.setEffectiveWeight(onGround && speed < ANIM.idleSpeed && !grabbed && flail < 0.05 ? 0.7 : 0);
    }
    // procedural limb flail on TOP of the clip pose (knocked / teetering /
    // grabbed) — the rigged legs kick and the head lolls, so it's not a rigid
    // spinning blob. Applied after mixer.update so it layers over the clip.
    if (flail > 0.02 && this.legs.length) {
      const t = performance.now() * 0.001;
      for (let i = 0; i < this.legs.length; i++) {
        const ph = i * 1.9;
        this._e.set(Math.sin(t * 17 + ph) * 1.2 * flail, Math.sin(t * 11 + ph) * 0.5 * flail, Math.cos(t * 14 + ph) * 0.9 * flail);
        this.legs[i].quaternion.multiply(this._q.setFromEuler(this._e));
      }
      if (this.head) {
        this._e.set(Math.sin(t * 10) * 0.5 * flail, Math.sin(t * 8) * 0.5 * flail, 0);
        this.head.quaternion.multiply(this._q.setFromEuler(this._e));
      }
    }
  }
}
