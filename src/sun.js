import * as THREE from 'three';
import { makeRadialTexture } from './textures.js';
import { clamp, damp, rand, randomDirection, TAU } from './utils.js';

const NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * snoise(p);
      p = p * 2.03 + vec3(11.7, 17.3, 7.9);
      amplitude *= 0.5;
    }
    return value;
  }
`;

function makeCoronaTexture() {
  const texture = new THREE.CanvasTexture(
    makeRadialTexture({
      size: 512,
      stops: [
        [0, 'rgba(255, 244, 214, 0.95)'],
        [0.1, 'rgba(255, 214, 130, 0.72)'],
        [0.23, 'rgba(255, 172, 76, 0.4)'],
        [0.42, 'rgba(255, 126, 42, 0.16)'],
        [0.66, 'rgba(255, 90, 28, 0.045)'],
        [1, 'rgba(255, 70, 20, 0)'],
      ],
    })
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The little sun: plasma surface, corona, embers and growth reactions. */
export class Sun {
  constructor(scene, { quality = 1 } = {}) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.quality = quality;
    this.level = 1;
    this.scale = 1;
    this.targetScale = 1;
    this.pulseValue = 0;
    this.heat = 0;
    this.targetHeat = 0;

    this.uniforms = {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uHeat: { value: 0 },
    };

    this._buildCore();
    this._buildAtmosphere();
    this._buildCorona();
    this._buildEmbers();
  }

  _buildCore() {
    const geometry = new THREE.SphereGeometry(1, 96, 72);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vObjPos;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;

        ${NOISE_GLSL}

        void main() {
          vObjPos = normalize(position);
          vec3 pos = position;
          float boil = snoise(normalize(position) * 5.0 + vec3(0.0, uTime * 0.22, 0.0));
          pos += normal * boil * 0.016;

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uPulse;
        uniform float uHeat;

        varying vec3 vObjPos;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;

        ${NOISE_GLSL}

        void main() {
          vec3 p = normalize(vObjPos);
          float flow = uTime * 0.075;

          float broad = fbm(p * 2.4 + vec3(flow * 0.6, -flow * 0.4, flow * 0.3));
          float fine = fbm(p * 8.5 - vec3(flow * 1.6, flow, -flow * 0.7));
          float cells = fbm(p * 16.0 + vec3(flow * 2.2, 0.0, -flow * 1.3));
          float granule = smoothstep(-0.18, 0.42, fine + cells * 0.3);

          float heat = clamp(0.42 + broad * 0.56 + granule * 0.42 + uPulse * 0.7, 0.0, 1.9);

          vec3 deep = vec3(0.5, 0.035, 0.003);
          vec3 ember = vec3(1.0, 0.19, 0.008);
          vec3 amber = vec3(1.0, 0.5, 0.03);
          vec3 gold = vec3(1.0, 0.83, 0.34);
          vec3 white = vec3(1.0, 0.97, 0.82);

          vec3 col = mix(deep, ember, smoothstep(0.02, 0.48, heat));
          col = mix(col, amber, smoothstep(0.38, 0.92, heat));
          col = mix(col, gold, smoothstep(0.7, 1.14, heat));
          col = mix(col, white, smoothstep(1.0, 1.48, heat));

          float spotField = fbm(p * 3.0 + vec3(19.0, -3.0, 7.0) + flow * 0.25);
          float spot = smoothstep(0.26, 0.02, spotField);
          col *= 1.0 - spot * 0.58;
          float faculae = smoothstep(0.04, 0.16, spotField) * (1.0 - smoothstep(0.18, 0.34, spotField));
          col += vec3(1.0, 0.58, 0.12) * faculae * 0.32;

          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(dot(normalize(vNormalW), viewDir), 0.0), 2.3);
          col += vec3(1.0, 0.26, 0.03) * fresnel * (0.55 + uPulse * 1.5);

          col *= 0.88 + 0.12 * sin(uTime * 0.85 + broad * 2.2);
          col *= 1.12 + uHeat * 0.32 + uPulse * 0.42;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.core = new THREE.Mesh(geometry, material);
    this.group.add(this.core);
  }

  _buildAtmosphere() {
    const geometry = new THREE.SphereGeometry(1, 64, 48);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vNormalW;
        varying vec3 vWorldPos;

        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uPulse;
        uniform float uHeat;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), viewDir)), 3.0);
          float flicker = 0.9 + 0.1 * sin(uTime * 1.7 + vWorldPos.y * 5.0 + vWorldPos.x * 3.4);
          vec3 warm = vec3(1.0, 0.34, 0.03);
          vec3 hot = vec3(1.0, 0.82, 0.42);
          vec3 col = mix(warm, hot, fresnel);
          float alpha = fresnel * 0.62 * flicker * (0.6 + uPulse * 1.2 + uHeat * 0.1);
          gl_FragColor = vec4(col * 1.3, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });

    this.atmosphere = new THREE.Mesh(geometry, material);
    this.atmosphere.scale.setScalar(1.34);
    this.group.add(this.atmosphere);
  }

  _buildCorona() {
    const texture = makeCoronaTexture();
    this.corona = new THREE.Group();

    this.coronaOuter = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: 0xffbb68,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      })
    );
    this.coronaOuter.scale.setScalar(4.8);
    this.corona.add(this.coronaOuter);

    this.coronaInner = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: 0xfff0c2,
        transparent: true,
        opacity: 0.66,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      })
    );
    this.coronaInner.scale.setScalar(2.55);
    this.corona.add(this.coronaInner);

    this.group.add(this.corona);
  }

  _buildEmbers() {
    const count = Math.round(680 * this.quality);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const speeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const dir = { x: 0, y: 0, z: 0 };

    for (let i = 0; i < count; i += 1) {
      randomDirection(dir);
      positions[i * 3] = dir.x;
      positions[i * 3 + 1] = dir.y;
      positions[i * 3 + 2] = dir.z;
      seeds[i] = Math.random();
      speeds[i] = rand(0.45, 1.5);
      sizes[i] = rand(0.55, 2.1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.emberUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uPulse: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.emberUniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uPulse;
        attribute float aSeed;
        attribute float aSpeed;
        attribute float aSize;
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          float life = fract(aSeed + uTime * 0.042 * aSpeed);
          float radius = 1.02 + life * 2.9;
          vec3 pos = position * radius;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          vAlpha = smoothstep(0.0, 0.16, life) * (1.0 - smoothstep(0.5, 1.0, life));
          vColor = mix(vec3(1.0, 0.9, 0.62), vec3(1.0, 0.38, 0.06), smoothstep(0.0, 0.8, life));
          float size = aSize * (0.55 + vAlpha * 0.9 + uPulse * 0.8);
          gl_PointSize = clamp(size * uPixelRatio * (33.0 / max(3.0, -mvPosition.z)), 0.5, 7.0 * uPixelRatio);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          vec2 point = gl_PointCoord - 0.5;
          float d = length(point) * 2.0;
          float alpha = smoothstep(1.0, 0.0, d);
          alpha *= alpha;
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(vColor * 1.35, alpha * vAlpha * 0.68);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.embers = new THREE.Points(geometry, material);
    this.embers.frustumCulled = false;
    this.group.add(this.embers);
  }

  pulse(strength = 0.6) {
    this.pulseValue = clamp(this.pulseValue + strength, 0, 1.8);
  }

  setLevel(level) {
    this.level = level;
    this.targetScale = 1 + (level - 1) * 0.078;
    this.targetHeat = (level - 1) / 5;
  }

  setPixelRatio(ratio) {
    this.emberUniforms.uPixelRatio.value = ratio;
  }

  update(dt, time) {
    this.uniforms.uTime.value = time;
    this.pulseValue = damp(this.pulseValue, 0, 2.4, dt);
    this.uniforms.uPulse.value = this.pulseValue;

    this.heat = damp(this.heat, this.targetHeat, 1.6, dt);
    this.uniforms.uHeat.value = this.heat;

    this.scale = damp(this.scale, this.targetScale, 3.5, dt);
    this.group.scale.setScalar(this.scale);

    this.core.rotation.y += dt * 0.055;
    this.core.rotation.z = Math.sin(time * 0.12) * 0.03;
    this.core.scale.setScalar(1 + this.pulseValue * 0.022);

    this.atmosphere.rotation.y -= dt * 0.02;
    this.atmosphere.scale.setScalar(1.34 + this.pulseValue * 0.03);

    this.coronaInner.scale.setScalar(2.55 + this.pulseValue * 0.35);
    this.coronaOuter.scale.setScalar(4.8 + this.pulseValue * 0.55);
    this.coronaOuter.material.opacity = 0.46 + 0.035 * Math.sin(time * 0.8) + this.pulseValue * 0.12;
    this.coronaInner.material.opacity = 0.6 + 0.035 * Math.sin(time * 1.1 + 1.0) + this.pulseValue * 0.1;

    this.emberUniforms.uTime.value = time;
    this.emberUniforms.uPulse.value = this.pulseValue;
  }
}
