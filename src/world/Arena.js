import * as THREE from 'three';
import { ARENA, RENDER } from '../config.js';

/* ============================================================
   Arena — a floating grassy sky-island above a dark abyss.
   Platform + rim, a ring of low-poly trees, scattered bushes/
   rocks/grass for richness, a backdrop cabin, ambient motes,
   and the abyss geometry players plunge into when they fall off.

   Swappable: a future gimmick map is another class exposing
   { group, update(dt) }.
   ============================================================ */
export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.fx = new THREE.Group();
    scene.add(this.fx);

    this._buildSky();
    this._buildAbyss();
    this._buildPlatform();
    this._buildDecor();
    this._buildMotes();
  }

  _buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(360, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          top: { value: new THREE.Color(0x3f7fd6) },
          mid: { value: new THREE.Color(0x9ec9f2) },
          bot: { value: new THREE.Color(0xdfeefc) },
        },
        vertexShader: `varying vec3 v; void main(){ v=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: `varying vec3 v; uniform vec3 top,mid,bot;
          void main(){ float h=v.y*0.5+0.5;
            vec3 c=mix(bot,mid,smoothstep(0.0,0.5,h));
            c=mix(c,top,smoothstep(0.5,0.95,h));
            gl_FragColor=vec4(c,1.0);} `,
      }),
    );
    this.group.add(sky);
  }

  /* The void the island floats above: a deep dark shaft players fall
     into, plus a dark cap so looking down reads as bottomless. */
  _buildAbyss() {
    const dark = new THREE.MeshBasicMaterial({ color: RENDER.abyssColor, side: THREE.DoubleSide, fog: false });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(80, 44, 320, 48, 1, true), dark);
    wall.position.y = -164; this.group.add(wall);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 48), dark);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -322; this.group.add(floor);

    // faint drifting streaks in the shaft to sell the depth/speed of the fall
    const N = 90;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * 6.28, r = 4 + Math.random() * 34;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = -8 - Math.random() * 260; pos[i * 3 + 2] = Math.sin(a) * r;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x3a4a6b, size: 0.5, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; this.group.add(pts);
  }

  _buildPlatform() {
    const R = ARENA.radius;
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 1.4, 80),
      new THREE.MeshStandardMaterial({ color: 0x8ec850, roughness: 0.95 }));
    top.position.y = -0.7; top.receiveShadow = true; this.group.add(top);

    // chunky earthy underside (reads as a floating chunk of land)
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.99, R * 0.34, 7.0, 80),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 }));
    band.position.y = -4.6; this.group.add(band);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.4, 16, 90),
      new THREE.MeshStandardMaterial({ color: 0xcaa25c, roughness: 0.7 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = ARENA.rimHeight;
    rim.receiveShadow = true; this.group.add(rim);
  }

  // ---- low-poly decoration ----
  _tree(scale = 1) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x7a5330, roughness: 1 }));
    trunk.position.y = 0.8; trunk.castShadow = true; g.add(trunk);
    const foliMat = new THREE.MeshStandardMaterial({ color: 0x4f9e43, roughness: 1 });
    const cones = [[1.5, 2.0, 1.7], [1.15, 1.7, 2.7], [0.8, 1.3, 3.5]];
    for (const [r, h, y] of cones) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), foliMat);
      c.position.y = y; c.castShadow = true; g.add(c);
    }
    g.scale.setScalar(scale);
    return g;
  }

  _buildDecor() {
    const R = ARENA.radius;
    // ring of trees hugging the rim (scenery, non-colliding, out of the play area)
    const treeCount = 9;
    for (let i = 0; i < treeCount; i++) {
      const a = (i / treeCount) * 6.28 + 0.2 + (Math.random() - 0.5) * 0.15;
      const r = R - 0.9 - Math.random() * 0.6;
      const t = this._tree(0.9 + Math.random() * 0.5);
      t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      t.rotation.y = Math.random() * 6.28;
      this.group.add(t);
    }

    // bushes scattered inside
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x5aa84a, roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, r = Math.random() * (R - 2.5);
      const s = 0.4 + Math.random() * 0.35;
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), bushMat);
      b.position.set(Math.cos(a) * r, s * 0.55, Math.sin(a) * r);
      b.scale.y = 0.7; b.castShadow = true; b.receiveShadow = true;
      this.group.add(b);
    }

    // rocks
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8b93, roughness: 1 });
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * 6.28, r = Math.random() * (R - 2);
      const s = 0.35 + Math.random() * 0.5;
      const k = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      k.position.set(Math.cos(a) * r, s * 0.4, Math.sin(a) * r);
      k.rotation.set(Math.random(), Math.random(), Math.random());
      k.scale.y = 0.6; k.castShadow = true; this.group.add(k);
    }

    // grass tufts (instanced, subtle)
    const tuftMat = new THREE.MeshStandardMaterial({ color: 0x79b84a, roughness: 1 });
    const tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 0.6, 5), tuftMat, 90);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * 6.28, r = Math.random() * (R - 0.8);
      m.makeTranslation(Math.cos(a) * r, 0.28, Math.sin(a) * r);
      tuft.setMatrixAt(i, m);
    }
    tuft.receiveShadow = true; this.group.add(tuft);
  }

  _buildMotes() {
    const N = 140;
    const geo = new THREE.BufferGeometry();
    this._motePos = new Float32Array(N * 3);
    this._moteVel = [];
    for (let i = 0; i < N; i++) {
      const a = Math.random() * 6.28, r = Math.random() * ARENA.radius;
      this._motePos[i * 3] = Math.cos(a) * r;
      this._motePos[i * 3 + 1] = Math.random() * 10;
      this._motePos[i * 3 + 2] = Math.sin(a) * r;
      this._moteVel.push(0.2 + Math.random() * 0.5);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this._motePos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffe6b0, size: 0.08, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this._moteN = N; this._moteGeo = geo;
    this.motes = new THREE.Points(geo, mat);
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  /** Place a normalised glTF prop (the forest house) as a rim cabin. */
  addProp(root, opts = {}) {
    const holder = new THREE.Group(); holder.add(root);
    let box = new THREE.Box3().setFromObject(holder);
    let size = box.getSize(new THREE.Vector3());
    const scale = (opts.height || 4.6) / size.y;
    holder.scale.setScalar(scale);
    box = new THREE.Box3().setFromObject(holder);
    const ctr = box.getCenter(new THREE.Vector3());
    root.position.x -= ctr.x / scale;
    root.position.z -= ctr.z / scale;
    root.position.y -= box.min.y / scale;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const g = new THREE.Group(); g.add(holder);
    const p = opts.position || { x: -4.5, y: 0, z: -ARENA.radius + 2.2 };
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = opts.rotationY ?? 0.5;
    this.scene.add(g);
    return g;
  }

  update(dt) {
    const N = this._moteN, pos = this._motePos, vel = this._moteVel;
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 1] += vel[i] * dt;
      if (pos[i * 3 + 1] > 11) {
        pos[i * 3 + 1] = -1;
        const a = Math.random() * 6.28, r = Math.random() * ARENA.radius;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 2] = Math.sin(a) * r;
      }
    }
    this._moteGeo.attributes.position.needsUpdate = true;
  }
}
