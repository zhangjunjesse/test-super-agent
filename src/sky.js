import * as THREE from 'three';
import { makeRadialTexture } from './textures.js';
import { damp, easeOutBack, rand, randomDirection, TAU } from './utils.js';

const STAR_COLORS = [0xffffff, 0xfff4e0, 0xcfe0ff, 0xffd9ec, 0xb9f2ff];

const PLANET_DEFS = [
  { name: '薄荷', color: 0x9be8c8, size: 0.17, orbit: 2.85, speed: 0.17, tilt: 0.2, ring: false, phase: 0.4 },
  { name: '蜜桃', color: 0xffb08f, size: 0.22, orbit: 3.65, speed: 0.12, tilt: -0.34, ring: false, phase: 2.1, moon: true },
  { name: '葡萄', color: 0xbba5ff, size: 0.19, orbit: 4.5, speed: 0.095, tilt: 0.46, ring: true, phase: 4.0 },
  { name: '青柠', color: 0xd6f27d, size: 0.15, orbit: 5.35, speed: 0.075, tilt: -0.16, ring: false, phase: 5.3 },
  { name: '玫瑰', color: 0xff9fc3, size: 0.26, orbit: 6.3, speed: 0.058, tilt: 0.3, ring: true, phase: 1.2 },
];

/** Deep-space backdrop + the cute planets that show up as the sun grows. */
export class Sky {
  constructor(scene, { reducedMotion = false, quality = 1 } = {}) {
    this.scene = scene;
    this.reducedMotion = reducedMotion;
    this.quality = quality;

    this.starUniforms = { uTime: { value: 0 }, uPixelRatio: { value: 1 } };
    this.stars = this._buildStars(Math.round((reducedMotion ? 1300 : 2700) * quality));
    scene.add(this.stars);

    this.nebulae = this._buildNebulae();
    this.nebulae.forEach((sprite) => scene.add(sprite));

    this.planetRoot = new THREE.Group();
    scene.add(this.planetRoot);
    this.planets = PLANET_DEFS.map((def) => this._buildPlanet(def));
    this.hitMeshes = this.planets.map((planet) => planet.mesh);
  }

  _buildStars(count) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const direction = { x: 0, y: 0, z: 0 };
    const color = new THREE.Color();

