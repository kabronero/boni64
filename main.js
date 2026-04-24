import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================
// Renderer + scene + lights + ground
// ============================================================

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let renderScale = 1.0; // multiplied with devicePixelRatio (capped). Lower = faster.
function applyRenderSize() {
  // On Retina screens devicePixelRatio is 2; rendering at DPR=1 is ~4x cheaper.
  // We expose a "renderScale" so the user can tweak live.
  const dpr = Math.min(window.devicePixelRatio, 2) * renderScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
document.body.appendChild(renderer.domElement);
applyRenderSize();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080d);
scene.fog = new THREE.Fog(0x05080d, 30, 90);

// Hemisphere (global ambient) — kept in a var so levels can retint it.
const hemi = new THREE.HemisphereLight(0x204060, 0x0a0012, 0.25);
scene.add(hemi);

// Directional "moon" — also adjustable per level.
const sun = new THREE.DirectionalLight(0x6aa8ff, 0.6);
sun.position.set(15, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0005;
scene.add(sun);
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);
sun.target = sunTarget;

// ============================================================
// Level system
// ============================================================
//
// A level is a factory object with a .setup(group, state) that populates:
//   - `group` (THREE.Group) with visual content
//   - `state.walls` with AABBs for collision
//   - `state.pickups` with collectibles
//   - `state.triggers` with proximity callbacks (e.g. portals)
//   - `state.config.*` for spawn point, fog, bg color, etc.
// loadLevel() swaps the active level, disposing the previous group's resources.

const levelGroup = new THREE.Group();
scene.add(levelGroup);

const levelState = {
  current: null,
  walls: [],
  pickups: [],
  triggers: [],
  data: {},
  config: {
    bgColor: 0x05080d,
    fogColor: 0x05080d,
    fogNear: 30,
    fogFar: 90,
    sunColor: 0x6aa8ff,
    sunIntensity: 0.6,
    hemiColor: 0x204060,
    hemiIntensity: 0.25,
    spawn: new THREE.Vector3(0, 0, 0),
    spawnFacing: 0,
    title: '',
    camDistance: 20,
    camPitch: -0.25,
    camHeightOffset: 4.5,
  },
};

function disposeObject3D(obj) {
  obj.traverse?.(o => {
    if (o.geometry) o.geometry.dispose?.();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => { m.map?.dispose?.(); m.dispose?.(); });
      else { o.material.map?.dispose?.(); o.material.dispose?.(); }
    }
  });
}

function clearLevel() {
  while (levelGroup.children.length) {
    const c = levelGroup.children.pop();
    disposeObject3D(c);
  }
  levelState.walls.length = 0;
  levelState.pickups.length = 0;
  levelState.triggers.length = 0;
  levelState.data = {};
}

let currentLevelFactory = null;
function loadLevel(levelFactory) {
  clearLevel();
  currentLevelFactory = levelFactory;
  levelState.current = levelFactory.name;
  // Reset config to defaults before setup overrides selected fields.
  levelState.config.bgColor = 0x0a1018;
  levelState.config.fogColor = 0x0a1018;
  levelState.config.fogNear = 80;
  levelState.config.fogFar = 260;
  levelState.config.sunColor = 0x9ec6ff;
  levelState.config.sunIntensity = 0.9;
  levelState.config.hemiColor = 0x3a6090;
  levelState.config.hemiIntensity = 0.5;
  levelState.config.spawn.set(0, 0, 0);
  levelState.config.spawnFacing = 0;
  levelState.config.title = '';
  levelState.config.camDistance = 20;
  levelState.config.camPitch = -0.25;
  levelState.config.camHeightOffset = 4.5;

  levelFactory.setup(levelGroup, levelState);

  scene.background = new THREE.Color(levelState.config.bgColor);
  scene.fog.color.set(levelState.config.fogColor);
  scene.fog.near = levelState.config.fogNear;
  scene.fog.far = levelState.config.fogFar;
  sun.color.set(levelState.config.sunColor);
  sun.intensity = levelState.config.sunIntensity;
  hemi.color.set(levelState.config.hemiColor);
  hemi.intensity = levelState.config.hemiIntensity;

  character.root.position.copy(levelState.config.spawn);
  character.root.position.y = 0;
  character.velocity.set(0, 0, 0);
  character.onGround = true;
  character.facing = levelState.config.spawnFacing;
  character.root.rotation.y = character.facing;
  // Camera goes directly behind the character. After model calibration,
  // character.facing equals the world face angle, so camera yaw = facing
  // places it on the opposite side.
  camRig.yaw = character.facing;
  camRig.distance = levelState.config.camDistance;
  camRig.pitch = levelState.config.camPitch;
  camRig.heightOffset = levelState.config.camHeightOffset;

  updateScoreHUD();
  if (levelState.config.title) showBanner(levelState.config.title, 1500);
}

// ---------- Reusable visual helpers ----------

function neonBox(group, walls, x, z, size = 2, h = 1, edgeColor = 0x00e8ff, collide = true) {
  const g = new THREE.BoxGeometry(size, h, size);
  const body = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ color: 0x0a0e14, roughness: 0.55, metalness: 0.4 })
  );
  body.position.set(x, h / 2, z);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(g),
    new THREE.LineBasicMaterial({ color: edgeColor })
  );
  edges.position.copy(body.position);
  group.add(edges);
  if (collide) {
    const halfX = size / 2, halfZ = size / 2;
    walls.push({ aabb: new THREE.Box3(
      new THREE.Vector3(x - halfX, 0, z - halfZ),
      new THREE.Vector3(x + halfX, h, z + halfZ),
    )});
  }
  return body;
}

function makeTextSprite(text, { fontsize = 44, color = '#ffffff', bg = 'rgba(0,0,0,0.6)' } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `bold ${fontsize}px system-ui, -apple-system, sans-serif`;
  ctx.font = font;
  const pad = 16;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontsize + pad * 2;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle = bg;
  // Rounded rect
  const r = 16;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(w / 90, h / 90, 1);
  return sp;
}

// A proper TRON-style building with a doorway. Walls have collision except
// for the gap where the door is. The trigger is placed at the door.
// Door faces -Z (i.e., toward smaller z, which is "south" in world terms).
function building(group, state, x, z, w, d, h, label, onEnter, color = 0xffa500) {
  const doorW = w * 0.22;   // ~1/5 of the facade wide
  const doorH = h * 0.55;   // ~half the building tall
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0a0e14, roughness: 0.55, metalness: 0.4 });
  const edgeMat = new THREE.LineBasicMaterial({ color });

  const wall = (cx, cy, cz, sx, sy, sz) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const body = new THREE.Mesh(g, wallMat);
    body.position.set(cx, cy, cz);
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat);
    e.position.copy(body.position);
    group.add(e);
    state.walls.push({ aabb: new THREE.Box3(
      new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    )});
  };

  const t = 0.6; // wall thickness
  const halfW = w / 2, halfD = d / 2;
  // Back (+Z)
  wall(x, h / 2, z + halfD - t / 2, w, h, t);
  // Left (-X), Right (+X) — lengthened to cover front wall thickness too
  wall(x - halfW + t / 2, h / 2, z, t, h, d);
  wall(x + halfW - t / 2, h / 2, z, t, h, d);
  // Front (-Z) in 3 pieces around the door
  const doorSide = (w - doorW) / 2;
  if (doorSide > 0.01) {
    wall(x - halfW + doorSide / 2, h / 2, z - halfD + t / 2, doorSide, h, t);
    wall(x + halfW - doorSide / 2, h / 2, z - halfD + t / 2, doorSide, h, t);
  }
  const aboveDoor = h - doorH;
  if (aboveDoor > 0.01) {
    wall(x, doorH + aboveDoor / 2, z - halfD + t / 2, doorW, aboveDoor, t);
  }

  // Glowing fill pane inside the doorway (depthless so it doesn't block passage)
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(doorW, doorH),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
  );
  fill.position.set(x, doorH / 2, z - halfD - 0.02);
  group.add(fill);

  // Neon outline around the doorway
  const doorFrame = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x - doorW / 2, 0.02, z - halfD - 0.03),
      new THREE.Vector3(x - doorW / 2, doorH, z - halfD - 0.03),
      new THREE.Vector3(x + doorW / 2, doorH, z - halfD - 0.03),
      new THREE.Vector3(x + doorW / 2, 0.02, z - halfD - 0.03),
    ]),
    edgeMat
  );
  group.add(doorFrame);

  // Big label on the front face, above the door
  const sprite = makeTextSprite(label, { fontsize: 120, color: `#${color.toString(16).padStart(6, '0')}` });
  sprite.position.set(x, h * 0.85, z - halfD - 0.1);
  sprite.scale.multiplyScalar(3.5);
  group.add(sprite);

  state.triggers.push({
    position: new THREE.Vector3(x, 0, z - halfD + 0.3),
    radius: 1.6,
    once: true,
    onEnter,
  });
}

