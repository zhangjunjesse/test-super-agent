import * as THREE from 'three';
import { makeRadialTexture } from './textures.js';
import { easeOutBack, easeOutCubic, rand, TAU } from './utils.js';

const MOTHER_GLOW = makeRadialTexture({
  size: 128,
  stops: [
    [0, 'rgba(255,255,255,0.95)'],
    [0.25, 'rgba(255,235,170,0.55)'],
    [0.6, 'rgba(255,180,80,0.12)'],
    [1, 'rgba(255,150,60,0)'],
  ],
});

const HIT_GEOMETRY = new THREE.SphereGeometry(0.34, 12, 8);
const CORE_GEOMETRY = new THREE.IcosahedronGeometry(0.1, 1);
const RING_GEOMETRY = new THREE.TorusGeometry(0.18, 0.012, 6, 40);

/** Glowing stardust motes that orbit the sun and love being clicked. */
export class Motes {
  constructor(scene, { count = 4 } = {}) {
    this.scene = scene;
    this.maxActive = count;
    this.motes = [];
    this.hitMeshes = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    this.glowTexture = new THREE.CanvasTexture(MOTHER_GLOW);
    this.glowTexture.colorSpace = THREE.SRGBColorSpace;

    for (let i = 0; i < count; i += 1) {
      this.motes.push(this._createMote(i));
    }
  }

