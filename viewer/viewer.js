// Boni — model viewer
// Standalone app: orbit the character in 360°, trigger every animation clip in
// the GLB, and download the model in a format other engines can import.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ------------------------------------------------------------------
// Clip names. The GLB exports its NLA tracks as NlaTrack.00X, so we map the
// indices to the readable names the game uses (see DEFAULT_MAPPING in main.js).
// ------------------------------------------------------------------
const CLIP_LABELS = {
  0:  'Correr',
  1:  'Golpear',
  2:  'Bailar',
  3:  'Extra A',
  4:  'Saludar',
  5:  'Idle',
  6:  'Aterrizar',
  7:  'Caminar',
  8:  'Recibir golpe',
  9:  'Saltar',
  10: 'Extra B',
};

const MODELS = {
  lite: { url: './downloads/boni-lite.glb', size: '3.8 MB' },
  full: { url: '../boni.glb',               size: '38 MB'  },
};
// The rig's face points +X; rotate so the character's front looks down +Z.
const MODEL_YAW = 3 * Math.PI / 2;
const DESIRED_HEIGHT = 1.8;
const CLIP_IDLE = 5; // "Idle" — the natural default pose

// ------------------------------------------------------------------
// Renderer / scene
// ------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true, // needed for the PNG capture button
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 200);
camera.position.set(2.4, 1.7, 3.3);

// Neutral image-based lighting so the PBR material reads correctly.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const hemi = new THREE.HemisphereLight(0x9fc6ff, 0x1a1208, 0.5);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.1);
key.position.set(3, 5.5, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -2.2;
key.shadow.camera.right = 2.2;
key.shadow.camera.top = 3.0;
key.shadow.camera.bottom = -0.3;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 16;
key.shadow.bias = -0.0012;
key.shadow.normalBias = 0.02;
scene.add(key);

const fill = new THREE.DirectionalLight(0x88bbff, 0.7);
fill.position.set(-4, 2.5, 2);
scene.add(fill);

const rim = new THREE.DirectionalLight(0x00e8ff, 1.4);
rim.position.set(-1.5, 2.2, -4.5);
scene.add(rim);

// Shadow-catcher floor.
const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.ShadowMaterial({ opacity: 0.42 })
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

let grid = null;
function buildGrid(c1, c2) {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  grid = new THREE.GridHelper(20, 40, c1, c2);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  grid.visible = ui.grid;
  scene.add(grid);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 0.5;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.52; // don't go under the floor
controls.target.set(0, 0.95, 0);
controls.autoRotateSpeed = 1.4;

// ------------------------------------------------------------------
// Viewer state
// ------------------------------------------------------------------
const ui = {
  playing: true,
  loop: true,
  speed: 1,
  rootMotion: false,
  spin: false,
  grid: true,
  shadow: true,
  wire: false,
  bones: false,
  glow: 0,
  quality: 'lite',
};

const M = {
  model: null,
  holder: null,   // yaw wrapper, so centering happens after rotation
  pivot: new THREE.Group(),
  mixer: null,
  actions: [],
  clips: [],
  active: null,
  activeIndex: -1,
  rootBone: null,
  rootBind: new THREE.Vector3(),
  skeleton: null,
  materials: [],
  height: DESIRED_HEIGHT,
};
scene.add(M.pivot);

// ------------------------------------------------------------------
// DOM helpers
// ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const clipsEl = $('clips');
const scrub = $('scrub');
const timeLabel = $('time-label');

function bindSwitch(id, initial, onChange) {
  const el = $(id);
  let v = initial;
  el.classList.toggle('on', v);
  el.addEventListener('click', () => {
    v = !v;
    el.classList.toggle('on', v);
    onChange(v);
  });
}

function bindRange(id, valId, fmt, onChange) {
  const el = $(id), out = $(valId);
  const apply = () => {
    const v = parseFloat(el.value);
    out.textContent = fmt(v);
    onChange(v);
  };
  el.addEventListener('input', apply);
  apply();
}

// ------------------------------------------------------------------
// Model loading
// ------------------------------------------------------------------
const loader = new GLTFLoader();

function disposeModel() {
  if (!M.model) return;
  M.mixer?.stopAllAction();
  M.pivot.remove(M.holder);
  M.model.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { m?.map?.dispose(); m?.dispose(); });
    }
  });
  if (M.skeleton) { scene.remove(M.skeleton); M.skeleton.dispose?.(); M.skeleton = null; }
  M.model = null; M.holder = null; M.mixer = null; M.actions = []; M.clips = [];
  M.active = null; M.activeIndex = -1; M.rootBone = null; M.materials = [];
}

