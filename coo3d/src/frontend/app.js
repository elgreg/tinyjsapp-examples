// The page is one pigeon's costume — every pigeon window loads this same
// file. All behavior (where to waddle, whom to pair with, when to poop)
// lives in the backend; this file performs what it's told with a skinned,
// animated GLB driven by three.js.
//
// Clip casting (the model ships eleven — no faking required this time):
//   idle → "Idle"/"IdleLoop"   walk → "Walk"     peck/eat → "Peck"
//   coo → "Cooing"             circle → "Circle" (root rotation kept — the
//   strut turns in place)      loaf → slow "IdleLoop"
//   fly → real "TakeOff" once, then "FlyLoop"     land → real "Land"
//   idle sometimes opens with a "Left"/"Right" wing-shuffle flourish.
// The poop squat is the one procedural bit: after mixer.update poses the
// skeleton, the tail bone lifts and the hips tip forward on an envelope
// (this rig hinges on local Z; found by screenshot grid, same as kraa3d).

const $ = (id) => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);

const me = tiny.win.id || 'main';
const idx = me === 'main' ? 0 : Math.max(0, parseInt(me.slice(1), 10) || 0);

// nobody's plumage matches: tints cycle, size jitters deterministically
const TINT = [0, 0x9096a3, 0xc2a78f, 0xdcdfe4, 0x71767f,
              0xa8988a, 0x848b99, 0xcfc9bd, 0x99856f, 0x5f646e][idx % 10];
const SIZE = 1 + (((idx * 37) % 15) - 7) / 100;

// Three costumes, one brain — the tray's 🐾 Animals menu picks who shows up
// and every window swaps in place. Each model file is only loaded (a script
// tag, on demand) once somebody picks that animal. The goldfinch is AnimalMesh3D's sparrow rig,
// repainted: its six clips stand in for the pigeon's eleven (a hop for the
// waddle, a bite for the peck, a feather-shake for the strut), it faces -Z
// where the pigeon faces +Z, and its flight wings are separate geometry that
// sits half-open in every clip — so on the ground they fold away to nothing
// (the folded wing is painted on the body) and they snap open for flight.
const SPECIES = {
  pigeon: { b64: () => PIGEON_GLB_B64, flip: false, tint: true, scale: 1,
            bones: { hips: 'Hips', tail: 'Tail01', spine: 'Spine' } },
  finch:  { b64: () => FINCH_GLB_B64, flip: true, tint: false, scale: 0.8,
            bones: { hips: 'hips_02', tail: 'tail1_014', spine: 'head_03' },
            wings: /shoulder/,
            clips: { idle: 'look', idleloop: 'look', left: 'shake', right: 'shake',
                     walk: 'jump', peck: 'bite', cooing: 'look', circle: 'shake',
                     takeoff: 'jump', flyloop: 'fly', land: 'jump' } },
  // The bear (AnimalMesh3D, 11 of its 30 clips kept) does everything on foot:
  // flights are a run, the strut stands up on its hind legs, loafing lies
  // down, and the poop squat tips the pelvis so the rump drops. Its root
  // motion lives on RigPelvis, whose local Y is forward and Z is up.
  bear:   { b64: () => BEAR_GLB_B64, script: 'bear-model.js', flip: false, tint: false,
            scale: 0.11, center: true,
            bones: { hips: 'RigPelvis_04', tail: 'RigTail1_032', spine: 'RigSpine1_09' },
            pin: { re: /RigPelvis_04\.position$/, keep: 2 },
            squat: { tail: 0, hips: -0.35, spine: 0.35 },   // spine keeps the front paws down
            clips: { idle: 'stand breathing', idleloop: 'stand breathing', loaf: 'lying breathing',
                     squat: 'stand breathing', left: 'stand2', right: 'stand angry breathing',
                     walk: 'walk', peck: 'stand eating', cooing: 'stand angry breathing2',
                     circle: 'hind breathing', takeoff: 'trot', flyloop: 'run', land: 'walk slow' } },
};
// the finch model is on-demand too
SPECIES.finch.script = 'finch-model.js';
let species = null;                 // boot says who we are; the model loads then

