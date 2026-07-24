import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RENDER } from '../config.js';

/* Final look grade — saturation + contrast + a warm/cool split and a vignette,
   applied to the tone-mapped image so the picture reads produced, not flat. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.18 }, uContrast: { value: 1.07 }, uWarm: { value: 0.035 },
    uVignette: { value: 0.42 }, uLift: { value: 0.008 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat,uContrast,uWarm,uVignette,uLift; varying vec2 vUv;
    void main(){
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, uSat);                       // saturation
      c = (c - 0.5) * uContrast + 0.5 + uLift;         // contrast + lift
      c += (c - 0.5) * vec3(uWarm, uWarm*0.25, -uWarm);// warm highlights / cool shadows
      vec2 d = vUv - 0.5;                              // vignette
      c *= 1.0 - dot(d,d) * uVignette;
      gl_FragColor = vec4(clamp(c,0.0,1.0), src.a);
    }`,
};

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
    // final look grade (last, on the tone-mapped sRGB image)
    const grade = new ShaderPass(GradeShader);
    const gr = RENDER.grade;
    grade.uniforms.uSat.value = gr.saturation; grade.uniforms.uContrast.value = gr.contrast;
    grade.uniforms.uWarm.value = gr.warmth; grade.uniforms.uVignette.value = gr.vignette;
    grade.uniforms.uLift.value = gr.lift;
    this.composer.addPass(grade);
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