function portal(group, state, x, z, label, onEnter, color = 0xffa500) {
  const w = 3.2, h = 4;
  // Frame: line loop
  const pts = [
    new THREE.Vector3(-w / 2, 0.02, 0),
    new THREE.Vector3(-w / 2, h, 0),
    new THREE.Vector3(w / 2, h, 0),
    new THREE.Vector3(w / 2, 0.02, 0),
  ];
  const frame = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color })
  );
  frame.position.set(x, 0, z);
  group.add(frame);
  // Glow fill
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  fill.position.set(x, h / 2, z);
  group.add(fill);
  // Label above
  const sprite = makeTextSprite(label, { color: `#${color.toString(16).padStart(6, '0')}` });
  sprite.position.set(x, h + 0.6, z);
  group.add(sprite);

  state.triggers.push({
    position: new THREE.Vector3(x, 0, z),
    radius: 1.5,
    once: true,
    onEnter,
  });
}

const COOKIE_HEIGHT = 3.2; // chest-height float

// A cookie = flat tan disc with small dark brown chocolate chips on top.
function makeCookieMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.58, 0.2, 22),
    new THREE.MeshStandardMaterial({
      color: 0xc68a4f,
      emissive: 0x8a5220,
      emissiveIntensity: 0.7,
      roughness: 0.9,
      metalness: 0.0,
    })
  );
  g.add(base);
  const chipMat = new THREE.MeshStandardMaterial({
    color: 0x3b1c0a,
    emissive: 0x180804,
    emissiveIntensity: 0.4,
    roughness: 0.8,
  });
  const chips = [
    [ 0.22,  0.11,  0.10, 0.09],
    [-0.24,  0.11, -0.06, 0.10],
    [ 0.07,  0.11, -0.28, 0.08],
    [-0.11,  0.11,  0.24, 0.09],
    [ 0.30,  0.11, -0.18, 0.07],
  ];
  for (const [cx, cy, cz, r] of chips) {
    const chip = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6), chipMat);
    chip.position.set(cx, cy, cz);
    g.add(chip);
  }
  return g;
}

function cookie(group, state, x, z) {
  const m = makeCookieMesh();
  m.position.set(x, COOKIE_HEIGHT, z);
  m.userData.spin = Math.random() * Math.PI * 2;
  group.add(m);
  state.pickups.push({
    object: m,
    position: m.position.clone(),
    radius: 4.5, // walking down the corridor = auto-grab
    onCollect: () => {
      group.remove(m);
      disposeObject3D(m);
      state.data.score = (state.data.score || 0) + 1;
      updateScoreHUD();
      if (state.data.score >= state.data.totalCookies) {
        endMazeLevel(state, true);
      }
    },
  });
}

function groundPlane(group, color = 0x06090f) {
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 })
  );
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  group.add(g);
  return g;
}

function neonGrid(group, size = 400, divs = 80, colorA = 0x00e8ff, colorB = 0x0096b4, opacity = 0.85) {
  const grid = new THREE.GridHelper(size, divs, colorA, colorB);
  grid.position.y = 0.015;
  grid.material.transparent = true;
  grid.material.opacity = opacity;
  grid.material.depthWrite = false;
  group.add(grid);
  return grid;
}

// ---------- HUD helpers ----------

function updateScoreHUD() {
  const el = document.getElementById('score-hud');
  if (!el) return;
  if (levelState.current === 'cookieMaze') {
    const score = levelState.data.score || 0;
    const total = levelState.data.totalCookies || 0;
    const time = Math.max(0, Math.ceil(levelState.data.timeLeft || 0));
    el.innerHTML = `galletitas: ${score} / ${total}  ·  tiempo: <span style="color:${time <= 10 ? '#ff4a4a' : '#ffcc4a'}">${time}s</span>`;
    el.style.display = 'block';
  } else if (levelState.current === 'cocaCola') {
    const f = levelState.data.found || {};
    const t = (levelState.data.timeElapsed || 0).toFixed(1);
    el.innerHTML = `lata: ${f.can ? '✓' : '·'}  botella: ${f.bottle ? '✓' : '·'}  ·  tiempo: <span style="color:#ff7a7a">${t}s</span>`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// ---------- Audio ----------
const sfx = {};
const sfxVols = {};
{
  const voice = ['damegalle', 'ricagalle', 'latafaltabotella', 'botellafaltalata', 'cocaconcoca'];
  for (const n of voice) {
    const a = new Audio(`./${n}.mp3`);
    a.preload = 'auto';
    sfx[n] = a;
    sfxVols[n] = 1;
  }
  // Step sounds: a small pool of clones so consecutive footsteps can overlap
  // without cutting each other off.
  for (let i = 0; i < 4; i++) {
    const a = new Audio('./step.mp3');
    a.preload = 'auto';
    sfx[`step${i}`] = a;
    sfxVols[`step${i}`] = 0.55;
  }
}
function playSound(name) {
  const a = sfx[name];
  if (!a) return;
  try {
    a.currentTime = 0;
    a.play().catch(() => {}); // ignore autoplay-block / "aborted by new load" etc
  } catch {}
}
let _stepIdx = 0;
function playStep() {
  const a = sfx[`step${_stepIdx}`];
  _stepIdx = (_stepIdx + 1) % 4;
  if (!a) return;
  try { a.currentTime = 0; a.play().catch(() => {}); } catch {}
}

// ---------- Chill procedural ambient music ----------
// Soft pads + arpeggio + occasional melodic blip, all via Web Audio synth.
// Low volume, looping forever. Starts on first user interaction so the
// browser doesn't block autoplay.
const MUSIC_VOLUME = 0.4;
let isMuted = localStorage.getItem('boni64.muted') === '1';
const music = { ctx: null, filter: null, master: null, started: false };

function setMuted(muted) {
  isMuted = muted;
  localStorage.setItem('boni64.muted', muted ? '1' : '0');
  if (music.master) music.master.gain.value = muted ? 0 : MUSIC_VOLUME;
  for (const name in sfx) sfx[name].volume = muted ? 0 : (sfxVols[name] ?? 1);
}

function startMusic() {
  if (music.started) return;
  music.started = true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = isMuted ? 0 : MUSIC_VOLUME;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1500;
  filter.Q.value = 0.6;
  filter.connect(master);
  master.connect(ctx.destination);
  music.ctx = ctx;
  music.filter = filter;
  music.master = master;
  // Apply mute state to any preloaded sfx audios as well
  for (const name in sfx) sfx[name].volume = isMuted ? 0 : (sfxVols[name] ?? 1);

  const playNoteAt = (freq, start, duration, type, vol) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g);
    g.connect(filter);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  };

  // Soft minor-to-major vibe. Each chord holds for 4 beats.
  const chords = [
    [164.81, 196.00, 246.94], // E minor
    [146.83, 174.61, 220.00], // D minor
    [174.61, 220.00, 261.63], // F major
    [196.00, 246.94, 293.66], // G major
  ];

  const bpm = 58;
  const beatSec = 60 / bpm;
  let beat = 0;
  let nextBeat = ctx.currentTime + 0.25;
  const tick = () => {
    const horizon = ctx.currentTime + 0.3;
    while (nextBeat < horizon) {
      const chord = chords[Math.floor(beat / 4) % chords.length];
      // Pad (triangle, long, soft) at every chord change
      if (beat % 4 === 0) {
        for (const f of chord) playNoteAt(f, nextBeat, beatSec * 4.5, 'triangle', 0.09);
      }
      // Arpeggio (sine, short) every 2 beats — up one octave
      if (beat % 2 === 0) {
        const note = chord[(beat / 2) % chord.length];
        playNoteAt(note * 2, nextBeat, beatSec * 1.3, 'sine', 0.07);
      }
      // Occasional high blip, rare
      if (Math.random() < 0.12) {
        const note = chord[(beat + 1) % chord.length];
        playNoteAt(note * 4, nextBeat + beatSec * 0.5, 0.4, 'sine', 0.04);
      }
      nextBeat += beatSec;
      beat = (beat + 1) % 1024;
    }
  };
  setInterval(tick, 60);
}

