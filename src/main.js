import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { AudioKit } from './audio.js';
import { CameraRig } from './camera-rig.js';
import { FX } from './fx.js';
import { Game } from './game.js';
import { Motes } from './motes.js';
import { Sky } from './sky.js';
import { Sun } from './sun.js';
import { clamp, damp, isCoarsePointer, isReducedMotion } from './utils.js';

const $ = (id) => document.getElementById(id);

const dom = {
  canvas: $('scene'),
  startScreen: $('start-screen'),
  startBtn: $('start-btn'),
  startBtnLabel: document.querySelector('#start-btn .start-btn-label'),
  loading: $('loading'),
  errorPanel: $('error-panel'),
  errorText: $('error-text'),
  score: $('score'),
  level: $('level'),
  levelName: $('level-name'),
  stats: $('stats'),
  power: $('power'),
  powerFill: $('power-fill'),
  powerPct: $('power-pct'),
  powerMeter: $('power-meter'),
  burstBtn: $('burst-btn'),
  hint: $('hint'),
  toast: $('toast'),
  floatLayer: $('float-layer'),
  soundBtn: $('sound-btn'),
  helpBtn: $('help-btn'),
  helpScreen: $('help-screen'),
  helpClose: $('help-close'),
  helpOk: $('help-ok'),
  flash: $('flash'),
};

const reducedMotion = isReducedMotion();
const coarsePointer = isCoarsePointer();
const quality = coarsePointer ? 0.72 : reducedMotion ? 0.8 : 1;
const world = {
  started: false,
  elapsed: 0,
  bloomBoost: 0,
  hoveredMote: null,
  lastScore: null,
  helpOpen: false,
};

let renderer;
let composer = null;
let bloomPass = null;
let scene;
let camera;
let cameraRig;
let sun;
let sky;
let motes;
let fx;
let audio;
let game;
let currentTargets = [];
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

const startWideComposition = () =>
  window.innerWidth >= 900 || (window.innerHeight <= 560 && window.innerWidth >= 700);

async function boot() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05030f);

  renderer = new THREE.WebGLRenderer({
    canvas: dom.canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setClearColor(0x05030f, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 2, 9.8);

  setupComposer();

  const ambient = new THREE.AmbientLight(0x8d7ab8, 0.9);
  const sunLight = new THREE.PointLight(0xffc37a, 65, 80, 2);
  sunLight.position.set(0, 0, 0);
  const fill = new THREE.DirectionalLight(0x7a86ff, 0.55);
  fill.position.set(-5, 3, 4);
  scene.add(ambient, sunLight, fill);

  cameraRig = new CameraRig(camera, dom.canvas, { onTap: handleTap });
  sky = new Sky(scene, { reducedMotion, quality });
  sun = new Sun(scene, { quality });
  motes = new Motes(scene, { count: coarsePointer ? 3 : 4 });
  fx = new FX(scene, camera);
  audio = new AudioKit({ muted: readMuted() });
  game = new Game({
    onUpdate: updateHud,
    onLevelUp: handleLevelUp,
    onEnergyFull: handleEnergyFull,
    onBurst: handleBurst,
  });

  currentTargets = [...motes.hitMeshes, sun.core];
  refreshTargets();

  applyMutedUi();
  setupComposition();
  setupUi();
  resize();
  window.addEventListener('resize', resize);
  setupDebug();

  cameraRig.update(0.016);
  if (composer) {
    // Warm up the post-processing pipeline so first frame isn't a surprise.
    try {
      composer.render();
    } catch (error) {
      console.warn('[sunny] post-processing unavailable, falling back', error);
      composer = null;
      bloomPass = null;
    }
  }

  dom.loading.hidden = true;
  dom.startBtn.disabled = false;
  dom.startBtnLabel.textContent = '开始玩';

  requestAnimationFrame(frame);
}
function setupComposer() {
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.65,
      0.48,
      0.78
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  } catch (error) {
    console.warn('[sunny] bloom unavailable, rendering without post-processing', error);
    composer = null;
    bloomPass = null;
  }
}

function setupComposition() {
  const wide = startWideComposition();
  if (wide) {
    cameraRig.radius = 11.2;
    cameraRig.targetRadius = 11.2;
    cameraRig.theta = 0.34;
    cameraRig.targetTheta = 0.34;
    cameraRig.setComposition(-1.95, 0.34);
  } else {
    cameraRig.radius = 11.4;
    cameraRig.targetRadius = 11.4;
    cameraRig.setComposition(0, -1.8);
  }
}