// Box3.setFromObject() only looks at the raw geometry bounds, and this rig's
// bind pose carries a scale — the geometry measures 0.21 units while the
// skinned character is ~0.82. So we sample actual deformed vertex positions.
function measureSkinnedBounds(root) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let found = false;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    found = true;
    const count = o.geometry.attributes.position.count;
    const step = Math.max(1, Math.floor(count / 5000));
    for (let i = 0; i < count; i += step) {
      o.getVertexPosition(i, v);
      box.expandByPoint(v.applyMatrix4(o.matrixWorld));
    }
  });
  if (!found) box.setFromObject(root);
  return box;
}

function loadModel(quality, onDone) {
  const { url } = MODELS[quality];
  const loaderEl = $('loader'), bar = $('bar'), pct = $('pct');
  loaderEl.classList.remove('gone');
  pct.textContent = 'cargando modelo…';
  bar.style.width = '0%';

  loader.load(
    url,
    (gltf) => {
      const keepIndex = M.activeIndex;
      disposeModel();

      const model = gltf.scene;

      // Normalize: 1.8 m tall, feet on y = 0, front facing +Z. The yaw lives on
      // a wrapper so the centering translation below is applied in world space.
      const holder = new THREE.Group();
      holder.rotation.y = MODEL_YAW;
      holder.add(model);
      M.pivot.add(holder);

      const raw = measureSkinnedBounds(holder);
      const s = DESIRED_HEIGHT / Math.max(raw.max.y - raw.min.y, 1e-4);
      model.scale.multiplyScalar(s);
      // Bounds scale linearly around the origin, so we can place the model
      // (feet on y=0, centered on x/z) without re-measuring.
      holder.position.set(
        -((raw.max.x + raw.min.x) / 2) * s,
        -raw.min.y * s,
        -((raw.max.z + raw.min.z) / 2) * s
      );
      holder.updateMatrixWorld(true);

      let tris = 0, verts = 0;
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false; // skinned bounds are unreliable
          const g = o.geometry;
          verts += g.attributes.position?.count ?? 0;
          tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { if (m) M.materials.push(m); });
        }
        if (o.isBone && o.name === 'Root') M.rootBone = o;
      });

      M.model = model;
      M.holder = holder;
      M.height = DESIRED_HEIGHT;
      if (M.rootBone) M.rootBind.copy(M.rootBone.position);

      // Skeleton overlay (hidden by default)
      M.skeleton = new THREE.SkeletonHelper(model);
      M.skeleton.visible = ui.bones;
      M.skeleton.material.linewidth = 2;
      scene.add(M.skeleton);

      // Animations
      M.mixer = new THREE.AnimationMixer(model);
      M.clips = gltf.animations;
      M.actions = gltf.animations.map((clip) => {
        const a = M.mixer.clipAction(clip);
        a.enabled = true;
        a.clampWhenFinished = true;
        return a;
      });

      applyGlow(ui.glow);
      applyWireframe(ui.wire);
      buildClipList();

      const bones = M.skeleton.bones.length;
      $('stats').innerHTML =
        `<b>${Math.round(tris).toLocaleString('es')}</b> triángulos · <b>${verts.toLocaleString('es')}</b> vértices<br>` +
        `<b>${bones}</b> huesos · <b>${M.clips.length}</b> animaciones<br>` +
        `malla: <b>${quality === 'lite' ? 'optimizada' : 'original'}</b>`;

      const start = keepIndex >= 0 && keepIndex < M.actions.length ? keepIndex : CLIP_IDLE;
      playClip(Math.min(start, M.actions.length - 1), 0);

      loaderEl.classList.add('gone');
      onDone?.();
    },
    (ev) => {
      if (ev.lengthComputable && ev.total) {
        const p = Math.round((ev.loaded / ev.total) * 100);
        bar.style.width = p + '%';
        pct.textContent = p + '%';
      } else {
        pct.textContent = (ev.loaded / 1048576).toFixed(1) + ' MB';
      }
    },
    (err) => {
      console.error(err);
      $('pct').innerHTML = 'no se pudo cargar el modelo.<br>Serví la carpeta con <code>npm start</code>.';
    }
  );
}

// ------------------------------------------------------------------
// Animation control
// ------------------------------------------------------------------
function buildClipList() {
  clipsEl.innerHTML = '';
  M.clips.forEach((clip, i) => {
    const b = document.createElement('button');
    b.className = 'clip';
    b.dataset.index = i;
    b.innerHTML = `${CLIP_LABELS[i] ?? clip.name}<span class="d">${clip.duration.toFixed(2)}s</span>`;
    b.title = clip.name;
    b.addEventListener('click', () => playClip(i));
    clipsEl.appendChild(b);
  });
}

