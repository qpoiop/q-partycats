/* ============================================================
   PARTY CATS — central tuning & content config
   ------------------------------------------------------------
   Every gameplay/render number lives here so designers can
   balance the game without touching engine code. Systems import
   from this module; nothing hard-codes magic values.
   ============================================================ */

// ---------- teams / roster (content, easy to extend) ----------
export const TEAMS = [
  { id: 'red',    name: '레드', hex: 0xf26a72, css: '#f26a72' },
  { id: 'blue',   name: '블루', hex: 0x5aa6ee, css: '#5aa6ee' },
  { id: 'green',  name: '그린', hex: 0x4ad39a, css: '#4ad39a' },
  { id: 'yellow', name: '옐로', hex: 0xf5c24f, css: '#f5c24f' },
];

export const BOT_NAMES = ['냥냥', '까칠', '치즈', '우당탕', '폭탄', '겁냥', '슈퍼', '발톱'];

// ---------- asset registry (add characters/maps here) ----------
export const ASSETS = {
  cat:   'scene/low-poly_oldxian_comix_cat.glb',
  house: 'scene/forest_house.glb',
};

// ---------- arena ----------
export const ARENA = {
  radius: 14.0,      // platform radius
  killY: -6,         // fall below → eliminated
  rimHeight: -0.02,
};

// ---------- character physical body ----------
export const BODY = {
  capHalfHeight: 0.37,
  capRadius: 0.52,
  density: 1.1,
  visualHeight: 2.3,
  linearDamping: 0.2,
};
BODY.footOffset = BODY.capHalfHeight + BODY.capRadius; // center → feet
BODY.restY = BODY.footOffset;

// ---------- physics world ----------
export const PHYSICS = {
  gravity: -18,          // stronger than proto (-14) → snappier jumps/landings
  timestep: 1 / 60,
  maxSubsteps: 5,
  platformFriction: 0.85,
  platformRestitution: 0.04,
  bodyFriction: 0.4,
  bodyRestitution: 0.2,
};

/* ---------- MOVEMENT (the "naturalness" fix) ----------
   Prototype used raw per-frame forces with a 1.8 m/s soft cap →
   sluggish, floaty, unresponsive. We now drive toward a target
   velocity with a bounded acceleration ("character controller"
   feel) that stays physical but crisp. External knockbacks are
   preserved via a knock window during which steering is paused. */
export const MOVE = {
  speed: 6.2,          // ground top speed (m/s)  [was ~1.8]
  airSpeed: 5.4,       // target speed while airborne
  accelGround: 55,     // m/s^2 toward desired velocity (snappy)
  accelAir: 18,        // weaker air control
  frictionDecel: 34,   // m/s^2 braking when no input on ground
  turnRateGround: 16,  // facing lerp rate (rad/s-ish)
  turnRateAir: 8,
  knockWindow: 0.34,   // s of no-steer after taking a hit (keeps knockback juicy)
};

// ---------- abilities (expressed as target velocities, intuitive) ----------
export const ABIL = {
  jumpVel: 7.2,        // up velocity on jump
  jumpSquash: -0.35,
  dashCd: 1.4,
  dashVel: 12.5,       // ground dash burst
  dashAirVel: 12.0,
  dashAirLift: 2.6,
  dashInvuln: 0.45,
  dashTime: 0.4,       // active window (contact = strike)
  dashStrikeGround: 6.5,
  dashStrikeAir: 12.5,
  dashStrikeAirLift: 4.6,
  slamDownVel: 17,
  slamRadius: 4.6,
  slamKnockBase: 6,
  slamKnockScale: 16,
  slamKnockLift: 8.0,
  grabRadius: 2.3,
  grabHold: 2.6,
  grabCd: 0.5,
  throwVel: 13,
  throwLift: 6,
};

// ---------- animation sync (kills foot-sliding) ----------
export const ANIM = {
  // ground speed (m/s) at which the Walking clip plays at its natural 1x.
  // timeScale = clamp(groundSpeed / refSpeed, min, max) so feet track velocity.
  refSpeed: 3.2,
  timeScaleMin: 0.6,
  timeScaleMax: 2.1,
  idleSpeed: 0.35,     // below this → idle (sit) blends in
  walkBlendSpeed: 1.4, // full walk weight reached here
};

/* ---------- CAMERA & RENDER DISTANCE (the "render distance" fix) ----------
   Prototype: FogExp2 0.006 + far=500 + orbit dist up to 50 made the
   arena wash out and edges fade into void. We switch to linear fog
   tuned to the arena scale, matched to the sky horizon color, with a
   larger environment skirt and shadow frustum sized to the whole scene. */
export const RENDER = {
  fov: 50,
  near: 0.3,
  far: 400,
  fogColor: 0xbfe0ff,   // matches sky horizon → seamless fade, no hard cutoff
  fogNear: 46,          // linear fog: fully clear well past the arena…
  fogFar: 190,          // …hazes only the far sky/environment
  pixelRatioCap: 2,
  bloom: { strength: 0.45, radius: 0.6, threshold: 0.92 },
  exposure: 1.02,
  shadowMapSize: 2048,
  shadowExtent: 26,     // half-width of shadow ortho frustum (covers arena + house)
  shadowFar: 90,
};

export const CAMERA = {
  menuDist:   { landscape: 27, portrait: 34 },
  playDist:   { landscape: 33, portrait: 44 },
  minDist: 20,
  maxDist: 60,
  menuElevation: 0.52,
  playElevation: 0.74,
  followLerp: 3.2,
  followFactor: 0.55,
  followClamp: 8.0,
  menuSpin: 0.026,
};

// ---------- match defaults ----------
export const MATCH = {
  defaultCount: 4,
  defaultRounds: 3,
  countOptions: [2, 3, 4],
  roundOptions: [1, 3, 5],
  roundEndDelay: 2.4,
};
