import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RENDER } from '../config.js';

/* ============================================================
   Engine — renderer, scene, camera, post-processing, lights.
   Owns the render-distance setup (linear fog matched to the sky
   horizon + a shadow frustum sized to the whole scene) so the
   arena never fades into a hard void the way it did before.
   ============================================================ */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;

    // Opaque canvas, no preserved buffer: any uncovered pixel clears to the
    // sky/fog colour (never the black page → no smearing "torn brown frame").
    // Portraits read from a RenderTarget, so preserveDrawingBuffer isn't needed.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER.pixelRatioCap));
    this.renderer.setClearColor(RENDER.fogColor, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.exposure;

    this.scene = new THREE.Scene();
    // Linear fog tuned to arena scale + coloured to the sky horizon:
    // clear well past the platform, only the distant environment hazes.
    this.scene.fog = new THREE.Fog(RENDER.fogColor, RENDER.fogNear, RENDER.fogFar);

    this.camera = new THREE.PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);

    this._setupLights();
    this._setupComposer();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  _setupLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xd6ecff, 0x6a5238, 1.0));

    const sun = new THREE.DirectionalLight(0xfff2dc, 2.3);
    sun.position.set(16, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    const c = sun.shadow.camera;
    const e = RENDER.shadowExtent;
    c.left = -e; c.right = e; c.top = e; c.bottom = -e;
    c.near = 1; c.far = RENDER.shadowFar;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.045;
    s.add(sun);
    this.sun = sun;

    const rim = new THREE.DirectionalLight(0x88bbff, 0.6);
    rim.position.set(-14, 10, -14);
    s.add(rim);
    s.add(new THREE.AmbientLight(0xffffff, 0.16));
  }

  _setupComposer() {
    const { strength, radius, threshold } = RENDER.bloom;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), strength, radius, threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    // updateStyle = true: THREE sets the canvas CSS size to the viewport while
    // the backing store scales by pixelRatio. (Passing false leaves the element
    // at its intrinsic backing size → on HiDPI it overflows the viewport.)
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
  }

  render() {
    this.composer.render();
  }
}
