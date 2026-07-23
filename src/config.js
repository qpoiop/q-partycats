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

/* ---------- character bone maps (per model) ----------
   Procedural motion (rear-up, punch, kick, flail…) drives the rig by role, not
   by one model's exact bone names. To add/swap a character, add its id here with
   regexes that tag its front legs / back legs / head — nothing else changes.
   `default` is the best-effort fallback when a model has no entry. */
export const BONEMAP = {
  cat:     { frontLeg: /F[LR]/, backLeg: /B[LR]/, head: /^head/i },
  default: { frontLeg: /(front|fore).*(leg|paw|arm|hand)|F[LR]\b/i, backLeg: /(back|hind|rear).*(leg|paw)|B[LR]\b/i, head: /head|skull|neck/i },
};

/* ---------- arena ----------
   One radius R drives everything: spawns, decoration, and camera framing
   are all expressed as ratios of R so nothing is hand-tuned in isolation. */
export const ARENA = {
  radius: 15.0,          // platform radius — the single source of scale
  rimHeight: -0.02,
  spawnFactor: 0.5,      // cats spawn at R*this (central, clearly visible)
  decorRingFactor: 0.97, // trees live on the rim ring (R*this) → play area stays clear
  doomY: -2.5,           // drop past the edge → out (round resolves immediately)
  menuKillY: -6,         // attract mode: respawn instead of KO
  // sea + underwater abyss (fall = splash at surface, then sink into the dark)
  waterY: -12,           // sea below the island → island floats clearly above (not submerged)
  sinkDrag: 2.6,         // vertical damping once submerged → ~3-4s sink
  darkenRange: 22,       // depth (below waterY) over which the screen fades to black
  hideY: -42,            // body removed here, deep in the abyss
};

// ---------- character physical body ----------
export const BODY = {
  capHalfHeight: 0.5,
  capRadius: 0.66,
  density: 1.1,
  visualHeight: 3.7,   // bigger, readable characters
  linearDamping: 0.2,
};
BODY.footOffset = BODY.capHalfHeight + BODY.capRadius; // center → feet
BODY.restY = BODY.footOffset;

// ---------- physics world ----------
export const PHYSICS = {
  gravity: -18,          // stronger than proto (-14) → snappier jumps/landings
  timestep: 1 / 60,
  maxSubsteps: 5,
  platformFriction: 0.5,   // cats can be shoved (movement is force-based, not friction-based)
  platformRestitution: 0.04,
  bodyFriction: 0.85,     // cats grip when pressed together → a grinding shove, not a slide
  bodyRestitution: 0.0,   // cats don't bounce off each other → no contact jitter
};

/* ---------- MOVEMENT (force-based, physical) ----------
   A spring force pulls the body toward a target velocity (F ∝ target−v),
   so momentum, contacts and shoving are resolved by Rapier — pushing into
   another cat transfers force, and the harder-committed cat wins the grind.
   `gain` trades feel: higher = crisper, lower = more inertia. */
export const MOVE = {
  speed: 6.2,          // ground top speed (m/s)
  airSpeed: 5.4,       // target speed while airborne
  gain: 13,            // ground velocity-spring stiffness (force toward target)
  gainAir: 5,          // weaker air control
  brake: 9,            // coast-to-stop force when no input
  accelGround: 55,     // (legacy — unused by the force controller)
  accelAir: 18,
  frictionDecel: 34,   // m/s^2 braking when no input on ground
  turnRateGround: 9,   // facing lerp rate — smooth, not whip-snappy
  turnRateAir: 5,
  knockWindow: 0.42,   // no-steer after a hit (not so long they fly across the map)
  airDrag: 2.0,        // knocked cats bleed horizontal speed → arc down, don't sail across the arena
  shove: 15,           // direct contact-shove — makes pressing feel like a push (decisive shoves come from dash)
};

/* ---------- abilities — Party-Animals-style move set ----------
   Ground: move, jump, PUNCH (주먹치기, the main attack), grab→throw.
   Air combos: jump+dash = flying kick (날라차기), jump+grab = slide (슬라이딩). */
export const ABIL = {
  jumpVel: 7.6,
  jumpSquash: -0.35,

  // dash / flying kick
  dashCd: 1.2,
  dashVel: 12.5,       // ground dash burst
  dashAirVel: 13.5,    // jump+dash = flying kick lunge
  dashAirLift: 2.4,
  dashInvuln: 0.4,
  dashTime: 0.4,       // active window (contact = strike)
  dashStrikeGround: 4.0,
  dashStrikeGroundLift: 2.2,
  dashStrikeAir: 5.5,      // flying-kick — strong but not a full-arena launch
  dashStrikeAirLift: 3.6,

  // punch (주먹치기) — quick jab, the bread-and-butter attack
  punchCd: 0.5,
  punchReach: 1.9,
  punchArc: 0.45,      // dot threshold — must be roughly facing the target
  punchKnock: 9,
  punchLift: 2.8,
  punchTime: 0.34,     // pose duration — long enough to read the swing

  // slide (슬라이딩) = jump+grab → low tackle
  slideVel: 12,
  slideTime: 0.45,
  slideStrike: 7.5,
  slideLift: 3.0,

  throwVel: 8.5,
  throwLift: 4.5,
};