function setupUi() {
  dom.startBtn.addEventListener('click', startGame);
  dom.burstBtn.addEventListener('click', doBurst);

  dom.soundBtn.addEventListener('click', () => {
    const muted = !audio.muted;
    setMuted(muted);
  });

  dom.helpBtn.addEventListener('click', openHelp);
  dom.helpClose.addEventListener('click', closeHelp);
  dom.helpOk.addEventListener('click', closeHelp);
  dom.helpScreen.addEventListener('click', (event) => {
    if (event.target === dom.helpScreen) closeHelp();
  });

  window.addEventListener('keydown', handleKeyDown);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) lastFrame = performance.now();
  });
  window.addEventListener('blur', () => {
    world.hoveredMote = null;
    motes.motes.forEach((mote) => motes.setHover(mote, false));
    dom.canvas.classList.remove('is-pointing');
  });
}

function refreshTargets() {
  currentTargets = [
    ...motes.hitMeshes,
    sun.core,
    ...sky.planets.filter((planet) => planet.visible).map((planet) => planet.mesh),
  ];
}

function startGame() {
  if (world.started) return;
  world.started = true;
  dom.startScreen.classList.add('closing');
  document.body.classList.add('playing');
  audio.resume();
  game.start();
  motes.start();
  cameraRig.setEnabled(true);
  cameraRig.playIntro();
  sun.pulse(0.8);
  fx.wave(new THREE.Vector3(), {
    color: 0xffd9a0,
    startScale: 1.2,
    maxScale: 5.5,
    duration: 1.2,
    opacity: 0.45,
  });
  audio.collect(0);
  showHint();
}

function showHint() {
  dom.hint.classList.add('show');
  window.setTimeout(() => dom.hint.classList.remove('show'), 11000);
}

function handleTap(clientX, clientY) {
  if (!world.started) return;
  const hits = raycastAt(clientX, clientY, currentTargets).filter((hit) => {
    const object = hit.object;
    if (object === sun.core) return true;
    if (object.userData.planet) {
      return sky.planets.some((planet) => planet.visible && planet.mesh === object);
    }
    if (object.userData.mote !== undefined) {
      return motes.motes[object.userData.mote]?.state === 'spawning';
    }
    return false;
  });
  if (!hits.length) return;

  const hit = hits[0];
  const object = hit.object;

  if (object.userData.mote !== undefined) {
    const mote = motes.motes[object.userData.mote];
    if (mote) collectMote(mote);
    return;
  }

  if (object === sun.core) {
    pokeSun(hit.point);
    return;
  }

  if (object.userData.planet) {
    const planet = sky.click(object);
    if (planet) {
      audio.planet();
      cameraRig.shake(0.02);
      const screen = toScreen(hit.point);
      spawnFloat('啵！', screen.x, screen.y, 'soft');
      fx.collectBurst(hit.point);
    }
  }
}

function collectMote(mote) {
  const worldPosition = mote.group.position.clone();
  const screen = toScreen(worldPosition);
  const value = motes.collect(mote);
  if (!value) return;

  const golden = mote.golden;
  fx.collectBurst(worldPosition);
  if (golden) {
    audio.golden();
    fx.wave(worldPosition, { color: 0xffd58a, maxScale: 2.4, duration: 0.75, opacity: 0.55 });
    sun.pulse(0.7);
  } else {
    audio.collect(game.combo);
    sun.pulse(0.35);
  }

  game.addStardust(value);
  spawnFloat(golden ? '+3 ✨' : '+1', screen.x, screen.y, golden ? 'gold' : '');
  if (navigator.vibrate) navigator.vibrate(golden ? [12, 24, 12] : 8);
}

function pokeSun(point) {
  const normal = point.clone().normalize();
  sun.pulse(0.5);
  fx.sunFlare(point, normal, { count: 30 + Math.floor(Math.random() * 22), power: 1 });
  if (Math.random() < 0.4) {
    fx.prominence(sun.scale, {
      height: 0.7 + Math.random() * 0.7,
      width: 0.5 + Math.random() * 0.4,
      thickness: 0.025,
      duration: 2.2,
    });
  }
  audio.poke();
  cameraRig.shake(0.06);
  if (navigator.vibrate) navigator.vibrate(6);
}

function doBurst() {
  if (!world.started) return false;
  return game.triggerBurst();
}

