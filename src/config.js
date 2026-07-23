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
  water: 'scene/water_animation.glb',
};

// ---------- arena ----------
export const ARENA = {
  radius: 13.0,      // platform radius (slightly tighter → cats read bigger)
  rimHeight: -0.02,
  doomY: -2.5,       // below this while off-platform → out (round resolves now)
  menuKillY: -6,     // attract mode: respawn instead of KO
  waterY: -46,       // visible sea the island floats over; fall ~2s then splash
  hideY: -55,        // body removed just under the surface after the splash
};

// ---------- character physical body ----------
export const BODY = {
  capHalfHeight: 0.44,
  capRadius: 0.6,
  density: 1.1,
  visualHeight: 3.1,   // bigger, readable characters
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

/* ---------- CAMERA & RENDER ----------
   Floating sky-island arena above a dark abyss. Fog is coloured to the
   sky horizon so the skyline reads clean, while the void below is dark
   geometry the players fall into. Camera sits closer so characters read. */
export const RENDER = {
  fov: 52,
  near: 0.3,
  far: 500,
  fogColor: 0xbfe0ff,   // matches sky horizon
  fogNear: 60,          // clear across the whole arena…
  fogFar: 320,          // …only the far skyline hazes
  abyssColor: 0x05060c, // the void the arena floats above
  pixelRatioCap: 2,
  bloom: { strength: 0.42, radius: 0.6, threshold: 0.9 },
  exposure: 1.02,
  shadowMapSize: 2048,
  shadowExtent: 22,     // covers the platform + edge decoration
  shadowFar: 90,
};

export const CAMERA = {
  menuDist:   { landscape: 23, portrait: 28 },
  playDist:   { landscape: 20, portrait: 27 },  // much closer → cats clearly visible
  minDist: 14,
  maxDist: 46,
  menuElevation: 0.5,
  playElevation: 0.66,
  followLerp: 3.4,
  followFactor: 0.42,   // less drift, arena stays framed
  followClamp: 6.5,
  menuSpin: 0.024,
  fallElevation: 0.28,  // tilt down to watch the plunge
};

// ---------- match defaults ----------
export const MATCH = {
  defaultCount: 4,
  defaultRounds: 3,
  countOptions: [2, 3, 4],
  roundOptions: [1, 3, 5],
  roundEndDelay: 2.4,
};