let state = 'idle';
let shine = null;                   // special coat, if the backend rolled one
let dir = 1, fast = false, moving = false;
let look = { x: 0, y: 0 };          // where the backend says the bird is looking
let poopT = -10;                    // clock time the current squat started

// ------------------------------------------------------------------- stage

const W = 200;
// Full device ratio (capped at 2). 1.5x was tried for 56% of the pixels and
// looked grainy in the real app: 300px scaled onto a 400px Retina area is a
// non-integer resample the compositor redoes every frame. Headless upscales
// hid it. low-power keeps dual-GPU Macs on the iGPU.
const renderer = new THREE.WebGLRenderer({ canvas: $('cv'), antialias: true, alpha: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, W);

const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
cam.position.set(0.34, 0.5, 1.1);            // gentle 3/4 view, a bit above
cam.lookAt(0, 0.15, 0);

// day-lit but soft — the bird lives over whatever wallpaper is behind it
const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x8a7a66, 1.5);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(1.5, 3, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0xaac4ff, 1.1);
rim.position.set(-2, 1.5, -1.5);
scene.add(rim);

// ONE sun for the whole flock, parked at a fixed screen spot way above the
// display. Each window aims its key light from the sun relative to its own
// position (the backend sends both), so as a bird crosses the screen its
// shading actually changes — the light isn't glued to the bird.
let sun = { x: 980, y: -520 };
let winPos = { x: 620, y: 400 };
const keyTarget = key.position.clone();
function aimSun() {
  const vx = sun.x - (winPos.x + 100);
  const vy = (winPos.y + 100) - sun.y;               // screen-down → world-up
  const len = Math.hypot(vx, vy) || 1;
  keyTarget.set((vx / len) * 4, (vy / len) * 4, 1.7); // a bit frontal so the
}                                                     // near side never goes black
tiny.api.on('env', (e) => { sun = e.sun; aimSun(); });

// a pigeon over a dark desktop needs a little more light to read
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
function applyShade() {
  const dark = darkMq.matches;
  hemi.intensity = dark ? 2.1 : 1.5;
  key.intensity = dark ? 2.7 : 2.2;
  rim.intensity = dark ? 1.6 : 1.1;
}
applyShade();
darkMq.addEventListener('change', applyShade);

// ------------------------------------------------------------------ puppet

let model = null, mixer = null, bones = {}, wingBones = [];
let wingOpen = 0;                   // 0 = flight wings folded away, 1 = spread
const rig = new THREE.Group();      // outer group: screen-space pitch (banking)
scene.add(rig);

// The contact shadow lives IN the scene: a radial-gradient blob on a ground
// plane, glued to the hip bone's world x/z every frame — so it stays under
// the feet through pecks, struts, and turns (a fixed CSS blob didn't).
const shadow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(10, 12, 28, 0.55)');
  g.addColorStop(0.55, 'rgba(10, 12, 28, 0.28)');
  g.addColorStop(1, 'rgba(10, 12, 28, 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.26),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  m.renderOrder = -1;
  scene.add(m);
  return m;
})();
const hipPos = new THREE.Vector3();
const actions = {};
let current = null;                 // name of the playing action
let rainbowMats = [];               // materials that cycle hue (the rare one)

// SPECIAL coats, shiny-Pokémon rare (the backend rolls them per launch):
// real metalness needs something to reflect, so a special bird also gets a
// tiny canvas-painted equirect environment — sky, ground, one hot sun blob.
// bare = drop the feather texture (it multiplies a metal down to mud)
const SHINES = {
  gold:    { color: 0xf2c14e, metal: 1, rough: 0.24, bare: true },
  silver:  { color: 0xe8edf4, metal: 1, rough: 0.18, bare: true },
  bronze:  { color: 0xc98a4b, metal: 1, rough: 0.3, bare: true },
  blue:    { color: 0x3d7df2, metal: 0.55, rough: 0.26, glow: 0.22 },
  red:     { color: 0xe04438, metal: 0.55, rough: 0.26, glow: 0.22 },
  rainbow: { color: 0xffffff, metal: 0.85, rough: 0.22, bare: true, cycle: true },
};

function envTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, '#eaf2ff');
  g.addColorStop(0.5, '#9fb6d8');
  g.addColorStop(0.55, '#6b5f4e');
  g.addColorStop(1, '#3d382f');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 32);
  x.fillStyle = '#ffffff';
  x.beginPath(); x.arc(44, 6, 5, 0, Math.PI * 2); x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function applyShine(name) {
  const s = SHINES[name];
  if (!s || !model) return;
  scene.environment = envTexture();
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const m = o.material.clone();
    m.color.setHex(s.color);
    m.metalness = s.metal;
    m.roughness = s.rough;
    m.envMapIntensity = 1.6;
    if (s.bare) m.map = null;
    if (s.glow) { m.emissive.setHex(s.color); m.emissiveIntensity = s.glow; }
    o.material = m;
    if (s.cycle) { m.emissive.setHex(0xffffff); m.emissiveIntensity = 0.12; rainbowMats.push(m); }
  });
}

const YAW = Math.PI / 2;            // yaw that points the pigeon at screen-right
                                    // (this rig's forward is +Z — the crow's was -Z)

function play(name, { ts = 1, fade = 0.25 } = {}) {
  const next = actions[name];
  if (!next) return;
  next.timeScale = ts;
  if (current === name) return;
  next.reset().play();
  if (current && actions[current]) next.crossFadeFrom(actions[current], fade, false);
  current = name;
}

function setState(s) {
  const wasAirborne = state === 'fly' || state === 'land';
  state = s;
  document.body.dataset.state = s;
  // a bird coming off the wing snaps into its ground gait — long blends here
  // read as mushy hovering
  const fade = wasAirborne ? 0.08 : 0.25;
  if (s === 'idle') {
    // usually just stand there; sometimes a little wing-settle flourish first
    const r = Math.random();
    if (r < 0.14 && actions.left) play(Math.random() < 0.5 ? 'left' : 'right', { ts: 1.5, fade });
    else play(r < 0.6 ? 'idle' : 'idleloop', { fade });
  }
  else if (s === 'loaf') play(actions.loaf ? 'loaf' : 'idleloop', { ts: 0.8, fade });
  else if (s === 'walk') play('walk', { ts: 1.5, fade });
  else if (s === 'peck') play('peck', { ts: 1.1, fade });
  else if (s === 'eat') play('peck', { ts: 1.35, fade });
  else if (s === 'coo') play('cooing', { fade });
  else if (s === 'circle') play('circle', { ts: 1.05, fade });
  else if (s === 'poop') { play(actions.squat ? 'squat' : 'idleloop', { ts: 0.5, fade }); poopT = clock.elapsedTime; }
  // a REAL explosive take-off clip, then the flap loop takes over (below)
  else if (s === 'fly') play('takeoff', { ts: fast ? 2.2 : 1.7, fade: 0.1 });
  // and a REAL wings-out braking landing — quick, so it never reads as a float
  else if (s === 'land') play('land', { ts: 3, fade: 0.1 });
}

// Keep clips in place: the source actions carry root motion (Walk covers
// ground, Circle wanders a loop), but here the WINDOW is what moves — so pin
// every root bone's horizontal translation to its first keyframe, keep the
// bob. Rotation stays free: that's what makes the circle-strut turn.
const PIN = { re: /(RL_BoneRoot|RootNode_0|Hips|hips_02)\.position$/, keep: 1 };
function pinRootMotion(clip, pin = PIN) {
  for (const tr of clip.tracks) {
    if (!pin.re.test(tr.name)) continue;
    const v = tr.values;
    // freeze the two horizontal axes, keep `keep` (the rig's up axis) moving
    for (let i = 3; i < v.length; i += 3) {
      for (let k = 0; k < 3; k++) if (k !== pin.keep) v[i + k] = v[k];
    }
  }
}