function handleBurst() {
  const soft = coarsePointer;
  fx.eruption(sun.scale * 1.02, { sparkCount: soft ? 140 : 250, waveOpacity: soft ? 0.45 : 1 });
  sun.pulse(soft ? 0.34 : 0.95);
  cameraRig.shake(soft ? 0.2 : 0.32);
  flashScreen(soft ? 0.4 : 1);
  world.bloomBoost = soft ? 0.08 : 0.3;
  audio.burst();
  toast('☀️ 太阳爆发！', 2200);
  spawnFloat('爆发！', window.innerWidth / 2, window.innerHeight * 0.38, 'gold');
  if (navigator.vibrate) navigator.vibrate([18, 40, 26]);
}

function handleLevelUp(info, level) {
  sun.setLevel(level);
  const revealed = sky.reveal(level);
  refreshTargets();
  fx.levelUp(sun.scale);
  audio.levelUp();
  cameraRig.shake(0.12);
  if (revealed) {
    const names = ['薄荷', '蜜桃', '葡萄', '青柠', '玫瑰'];
    toast(`小太阳长大啦！Lv.${level} · ${info.name}，${names[level - 2]}星出现了`, 3000);
  } else {
    toast(`小太阳长大啦！Lv.${level} · ${info.name}`, 2400);
  }
  if (level === 6) {
    window.setTimeout(() => toast('已经是宇宙里最亮的小太阳啦！', 2600), 3200);
  }
}

function handleEnergyFull() {
  audio.collect(3);
  toast('太阳能量满格！点「太阳爆发」或按空格', 2600);
}

function updateHud(state) {
  dom.score.textContent = String(state.score);
  if (state.score !== world.lastScore) {
    world.lastScore = state.score;
    if (state.score > 0) {
      dom.score.classList.remove('bump');
      void dom.score.offsetWidth;
      dom.score.classList.add('bump');
    }
  }

  dom.level.textContent = `Lv.${state.level}`;
  dom.levelName.textContent = state.levelName;

  const percent = Math.round(state.energy * 100);
  dom.powerFill.style.width = `${percent}%`;
  dom.powerPct.textContent = `${percent}%`;
  dom.powerMeter.setAttribute('aria-valuenow', String(percent));
  dom.power.classList.toggle('charged', state.energy >= 1);
  dom.burstBtn.disabled = state.energy < 1;
}

function toast(text, duration = 2000) {
  dom.toast.textContent = text;
  dom.toast.classList.add('show');
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => dom.toast.classList.remove('show'), duration);
}

function spawnFloat(text, x, y, kind = '') {
  const el = document.createElement('span');
  el.className = `float-label ${kind}`.trim();
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  dom.floatLayer.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  window.setTimeout(() => el.remove(), 1400);
}

function flashScreen(strength = 1) {
  dom.flash.style.setProperty('--flash-opacity', String(clamp(strength, 0.2, 1)));
  dom.flash.classList.add('on');
  window.setTimeout(() => dom.flash.classList.remove('on'), 80);
}

function openHelp() {
  if (world.helpOpen) return;
  world.helpOpen = true;
  world.helpReturnFocus = document.activeElement;
  dom.helpScreen.hidden = false;
  dom.helpClose.focus();
}

function closeHelp() {
  if (!world.helpOpen) return;
  world.helpOpen = false;
  dom.helpScreen.hidden = true;
  if (world.helpReturnFocus && typeof world.helpReturnFocus.focus === 'function') {
    world.helpReturnFocus.focus();
  }
}

function handleKeyDown(event) {
  if (event.defaultPrevented) return;
  const key = event.key;
  const lower = key.toLowerCase();

  if (key === 'Escape') {
    if (world.helpOpen) {
      closeHelp();
      event.preventDefault();
    }
    return;
  }

  if (world.helpOpen) {
    if (lower === 'h') {
      closeHelp();
      event.preventDefault();
    }
    return;
  }

  if (key === ' ' || key === 'Spacebar') {
    event.preventDefault();
    doBurst();
    return;
  }

  if (lower === 'm') {
    event.preventDefault();
    setMuted(!audio.muted);
    return;
  }

  if (lower === 'h') {
    event.preventDefault();
    openHelp();
    return;
  }

  if (lower === 'r') {
    event.preventDefault();
    cameraRig.resetView();
    return;
  }

  if (world.started) {
    if (key === 'ArrowLeft') {
      cameraRig.nudge(0.18, 0);
      event.preventDefault();
    } else if (key === 'ArrowRight') {
      cameraRig.nudge(-0.18, 0);
      event.preventDefault();
    } else if (key === 'ArrowUp') {
      cameraRig.nudge(0, -0.09);
      event.preventDefault();
    } else if (key === 'ArrowDown') {
      cameraRig.nudge(0, 0.09);
      event.preventDefault();
    }
  }
}