function playClip(i, fade = 0.25) {
  const next = M.actions[i];
  if (!next) return;
  if (M.active && M.active !== next) M.active.fadeOut(fade);
  next.reset();
  next.setLoop(ui.loop ? THREE.LoopRepeat : THREE.LoopOnce, ui.loop ? Infinity : 1);
  next.clampWhenFinished = !ui.loop;
  next.fadeIn(fade).play();
  M.active = next;
  M.activeIndex = i;
  ui.playing = true;
  updatePlayButton();
  [...clipsEl.children].forEach((c) => c.classList.toggle('active', +c.dataset.index === i));
}

function updatePlayButton() {
  const b = $('btn-play');
  b.textContent = ui.playing ? '⏸ Pausar' : '▶ Reproducir';
  b.classList.toggle('on', !ui.playing);
}

$('btn-play').addEventListener('click', () => {
  ui.playing = !ui.playing;
  updatePlayButton();
});

$('btn-loop').addEventListener('click', () => {
  ui.loop = !ui.loop;
  $('btn-loop').classList.toggle('on', ui.loop);
  if (M.active) {
    M.active.setLoop(ui.loop ? THREE.LoopRepeat : THREE.LoopOnce, ui.loop ? Infinity : 1);
    M.active.clampWhenFinished = !ui.loop;
    if (ui.loop) { M.active.paused = false; M.active.play(); }
  }
});

let scrubbing = false;
scrub.addEventListener('pointerdown', () => { scrubbing = true; });
addEventListener('pointerup', () => { scrubbing = false; });
scrub.addEventListener('input', () => {
  if (!M.active) return;
  ui.playing = false;
  updatePlayButton();
  const dur = M.active.getClip().duration;
  M.active.paused = false;
  M.active.time = parseFloat(scrub.value) * dur;
  M.mixer.update(0);
  pinRoot();
  timeLabel.textContent = `${M.active.time.toFixed(2)} / ${dur.toFixed(2)}`;
});

bindRange('speed', 'speed-val', (v) => v.toFixed(2) + '×', (v) => { ui.speed = v; });
bindSwitch('sw-rootmotion', ui.rootMotion, (v) => { ui.rootMotion = v; });

// ------------------------------------------------------------------
// Camera presets
// ------------------------------------------------------------------
const tween = { active: false, t: 0, dur: 0.6, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTgt: new THREE.Vector3(), toTgt: new THREE.Vector3() };

function moveCamera(pos, target) {
  tween.fromPos.copy(camera.position);
  tween.toPos.copy(pos);
  tween.fromTgt.copy(controls.target);
  tween.toTgt.copy(target);
  tween.t = 0;
  tween.active = true;
}

const VIEWS = {
  front: () => [new THREE.Vector3(0, 1.05, 4.0),      new THREE.Vector3(0, 0.95, 0)],
  back:  () => [new THREE.Vector3(0, 1.05, -4.0),     new THREE.Vector3(0, 0.95, 0)],
  side:  () => [new THREE.Vector3(4.0, 1.05, 0),      new THREE.Vector3(0, 0.95, 0)],
  face:  () => [new THREE.Vector3(0, 1.62, 0.95),     new THREE.Vector3(0, 1.58, 0)],
  reset: () => [new THREE.Vector3(2.4, 1.7, 3.3),     new THREE.Vector3(0, 0.95, 0)],
};

document.querySelectorAll('[data-view]').forEach((b) => {
  b.addEventListener('click', () => {
    const v = VIEWS[b.dataset.view];
    if (v) moveCamera(...v());
  });
});

bindSwitch('sw-spin', ui.spin, (v) => { ui.spin = v; controls.autoRotate = v; });
controls.autoRotate = ui.spin;
bindRange('spin-speed', 'spin-val', (v) => v.toFixed(1), (v) => { controls.autoRotateSpeed = v; });

// ------------------------------------------------------------------
// Display options
// ------------------------------------------------------------------
function applyWireframe(on) {
  M.materials.forEach((m) => { m.wireframe = on; });
}
function applyGlow(v) {
  M.materials.forEach((m) => {
    if (!('emissive' in m)) return;
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveIntensity = v;
    if (m.map && 'emissiveMap' in m) m.emissiveMap = m.map;
    m.needsUpdate = true;
  });
}