// Model files arrive on demand: a <script> tag per animal, once.
const scriptLoads = {};
function needScript(src) {
  if (!src) return Promise.resolve();
  return (scriptLoads[src] ||= new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = res;
    el.onerror = () => rej(new Error('could not load ' + src));
    document.head.appendChild(el);
  }));
}

const clock = new THREE.Clock();

function clearModel() {
  if (!model) return;
  mixer.stopAllAction();
  rig.remove(model);
  model.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  model = null; mixer = null; bones = {}; wingBones = []; current = null; rainbowMats = [];
  for (const k of Object.keys(actions)) delete actions[k];
}

let loadSeq = 0, looping = false;
function loadModel(name) {
  if (!SPECIES[name]) name = 'pigeon';
  if (name === species && model) return;
  species = name;
  const cfg = SPECIES[name];
  const seq = ++loadSeq;
  needScript(cfg.script).then(() => {
  if (seq !== loadSeq) return;
  const bin = Uint8Array.from(atob(cfg.b64()), (c) => c.charCodeAt(0)).buffer;
  new GLTFLoader().parse(bin, '', (gltf) => {
    if (seq !== loadSeq) return;              // switched again mid-parse
    clearModel();
    // an outer group carries yaw/scale; a backwards-facing rig is turned inside it
    const inner = gltf.scene;
    if (cfg.flip) inner.rotation.y = Math.PI;
    if (cfg.center) {
      // this rig's origin sits behind its body — centre it over the window
      const c = new THREE.Box3().setFromObject(inner).getCenter(new THREE.Vector3());
      inner.position.x -= c.x;
      inner.position.z -= c.z;
    }
    model = new THREE.Group();
    model.add(inner);
    model.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (o.isBone && cfg.wings && cfg.wings.test(o.name)) wingBones.push(o);
      if (o.isMesh) o.frustumCulled = false;    // a flap must never clip out
    });
    if (TINT && cfg.tint) {
      model.traverse((o) => {
        if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color.setHex(TINT); }
      });
    }
    model.scale.setScalar(SIZE * cfg.scale);
    model.rotation.y = dir > 0 ? YAW : -YAW;
    rig.add(model);
    if (shine) applyShine(shine);

    mixer = new THREE.AnimationMixer(model);
    mixer.timeScale = 0.94 + idx * 0.035;         // desync the flock a touch
    // clip key: the last '|' segment; single-word names also drop an '_' prefix
    const short = (clip) => {
      const tail = clip.name.split('|').pop();
      return (tail.includes(' ') ? tail : tail.split('_').pop()).toLowerCase();
    };
    if (cfg.clips) {
      // stand-ins: each role gets its own copy of the source clip, so one clip
      // can loop as the hop and play once as the take-off without a tug-of-war
      for (const [role, src] of Object.entries(cfg.clips)) {
        const clip = gltf.animations.find((c) => short(c) === src);
        if (!clip) continue;
        const c = clip.clone();
        pinRootMotion(c, cfg.pin);
        actions[role] = mixer.clipAction(c);
      }
    } else {
      for (const clip of gltf.animations) {
        pinRootMotion(clip);
        actions[short(clip)] = mixer.clipAction(clip);
      }
    }
    // one-shot clips hand off when they finish
    for (const n of ['takeoff', 'land', 'left', 'right']) {
      if (!actions[n]) continue;
      actions[n].setLoop(THREE.LoopOnce);
      actions[n].clampWhenFinished = true;
    }
    mixer.addEventListener('finished', (e) => {
      if (e.action === actions.takeoff && state === 'fly') play('flyloop', { ts: fast ? 1.7 : 1.2, fade: 0.12 });
      else if (e.action === actions.land || e.action === actions.left || e.action === actions.right) {
        if (state === 'idle' || state === 'land' || state === 'loaf') play('idle', { fade: 0.2 });
      }
    });

    setState(state);
    if (!looping) { looping = true; requestAnimationFrame(loop); }
  }, (e) => tiny.log(name + ' load failed: ' + e));
  }).catch((e) => tiny.log(String(e)));
}