// First user gesture: prime the audio context for music
document.addEventListener('pointerdown', () => startMusic(), { once: true });
document.addEventListener('keydown', () => startMusic(), { once: true });

let bannerTimer = 0;
function showBanner(text, durationMs = 1500) {
  const el = document.getElementById('banner');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), durationMs);
}

// ---------- Scoreboard API (talks to server.js) ----------

async function apiFetchScores(game = 'cookies') {
  try {
    const r = await fetch(`/api/scores?game=${encodeURIComponent(game)}`, { cache: 'no-store' });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

async function apiSubmitScore(entry, game = 'cookies') {
  try {
    const r = await fetch(`/api/scores?game=${encodeURIComponent(game)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function renderScoreboard(top, highlightRank = -1) {
  const ol = document.getElementById('scoreboard-list');
  ol.innerHTML = '';
  if (!top || !top.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="rk">–</span><span class="nm">sé el primero</span>';
    ol.appendChild(li);
    return;
  }
  top.forEach((s, i) => {
    const li = document.createElement('li');
    if (i === highlightRank) li.classList.add('me');
    li.innerHTML =
      `<span class="rk">${i + 1}</span>` +
      `<span class="nm">${escapeHtml(s.name)}</span>` +
      `<span class="sc">${s.cookies}/${s.total}</span>` +
      `<span class="tm">${s.seconds.toFixed(1)}s</span>`;
    ol.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---------- Splash + end modals ----------

let splashTarget = null; // which game the splash is for
function showSplashModal(game) {
  splashTarget = game;
  const m = document.getElementById('splash-modal');
  const panel = m.querySelector('.panel');
  const h1 = panel.querySelector('h1');
  const p  = panel.querySelector('p');
  if (game === 'cocacola') {
    h1.innerHTML = 'COCA CON COCA';
    h1.style.color = '#ff4a4a';
    h1.style.textShadow = '0 0 14px rgba(255,74,74,.7)';
    p.textContent = 'encontrá la lata y la botella lo antes posible';
  } else {
    h1.innerHTML = 'DAME MI GALLETITA<br>Y ME VOY';
    h1.style.color = '#ffcc4a';
    h1.style.textShadow = '0 0 14px rgba(255,204,74,.7)';
    p.textContent = 'agarrá todas las galletitas antes que se acabe el tiempo';
  }
  m.classList.add('show');
  if (document.pointerLockElement) document.exitPointerLock();
}
function hideSplashModal() {
  document.getElementById('splash-modal').classList.remove('show');
}

async function showEndModal({ game, won, detail, canSubmit = true }) {
  const m = document.getElementById('end-modal');
  const title = document.getElementById('end-title');
  title.textContent = won ? 'GANASTE' : 'PERDISTE';
  title.style.color = won ? '#7fffa0' : '#ff7a7a';
  title.style.textShadow = won
    ? '0 0 14px rgba(127,255,160,.7)'
    : '0 0 14px rgba(255,122,122,.7)';

  document.getElementById('end-result-detail').textContent = detail;

  document.getElementById('end-name-input').style.display = canSubmit ? 'block' : 'none';
  const input = document.getElementById('name-field');
  input.value = localStorage.getItem('boni64.playerName') || '';

  const top = await apiFetchScores(game);
  renderScoreboard(top, -1);

  m.classList.add('show');
  if (document.pointerLockElement) document.exitPointerLock();
  if (canSubmit) input.focus();
}
function hideEndModal() {
  document.getElementById('end-modal').classList.remove('show');
}

// Wire up buttons once (after DOM is ready — this script is type=module at end)
function reacquireLock() {
  // Called inside user-gesture handlers so requestPointerLock succeeds.
  try { renderer.domElement.requestPointerLock(); } catch {}
}

document.getElementById('boni-start').addEventListener('click', () => {
  document.getElementById('boni-splash').classList.remove('show');
  reacquireLock();
  startMusic();
});

document.getElementById('splash-start').addEventListener('click', () => {
  hideSplashModal();
  if (splashTarget === 'cocacola') loadLevel(cocaColaLevel);
  else loadLevel(cookieMazeLevel);
  reacquireLock();
});
document.getElementById('splash-back').addEventListener('click', () => {
  hideSplashModal();
  reacquireLock();
});
document.getElementById('save-score').addEventListener('click', async () => {
  const input = document.getElementById('name-field');
  const name = (input.value || '').trim().slice(0, 16);
  if (!name) { input.focus(); return; }
  localStorage.setItem('boni64.playerName', name);
  const pending = window.__pendingScore;
  if (!pending) return;
  const resp = await apiSubmitScore({ name, ...pending.entry }, pending.game);
  if (resp) {
    renderScoreboard(resp.top, resp.rank);
  } else {
    showBanner('error guardando el score', 1800);
  }
  document.getElementById('end-name-input').style.display = 'none';
  window.__pendingScore = null;
});
document.getElementById('end-restart').addEventListener('click', () => {
  hideEndModal();
  if (currentLevelFactory && currentLevelFactory !== hubLevel) {
    loadLevel(currentLevelFactory);
  } else {
    loadLevel(cookieMazeLevel);
  }
  reacquireLock();
});
document.getElementById('end-hub').addEventListener('click', () => {
  hideEndModal();
  loadLevel(hubLevel);
  reacquireLock();
});

// ============================================================
// Levels: hub + cookieMaze
// ============================================================

const hubLevel = {
  name: 'hub',
  setup(group, state) {
    state.config.title = 'HUB';
    // Spawn way back so the opening shot frames both buildings nicely
    state.config.spawn.set(0, 0, -90);
    state.config.spawnFacing = 0;
    // Push fog far so the buildings read at distance in the hub
    state.config.fogNear = 110;
    state.config.fogFar = 360;

    groundPlane(group);
    neonGrid(group);

    // Two big TRON buildings, separated so there's room between them
    const bA = { x: -45, z: 40 };
    const bB = { x:  45, z: 40 };
    building(group, state, bA.x, bA.z, 50, 40, 32, 'dame mi galletita',
      () => showSplashModal('cookies'), 0xffa500);
    building(group, state, bB.x, bB.z, 50, 40, 32, 'coca con coca',
      () => showSplashModal('cocacola'), 0xff2a2a);

    // Scatter a bunch of decorative neon blocks around the hub. We keep them
    // away from:
    //   - the spawn area
    //   - directly in front of / next to the buildings
    //   - the central corridor the player will walk through
    const spawnSafe = 18;
    const buildingSafe = 32;
    const corridorX = 14;   // |x| < this is the approach corridor
    const corridorZ = [-70, 22]; // z range of the corridor
    const palette = [0x00e8ff, 0xff3cf0, 0x7fff6a, 0xffa050];
    const scatter = 22;
    for (let i = 0; i < scatter; i++) {
      let x = 0, z = 0, ok = false;
      for (let a = 0; a < 40; a++) {
        const tx = (Math.random() - 0.5) * 220;
        const tz = (Math.random() - 0.5) * 200;
        if (tx * tx + (tz + 90) * (tz + 90) < spawnSafe * spawnSafe) continue;
        if ((tx - bA.x) ** 2 + (tz - bA.z) ** 2 < buildingSafe * buildingSafe) continue;
        if ((tx - bB.x) ** 2 + (tz - bB.z) ** 2 < buildingSafe * buildingSafe) continue;
        if (Math.abs(tx) < corridorX && tz > corridorZ[0] && tz < corridorZ[1]) continue;
        x = tx; z = tz; ok = true; break;
      }
      if (!ok) continue;
      const size = 1.2 + Math.random() * 2.4;
      const h = 0.6 + Math.random() * 3.2;
      const color = palette[(Math.random() * palette.length) | 0];
      neonBox(group, state.walls, x, z, size, h, color);
    }
  },
};

// Randomized depth-first maze generator. Width/height should be odd (if not,
// they get rounded up). Returns an array of strings where 'W' = wall, '.' = open.
function generateMaze(w, h) {
  if (w % 2 === 0) w++;
  if (h % 2 === 0) h++;
  const grid = Array.from({ length: h }, () => new Array(w).fill('W'));
  const stack = [[1, 1]];
  grid[1][1] = '.';
  const dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    let moved = false;
    for (const [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz;
      if (nx > 0 && nx < w - 1 && nz > 0 && nz < h - 1 && grid[nz][nx] === 'W') {
        grid[nz - dz / 2][nx - dx / 2] = '.';
        grid[nz][nx] = '.';
        stack.push([nx, nz]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }
  return grid.map(row => row.join(''));
}

// ---------- Coca con Coca: can & bottle procedural meshes ----------

function makeCanMesh() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({
    color: 0xd51e20, emissive: 0x6a1010, emissiveIntensity: 0.6,
    roughness: 0.35, metalness: 0.4,
  });
  const white = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xbbbbbb, emissiveIntensity: 0.35,
    roughness: 0.5, metalness: 0.15,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x9aa0a6, roughness: 0.25, metalness: 0.9,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.2, 24), red);
  g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.22, 24), white);
  band.position.y = 0.12;
  g.add(band);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.36, 0.06, 24), metal);
  top.position.y = 0.62;
  g.add(top);
  const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.35, 0.06, 24), metal);
  bot.position.y = -0.62;
  g.add(bot);
  return g;
}

function makeBottleMesh() {
  const pts = [];
  // Contour bottle profile (rough Coca-Cola shape)
  const prof = [
    [0.00, -1.30], [0.38, -1.30],
    [0.40, -1.15], [0.42, -0.80],
    [0.42, -0.10], [0.40,  0.20],
    [0.30,  0.45], [0.28,  0.70],
    [0.30,  0.95], [0.22,  1.10],
    [0.18,  1.25], [0.20,  1.35],
    [0.18,  1.45], [0.00,  1.45],
  ];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const geom = new THREE.LatheGeometry(pts, 20);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xa81a1a, emissive: 0x5a1010, emissiveIntensity: 0.7,
    roughness: 0.28, metalness: 0.1,
  });
  return new THREE.Mesh(geom, mat);
}

const COCA_HEIGHT = 1.5; // where the can/bottle center floats

function cocaItem(group, state, x, z, kind /* 'can' | 'bottle' */) {
  const m = kind === 'can' ? makeCanMesh() : makeBottleMesh();
  m.position.set(x, COCA_HEIGHT, z);
  m.userData.spin = Math.random() * Math.PI * 2;
  m.userData.isCocaItem = true;
  group.add(m);
  state.pickups.push({
    object: m,
    position: m.position.clone(),
    radius: 2.5,
    onCollect: () => {
      group.remove(m);
      disposeObject3D(m);
      state.data.found = state.data.found || {};
      const other = kind === 'can' ? 'bottle' : 'can';
      const hadOther = !!state.data.found[other];
      state.data.found[kind] = true;
      if (hadOther) {
        playSound('cocaconcoca');
        endCocaLevel(state, true);
      } else {
        playSound(kind === 'can' ? 'latafaltabotella' : 'botellafaltalata');
        showBanner(kind === 'can' ? 'lata conseguida!' : 'botella conseguida!', 900);
      }
    },
  });
}

function endCocaLevel(state, won) {
  if (state.data.ended) return;
  state.data.ended = true;
  const secondsUsed = state.data.timeElapsed || 0;
  if (won) {
    showBigBanner('COCA CON COCA', 2200);
  }
  window.__pendingScore = {
    game: 'cocacola',
    entry: { seconds: secondsUsed, won, cookies: 0, total: 0 },
  };
  // Delay so the big banner is visible before the modal covers it
  setTimeout(() => {
    showEndModal({
      game: 'cocacola',
      won,
      detail: won
        ? `tiempo: ${secondsUsed.toFixed(1)}s`
        : `se acabó el tiempo — tiempo máximo alcanzado`,
      canSubmit: won, // only winners can save a time
    });
  }, won ? 1800 : 300);
}

function showBigBanner(text, durationMs = 2000) {
  const el = document.getElementById('banner');
  if (!el) return;
  el.textContent = text;
  el.style.fontSize = '48px';
  el.style.color = '#ff4040';
  el.style.borderColor = 'rgba(255,60,60,.8)';
  el.style.textShadow = '0 0 20px rgba(255,40,40,.9)';
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    el.classList.remove('show');
    // restore defaults
    el.style.fontSize = '';
    el.style.color = '';
    el.style.borderColor = '';
    el.style.textShadow = '';
  }, durationMs);
}

function endMazeLevel(state, won) {
  if (state.data.ended) return;
  state.data.ended = true;
  const score = state.data.score || 0;
  const total = state.data.totalCookies || 0;
  const secondsUsed = Math.max(0, state.data.timeLimit - state.data.timeLeft);
  if (won) playSound('ricagalle');
  window.__pendingScore = {
    game: 'cookies',
    entry: { cookies: score, total, seconds: secondsUsed, won },
  };
  showEndModal({
    game: 'cookies',
    won,
    detail: `galletitas: ${score} / ${total}   ·   tiempo: ${secondsUsed.toFixed(1)}s`,
  });
}

const cookieMazeLevel = {
  name: 'cookieMaze',
  setup(group, state) {
    state.config.title = 'DAME MI GALLETITA';
    state.config.bgColor = 0x1a0e08;
    state.config.fogColor = 0x1a0e08;
    state.config.fogNear = 30;
    state.config.fogFar = 110;
    state.config.sunColor = 0xffc688;
    state.config.sunIntensity = 0.8;
    state.config.hemiColor = 0x8a4020;
    state.config.hemiIntensity = 0.6;
    // Elevated, near-top-down camera so the walls don't occlude the player
    state.config.camDistance = 30;
    state.config.camPitch = -0.95;     // nearly looking straight down
    state.config.camHeightOffset = 0;  // target = player's feet

    groundPlane(group, 0x14080a);
    neonGrid(group, 200, 40, 0xffa030, 0x8a5a20, 0.6);

    // Random maze + cookies
    const cellSize = 9;
    const gridW = 15, gridH = 15;
    const layout = generateMaze(gridW, gridH);
    const offsetX = -(gridW - 1) / 2 * cellSize;
    const offsetZ = -(gridH - 1) / 2 * cellSize;

    state.data.score = 0;
    state.data.totalCookies = 0;
    state.data.timeLimit = 60;
    state.data.timeLeft = 60;
    state.data.ended = false;
    state.data._lastSec = -1;

    // Kick off the intro sound
    playSound('damegalle');

    for (let z = 0; z < gridH; z++) {
      for (let x = 0; x < gridW; x++) {
        const ch = layout[z][x];
        const wx = offsetX + x * cellSize;
        const wz = offsetZ + z * cellSize;
        if (ch === 'W') {
          neonBox(group, state.walls, wx, wz, cellSize, 5.0, 0xffa030, true);
        } else {
          if (x === 1 && z === 1) {
            // spawn cell, skip cookie
            state.config.spawn.set(wx, 0, wz);
          } else {
            cookie(group, state, wx, wz);
            state.data.totalCookies++;
          }
        }
      }
    }
  },
};

const cocaColaLevel = {
  name: 'cocaCola',
  setup(group, state) {
    state.config.title = 'COCA CON COCA';
    state.config.bgColor = 0x130606;
    state.config.fogColor = 0x130606;
    state.config.fogNear = 35;
    state.config.fogFar = 110;
    state.config.sunColor = 0xff8a6a;
    state.config.sunIntensity = 0.75;
    state.config.hemiColor = 0x661414;
    state.config.hemiIntensity = 0.55;
    // Standard 3rd-person so the player actually has to explore (walls hide items)
    state.config.camDistance = 18;
    state.config.camPitch = -0.32;
    state.config.camHeightOffset = 3.5;

    groundPlane(group, 0x0c0404);
    neonGrid(group, 200, 40, 0xff2020, 0x8a1010, 0.75);

    // Arena bounds: perimeter walls, 90 x 90
    const bound = 45;
    const bh = 6;
    const buildLongWall = (cx, cz, sx, sy, sz, color) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      const body = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        color: 0x0a0404, roughness: 0.5, metalness: 0.35,
      }));
      body.position.set(cx, sy / 2, cz);
      body.castShadow = body.receiveShadow = true;
      group.add(body);
      const e = new THREE.LineSegments(
        new THREE.EdgesGeometry(g),
        new THREE.LineBasicMaterial({ color })
      );
      e.position.copy(body.position);
      group.add(e);
      state.walls.push({ aabb: new THREE.Box3(
        new THREE.Vector3(cx - sx / 2, 0, cz - sz / 2),
        new THREE.Vector3(cx + sx / 2, sy, cz + sz / 2),
      )});
    };
    buildLongWall(0,  bound + 1, (bound + 1) * 2, bh, 2, 0xff3030); // north
    buildLongWall(0, -bound - 1, (bound + 1) * 2, bh, 2, 0xff3030); // south
    buildLongWall( bound + 1, 0, 2, bh, (bound + 1) * 2, 0xff3030); // east
    buildLongWall(-bound - 1, 0, 2, bh, (bound + 1) * 2, 0xff3030); // west

    // Scatter obstacles
    const obstacles = [];
    const numObstacles = 18;
    for (let i = 0; i < numObstacles; i++) {
      let x = 0, z = 0;
      for (let a = 0; a < 30; a++) {
        const tx = (Math.random() - 0.5) * (bound * 1.8);
        const tz = (Math.random() - 0.5) * (bound * 1.8);
        if (tx * tx + tz * tz < 64) continue; // keep spawn area clear
        let tooClose = false;
        for (const o of obstacles) {
          if ((tx - o.x) ** 2 + (tz - o.z) ** 2 < 64) { tooClose = true; break; }
        }
        if (!tooClose) { x = tx; z = tz; break; }
      }
      const size = 3 + Math.random() * 3;
      const h = 4 + Math.random() * 3;
      const color = Math.random() < 0.5 ? 0xff2020 : 0xff8040;
      neonBox(group, state.walls, x, z, size, h, color, true);
      obstacles.push({ x, z, size });
    }

    // Spawn at center
    state.config.spawn.set(0, 0, 0);

    // Place can and bottle at random spots, far from each other and spawn
    const pickSpot = () => {
      for (let a = 0; a < 50; a++) {
        const x = (Math.random() - 0.5) * (bound * 1.7);
        const z = (Math.random() - 0.5) * (bound * 1.7);
        if (x * x + z * z < 100) continue;
        let bad = false;
        for (const o of obstacles) {
          const r = o.size / 2 + 2;
          if ((x - o.x) ** 2 + (z - o.z) ** 2 < r * r) { bad = true; break; }
        }
        if (!bad) return { x, z };
      }
      return { x: (Math.random() - 0.5) * 40, z: (Math.random() - 0.5) * 40 };
    };
    const canPos = pickSpot();
    let bottlePos;
    for (let a = 0; a < 30; a++) {
      bottlePos = pickSpot();
      if ((bottlePos.x - canPos.x) ** 2 + (bottlePos.z - canPos.z) ** 2 > 400) break;
    }
    cocaItem(group, state, canPos.x, canPos.z, 'can');
    cocaItem(group, state, bottlePos.x, bottlePos.z, 'bottle');

    state.data.found = { can: false, bottle: false };
    state.data.timeElapsed = 0;
    state.data.timeLimit = 90; // you fail if you don't find both in 90s
    state.data.ended = false;
    state.data._lastSec = -1;
  },
};

// ============================================================
// Camera (third-person orbit with pointer lock)
// ============================================================

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);

const camRig = {
  yaw: 0,
  pitch: -0.25,
  distance: 20,
  target: new THREE.Vector3(),
  minPitch: -1.2,
  maxPitch: 0.6,
  minDistance: 2,
  maxDistance: 40,
  sensitivity: 0.0025,
  zoomSpeed: 1.2,
  heightOffset: 4.5, // camera looks at this height above character's feet
};

// ============================================================
// Input
// ============================================================

const keys = new Set();
const input = { forward: 0, right: 0, jump: false, run: false };

addEventListener('keydown', (e) => {
  // Ignore key events while focus is inside the dev panel (so typing in the
  // key-bind input doesn't trigger an action)
  if (e.target instanceof HTMLElement && e.target.closest('#dev')) return;
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  // One-shot trigger: map KeyX -> 'X'
  const letter = e.code.startsWith('Key') ? e.code.slice(3) : null;
  if (letter) {
    for (const [idxStr, k] of Object.entries(mapping.keys)) {
      if (k === letter) { triggerOneShot(Number(idxStr)); break; }
    }
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function readInput() {
  let f = 0, r = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
  input.forward = f;
  input.right = r;
  input.jump = keys.has('Space');
  input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
}

// Pointer lock
const clickOverlay = document.getElementById('click-to-play');
clickOverlay.addEventListener('click', () => renderer.domElement.requestPointerLock());
renderer.domElement.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  clickOverlay.classList.toggle('hidden', locked);
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  camRig.yaw -= e.movementX * camRig.sensitivity;
  camRig.pitch -= e.movementY * camRig.sensitivity;
  camRig.pitch = Math.max(camRig.minPitch, Math.min(camRig.maxPitch, camRig.pitch));
});
addEventListener('wheel', (e) => {
  camRig.distance += Math.sign(e.deltaY) * camRig.zoomSpeed;
  camRig.distance = Math.max(camRig.minDistance, Math.min(camRig.maxDistance, camRig.distance));
}, { passive: true });

addEventListener('resize', () => {
  applyRenderSize();
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// Live resolution controls: Minus / Equal (i.e. '-' and '+')
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && e.target.closest('#dev')) return;
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
    renderScale = Math.max(0.4, Math.round((renderScale - 0.1) * 10) / 10);
    applyRenderSize();
    flashNote(`res x${renderScale.toFixed(1)}`);
  } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
    renderScale = Math.min(1.5, Math.round((renderScale + 0.1) * 10) / 10);
    applyRenderSize();
    flashNote(`res x${renderScale.toFixed(1)}`);
  } else if (e.code === 'F2') {
    // Toggle shadows for a quick fps boost
    renderer.shadowMap.enabled = !renderer.shadowMap.enabled;
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    flashNote(`shadows ${renderer.shadowMap.enabled ? 'on' : 'off'}`);
  } else if (e.code === 'Backquote') {
    document.getElementById('dev').classList.toggle('open');
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (e.code === 'BracketLeft') {
    character.modelYawOffset -= Math.PI / 12; // -15°
    if (character.model) character.model.rotation.y = character.modelYawOffset;
    localStorage.setItem(LS_YAW_KEY, String(character.modelYawOffset));
    flashNote(`modelo yaw ${(character.modelYawOffset * 180 / Math.PI).toFixed(0)}°`);
  } else if (e.code === 'BracketRight') {
    character.modelYawOffset += Math.PI / 12; // +15°
    if (character.model) character.model.rotation.y = character.modelYawOffset;
    localStorage.setItem(LS_YAW_KEY, String(character.modelYawOffset));
    flashNote(`modelo yaw ${(character.modelYawOffset * 180 / Math.PI).toFixed(0)}°`);
  } else if (e.code === 'KeyM') {
    setMuted(!isMuted);
    flashNote(isMuted ? 'muted' : 'unmuted');
  }
});

let noteTimer = 0;
function flashNote(text) {
  const el = document.getElementById('state-label');
  const prev = el.textContent;
  el.textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { el.textContent = prev; }, 900);
}

// ============================================================
// Character
// ============================================================

const character = {
  root: new THREE.Group(),            // we drive this in world space
  model: null,                        // the loaded GLTF scene
  mixer: null,
  actions: [],                        // THREE.AnimationAction per clip
  clipNames: [],                      // original clip names (NlaTrack.00X)
  velocity: new THREE.Vector3(),
  onGround: true,
  facing: 0,                          // current Y rotation
  walkSpeed: 10.5,
  runSpeed: 28.0,
  jumpSpeed: 17.0,
  gravity: -36.0,
  turnSpeed: 12,                      // how fast the character rotates to face movement
  rootBoneName: 'Root',               // to strip in-place root motion
  rootBone: null,                     // assigned after load
  modelYawOffset: 0,                  // added to model rotation so its "front" faces +Z
  needsGroundAlign: true,             // re-measure bbox after first animated frame
  _stepAccum: -1,                     // footstep timer accumulator
};
const LS_YAW_KEY = 'boni64.modelYawOffset';
character.modelYawOffset = parseFloat(localStorage.getItem(LS_YAW_KEY) || '3.14159265') || Math.PI;
scene.add(character.root);

// ============================================================
// Animation state machine
// ============================================================

// States we care about in the game.
const STATES = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'walk_back', 'crouch', 'hit', 'death', 'dance', 'wave', 'attack'];

// Persisted config: { states: {state: clipIndex}, keys: {clipIndex: 'F'} }
const DEFAULT_MAPPING = {
  states: {
    idle: 5, walk: 7, run: 0, jump: 9, land: 6,
    attack: 1, dance: 2, wave: 4, hit: 8,
  },
  keys: { 2: 'R', 8: 'E' },
};
const LS_KEY = 'boni64.animMapping';

function loadMapping() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_MAPPING);
    const parsed = JSON.parse(raw);
    // Migrate old flat format
    if (!parsed.states && !parsed.keys) {
      return { states: { ...DEFAULT_MAPPING.states, ...parsed }, keys: {} };
    }
    return {
      states: { ...DEFAULT_MAPPING.states, ...(parsed.states ?? {}) },
      keys: { ...DEFAULT_MAPPING.keys, ...(parsed.keys ?? {}) },
    };
  } catch { return structuredClone(DEFAULT_MAPPING); }
}
function saveMapping(m) {
  localStorage.setItem(LS_KEY, JSON.stringify(m));
}
let mapping = loadMapping();
// Migration: strip any key binding on F (wave action no longer exposed).
for (const idx of Object.keys(mapping.keys)) {
  if (mapping.keys[idx] === 'F') delete mapping.keys[idx];
}

const anim = {
  current: null,       // currently-playing THREE.AnimationAction for the game state
  currentState: null,
  preview: null,       // currently-playing preview action (overrides game state)
  oneShot: null,       // { action, endAt } when a key-triggered one-shot is playing
};

function actionForState(state) {
  const idx = mapping.states[state];
  if (idx == null) return null;
  return character.actions[idx] ?? null;
}

function playState(state, fadeDuration = 0.2) {
  if (anim.preview) return; // previewing overrides state
  if (anim.oneShot) return; // one-shot overrides state
  if (anim.currentState === state) return;
  const next = actionForState(state);
  if (!next) return;
  if (anim.current && anim.current !== next) {
    anim.current.fadeOut(fadeDuration);
  }
  next.reset().fadeIn(fadeDuration).play();
  anim.current = next;
  anim.currentState = state;
  document.getElementById('state-label').textContent = state;
}

// Builds a procedural jump clip from scratch by rotating individual bones
// relative to their rest (bind) pose. Knees up, arms raised, slight lean.
function buildProceduralJump(model) {
  const names = ['L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf',
                 'L_Upperarm', 'R_Upperarm', 'Spine02'];
  const bones = {};
  model.traverse(o => { if (o.isBone && names.includes(o.name)) bones[o.name] = o; });

  const times = [0.00, 0.18, 0.40];
  const tracks = [];
  const tmpE = new THREE.Euler();
  const tmpD = new THREE.Quaternion();
  const tmpQ = new THREE.Quaternion();

  function addTrack(bone, eulersPerKey) {
    if (!bone) return;
    const bind = bone.quaternion.clone();
    const values = [];
    for (const e of eulersPerKey) {
      tmpE.set(e[0] || 0, e[1] || 0, e[2] || 0, 'XYZ');
      tmpD.setFromEuler(tmpE);
      tmpQ.copy(bind).multiply(tmpD); // apply delta in bone-local space
      values.push(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${bone.name}.quaternion`, times, values
    ));
  }

  // Legs: thighs rotate forward (knees up), calves fold back (tuck feet under).
  // Clip ends at max tuck; with clampWhenFinished the pose holds until 'land'.
  addTrack(bones.L_Thigh, [[0.2], [1.2], [1.3]]);
  addTrack(bones.R_Thigh, [[0.2], [1.2], [1.3]]);
  addTrack(bones.L_Calf,  [[-0.3], [-1.5], [-1.6]]);
  addTrack(bones.R_Calf,  [[-0.3], [-1.5], [-1.6]]);
  addTrack(bones.L_Upperarm, [[0, 0, 0.5], [0, 0, 1.6], [0, 0, 1.7]]);
  addTrack(bones.R_Upperarm, [[0, 0, -0.5], [0, 0, -1.6], [0, 0, -1.7]]);
  addTrack(bones.Spine02, [[0.1], [0.3], [0.3]]);

  return new THREE.AnimationClip('proceduralJump', 0.40, tracks);
}

// Quick right-hand punch. Wind-up → extend → return, ~0.4s total.
function buildProceduralAttack(model) {
  const names = ['R_Upperarm', 'R_Forearm', 'L_Upperarm', 'L_Forearm', 'Spine02'];
  const bones = {};
  model.traverse(o => { if (o.isBone && names.includes(o.name)) bones[o.name] = o; });

  const times = [0.00, 0.09, 0.20, 0.40];
  const tracks = [];
  const tmpE = new THREE.Euler();
  const tmpD = new THREE.Quaternion();
  const tmpQ = new THREE.Quaternion();

  function addTrack(bone, eulersPerKey) {
    if (!bone) return;
    const bind = bone.quaternion.clone();
    const values = [];
    for (const e of eulersPerKey) {
      tmpE.set(e[0] || 0, e[1] || 0, e[2] || 0, 'XYZ');
      tmpD.setFromEuler(tmpE);
      tmpQ.copy(bind).multiply(tmpD);
      values.push(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${bone.name}.quaternion`, times, values
    ));
  }

  // Right arm: wind-up → extended punch → return to guard
  addTrack(bones.R_Upperarm, [
    [0, 0, 0],          // neutral
    [-0.4, 0, -0.55],   // wind-up: pulled back + raised
    [1.35, 0, -0.3],    // punch: forward thrust at shoulder height
    [0.1, 0, 0],        // return
  ]);
  addTrack(bones.R_Forearm, [
    [0, 0, 0],
    [1.9, 0, 0],        // elbow cocked
    [0.1, 0, 0],        // snap straight
    [0.25, 0, 0],
  ]);
  // Left arm guard: raises into a defensive position
  addTrack(bones.L_Upperarm, [
    [0, 0, 0],
    [0.3, 0, 0.35],
    [0.55, 0, 0.5],
    [0.1, 0, 0.1],
  ]);
  addTrack(bones.L_Forearm, [
    [0, 0, 0],
    [1.3, 0, 0],
    [1.3, 0, 0],
    [0.4, 0, 0],
  ]);
  // Torso twist: load energy by rotating away, then follow through into the punch
  addTrack(bones.Spine02, [
    [0, 0, 0],
    [0, 0.35, 0],
    [0, -0.35, 0],
    [0, 0, 0],
  ]);

  return new THREE.AnimationClip('proceduralAttack', 0.40, tracks);
}

function triggerOneShot(clipIndex) {
  if (anim.preview) return;
  const a = character.actions[clipIndex];
  if (!a) return;
  // Stop state action
  if (anim.current) anim.current.fadeOut(0.08);
  a.reset();
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true;
  a.fadeIn(0.08).play();
  anim.oneShot = { action: a, endAt: performance.now() + a._clip.duration * 1000 };
  anim.current = null;
  anim.currentState = null;
  document.getElementById('state-label').textContent = `action #${clipIndex}`;
}

function playPreview(index) {
  stopPreview(false);
  const a = character.actions[index];
  if (!a) return;
  // Stop state action while previewing
  if (anim.current) anim.current.stop();
  a.reset().fadeIn(0.15).play();
  anim.preview = { index, action: a };
  document.getElementById('state-label').textContent = `preview #${index}`;
  updateDevActiveRow();
}
function stopPreview(resumeState = true) {
  if (anim.preview) {
    anim.preview.action.fadeOut(0.15);
    anim.preview = null;
  }
  updateDevActiveRow();
  if (resumeState && anim.currentState) {
    const state = anim.currentState;
    anim.currentState = null; // force re-trigger
    anim.current = null;
    playState(state, 0.15);
  }
}

// ============================================================
// Dev panel
// ============================================================

function buildDevPanel() {
  const rowsEl = document.getElementById('dev-rows');
  rowsEl.innerHTML = '';
  character.clipNames.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.index = String(i);

    const idx = document.createElement('div');
    idx.className = 'idx';
    idx.textContent = `#${i}`;

    const btn = document.createElement('button');
    btn.className = 'preview';
    const dur = character.actions[i]?._clip?.duration?.toFixed(2) ?? '?';
    btn.textContent = `${name}  (${dur}s)`;
    btn.title = 'Previsualizar';
    btn.addEventListener('click', () => playPreview(i));

    const sel = document.createElement('select');
    sel.innerHTML = `<option value="">—</option>` +
      STATES.map(s => `<option value="${s}">${s}</option>`).join('');
    for (const s of STATES) if (mapping.states[s] === i) sel.value = s;
    sel.addEventListener('change', () => {
      const newState = sel.value;
      if (newState) {
        rowsEl.querySelectorAll('select').forEach(other => {
          if (other !== sel && other.value === newState) other.value = '';
        });
        for (const s of STATES) if (mapping.states[s] === i) mapping.states[s] = null;
        mapping.states[newState] = i;
      } else {
        for (const s of STATES) if (mapping.states[s] === i) mapping.states[s] = null;
      }
    });

    const keyInp = document.createElement('input');
    keyInp.type = 'text';
    keyInp.maxLength = 1;
    keyInp.className = 'key';
    keyInp.placeholder = '—';
    keyInp.title = 'Tecla one-shot (una letra)';
    keyInp.value = (mapping.keys[i] ?? '').toUpperCase();
    keyInp.addEventListener('input', () => {
      const v = keyInp.value.trim().toUpperCase().slice(0, 1);
      keyInp.value = v;
      // Clear same key from other inputs
      if (v) {
        rowsEl.querySelectorAll('input.key').forEach(other => {
          if (other !== keyInp && other.value === v) {
            other.value = '';
            const oi = Number(other.closest('.row').dataset.index);
            delete mapping.keys[oi];
          }
        });
        mapping.keys[i] = v;
      } else {
        delete mapping.keys[i];
      }
    });

    row.append(idx, btn, sel, keyInp);
    rowsEl.appendChild(row);
  });
  updateDevActiveRow();
}
function updateDevActiveRow() {
  const rowsEl = document.getElementById('dev-rows');
  rowsEl.querySelectorAll('.row').forEach(r => {
    const i = Number(r.dataset.index);
    const active = anim.preview && anim.preview.index === i;
    r.querySelector('button.preview').classList.toggle('active', !!active);
  });
}

document.getElementById('dev-stop').addEventListener('click', () => stopPreview(true));
document.getElementById('dev-save').addEventListener('click', () => {
  saveMapping(mapping);
  const btn = document.getElementById('dev-save');
  const prev = btn.textContent;
  btn.textContent = 'Guardado ✓';
  setTimeout(() => (btn.textContent = prev), 900);
});

// ============================================================
// Model load
// ============================================================

const loader = new GLTFLoader();
loader.load('./boni.glb', (gltf) => {
  const model = gltf.scene;

  // Compute bounding box to auto-scale and place on ground
  const bbox = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3(); bbox.getSize(size);
  const desiredHeight = 1.8;
  const scale = desiredHeight / Math.max(size.y, 0.01);
  model.scale.setScalar(scale);

  // Recompute after scaling to put feet on y=0
  const bbox2 = new THREE.Box3().setFromObject(model);
  model.position.y -= bbox2.min.y;

  // Shadows + self-illumination so the character reads well in the dark scene.
  // We reuse the albedo map as the emissive map: the character glows with its
  // own colors instead of depending entirely on scene lighting.
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // skinned bounds can be wrong
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        if (!m) return;
        if ('emissive' in m) {
          m.emissive = new THREE.Color(0xffffff);
          m.emissiveIntensity = 0.55;  // tweak: 0 = off, 1 = fully glowing
          if (m.map && 'emissiveMap' in m) m.emissiveMap = m.map;
          if ('roughness' in m) m.roughness = Math.min(m.roughness ?? 1, 0.85);
          m.needsUpdate = true;
        }
      });
    }
    if (o.isBone && o.name === character.rootBoneName) {
      character.rootBone = o;
    }
  });

  character.root.add(model);
  character.model = model;
  model.rotation.y = character.modelYawOffset;

  // Animation mixer: target the model so all clips apply to its skeleton
  character.mixer = new THREE.AnimationMixer(model);
  character.actions = gltf.animations.map((clip) => {
    const a = character.mixer.clipAction(clip);
    a.enabled = true;
    a.setLoop(THREE.LoopRepeat);
    a._clip = clip;
    return a;
  });
  character.clipNames = gltf.animations.map(c => c.name || '(unnamed)');

  // Build procedural clips (jump, attack). Done BEFORE any action plays
  // so we capture bind-pose bone rotations as the reference.
  const registerProcedural = (clip, stateName, loopOnce = true, keyBind = null) => {
    if (!clip || clip.tracks.length === 0) return;
    const action = character.mixer.clipAction(clip);
    action.enabled = true;
    action.setLoop(loopOnce ? THREE.LoopOnce : THREE.LoopRepeat, loopOnce ? 1 : Infinity);
    action.clampWhenFinished = loopOnce;
    action._clip = clip;
    character.actions.push(action);
    character.clipNames.push(`${clip.name} (auto)`);
    const newIdx = character.actions.length - 1;
    if (stateName) mapping.states[stateName] = newIdx;
    if (keyBind) {
      // Drop any existing bone binding on that key, then bind to our new clip
      for (const idx of Object.keys(mapping.keys)) {
        if (mapping.keys[idx] === keyBind) delete mapping.keys[idx];
      }
      mapping.keys[newIdx] = keyBind;
    }
  };
  registerProcedural(buildProceduralJump(model), 'jump', true, null);
  registerProcedural(buildProceduralAttack(model), 'attack', true, null);

  buildDevPanel();

  // Start with idle
  playState('idle', 0);

  // Load the starting level (sets camera yaw + spawn position)
  loadLevel(hubLevel);

  // Kick off loop
  lastT = performance.now();
  requestAnimationFrame(tick);
}, undefined, (err) => {
  console.error('Error cargando boni.glb:', err);
  document.getElementById('click-to-play').textContent = 'Error cargando boni.glb (mirá la consola)';
});