    for (let i = 0; i < count; i += 1) {
      randomDirection(direction);
      const radius = rand(28, 74);
      positions[i * 3] = direction.x * radius;
      positions[i * 3 + 1] = direction.y * radius;
      positions[i * 3 + 2] = direction.z * radius;

      color.setHex(STAR_COLORS[i % STAR_COLORS.length]);
      const warmth = rand(0.85, 1.1);
      colors[i * 3] = color.r * warmth;
      colors[i * 3 + 1] = color.g * warmth;
      colors[i * 3 + 2] = color.b * warmth;

      sizes[i] = 0.55 + Math.pow(Math.random(), 4) * 2.3;
      phases[i] = rand(0, TAU);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aSize;
        attribute float aPhase;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float twinkle = 0.62 + 0.38 * sin(uTime * 0.65 + aPhase);
          vAlpha = twinkle;
          vColor = aColor * 1.35;
          gl_PointSize = clamp(aSize * uPixelRatio * (42.0 / max(7.0, -mvPosition.z)), 1.0, 5.0 * uPixelRatio);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 point = gl_PointCoord - 0.5;
          float d = length(point) * 2.0;
          float alpha = smoothstep(1.0, 0.0, d);
          alpha *= alpha;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vColor, alpha * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  _buildNebulae() {
    const texture = new THREE.CanvasTexture(
      makeRadialTexture({
        size: 512,
        stops: [
          [0, 'rgba(255,255,255,0.5)'],
          [0.32, 'rgba(255,255,255,0.18)'],
          [0.7, 'rgba(255,255,255,0.045)'],
          [1, 'rgba(255,255,255,0)'],
        ],
      })
    );
    texture.colorSpace = THREE.SRGBColorSpace;

    const layers = [
      { color: 0x5b3fa8, position: [-16, 9, -34], scale: 46, opacity: 0.32 },
      { color: 0x2d5fa8, position: [22, -6, -38], scale: 52, opacity: 0.26 },
      { color: 0xa83f7a, position: [4, -16, -30], scale: 38, opacity: 0.18 },
    ];

    return layers.map((layer) => {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: layer.color,
        transparent: true,
        opacity: layer.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(...layer.position);
      sprite.scale.setScalar(layer.scale);
      return sprite;
    });
  }

  _buildPlanet(def) {
    const orbit = new THREE.Group();
    orbit.rotation.x = def.tilt;
    orbit.rotation.z = def.tilt * 0.6;
    orbit.visible = false;
    this.planetRoot.add(orbit);

    const orbitGeometry = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 128 }, (_, i) => {
        const a = (i / 128) * TAU;
        return new THREE.Vector3(Math.cos(a) * def.orbit, 0, Math.sin(a) * def.orbit);
      })
    );
    const orbitColor = new THREE.Color(def.color).lerp(new THREE.Color(0xffffff), 0.25);
    const orbitMaterial = new THREE.LineBasicMaterial({
      color: orbitColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.LineLoop(orbitGeometry, orbitMaterial);
    orbit.add(line);

    const material = new THREE.MeshStandardMaterial({
      color: def.color,
      roughness: 0.82,
      metalness: 0.05,
      emissive: new THREE.Color(def.color).multiplyScalar(0.16),
      emissiveIntensity: 0.8,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.size, 32, 24), material);
    mesh.position.set(def.orbit, 0, 0);
    mesh.userData.planet = true;
    orbit.add(mesh);

    const glowTexture = new THREE.CanvasTexture(
      makeRadialTexture({
        size: 128,
        stops: [
          [0, 'rgba(255,255,255,0.55)'],
          [0.38, 'rgba(255,255,255,0.18)'],
          [1, 'rgba(255,255,255,0)'],
        ],
      })
    );
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: new THREE.Color(def.color).multiplyScalar(2),
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.scale.setScalar(def.size * 5);
    mesh.add(glow);

    let moon = null;
    if (def.moon) {
      const moonOrbit = new THREE.Group();
      const moonMesh = new THREE.Mesh(
        new THREE.SphereGeometry(def.size * 0.28, 18, 14),
        new THREE.MeshStandardMaterial({
          color: 0xfff3d1,
          roughness: 0.9,
          emissive: 0x221a0c,
        })
      );
      moonMesh.position.set(def.size * 1.75, 0, 0);
      moonOrbit.add(moonMesh);
      mesh.add(moonOrbit);
      moon = { orbit: moonOrbit, mesh: moonMesh };
    }

    if (def.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(def.size * 1.45, def.size * 2.15, 64),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(def.color).multiplyScalar(1.6),
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      ring.rotation.x = Math.PI / 2.2;
      mesh.add(ring);
    }

    return {
      def,
      orbit,
      line,
      mesh,
      moon,
      visible: false,
      grow: 0,
      angle: def.phase,
      boop: 0,
    };
  }

  /** Reveal the planet that belongs to a level (2..6). */
  reveal(level) {
    const planet = this.planets[level - 2];
    if (!planet || planet.visible) return false;
    planet.visible = true;
    planet.orbit.visible = true;
    planet.grow = 0;
    return true;
  }

  revealAll() {
    this.planets.forEach((planet) => {
      planet.visible = true;
      planet.orbit.visible = true;
      planet.grow = 1;
    });
  }

  reset() {
    this.planets.forEach((planet) => {
      planet.visible = false;
      planet.orbit.visible = false;
      planet.grow = 0;
      planet.orbit.scale.setScalar(1);
    });
  }

  click(planetMesh) {
    const planet = this.planets.find((item) => item.mesh === planetMesh);
    if (!planet) return null;
    planet.boop = 1;
    return planet;
  }

  update(dt, time) {
    this.starUniforms.uTime.value = time;

    for (const planet of this.planets) {
      if (!planet.visible) continue;
      planet.grow = Math.min(1, planet.grow + dt / 1.1);
      planet.orbit.scale.setScalar(Math.max(0.001, easeOutBack(planet.grow)));
      planet.angle += dt * planet.def.speed;
      planet.orbit.rotation.y = planet.angle;
      planet.mesh.rotation.y += dt * 0.55;
      planet.line.material.opacity = damp(planet.line.material.opacity, 0.16 * planet.grow, 2, dt);

      if (planet.boop > 0) {
        planet.boop = Math.max(0, planet.boop - dt * 2.6);
        const pop = Math.sin(Math.PI * (1 - planet.boop)) * 0.16;
        planet.mesh.scale.setScalar(1 + pop);
      } else {
        planet.mesh.scale.setScalar(1);
      }

      if (planet.moon) {
        planet.moon.orbit.rotation.y += dt * 1.6;
        planet.moon.orbit.rotation.z = 0.25;
      }
    }
  }

  setPixelRatio(ratio) {
    this.starUniforms.uPixelRatio.value = ratio;
  }
}
