import * as THREE from 'three';
import { makeRingTexture } from './textures.js';
import { clamp, easeOutCubic, rand, randomDirection, randomPerpendicular, TAU } from './utils.js';

const SPARK_CAPACITY = 1000;
const RING_TEXTURE = new THREE.CanvasTexture(makeRingTexture({ size: 256 }));

const SPARK_PALETTE = [
  [3.2, 1.5, 0.25],
  [3.0, 0.8, 0.12],
  [2.4, 2.2, 1.5],
  [2.8, 1.1, 0.35],
];
const PARTY_PALETTE = [
  [2.6, 2.3, 0.8],
  [2.2, 0.9, 1.8],
  [0.9, 2.1, 1.6],
  [2.4, 1.6, 0.5],
];

/** Particle sparks, expanding halos and plasma loops — all procedural. */
export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    RING_TEXTURE.colorSpace = THREE.SRGBColorSpace;

    this.sparks = [];
    this.waves = [];
    this.arcs = [];

    this._buildSparkPool();
  }

  _buildSparkPool() {
    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(SPARK_CAPACITY * 3), 3);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(SPARK_CAPACITY * 3), 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(SPARK_CAPACITY), 1);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(SPARK_CAPACITY), 1);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aColor', this.colorAttr);
    geometry.setAttribute('aSize', this.sizeAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uPixelRatio;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * uPixelRatio * (240.0 / max(1.0, -mvPosition.z)), 1.0, 26.0 * uPixelRatio);
          vColor = aColor;
          vAlpha = aAlpha;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 point = gl_PointCoord - 0.5;
          float d = length(point) * 2.0;
          float core = smoothstep(1.0, 0.0, d);
          core *= core;
          if (core < 0.015) discard;
          gl_FragColor = vec4(vColor * (0.55 + core), core * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.sparkPoints = new THREE.Points(geometry, material);
    this.sparkPoints.frustumCulled = false;
    this.sparkPoints.renderOrder = 3;
    this.scene.add(this.sparkPoints);
  }

  setPixelRatio(ratio) {
    this.sparkPoints.material.uniforms.uPixelRatio.value = ratio;
  }

  _emitSpark(position, velocity, color, { size = 0.12, life = 1, gravity = 0, drag = 1.5 } = {}) {
    if (this.sparks.length >= SPARK_CAPACITY) this.sparks.shift();
    this.sparks.push({
      position: position.clone(),
      velocity: velocity.clone(),
      color: color.clone(),
      size,
      life,
      maxLife: life,
      gravity,
      drag,
    });
  }

  _sparkColor(palette = SPARK_PALETTE) {
    const [r, g, b] = palette[Math.floor(Math.random() * palette.length)];
    const tint = rand(0.82, 1.12);
    return new THREE.Color(r * tint, g * tint, b * tint);
  }

  /** A cheery pop of stardust. */
  collectBurst(position) {
    for (let i = 0; i < 20; i += 1) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      const speed = rand(0.25, 1.4);
      this._emitSpark(
        position,
        dir.multiplyScalar(speed),
        this._sparkColor(),
        { size: rand(0.05, 0.13), life: rand(0.45, 0.95), gravity: 0.15, drag: 2.1 }
      );
    }
  }

  /** A little solar flare from one point on the surface. */
  sunFlare(position, normal, { count = 34, power = 1 } = {}) {
    const base = normal.clone().normalize();
    for (let i = 0; i < count; i += 1) {
      const dir = base.clone().add(
        new THREE.Vector3(rand(-0.9, 0.9), rand(-0.9, 0.9), rand(-0.9, 0.9))
      ).normalize();
      const speed = rand(0.6, 2.4) * power;
      this._emitSpark(
        position,
        dir.multiplyScalar(speed),
        this._sparkColor(),
        { size: rand(0.05, 0.16) * power, life: rand(0.5, 1.4), gravity: 0.1, drag: 1.4 }
      );
    }
    this.wave(position, { color: 0xffc06a, maxScale: rand(2.2, 3.4), duration: 0.9, opacity: 0.7 });
  }

  /** The full corona eruption. */
  eruption(scale = 1) {
    const origin = new THREE.Vector3(0, 0, 0);
    const count = 250;
    for (let i = 0; i < count; i += 1) {
      const dir = new THREE.Vector3(0, 0, 0);
      randomDirection(dir);
      dir.y = Math.abs(dir.y) * 0.85 + 0.1;
      dir.normalize();
      const position = dir.clone().multiplyScalar(scale * rand(0.92, 1.04));
      const speed = rand(2.2, 7.0);
      this._emitSpark(
        position,
        dir.clone().multiplyScalar(speed),
        this._sparkColor(SPARK_PALETTE),
        {
          size: rand(0.07, 0.22),
          life: rand(1.0, 2.3),
          gravity: 0.35,
          drag: 0.85,
        }
      );
    }

    // Expanding rings: a crisp inner shockwave plus two soft halos.
    this.wave(origin, { color: 0xfff0c0, maxScale: 8.4, duration: 1.7, opacity: 0.7, startScale: 2.4 });
    this.wave(origin, { color: 0xffa04a, maxScale: 11.5, duration: 2.1, opacity: 0.38, startScale: 3.2 });
    this.wave(origin, { color: 0xff7a9a, maxScale: 6.4, duration: 1.35, opacity: 0.3, startScale: 2 });

    // Plasma loops around the limb.
    for (let i = 0; i < 4; i += 1) {
      this.prominence(scale, {
        height: rand(0.6, 1.5),
        width: rand(0.5, 1.1),
        thickness: rand(0.038, 0.06),
        duration: rand(2.2, 3.4),
      });
    }
  }

  /** Confetti of light when the sun levels up. */
  levelUp(scale = 1) {
    for (let i = 0; i < 100; i += 1) {
      const dir = new THREE.Vector3(0, 0, 0);
      randomDirection(dir);
      const position = dir.clone().multiplyScalar(scale * rand(1.0, 1.15));
      this._emitSpark(
        position,
        dir.clone().multiplyScalar(rand(1.0, 3.8)),
        this._sparkColor(PARTY_PALETTE),
        { size: rand(0.05, 0.17), life: rand(0.8, 1.8), gravity: 0.15, drag: 1.1 }
      );
    }
    this.wave(new THREE.Vector3(), {
      color: 0xffd9a0,
      maxScale: 5.4,
      duration: 1.1,
      opacity: 0.5,
      startScale: 1.5,
    });
  }

  /** Soft expanding halo (sprite) at a position. */
  wave(position, { color = 0xffc46a, maxScale = 6, duration = 1.2, opacity = 0.7, startScale = 0.6 } = {}) {
    const material = new THREE.SpriteMaterial({
      map: RING_TEXTURE,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(startScale);
    sprite.renderOrder = 4;
    this.scene.add(sprite);
    this.waves.push({
      sprite,
      material,
      age: 0,
      duration,
      startScale,
      maxScale,
      opacity,
    });
  }

  /** A glowing loop of plasma over the solar surface. */
  prominence(scale = 1, { height = 0.9, width = 0.7, thickness = 0.035, duration = 2.6 } = {}) {
    const p1 = new THREE.Vector3(0, 0, 0);
    randomDirection(p1);
    const axis = new THREE.Vector3(0, 0, 0);
    randomPerpendicular(p1, axis);
    const p2 = p1.clone().applyAxisAngle(axis, width);

    const points = [];
    const steps = 48;
    const dir = new THREE.Vector3();
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      dir.copy(p1).lerp(p2, t).normalize();
      const lift = Math.sin(Math.PI * t);
      const radius = scale * (1.0 + height * Math.pow(lift, 0.85) + 0.02);
      points.push(dir.clone().multiplyScalar(radius));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, 80, thickness, 6, false);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0.001 },
        uOpacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uProgress;
        uniform float uOpacity;
        varying vec2 vUv;

        void main() {
          float visible = smoothstep(0.0, 0.06, vUv.x) * (1.0 - smoothstep(uProgress - 0.07, uProgress, vUv.x));
          if (visible < 0.01) discard;
          vec3 deep = vec3(1.0, 0.16, 0.01);
          vec3 hot = vec3(1.0, 0.82, 0.4);
          float flow = 0.65 + 0.35 * sin(uTime * 9.0 + vUv.x * 24.0 + vUv.y * 6.0);
          vec3 col = mix(deep, hot, vUv.y) * (1.6 + flow);
          gl_FragColor = vec4(col, visible * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.scene.add(mesh);
    this.arcs.push({
      mesh,
      material,
      age: 0,
      duration,
      reveal: 0,
    });
  }

  update(dt, time) {
    // Sparks ------------------------------------------------------------
    const positionArray = this.positionAttr.array;
    const colorArray = this.colorAttr.array;
    const sizeArray = this.sizeAttr.array;
    const alphaArray = this.alphaAttr.array;

    let write = 0;
    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i];
      spark.life -= dt;
      if (spark.life <= 0) {
        this.sparks.splice(i, 1);
      }
    }

    for (const spark of this.sparks) {
      spark.position.addScaledVector(spark.velocity, dt);
      spark.velocity.multiplyScalar(Math.exp(-spark.drag * dt));
      spark.velocity.y -= spark.gravity * dt;

      const progress = spark.life / spark.maxLife;
      const alpha = Math.min(1, progress * 2.4) * progress;
      positionArray[write * 3] = spark.position.x;
      positionArray[write * 3 + 1] = spark.position.y;
      positionArray[write * 3 + 2] = spark.position.z;
      colorArray[write * 3] = spark.color.r;
      colorArray[write * 3 + 1] = spark.color.g;
      colorArray[write * 3 + 2] = spark.color.b;
      sizeArray[write] = spark.size;
      alphaArray[write] = alpha;
      write += 1;
    }

    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sparkPoints.geometry.setDrawRange(0, write);

    // Halos -------------------------------------------------------------
    for (let i = this.waves.length - 1; i >= 0; i -= 1) {
      const wave = this.waves[i];
      wave.age += dt;
      const t = clamp(wave.age / wave.duration, 0, 1);
      const eased = easeOutCubic(t);
      wave.sprite.scale.setScalar(wave.startScale + (wave.maxScale - wave.startScale) * eased);
      wave.material.opacity = wave.opacity * (1 - t) * (1 - t);
      if (t >= 1) {
        this.scene.remove(wave.sprite);
        wave.material.dispose();
        this.waves.splice(i, 1);
      }
    }

    // Plasma loops ------------------------------------------------------
    for (let i = this.arcs.length - 1; i >= 0; i -= 1) {
      const arc = this.arcs[i];
      arc.age += dt;
      const t = clamp(arc.age / arc.duration, 0, 1);
      arc.material.uniforms.uTime.value = time;
      const reveal = Math.min(1, arc.age / 0.65);
      arc.material.uniforms.uProgress.value = easeOutCubic(reveal);
      arc.material.uniforms.uOpacity.value = 1 - Math.max(0, (t - 0.45) / 0.55);
      if (t >= 1) {
        this.scene.remove(arc.mesh);
        arc.mesh.geometry.dispose();
        arc.material.dispose();
        this.arcs.splice(i, 1);
      }
    }
  }
}
