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
  }

  updateAnimation(dt, speed, onGround, grabbed) {
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
      this.sit.setEffectiveWeight(onGround && speed < ANIM.idleSpeed && !grabbed ? 0.7 : 0);
    }
  }
}
