import * as THREE from 'three';
import { PHYSICS } from '../config.js';

/* ============================================================
   Effects — pooled particle/impact juice: dust bursts, shock
   rings, dash streaks, screen shake, flash, and DOM confetti.
   Camera reads `shakeAmt`; everything else is fire-and-forget.
   ============================================================ */
const DUST_MAX = 520;

export class Effects {
  constructor(scene, flashEl) {
    this.scene = scene;
    this.flashEl = flashEl;
    this.shakeAmt = 0;

    this.group = new THREE.Group(); scene.add(this.group);

    // dust point pool
    this._dPos = new Float32Array(DUST_MAX * 3);
    this._dCol = new Float32Array(DUST_MAX * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this._dPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this._dCol, 3));
    const mat = new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    this._dGeo = g;
    this._dPts = new THREE.Points(g, mat); this._dPts.frustumCulled = false; scene.add(this._dPts);
    this._dust = []; this._dHead = 0;

    this._rings = [];
    this._streaks = [];
  }

  dust(pos, hex, n, spread) {
    const c = new THREE.Color(hex);
    for (let i = 0; i < n; i++) {
      const idx = this._dHead % DUST_MAX; this._dHead++;
      const a = Math.random() * 6.28, r = Math.random() * spread;
      this._dust[idx] = {
        x: pos.x + Math.cos(a) * r * 0.3, y: (pos.y || 0) + 0.3 + Math.random() * 0.4, z: pos.z + Math.sin(a) * r * 0.3,
        vx: Math.cos(a) * r * 3, vy: 1 + Math.random() * 3, vz: Math.sin(a) * r * 3,
        life: 0.55 + Math.random() * 0.4, r: c.r, g: c.g, b: c.b,
      };
    }
  }

  ring(pos, hex) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.5, 40),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.12, pos.z);
    this.group.add(m); this._rings.push({ m, life: 0.6 });
  }

  /* water splash where a fallen cat hits the sea (at the given world pos) */
  splash(pos) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.9, 44),
      new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, pos.y + 0.1, pos.z);
    this.group.add(m); this._rings.push({ m, life: 0.6 });
    this.dust(pos, 0x9fd6ff, 30, 2.6);
  }

  streak(p, dir) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.6),
      new THREE.MeshBasicMaterial({ color: p.hex, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const pos = p.pos();
    m.position.set(pos.x, pos.y - 0.1, pos.z);
    m.lookAt(pos.x + dir.x, pos.y - 0.1, pos.z + dir.z); m.rotateY(Math.PI / 2);
    this.group.add(m); this._streaks.push({ m, life: 0.25 });
  }

  shake(a) { this.shakeAmt = Math.min(1.6, this.shakeAmt + a); }

  flash(a) {
    const el = this.flashEl; if (!el) return;
    el.style.transition = 'none'; el.style.opacity = a;
    requestAnimationFrame(() => { el.style.transition = 'opacity .35s'; el.style.opacity = 0; });
  }

  update(dt) {
    // dust
    const gy = PHYSICS.gravity * 0.4;
    for (let i = 0; i < DUST_MAX; i++) {
      const d = this._dust[i];
      if (!d || d.life <= 0) { this._dPos[i * 3 + 1] = -999; continue; }
      d.life -= dt; d.vy += gy * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.vx *= 0.92; d.vz *= 0.92;
      const k = Math.max(0, d.life);
      this._dPos[i * 3] = d.x; this._dPos[i * 3 + 1] = d.y; this._dPos[i * 3 + 2] = d.z;
      this._dCol[i * 3] = d.r * k * 1.6; this._dCol[i * 3 + 1] = d.g * k * 1.6; this._dCol[i * 3 + 2] = d.b * k * 1.6;
    }
    this._dGeo.attributes.position.needsUpdate = true;
    this._dGeo.attributes.color.needsUpdate = true;

    // rings
    for (let i = this._rings.length - 1; i >= 0; i--) {
      const r = this._rings[i]; r.life -= dt;
      const s = 1 + (0.6 - r.life) * 11; r.m.scale.setScalar(s);
      r.m.material.opacity = Math.max(0, r.life / 0.6);
      if (r.life <= 0) { this.group.remove(r.m); this._rings.splice(i, 1); }
    }
    // streaks
    for (let i = this._streaks.length - 1; i >= 0; i--) {
      const s = this._streaks[i]; s.life -= dt;
      s.m.material.opacity = Math.max(0, s.life / 0.25) * 0.7;
      s.m.scale.y = 1 + (0.25 - s.life) * 4;
      if (s.life <= 0) { this.group.remove(s.m); this._streaks.splice(i, 1); }
    }
    if (this.shakeAmt > 0) this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
  }

  confetti(holder) {
    for (let i = 0; i < 70; i++) {
      const d = document.createElement('div');
      const c = ['#ff5661', '#39a0ff', '#31e08f', '#ffcb37', '#ff8fe0'][i % 5];
      d.style.cssText = `position:absolute;top:-20px;left:${Math.random() * 100}%;width:9px;height:14px;background:${c};border-radius:2px;pointer-events:none;z-index:2;`;
      d.animate(
        [{ transform: 'translateY(0) rotate(0)', opacity: 1 },
         { transform: `translateY(${innerHeight + 60}px) rotate(${720 + Math.random() * 360}deg)`, opacity: 1 }],
        { duration: 2400 + Math.random() * 1600, delay: Math.random() * 700, easing: 'cubic-bezier(.4,.1,.7,1)' });
      holder.appendChild(d); setTimeout(() => d.remove(), 5000);
    }
  }
}