  _createMote(index) {
    const group = new THREE.Group();
    group.visible = false;
    this.group.add(group);

    const color = new THREE.Color(0xfff0b8);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      toneMapped: false,
    });
    const core = new THREE.Mesh(CORE_GEOMETRY, coreMaterial);
    core.userData.mote = index;
    group.add(core);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffd48a,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    glow.scale.setScalar(0.75);
    group.add(glow);

    const ring = new THREE.Mesh(
      RING_GEOMETRY,
      new THREE.MeshBasicMaterial({
        color: 0xfff3c4,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    ring.rotation.set(1.1, 0.3, 0.5);
    group.add(ring);

    const hitMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    const hit = new THREE.Mesh(HIT_GEOMETRY, hitMaterial);
    hit.userData.mote = index;
    group.add(hit);

    const mote = {
      index,
      group,
      core,
      glow,
      ring,
      hit,
      coreMaterial,
      glowMaterial: glow.material,
      ringMaterial: ring.material,
      value: 1,
      golden: false,
      radius: 2.2,
      speed: 0.14,
      phase: rand(0, TAU),
      tilt: rand(-0.5, 0.5),
      bobPhase: rand(0, TAU),
      bobSpeed: rand(0.5, 1.1),
      bobAmp: rand(0.08, 0.2),
      spawnT: 0,
      state: 'hidden',
      respawnIn: 0,
      hovered: false,
      scale: 0,
      targetScale: 0,
      collectT: 0,
      collectFrom: new THREE.Vector3(),
      spin: rand(-1.4, 1.4),
      ringSpin: rand(-2, 2),
      opacity: 1,
    };

    this.hitMeshes.push(hit);
    this._randomizeOrbit(mote, 0);
    return mote;
  }

  _randomizeOrbit(mote, delay = 0) {
    mote.radius = rand(2.05, 2.95);
    mote.speed = rand(0.09, 0.21) * (Math.random() < 0.5 ? 1 : -1);
    mote.phase = rand(0, TAU);
    mote.tilt = rand(-0.62, 0.62);
    mote.bobPhase = rand(0, TAU);
    mote.bobAmp = rand(0.06, 0.18);
    mote.golden = Math.random() < 0.18;
    mote.value = mote.golden ? 3 : 1;
    mote.ringMaterial.opacity = 0;
    mote.ring.visible = false;

    if (mote.golden) {
      mote.coreMaterial.color.setRGB(2.1, 1.45, 0.4);
      mote.glowMaterial.color.setRGB(1.8, 1.2, 0.5);
      mote.core.scale.setScalar(1.35);
      mote.ring.visible = true;
    } else {
      mote.coreMaterial.color.setRGB(2.6, 2.35, 1.55);
      mote.glowMaterial.color.setRGB(1.5, 1.3, 0.9);
      mote.core.scale.setScalar(0.95);
    }
    mote.group.visible = false;
    mote.state = 'hidden';
    mote.respawnIn = delay;
    mote.spawnT = 0;
    mote.scale = 0;
    mote.opacity = 1;
    mote.hovered = false;
  }

  /** Called once the game starts: all motes pop in with a little stagger. */
  start() {
    this.motes.forEach((mote, i) => {
      this._randomizeOrbit(mote, i * 0.14);
      this._respawn(mote);
    });
  }

  reset() {
    this.motes.forEach((mote) => {
      mote.group.visible = false;
      mote.state = 'hidden';
      mote.scale = 0;
      mote.hovered = false;
    });
  }

  _respawn(mote) {
    this._randomizeOrbit(mote, 0);
    mote.state = 'spawning';
    mote.group.visible = true;
    mote.ring.visible = mote.golden;
    mote.ringMaterial.opacity = mote.golden ? 0.6 : 0;
    mote.spawnT = 0;
    mote.scale = 0;
  }

  /** Fly the mote into the sun. Returns its reward value. */
  collect(mote) {
    if (!mote || mote.state !== 'spawning') return 0;
    mote.state = 'collecting';
    mote.collectT = 0;
    mote.collectFrom.copy(mote.group.position);
    mote.collectValue = mote.value;
    mote.hovered = false;
    return mote.value;
  }

  _positionFor(mote, time, target) {
    const angle = mote.phase + time * mote.speed;
    target.set(Math.cos(angle) * mote.radius, 0, Math.sin(angle) * mote.radius);
    target.applyEuler(_euler.set(mote.tilt, 0, mote.tilt * 0.4));
    target.y += Math.sin(time * mote.bobSpeed + mote.bobPhase) * mote.bobAmp;
    return target;
  }

  setHover(mote, hovered) {
    if (!mote || mote.state === 'hidden') return;
    mote.hovered = hovered;
  }

  update(dt, time) {
    for (const mote of this.motes) {
      if (mote.respawnIn > 0 && mote.state === 'hidden') {
        mote.respawnIn -= dt;
        if (mote.respawnIn <= 0) this._respawn(mote);
        continue;
      }
      if (mote.state === 'hidden') continue;

      if (mote.state === 'collecting') {
        mote.collectT = Math.min(1, mote.collectT + dt / 0.32);
        const e = easeOutCubic(mote.collectT);
        mote.group.position.lerpVectors(mote.collectFrom, _origin, e);
        mote.group.scale.setScalar(Math.max(0.001, (1 - e) * 1.2));
        mote.glowMaterial.opacity = 0.7 * (1 - e);
        mote.coreMaterial.opacity = 1 - e;
        if (mote.collectT >= 1) {
          mote.group.visible = false;
          mote.state = 'hidden';
          this._randomizeOrbit(mote, rand(0.5, 1.1));
        }
        continue;
      }

      // spawning / idle
      mote.spawnT = Math.min(1, mote.spawnT + dt / 0.5);
      const pop = easeOutBack(mote.spawnT);
      const hoverScale = mote.hovered ? 1.2 : 1;
      const idlePulse = 1 + Math.sin(time * 3.1 + mote.phase) * 0.05;
      mote.scale = pop * hoverScale * idlePulse;
      mote.group.scale.setScalar(Math.max(0.001, mote.scale));

      this._positionFor(mote, time, mote.group.position);

      mote.core.rotation.y += dt * mote.spin;
      mote.core.rotation.x += dt * mote.spin * 0.6;
      if (mote.golden) {
        mote.ring.rotation.z += dt * mote.ringSpin;
        mote.ring.rotation.y += dt * mote.ringSpin * 0.4;
        mote.ringMaterial.opacity = 0.55 + 0.2 * Math.sin(time * 2.4 + mote.phase);
      }
      mote.glowMaterial.opacity = (mote.golden ? 0.7 : 0.55) + (mote.hovered ? 0.2 : 0) + 0.05 * Math.sin(time * 2 + mote.phase);
      mote.coreMaterial.opacity = 1;
    }
  }
}

const _euler = new THREE.Euler();
const _origin = new THREE.Vector3();