bindSwitch('sw-grid', ui.grid, (v) => { ui.grid = v; if (grid) grid.visible = v; });
bindSwitch('sw-shadow', ui.shadow, (v) => { ui.shadow = v; shadowPlane.visible = v; });
bindSwitch('sw-wire', ui.wire, (v) => { ui.wire = v; applyWireframe(v); });
bindSwitch('sw-bones', ui.bones, (v) => { ui.bones = v; if (M.skeleton) M.skeleton.visible = v; });
bindRange('glow', 'glow-val', (v) => v.toFixed(2), (v) => { ui.glow = v; applyGlow(v); });
bindRange('expo', 'expo-val', (v) => v.toFixed(2), (v) => { renderer.toneMappingExposure = v; });

const BGS = {
  dark:   { bg: 0x05080d, grid: [0x00e8ff, 0x123044], hemi: 0x9fc6ff, fog: null },
  studio: { bg: 0x2b3138, grid: [0x8aa0b4, 0x424b55], hemi: 0xffffff, fog: null },
  tron:   { bg: 0x01040a, grid: [0x00e8ff, 0x0a5f78], hemi: 0x2a6cff, fog: [0x01040a, 8, 26] },
};
function applyBg(name) {
  const b = BGS[name] ?? BGS.dark;
  scene.background = new THREE.Color(b.bg);
  scene.fog = b.fog ? new THREE.Fog(b.fog[0], b.fog[1], b.fog[2]) : null;
  hemi.color.setHex(b.hemi);
  buildGrid(b.grid[0], b.grid[1]);
  document.querySelectorAll('[data-bg]').forEach((el) => el.classList.toggle('on', el.dataset.bg === name));
}
document.querySelectorAll('[data-bg]').forEach((b) => {
  b.addEventListener('click', () => applyBg(b.dataset.bg));
});
applyBg('dark');

$('btn-shot').addEventListener('click', () => {
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.download = `boni-${CLIP_LABELS[M.activeIndex] ?? 'pose'}.png`.replace(/\s+/g, '-').toLowerCase();
  a.href = renderer.domElement.toDataURL('image/png');
  a.click();
});

// ------------------------------------------------------------------
// Panel show/hide + download labels
// ------------------------------------------------------------------
const panel = $('panel');
function setPanel(open) {
  panel.classList.toggle('hidden', !open);
  document.body.classList.toggle('panel-hidden', !open);
}
$('toggle').addEventListener('click', () => setPanel(true));
$('close').addEventListener('click', () => setPanel(false));

// Swap between the optimized mesh and the full-resolution original.
bindSwitch('sw-quality', false, (v) => {
  ui.quality = v ? 'full' : 'lite';
  loadModel(ui.quality);
});

$('size-lite').textContent = MODELS.lite.size;
$('size-full').textContent = MODELS.full.size;

// ------------------------------------------------------------------
// Keyboard
// ------------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); ui.playing = !ui.playing; updatePlayButton(); }
  else if (e.code === 'ArrowRight') playClip((M.activeIndex + 1) % M.actions.length);
  else if (e.code === 'ArrowLeft') playClip((M.activeIndex - 1 + M.actions.length) % M.actions.length);
  else if (e.key.toLowerCase() === 'r') moveCamera(...VIEWS.reset());
  else if (e.key.toLowerCase() === 'h') setPanel(panel.classList.contains('hidden'));
});

let hintTimer = null;
const fadeHint = () => {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { $('hint').style.opacity = '0'; }, 400);
};
renderer.domElement.addEventListener('pointerdown', fadeHint);
renderer.domElement.addEventListener('wheel', fadeHint, { passive: true });

// ------------------------------------------------------------------
// Loop
// ------------------------------------------------------------------
function pinRoot() {
  // Keep the character centered unless root motion is requested.
  if (!ui.rootMotion && M.rootBone) M.rootBone.position.copy(M.rootBind);
}

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (M.mixer) {
    M.mixer.update(ui.playing ? dt * ui.speed : 0);
    pinRoot();
  }

  if (M.active && !scrubbing) {
    const dur = M.active.getClip().duration;
    const t = dur > 0 ? (M.active.time % dur) : 0;
    scrub.value = dur > 0 ? t / dur : 0;
    timeLabel.textContent = `${t.toFixed(2)} / ${dur.toFixed(2)}`;
  }

  if (tween.active) {
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const e = tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - Math.pow(-2 * tween.t + 2, 2) / 2; // easeInOutQuad
    camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
    controls.target.lerpVectors(tween.fromTgt, tween.toTgt, e);
    if (tween.t >= 1) tween.active = false;
  }

  controls.update();
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Handy for debugging from the console.
window.boni = { scene, camera, controls, renderer, M, ui, THREE };

loadModel(ui.quality);
tick();
