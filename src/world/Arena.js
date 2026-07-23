import * as THREE from 'three';
import { ARENA } from '../config.js';

/* ============================================================
   Arena — the visual map: sky dome, platform, rim, grass tufts,
   the forest house prop, and ambient floating motes. Physics for
   the platform lives in Physics; this is purely presentation.

   Designed to be swappable — a future gimmick map is just another
   class exposing { addTo(scene), update(dt) }.
   ============================================================ */
export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.fx = new THREE.Group();
    scene.add(this.fx);

    this._buildSky();
    this._buildPlatform();
    this._buildGround();
    this._buildMotes();
  }

  _buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          top: { value: new THREE.Color(0x3f7fd6) },
          mid: { value: new THREE.Color(0x9ec9f2) },
          bot: { value: new THREE.Color(0xffe4c0) },
        },
        vertexShader: `varying vec3 v; void main(){ v=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: `varying vec3 v; uniform vec3 top,mid,bot;
          void main(){ float h=v.y*0.5+0.5;
            vec3 c=mix(bot,mid,smoothstep(0.0,0.45,h));
            c=mix(c,top,smoothstep(0.45,0.92,h));
            gl_FragColor=vec4(c,1.0);} `,
      }),
    );
    this.group.add(sky);
  }

  _buildPlatform() {
    const R = ARENA.radius;
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 1.2, 72),
      new THREE.MeshStandardMaterial({ color: 0x86c14f, roughness: 0.95 }));
    top.position.y = -0.6; top.receiveShadow = true; this.group.add(top);

    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 1.004, R * 0.62, 4.2, 72),
      new THREE.MeshStandardMaterial({ color: 0x7a5634, roughness: 1 }));
    band.position.y = -3.1; this.group.add(band);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.36, 14, 80),
      new THREE.MeshStandardMaterial({ color: 0xc79553, roughness: 0.7 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = ARENA.rimHeight;
    rim.receiveShadow = true; this.group.add(rim);

    // grass tufts
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0x74ab45, roughness: 1 });
    const tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.55, 5), tuftMat, 120);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * 6.28, r = Math.random() * (R - 0.7);
      m.makeTranslation(Math.cos(a) * r, 0.24, Math.sin(a) * r);
      tuft.setMatrixAt(i, m);
    }
    tuft.receiveShadow = true; this.group.add(tuft);
  }

  /* A wide, softly-coloured ground skirt beneath/around the arena so
     the platform reads as sitting in a world rather than floating in a
     void — the far edge dissolves into fog instead of a hard cutoff. */
  _buildGround() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(170, 48),
      new THREE.MeshStandardMaterial({ color: 0x5f8f4a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -5.4;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  _buildMotes() {
    const N = 160;
    const geo = new THREE.BufferGeometry();
    this._motePos = new Float32Array(N * 3);
    this._moteVel = [];
    for (let i = 0; i < N; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 13;
      this._motePos[i * 3] = Math.cos(a) * r;
      this._motePos[i * 3 + 1] = Math.random() * 12;
      this._motePos[i * 3 + 2] = Math.sin(a) * r;
      this._moteVel.push(0.2 + Math.random() * 0.5);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this._motePos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffe6b0, size: 0.09, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this._moteN = N;
    this._moteGeo = geo;
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  addProp(root, opts = {}) {
    // Normalise an arbitrary glTF prop to a target height, then place it.
    const holder = new THREE.Group(); holder.add(root);
    let box = new THREE.Box3().setFromObject(holder);
    let size = box.getSize(new THREE.Vector3());
    const scale = (opts.height || 7.5) / size.y;
    holder.scale.setScalar(scale);
    box = new THREE.Box3().setFromObject(holder);
    const ctr = box.getCenter(new THREE.Vector3());
    root.position.x -= ctr.x / scale;
    root.position.z -= ctr.z / scale;
    root.position.y -= box.min.y / scale;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const g = new THREE.Group(); g.add(holder);
    const p = opts.position || { x: 0, y: -0.3, z: -15 };
    g.position.set(p.x, p.y, p.z);
    g.scale.setScalar(opts.worldScale || 1.4);
    g.rotation.y = opts.rotationY ?? 0.2;
    this.scene.add(g);
    return g;
  }

  update(dt) {
    const N = this._moteN, pos = this._motePos, vel = this._moteVel;
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 1] += vel[i] * dt;
      if (pos[i * 3 + 1] > 13) {
        pos[i * 3 + 1] = -1;
        const a = Math.random() * 6.28, r = Math.random() * 13;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 2] = Math.sin(a) * r;
      }
    }
    this._moteGeo.attributes.position.needsUpdate = true;
  }
}