// ------------------------------------------------------------ frame-by-frame

// Frame budget: twenty windows each rendering at display refresh (120 Hz on
// ProMotion) is most of the app's energy. Ground life renders at FPS_GROUND;
// flight gets FPS_AIR (the goldfinch's flap strobes at 30). Keep both even
// divisors of 60/120: 90 on a 120 Hz panel alternates 1- and 2-frame gaps,
// which judders worse than a steady 60. Skipped rAFs just bank their time,
// so passing the banked dt keeps clip speed and every ease rate unchanged.
const FPS_GROUND = 30, FPS_AIR = 60;
let banked = 0;

function loop() {
  requestAnimationFrame(loop);
  banked += clock.getDelta();
  if (!mixer) return;
  const fps = state === 'fly' || state === 'land' ? FPS_AIR : FPS_GROUND;
  if (banked < 1 / fps - 0.002) return;   // slack for rAF jitter
  const dt = Math.min(banked, 0.1);
  banked = 0;
  const t = clock.elapsedTime;

  mixer.update(dt);

  // flight wings (goldfinch): open on the wing, folded away on the ground —
  // quick, the way a small bird snaps them shut
  if (wingBones.length) {
    const want = state === 'fly' || state === 'land' ? 1 : 0;
    wingOpen += (want - wingOpen) * Math.min(1, dt * 14);
    const sc = Math.max(0.001, wingOpen);
    for (const w of wingBones) w.scale.setScalar(sc);
  }

  // the rainbow one is never the same color twice
  for (const m of rainbowMats) {
    m.color.setHSL((t * 0.12 + idx * 0.3) % 1, 0.8, 0.55);
    m.emissive.setHSL((t * 0.12 + idx * 0.3) % 1, 0.8, 0.3);
  }

  // face where the backend says — and when actually traveling, TURN into the
  // direction of travel. The look vector is the screen-space heading; treat
  // screen-down as toward the camera, so a bird waddling down-right angles
  // toward you and one climbing away shows you its back. The toward-camera
  // component is capped: fully sideways the wingspan would overflow the
  // 200px window mid-flap.
  let wantYaw;
  const traveling = moving && (state === 'fly' || state === 'land' || state === 'walk');
  if (traveling && (look.x || look.y)) {
    const depth = state === 'walk' ? 0.55 : 0.45;
    wantYaw = Math.atan2(look.x || dir * 0.05, look.y * depth);
  } else if (state === 'circle') {
    wantYaw = model.rotation.y;                 // the clip is doing the turning
  } else {
    wantYaw = dir > 0 ? YAW : -YAW;
  }
  // ease along the shortest arc (yaw wraps), then keep the angle bounded
  let dyaw = wantYaw - model.rotation.y;
  dyaw = ((dyaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  model.rotation.y += dyaw * Math.min(1, dt * 7);
  if (model.rotation.y > Math.PI) model.rotation.y -= Math.PI * 2;
  else if (model.rotation.y < -Math.PI) model.rotation.y += Math.PI * 2;
  // a bird angled to/away from the camera spreads its wingspan across the
  // window — shrink it a touch as it turns off-profile so flaps stay inside.
  // 'land' counts as grounded here: the flight lift, banking, and shadow all
  // ease back DURING the wings-out landing clip, so the bird doesn't float
  // down half a body-height after it has visibly touched down.
  const airborne = state === 'fly';
  const off = Math.abs(Math.cos(model.rotation.y));
  const wantScale = 1 - off * (airborne ? 0.14 : 0.06);
  rig.scale.setScalar(rig.scale.x + (wantScale - rig.scale.x) * Math.min(1, dt * 5));
  // in the air, ride a little higher in the frame — a flap's downstroke
  // otherwise pokes the wingtip out the bottom of the window
  const wantLift = airborne ? 0.07 : 0;
  rig.position.y += (wantLift - rig.position.y) * Math.min(1, dt * 5);

  // shadow: follow the hips along the ground; fade and shrink on the wing
  const B = SPECIES[species].bones;
  const hipBone = bones[B.hips];
  if (hipBone) {
    hipBone.getWorldPosition(hipPos);
    shadow.position.x += (hipPos.x - shadow.position.x) * Math.min(1, dt * 12);
    shadow.position.z += (hipPos.z - shadow.position.z) * Math.min(1, dt * 12);
    const wantOp = airborne ? 0.22 : 0.9;
    const wantSc = airborne ? 0.55 : 1;
    shadow.material.opacity += (wantOp - shadow.material.opacity) * Math.min(1, dt * 4);
    shadow.scale.setScalar(shadow.scale.x + (wantSc - shadow.scale.x) * Math.min(1, dt * 4));
  }

  // drift the key light toward where the sun says it should be
  key.position.lerp(keyTarget, Math.min(1, dt * 3));
  // banking: pitch into climbs and dives on the wing. This happens on the
  // OUTER group, whose local Z is the screen axis — rotating the yawed model
  // itself would roll it instead.
  const wantTilt = airborne ? -look.y * 0.5 * dir : 0;
  rig.rotation.z += (wantTilt - rig.rotation.z) * Math.min(1, dt * 5);

  // post-mix puppetry: the mixer has already posed every bone this frame,
  // so nudging them now layers on top of the clip (local Z is the hinge)
  const tail = bones[B.tail], hips = hipBone, spine = bones[B.spine];
  const squatAge = t - poopT;
  if (state === 'poop' && squatAge < 1.1 && tail && hips) {
    // tail up, tip forward, a businesslike shiver, and… done
    const k = Math.min(1, squatAge / 0.22) * (squatAge < 0.85 ? 1 : Math.max(0, (1.1 - squatAge) / 0.25));
    const sq = SPECIES[species].squat || { tail: 0.9, hips: -0.24 };
    if (sq.tail) tail.rotateZ((sq.tail + Math.sin(squatAge * 34) * 0.06) * k);
    hips.rotateZ(sq.hips * k);
    if (sq.spine && spine) spine.rotateZ(sq.spine * k);
  } else if (spine && (state === 'idle' || state === 'walk' || state === 'loaf')) {
    // watching: pitch the front half toward whatever the backend clocked
    // (+Z is chest-up on this rig, so looking down-screen hunches it down)
    spine.rotateZ(-look.y * 0.3);
  }

  renderer.render(scene, cam);
}

// ------------------------------------------------------------ backend cues

tiny.api.on('bird', (p) => { if (p.who === me) setState(p.state); });
tiny.api.on('species', (p) => { loadModel(p.species); ensureAudio(); });

tiny.api.on('look', (p) => {
  if (p.who !== me) return;
  look = { x: p.x, y: p.y };
  dir = p.dir;
  moving = p.moving;
  if (p.wx !== undefined) { winPos = { x: p.wx, y: p.wy }; aimSun(); }
  if (p.fast !== fast) {
    fast = p.fast;
    if (state === 'fly' && current === 'flyloop') play('flyloop', { ts: fast ? 1.7 : 1.2 });
  }
});

tiny.api.on('say', (p) => {
  if (me !== 'main' || !p.vol) return;   // one mixer for the whole flock
  playKind(p.kind, p.pan || 0, p.vol);
});

// ------------------------------------------------------------------- voice

// ALL audio rides tiny.audio.sampler — the app-scoped SFX mixer, one decoded
// copy of the 21-recording bank however many windows the flock has. The MAIN
// window feeds the bank in once (twenty windows each shipping the same bytes
// to the bridge would cost real work for nothing); the backend supplies a
// kind, a stereo pan from the bird's x position on the screen, and a volume,
// with per-kind pitch jitter so no two coos match. The sampler mixes
// natively on Linux (Web Audio crackles under WebKitGTK) and via the main
// page's Web Audio on macOS/Windows — same numbers, same sound, and this
// file no longer owns an AudioContext at all.
const KINDS = {
  coo:     { names: ['coo1', 'coo-2x', 'coo-2x-2', 'coo-2x-3', 'coo-2x-4', 'coo-2x-5',
                     'coo-3x', 'coo-3x-2', 'coo-3x-3', 'coo-3x-4'], rate: [0.94, 1.08] },
  coolong: { names: ['coo-4x', 'coo-5x'], rate: [0.95, 1.05] },          // courtship
  call:    { names: ['call-1', 'call-2', 'call-3'], rate: [0.98, 1.14], gain: 0.9 },
  takeoff: { names: ['take_off', 'more_flapping', 'more_flapping2'], rate: [0.92, 1.08], gain: 0.7 },
  scatter: { names: ['flap_away', 'flap_away2'], rate: [0.95, 1.12], gain: 0.85 },
  distant: { names: ['distant_long_cooing'], rate: [0.97, 1.03], gain: 0.28 },
};
// Goldfinches answer the same cues in their own voice (finch-sound.js, cut
// from a real xeno-canto recording): "tee-yee" contact calls and chip runs for
// a coo, twittery song for the courtship strut, the sharpest calls for alarm —
// and the pigeon's wing-flaps, pitched up and quieter, because small wings
// sound small.
const FINCH_KINDS = {
  coo:     { names: ['xc-call-1', 'xc-call-2', 'xc-call-3', 'xc-call-4', 'xc-call-5',
                     'xc-call-6', 'xc-chips-1', 'xc-chips-2'], rate: [0.96, 1.05], gain: 0.5 },
  coolong: { names: ['xc-song-1', 'xc-song-2', 'xc-song-3', 'xc-song-4'], rate: [0.97, 1.03], gain: 0.5 },
  call:    { names: ['xc-alarm-1', 'xc-alarm-2'], rate: [0.98, 1.06], gain: 0.6 },
  takeoff: { names: ['take_off', 'more_flapping', 'more_flapping2'], rate: [1.35, 1.6], gain: 0.4 },
  scatter: { names: ['flap_away', 'flap_away2'], rate: [1.4, 1.65], gain: 0.5 },
  distant: { names: ['xc-song-1', 'xc-song-2', 'xc-song-3', 'xc-song-4'], rate: [0.98, 1.02], gain: 0.12 },
};
// Bears (bear-sound.js, cut from NPS recordings — see README): low moaning
// grumbles for a coo, a full roar for the hind-leg display, huffs when
// spooked, and bone-crunching while they work through a salmon. No wings, so
// no take-off sound; the distant ambience is a far-off roar.
const BEAR_KINDS = {
  coo:     { names: ['b-grumble-1', 'b-grumble-2', 'b-grumble-3', 'b-grumble-4'], rate: [0.9, 1.05], gain: 0.55 },
  coolong: { names: ['b-roar-1', 'b-roar-2', 'b-roar-3'], rate: [0.94, 1.04], gain: 0.55 },
  call:    { names: ['b-huff-1', 'b-huff-3'], rate: [0.95, 1.05], gain: 0.55 },
  scatter: { names: ['b-huff-1', 'b-huff-3'], rate: [1.0, 1.1], gain: 0.5 },
  munch:   { names: ['b-munch-1', 'b-munch-2', 'b-munch-3', 'b-munch-4', 'b-munch-5', 'b-munch-6'],
             rate: [0.92, 1.08], gain: 0.5 },
  distant: { names: ['b-roar-1', 'b-roar-2', 'b-roar-3'], rate: [0.9, 0.96], gain: 0.1 },
};
// The pigeon bank ships with the page (its wing-flaps serve everyone); the
// goldfinch and bear banks are fetched on demand, like their models.
const BANKS = {
  finch: { script: 'finch-sound.js', data: () => FINCH_SND_B64 },
  bear:  { script: 'bear-sound.js', data: () => BEAR_SND_B64 },
};
const bankSent = new Set();
const bankReady = new Set();   // names whose decode has confirmed — playable
function loadBank(obj) {
  for (const [name, b64] of Object.entries(obj)) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    tiny.audio.sampler.load(name, bytes.buffer)
      .then(() => bankReady.add(name))
      .catch(() => {});        // one bad clip shouldn't silence the rest
  }
}
function ensureAudio() {
  if (me !== 'main' || typeof SND_B64 === 'undefined') return;
  if (!bankSent.has('pigeon')) { bankSent.add('pigeon'); loadBank(SND_B64); }
  const bank = BANKS[species];
  if (bank && !bankSent.has(species)) {
    bankSent.add(species);
    needScript(bank.script).then(() => loadBank(bank.data())).catch((e) => tiny.log(String(e)));
  }
}
function playKind(kind, pan, vol) {
  ensureAudio();
  const k = ({ finch: FINCH_KINDS, bear: BEAR_KINDS }[species] || KINDS)[kind];
  if (!k) return;
  const loaded = k.names.filter((n) => bankReady.has(n));
  if (!loaded.length) return;  // still decoding — skip, same as before
  tiny.audio.sampler.play(loaded[Math.floor(Math.random() * loaded.length)], {
    vol: vol * (k.gain ?? 1),
    pan: Math.max(-1, Math.min(1, pan)),
    rate: rnd(k.rate[0], k.rate[1]),
  }).catch(() => {});
}

// Listeners are up — wake the brain (and prime the audio decoder so the
// first coo isn't swallowed while the mp3 decodes). Every window here is
// click-through, so there's nothing to wire for the mouse — the pigeons
// are scenery you can never accidentally interact with.
// Ask the Wayland tracking question BEFORE waking the brain — the pigeons
// roam, and a confirm attached to a roaming window is a chase.
offerTracking(false).catch(() => {}).then(() =>
tiny.api.call('boot')).then((p) => {
  setState(p.state);
  if (p.env) { sun = p.env.sun; aimSun(); }
  shine = p.shine || null;
  loadModel(p.species || 'pigeon');         // applies the shine once it's parsed
  ensureAudio();
});


// ── Wayland: ask before tracking the mouse beyond our window ────────────────
// The desktop hides the cursor once it leaves this window (capabilities()
// reports mousePosition false), so the pet goes blind. Tracking everywhere
// rides the system's screen-share permission — a user decision, so ask first,
// remember the answer, and let the context menu's "Follow mouse everywhere…"
// re-ask. Elsewhere mousePosition is global already and this returns at once.
async function offerTracking(again) {
  if (tiny.win.id !== 'main') return;   // one voice per app, not per window
  if ((await tiny.system.capabilities()).mousePosition !== false) return;
  let choice = again ? null : await tiny.store.get('mouseTrackChoice');
  if (choice !== 'yes' && choice !== 'no') {
    const yes = await tiny.dialog.confirm('Let the pigeons see your mouse everywhere?', {
      detail: 'On Wayland an app only sees the cursor while it is over its own '
        + 'window. Tracking everywhere uses the system screen-share permission — '
        + 'you will be asked once, and the sharing indicator shows while it is '
        + 'on. Right-click a pigeon to change this later.',
      ok: 'Enable', cancel: 'Not now',
    });
    choice = yes ? 'yes' : 'no';
    await tiny.store.set('mouseTrackChoice', choice);
  }
  if (choice !== 'yes') return;
  try { await tiny.app.mouseTracking.start(); }
  catch { await tiny.store.set('mouseTrackChoice', 'no'); }  // portal said no — don't nag
}
tiny.api.on('ask-tracking', () => offerTracking(true));