// ============================================================
// Simulation / loop
// ============================================================

let lastT = 0;
let fpsAccum = 0, fpsFrames = 0, fpsShown = 0;
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpMove = new THREE.Vector3();

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;

  readInput();

  // --- Character movement ---
  // Horizontal move direction in camera-yaw space
  tmpForward.set(Math.sin(camRig.yaw), 0, Math.cos(camRig.yaw));
  tmpRight.set(-tmpForward.z, 0, tmpForward.x);
  tmpMove.set(0, 0, 0);
  tmpMove.addScaledVector(tmpForward, input.forward);
  tmpMove.addScaledVector(tmpRight, input.right);

  const moving = tmpMove.lengthSq() > 0.0001;
  if (moving) tmpMove.normalize();

  const speed = input.run ? character.runSpeed : character.walkSpeed;
  character.velocity.x = tmpMove.x * speed;
  character.velocity.z = tmpMove.z * speed;

  // Jump + gravity
  if (input.jump && character.onGround) {
    character.velocity.y = character.jumpSpeed;
    character.onGround = false;
  }
  character.velocity.y += character.gravity * dt;

  // Integrate
  character.root.position.x += character.velocity.x * dt;
  character.root.position.y += character.velocity.y * dt;
  character.root.position.z += character.velocity.z * dt;

  // --- Wall collisions (circle vs AABB in XZ) ---
  if (levelState.walls.length) {
    const charRadius = 0.5;
    const cy = character.root.position.y;
    for (const w of levelState.walls) {
      const b = w.aabb;
      // Skip walls we're above (when airborne and jumping over low walls)
      if (cy > b.max.y + 0.1) continue;
      const cx = character.root.position.x;
      const cz = character.root.position.z;
      const nx = Math.max(b.min.x, Math.min(cx, b.max.x));
      const nz = Math.max(b.min.z, Math.min(cz, b.max.z));
      const dx = cx - nx;
      const dz = cz - nz;
      const dsq = dx * dx + dz * dz;
      if (dsq < charRadius * charRadius) {
        if (dsq < 1e-6) {
          // Inside the wall — push toward nearest face
          const ex = Math.min(cx - b.min.x, b.max.x - cx);
          const ez = Math.min(cz - b.min.z, b.max.z - cz);
          if (ex < ez) {
            character.root.position.x = (cx < (b.min.x + b.max.x) / 2) ? b.min.x - charRadius : b.max.x + charRadius;
          } else {
            character.root.position.z = (cz < (b.min.z + b.max.z) / 2) ? b.min.z - charRadius : b.max.z + charRadius;
          }
        } else {
          const d = Math.sqrt(dsq);
          character.root.position.x = nx + (dx / d) * charRadius;
          character.root.position.z = nz + (dz / d) * charRadius;
        }
      }
    }
  }

  // Ground plane at y=0
  if (character.root.position.y <= 0) {
    character.root.position.y = 0;
    if (!character.onGround) {
      character.onGround = true;
      // trigger 'land' briefly if mapped
      if (actionForState('land')) {
        playState('land', 0.08);
        // fall back to idle/run after short timeout
        setTimeout(() => {
          if (!character.onGround) return;
          const fallback = moving ? (input.run ? 'run' : 'walk') : 'idle';
          playState(fallback, 0.15);
        }, 180);
      }
    }
    if (character.velocity.y < 0) character.velocity.y = 0;
  }

  // Face movement direction
  if (moving) {
    const targetFacing = Math.atan2(tmpMove.x, tmpMove.z);
    // shortest-angle lerp
    let d = targetFacing - character.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    character.facing += d * Math.min(1, character.turnSpeed * dt);
    character.root.rotation.y = character.facing;
  }

  // --- One-shot expiry ---
  if (anim.oneShot && performance.now() >= anim.oneShot.endAt) {
    anim.oneShot.action.fadeOut(0.15);
    anim.oneShot = null;
  }

  // --- Animation state selection (unless previewing or one-shot) ---
  if (!anim.preview && !anim.oneShot) {
    let desired;
    if (!character.onGround) {
      desired = character.velocity.y > 0.5 ? 'jump' : 'fall';
    } else if (anim.currentState === 'land') {
      desired = 'land'; // stay in land until timeout above switches it
    } else if (moving) {
      desired = input.run ? 'run' : 'walk';
    } else {
      desired = 'idle';
    }
    playState(desired);
  }

  // --- Footstep sfx ---
  if (character.onGround && moving && !anim.oneShot && !anim.preview) {
    const interval = input.run ? 0.28 : 0.46;
    if (character._stepAccum < 0) {
      // Just started moving — play an immediate step
      playStep();
      character._stepAccum = 0;
    } else {
      character._stepAccum += dt;
      if (character._stepAccum >= interval) {
        playStep();
        character._stepAccum = 0;
      }
    }
  } else {
    character._stepAccum = -1; // flag: not moving
  }

  // --- Advance animation mixer ---
  if (character.mixer) character.mixer.update(dt);

  // --- Maze timer tick (counts down) ---
  if (levelState.current === 'cookieMaze' && !levelState.data.ended) {
    levelState.data.timeLeft -= dt;
    if (levelState.data.timeLeft <= 0) {
      levelState.data.timeLeft = 0;
      endMazeLevel(levelState, false);
    }
    const sec = Math.max(0, Math.ceil(levelState.data.timeLeft));
    if (sec !== levelState.data._lastSec) {
      levelState.data._lastSec = sec;
      updateScoreHUD();
    }
  }

  // --- Coca con Coca timer tick (counts up) ---
  if (levelState.current === 'cocaCola' && !levelState.data.ended) {
    levelState.data.timeElapsed += dt;
    if (levelState.data.timeElapsed >= levelState.data.timeLimit) {
      endCocaLevel(levelState, false);
    }
    const sec = Math.floor(levelState.data.timeElapsed * 10);
    if (sec !== levelState.data._lastSec) {
      levelState.data._lastSec = sec;
      updateScoreHUD();
    }
  }

  // --- Pickups (cookies) and triggers (portals) ---
  if (levelState.pickups.length || levelState.triggers.length) {
    const cx = character.root.position.x;
    const cz = character.root.position.z;
    for (let i = levelState.pickups.length - 1; i >= 0; i--) {
      const p = levelState.pickups[i];
      const dx = cx - p.position.x;
      const dz = cz - p.position.z;
      if (dx * dx + dz * dz < p.radius * p.radius) {
        p.onCollect();
        levelState.pickups.splice(i, 1);
      }
    }
    for (let i = levelState.triggers.length - 1; i >= 0; i--) {
      const t = levelState.triggers[i];
      const dx = cx - t.position.x;
      const dz = cz - t.position.z;
      if (dx * dx + dz * dz < t.radius * t.radius) {
        const cb = t.onEnter;
        if (t.once) levelState.triggers.splice(i, 1);
        cb();
        break; // a trigger may have reloaded the level; stop iterating this frame
      }
    }
  }

  // Spin pickups (cookies, cans, bottles) and bob them up/down
  for (const p of levelState.pickups) {
    if (!p.object) continue;
    p.object.userData.spin = (p.object.userData.spin || 0) + dt * 2.0;
    p.object.rotation.y = p.object.userData.spin;
    const baseY = p.object.userData.isCocaItem ? COCA_HEIGHT : COOKIE_HEIGHT;
    p.object.position.y = baseY + Math.sin(p.object.userData.spin) * 0.18;
  }

  // --- Ground-alignment: once the idle pose has settled, use the actual
  // posed foot bones (not the skinned-mesh bbox, which can report the bind
  // pose) to figure out where the feet really are, and shift the model so
  // the lowest foot lands on y=0. ---
  if (character.needsGroundAlign && character.model && character.onGround) {
    const wp = new THREE.Vector3();
    let lowestFootY = Infinity;
    character.model.traverse(o => {
      if (o.isBone && /toebase|_foot$/i.test(o.name)) {
        o.getWorldPosition(wp);
        if (wp.y < lowestFootY) lowestFootY = wp.y;
      }
    });
    if (isFinite(lowestFootY)) {
      const worldTargetY = character.root.position.y;
      // Toe bone sits approximately at the sole; tiny tweak for shoe thickness.
      const soleOffset = 0.02;
      character.model.position.y += (worldTargetY - lowestFootY - soleOffset);
      character.needsGroundAlign = false;
    }
  }

  // --- Strip in-place root motion so animations don't drift the model ---
  // The Root bone in the skeleton may animate translation; we keep it pinned
  // so the character stays under our physics-driven transform.
  if (character.rootBone) {
    character.rootBone.position.set(0, 0, 0);
  }

  // --- Sun follows character so the shadow frustum stays tight ---
  sunTarget.position.copy(character.root.position);
  sun.position.set(
    character.root.position.x + 15,
    character.root.position.y + 25,
    character.root.position.z + 10
  );

  // --- Camera follow ---
  camRig.target.set(
    character.root.position.x,
    character.root.position.y + camRig.heightOffset,
    character.root.position.z
  );
  const cosP = Math.cos(camRig.pitch);
  const offsetX = Math.sin(camRig.yaw) * camRig.distance * cosP;
  const offsetZ = Math.cos(camRig.yaw) * camRig.distance * cosP;
  const offsetY = -Math.sin(camRig.pitch) * camRig.distance;
  camera.position.set(
    camRig.target.x - offsetX,
    camRig.target.y + offsetY,
    camRig.target.z - offsetZ
  );
  camera.lookAt(camRig.target);

  // --- Render ---
  renderer.render(scene, camera);

  // --- FPS meter ---
  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsShown = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0; fpsFrames = 0;
    document.getElementById('fps').textContent = String(fpsShown);
  }
}
