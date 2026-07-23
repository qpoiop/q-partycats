import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS } from '../config.js';

/* ============================================================
   AssetManager — resolves paths against Vite's BASE_URL, loads
   glTF with progress, and degrades gracefully: if a model is
   missing it substitutes a procedural stand-in so the build is
   always runnable (dev before art lands, or CDN hiccups).
   ============================================================ */
export class AssetManager {
  constructor(onProgress) {
    this.loader = new GLTFLoader();
    this.onProgress = onProgress || (() => {});
    this.cache = {};
  }

  url(rel) {
    const base = import.meta.env.BASE_URL || './';
    return base.replace(/\/$/, '') + '/' + rel.replace(/^\//, '');
  }

  loadGLB(rel) {
    return new Promise((res, rej) => this.loader.load(this.url(rel), res, undefined, rej));
  }

  /** Load a GLB, or fall back to a procedural stand-in on failure. */
  async loadModel(key, fallbackFactory) {
    try {
      const gltf = await this.loadGLB(ASSETS[key]);
      this.cache[key] = { scene: gltf.scene, animations: gltf.animations, fallback: false };
    } catch (e) {
      console.warn(`[assets] '${key}' unavailable (${ASSETS[key]}) — using fallback.`, e?.message || e);
      this.cache[key] = { scene: fallbackFactory(), animations: [], fallback: true };
    }
    return this.cache[key];
  }

  get(key) { return this.cache[key]; }
}

/* ---- procedural fallbacks (cream-toned so team-tint reads) ---- */
export function makeFallbackCat() {
  const g = new THREE.Group();
  const fur = () => new THREE.MeshStandardMaterial({ color: 0xf3e7d4, roughness: 0.8, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a2f2a, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 1.1, 6, 12), fur());
  body.rotation.z = Math.PI / 2; body.position.set(0, 1.0, 0); g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.78, 16, 14), fur());
  head.position.set(0, 1.5, 1.05); g.add(head);

  const ear = new THREE.ConeGeometry(0.34, 0.6, 4);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(ear, fur());
    e.position.set(0.4 * sx, 2.0, 1.0); e.rotation.y = Math.PI / 4; g.add(e);
  }
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), dark);
    eye.position.set(0.28 * sx, 1.55, 1.7); g.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 1.1, 4, 8), fur());
  tail.position.set(0, 1.3, -1.2); tail.rotation.x = -0.7; g.add(tail);

  const legGeo = new THREE.CapsuleGeometry(0.22, 0.5, 4, 8);
  for (const [x, z] of [[-0.5, 0.7], [0.5, 0.7], [-0.5, -0.7], [0.5, -0.7]]) {
    const leg = new THREE.Mesh(legGeo, fur());
    leg.position.set(x, 0.35, z); g.add(leg);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function makeFallbackHouse() {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3),
    new THREE.MeshStandardMaterial({ color: 0xcaa877, roughness: 0.95 }));
  wall.position.y = 1.2; g.add(wall);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.8, 4),
    new THREE.MeshStandardMaterial({ color: 0x8a4f3a, roughness: 0.9 }));
  roof.position.y = 3.3; roof.rotation.y = Math.PI / 4; g.add(roof);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