/* ---------- EDGE TEETER ----------
   Going off the lip slowly shouldn't be a smooth slide into the void — the
   cat catches the ledge, hangs and flails for a beat (and may scramble back)
   before it drops. A hard shove (high outward speed) skips this = clean KO. */
export const EDGE = {
  teeterTime: 0.5,      // hang/flail duration at the lip
  teeterOutSpeed: 5.0,  // outward speed above this → launched clean off (no teeter)
  teeterBand: 1.5,      // how far past the rim the teeter can trigger
  teeterRecover: 0.8,   // weak inward scramble — a dramatic hang that usually still drops
};

/* ---------- KNOCKDOWN / STAGGER ----------
   A solid hit knocks a cat down: it tumbles, can't act, and takes time to
   get up. This is what makes hits *matter* (and stops knocked cats from
   fighting the steering controller → no more contact jitter). Duration
   scales with the impact velocity. */
export const KNOCKDOWN = {
  threshold: 5.5,   // only real hits knock down (light shoves are recoverable)
  minTime: 0.45,
  maxTime: 1.1,
  perSpeed: 0.05,   // extra downtime per m/s of impact over threshold
  getup: 0.35,      // brief rise-and-vulnerable window as it stands
};

/* ---------- GRAB (Party-Animals-style tug-of-war) ----------
   Grabber carries a struggling victim; it's a contest between the
   grabber's grip (drains over time, faster while the victim struggles)
   and the victim's struggle meter (fills by mashing; dash = burst).
   The victim stays a *dynamic* body pulled to a hold point by a
   critically-damped spring, so it still collides with the world. */
export const GRAB = {
  radius: 2.4,          // reach to grab a cat in front
  cd: 0.5,              // cooldown after grab/throw/break
  holdDist: 1.9,        // how far in front the victim is held (avoids model overlap)
  holdHeight: 0.95,     // lift the victim clearly off the ground (was planted in it)
  spring: 60,           // spring stiffness pulling victim → hold point
  damp: 14,             // spring damping (≈ critical for the mass)
  maxForce: 42,         // accel cap so the pull stays physical, not a snap
  carrySpeedMul: 0.62,  // grabber slows while carrying
  victimSpeedMul: 0.0,  // victim can't self-propel (only struggle)

  gripMax: 1.0,
  gripDrainBase: 0.16,      // grip lost per second just holding
  gripDrainStruggle: 0.5,   // extra grip lost per second scaled by struggle

  struggleMax: 1.0,
  struggleDecay: 0.5,       // struggle bleeds off when not mashing
  struggleGainMash: 0.14,   // per mash input (key/tap/stick flick)
  struggleGainDash: 0.55,   // dash while carried = big burst (near-instant break)

  breakKick: 7.5,       // knockback the victim kicks the grabber with on break
  breakStun: 0.6,       // grabber can't re-grab for this long after a break
  victimPopVel: 5.5,    // victim's escape pop away from grabber
};

// ---------- animation sync (kills foot-sliding) ----------
export const ANIM = {
  // ground speed (m/s) at which the Walking clip plays at its natural 1x.
  // timeScale = clamp(groundSpeed / refSpeed, min, max) so feet track velocity.
  // Measured: the planted paw travels ~2.9 u/s at timeScale 1, so refSpeed=2.9
  // makes stance foot-speed == body-speed → near-zero slide (was 3.2 → dragged
  // ~0.5 m/s at top speed). Max raised so top speed (6.2) can reach its ~2.14x.
  refSpeed: 2.9,
  timeScaleMin: 0.5,
  timeScaleMax: 2.4,
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
  fogNear: 90,          // clear across the whole arena…
  fogFar: 520,          // …only the far skyline hazes (sea reads blue, not grey)
  abyssColor: 0x05060c, // the void the arena floats above
  pixelRatioCap: 2,
  bloom: { strength: 0.42, radius: 0.6, threshold: 0.9 },
  exposure: 1.02,
  shadowMapSize: 2048,
  shadowExtent: 22,     // covers the platform + edge decoration
  shadowFar: 90,
};

/* Distance is DERIVED so the arena always frames correctly at any aspect
   (no hardcoded 20/27/44): we fit a sphere of radius R*margin in the view.
   See CameraRig.framingDistance(). Only ratios/limits live here. */
export const CAMERA = {
  // Fit factor (calibrated): a disc seen at an angle needs far less pull-back
  // than a full sphere, so <1 frames the arena nicely (≈20u at 16:9).
  framingMargin: { menu: 0.82, play: 0.52 },   // play: closer follow so my cat reads big
  minDist: 12,
  maxDist: 64,
  menuElevation: 0.42,
  playElevation: 0.6,    // raised angle → clearer read of the arena from above
  fallElevation: 0.28,   // tilt down to watch the plunge into the sea
  followLerp: 2.4,       // smoother follow → fast-flung cats don't jerk the camera
  followClamp: 5.5,      // how far the framing centroid may drift from centre
  menuSpin: 0.024,
};

// ---------- match defaults ----------
export const MATCH = {
  defaultCount: 4,
  defaultRounds: 3,
  countOptions: [2, 3, 4],
  roundOptions: [1, 3, 5],
  roundEndDelay: 2.4,
  maxRound: 45,   // hard time cap so a round always ends (no tacky shrinking map)
};