function readMuted() {
  try {
    return window.localStorage.getItem('sunny.muted') === '1';
  } catch {
    return false;
  }
}

function setMuted(muted) {
  audio.setMuted(muted);
  applyMutedUi();
  try {
    window.localStorage.setItem('sunny.muted', muted ? '1' : '0');
  } catch {
    /* private mode — sound preference just won't persist */
  }
}

function applyMutedUi() {
  const muted = audio ? audio.muted : readMuted();
  dom.soundBtn.classList.toggle('sound-off', muted);
  dom.soundBtn.setAttribute('aria-pressed', String(!muted));
  dom.soundBtn.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
}

function raycastAt(clientX, clientY, objects = currentTargets) {
  const rect = dom.canvas.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  return raycaster.intersectObjects(objects, false);
}

const _screen = new THREE.Vector3();
function toScreen(worldPosition) {
  _screen.copy(worldPosition).project(camera);
  return {
    x: (_screen.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_screen.y * 0.5 + 0.5) * window.innerHeight,
  };
}

let hoverCooldown = 0;
function updateHover(dt) {
  if (!world.started) return;
  hoverCooldown -= dt;
  if (hoverCooldown > 0) return;
  hoverCooldown = 0.07;

  const x = cameraRig.hoverX;
  const y = cameraRig.hoverY;
  if (x == null || y == null || cameraRig.dragging) {
    setHoveredMote(null);
    return;
  }

  const hits = raycastAt(x, y, motes.hitMeshes);
  const hit = hits.find((item) => {
    const mote = motes.motes[item.object.userData.mote];
    return mote && mote.state === 'spawning';
  });
  const mote = hit ? motes.motes[hit.object.userData.mote] : null;
  setHoveredMote(mote);
}

function setHoveredMote(mote) {
  if (mote === world.hoveredMote) return;
  if (world.hoveredMote) motes.setHover(world.hoveredMote, false);
  if (mote) motes.setHover(mote, true);
  world.hoveredMote = mote;
  dom.canvas.classList.toggle('is-pointing', Boolean(mote));
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.6 : 2);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height);

  if (composer) {
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
  }

  sky.setPixelRatio(ratio);
  sun.setPixelRatio(ratio);
  fx.setPixelRatio(ratio);
}

let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rawDelta = (now - lastFrame) / 1000;
  lastFrame = now;
  if (document.hidden) return;

  const dt = Math.min(0.05, Math.max(0.001, rawDelta));
  world.elapsed += dt;

  cameraRig.update(dt);
  sun.update(dt, world.elapsed);
  sky.update(dt, world.elapsed);
  motes.update(dt, world.elapsed);
  fx.update(dt, world.elapsed);
  updateHover(dt);

  if (bloomPass) {
    world.bloomBoost = damp(world.bloomBoost, 0, 3.2, dt);
    bloomPass.strength = 0.65 + world.bloomBoost;
  }

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

function showFatal(error) {
  dom.loading.hidden = true;
  dom.startScreen.classList.add('closing');
  dom.errorPanel.hidden = false;
  const message = error && error.message ? error.message : '';
  if (/webgl|context/i.test(message)) {
    dom.errorText.textContent = '这个浏览器好像没有点亮 WebGL 的能力，换一个现代浏览器再试试。';
  }
  console.error('[sunny] fatal', error);
}

function setupDebug() {
  if (!new URLSearchParams(window.location.search).has('debug')) return;
  window.__sunny = {
    ready: true,
    state: () => game.getState(),
    start: () => startGame(),
    motePositions: () =>
      motes.motes
        .filter((mote) => mote.state === 'spawning')
        .map((mote) => {
          const screen = toScreen(mote.group.position);
          return {
            x: screen.x,
            y: screen.y,
            value: mote.value,
            golden: mote.golden,
            index: mote.index,
          };
        }),
    sunPosition: () => toScreen(new THREE.Vector3(0, 0, 0)),
    setEnergy: (value) => {
      game.energy = clamp(value, 0, 1);
      game.fullAnnounced = game.energy >= 1;
      game._emit();
    },
    burst: () => doBurst(),
    finishIntro: () => cameraRig.finishIntro(),
    poke: () => pokeSun(new THREE.Vector3(0.4, 0.4, 0.9).normalize()),
    planets: () => sky.planets.filter((planet) => planet.visible).map((planet) => planet.def.name),
  };
}

boot().catch((error) => {
  console.error('[sunny] boot failed', error);
  showFatal(error);
});
