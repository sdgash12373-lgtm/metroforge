import * as THREE from 'three';
import { type Terrain, WATER_LEVEL } from '../sim/terrain';

/**
 * The sea, after Tessendorf's FFT ocean, on the GPU with WebGL2. Each frame a wave spectrum is moved on in time and
 * turned into a height and sideways-displacement field by an inverse FFT (Stockham butterflies in fragment
 * shaders, ping-ponging float render targets). A normal, foam pass follows. The surface is a camera-centred disc
 * reaching past the fog to the horizon, so the sea has no edge: beyond the map it carries on wherever the map's
 * edge is sea, and stays away where the edge is land.
 *
 * Waves grow with the water's depth (calm in harbours, rivers and lakes, full swell out at sea) and with the wind.
 */

/** Size of the wave patch the FFT works over, in meters: it tiles across the sea. */
const PATCH = 240;
/** Gravity, for how fast waves of each length travel. */
const G = 9.81;
/** The waves repeat after this many seconds (their frequencies are rounded to it), so time never runs out of precision. */
const LOOP = 200;
/** Root-mean-square wave height in calm weather, meters. */
const RMS = 0.32;
/** How strongly crests are pulled together (choppy waves). */
const CHOP = 1.25;
/** Reach of the sea surface from the camera's focus: past the far fog, to the horizon. */
const REACH = 9000;
/** Resolution of the depth map over the land's extent. */
const DEPTH_RES = 384;
/** Depth (m) at which the waves are full height and the water its deepest colour. */
const FULL_DEPTH = 8;

const QUAD_VERT = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** h(k, t) for the height and both sideways displacements, packed as two complex fields (see Ocean). */
const SPECTRUM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uH0;
uniform float uTime;
uniform float uN;
out vec4 color;
const float PI = 3.141592653589793;
vec2 mul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  vec2 ij = floor(gl_FragCoord.xy);
  vec2 f = vec2(ij.x < uN * 0.5 ? ij.x : ij.x - uN, ij.y < uN * 0.5 ? ij.y : ij.y - uN);
  vec2 k = 2.0 * PI * f / ${PATCH.toFixed(1)};
  float len = length(k);
  if (len < 1e-6) { color = vec4(0.0); return; }
  float w0 = 2.0 * PI / ${LOOP.toFixed(1)};
  float w = floor(sqrt(${G} * len) / w0) * w0;
  vec4 h0 = texture(uH0, (ij + 0.5) / uN);
  float c = cos(w * uTime);
  float s = sin(w * uTime);
  vec2 h = mul(h0.xy, vec2(c, s)) + mul(h0.zw, vec2(c, -s));
  vec2 kh = k / len;
  // Height plus i times the x displacement (D = -i k/|k| h, so i D = k/|k| h), and the z displacement
  vec2 one = h + kh.x * h;
  vec2 two = kh.y * vec2(h.y, -h.x);
  color = vec4(one, two);
}
`;

/** One radix-2 Stockham stage of the inverse FFT along x (uAxis 0) or y (uAxis 1), on two complex values per texel. */
const FFT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uInput;
uniform float uN;
uniform float uSize;
uniform int uAxis;
out vec4 color;
const float PI = 3.141592653589793;
vec2 mul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  vec2 ij = floor(gl_FragCoord.xy);
  float index = uAxis == 0 ? ij.x : ij.y;
  float half_ = uSize * 0.5;
  float even = floor(index / uSize) * half_ + mod(index, half_);
  vec2 a = uAxis == 0 ? vec2(even, ij.y) : vec2(ij.x, even);
  vec2 b = uAxis == 0 ? vec2(even + uN * 0.5, ij.y) : vec2(ij.x, even + uN * 0.5);
  vec4 e = texture(uInput, (a + 0.5) / uN);
  vec4 o = texture(uInput, (b + 0.5) / uN);
  float arg = 2.0 * PI * index / uSize;
  vec2 t = vec2(cos(arg), sin(arg));
  color = vec4(e.xy + mul(t, o.xy), e.zw + mul(t, o.zw));
}
`;

/** Displacement (x, height, z) from the FFT's output, scaled. */
const DISPLACE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uInput;
uniform float uN;
uniform float uScale;
out vec4 color;
void main() {
  vec4 v = texture(uInput, gl_FragCoord.xy / uN);
  color = vec4(v.y * ${CHOP.toFixed(2)} * uScale, v.x * uScale, v.z * ${CHOP.toFixed(2)} * uScale, 1.0);
}
`;

/** Surface normal and foam (where the waves fold over: the Jacobian of the displacement drops below 1). */
const NORMAL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uDisp;
uniform float uN;
out vec4 color;
void main() {
  vec2 uv = gl_FragCoord.xy / uN;
  float d = 1.0 / uN;
  vec3 l = texture(uDisp, uv - vec2(d, 0.0)).xyz;
  vec3 r = texture(uDisp, uv + vec2(d, 0.0)).xyz;
  vec3 b = texture(uDisp, uv - vec2(0.0, d)).xyz;
  vec3 t = texture(uDisp, uv + vec2(0.0, d)).xyz;
  float step_ = 2.0 * ${PATCH.toFixed(1)} / uN;
  vec3 dx = (r - l) / step_;
  vec3 dz = (t - b) / step_;
  vec3 tx = vec3(1.0 + dx.x, dx.y, dx.z);
  vec3 tz = vec3(dz.x, dz.y, 1.0 + dz.z);
  vec3 n = normalize(cross(tz, tx));
  float jacobian = (1.0 + dx.x) * (1.0 + dz.z) - dx.z * dz.x;
  color = vec4(n * 0.5 + 0.5, clamp(0.85 - jacobian, 0.0, 1.0));
}
`;

const SURFACE_VERT = /* glsl */ `
uniform sampler2D uDisp;
uniform sampler2D uDepth;
uniform vec4 uBounds;
uniform float uAmp;
varying vec3 vWorld;
varying vec2 vDepth;
varying float vHeight;
varying float vOutside;
#include <fog_pars_vertex>

// Depth (r, 0..1 of ${FULL_DEPTH} m) and open sea (g) at a point; past the map's edge, the edge's own, deepening offshore
vec3 depthAt(vec2 p) {
  vec2 uv = (p - uBounds.xy) / (uBounds.zw - uBounds.xy);
  vec2 edge = clamp(uv, vec2(0.5 / ${DEPTH_RES}.0), vec2(1.0 - 0.5 / ${DEPTH_RES}.0));
  vec2 dm = texture2D(uDepth, edge).rg;
  float out_ = length((uv - clamp(uv, 0.0, 1.0)) * (uBounds.zw - uBounds.xy));
  // Beyond the edge, sea gets deep fast; land at the edge keeps the sea off
  float deep = smoothstep(0.0, 1500.0, out_);
  return vec3(mix(dm.r, 1.0, deep * step(0.02, dm.g)), dm.g, out_);
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 dm = depthAt(world.xz);
  vDepth = dm.xy;
  vOutside = dm.z;
  float far = distance(world.xz, cameraPosition.xz);
  // Full waves on open water, none at the shore or on rivers and lakes; flat far off where they could not be seen
  float amp = uAmp * smoothstep(0.02, 0.6, dm.x) * mix(0.25, 1.0, dm.y) * (1.0 - smoothstep(2500.0, 5000.0, far));
  vec3 d = texture2D(uDisp, world.xz / ${PATCH.toFixed(1)}).xyz * amp;
  world.xyz += d;
  vHeight = d.y;
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SURFACE_FRAG = /* glsl */ `
uniform sampler2D uNormal;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform float uLight;
uniform float uTime;
uniform float uAmp;
varying vec3 vWorld;
varying vec2 vDepth;
varying float vHeight;
varying float vOutside;
#include <fog_pars_fragment>

void main() {
  // The land's edge: no sea beyond it
  if (vOutside > 0.0 && vDepth.y < 0.02) discard;
  float far = distance(vWorld, cameraPosition);
  vec2 p = vWorld.xz / ${PATCH.toFixed(1)};
  vec4 a = texture2D(uNormal, p);
  // A second, smaller and turned sampling of the same waves, so the tiling does not show
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p * 3.7 + vec2(uTime * 0.013, uTime * 0.007);
  vec4 b = texture2D(uNormal, q);
  vec3 n1 = a.xyz * 2.0 - 1.0;
  vec3 n2 = b.xyz * 2.0 - 1.0;
  float calm = smoothstep(0.02, 0.6, vDepth.x) * mix(0.3, 1.0, vDepth.y);
  vec3 n = normalize(vec3((n1.x + n2.x * 0.45) * calm, n1.y, (n1.z + n2.z * 0.45) * calm));
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(600.0, 4000.0, far)));
  vec3 v = normalize(cameraPosition - vWorld);
  float facing = max(dot(n, v), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  // Sky in the reflection: the horizon colour, a deeper blue overhead
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uSky, uSky * vec3(0.62, 0.78, 1.0), clamp(r.y * 1.5, 0.0, 1.0));
  // Water colour by depth: clear turquoise over sand, deep blue offshore
  vec3 shallow = vec3(0.09, 0.40, 0.42);
  vec3 mid = vec3(0.03, 0.20, 0.27);
  vec3 deep = vec3(0.012, 0.075, 0.15);
  float dd = vDepth.x;
  vec3 body = mix(mix(shallow, mid, smoothstep(0.05, 0.6, dd)), deep, smoothstep(0.75, 1.0, dd) * smoothstep(0.0, 1500.0, vOutside + 300.0)) * uLight;
  // Light through the tops of the waves, and from the sun behind them
  float crest = clamp(vHeight * 0.45, 0.0, 1.0);
  float back = pow(max(dot(v, -uSunDir), 0.0), 3.0);
  body += vec3(0.04, 0.2, 0.18) * crest * (0.4 + back) * uLight;
  vec3 col = mix(body, sky, fresnel);
  // Sun glitter
  vec3 h = normalize(uSunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 420.0) * 6.0 + pow(max(dot(n, h), 0.0), 60.0) * 0.12;
  col += uSunColor * spec * step(0.0, uSunDir.y);
  // Foam: on folding crests (more in a strong wind) and along the shore
  float foam = a.w * smoothstep(0.1, 0.6, vDepth.x) * clamp(uAmp, 0.0, 1.6);
  float shore = (1.0 - smoothstep(0.0, 0.08, vDepth.x)) * vDepth.y;
  float streaks = 0.5 + 0.5 * sin(dot(vWorld.xz, vec2(0.21, 0.17)) + uTime * 0.9 + b.x * 6.0);
  foam = clamp(foam * 1.6 + shore * streaks * 0.7, 0.0, 1.0) * (1.0 - smoothstep(800.0, 2500.0, far));
  col = mix(col, vec3(0.92, 0.95, 0.96) * max(uLight, 0.15), foam);
  // Clear in the shallows (the sand shows), solid where deep or past the map
  float alpha = mix(0.62, 1.0, smoothstep(0.0, 0.35, vDepth.x));
  alpha = mix(alpha, 1.0, max(foam, step(0.001, vOutside)));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Gaussian random pairs, seeded, so every game's sea is the same. */
function gauss(rand: () => number): [number, number] {
  const u = Math.max(1e-6, rand());
  const v = rand();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * h0(k) and conj(h0(-k)) for a Phillips spectrum blown by `wind` (m/s) towards `dir`, in natural FFT order, scaled
 * so the waves' root-mean-square height comes out at RMS meters after the inverse FFT.
 */
function initialSpectrum(n: number, wind: number, dir: THREE.Vector2): Float32Array {
  const rand = mulberry(20261031);
  const big = (wind * wind) / G;
  const small = big / 1000;
  const amp = new Float32Array(n * n * 2);
  let variance = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = x < n / 2 ? x : x - n;
      const fy = y < n / 2 ? y : y - n;
      const kx = (2 * Math.PI * fx) / PATCH;
      const ky = (2 * Math.PI * fy) / PATCH;
      const k2 = kx * kx + ky * ky;
      const i = (y * n + x) * 2;
      if (k2 < 1e-12) continue;
      const k = Math.sqrt(k2);
      const cos = (kx * dir.x + ky * dir.y) / k;
      let p = (Math.exp(-1 / (k2 * big * big)) / (k2 * k2)) * cos * cos * Math.exp(-k2 * small * small);
      // Little travels against the wind
      if (cos < 0) p *= 0.07;
      const [a, b] = gauss(rand);
      const s = Math.sqrt(p / 2);
      amp[i] = a * s;
      amp[i + 1] = b * s;
      variance += amp[i] * amp[i] + amp[i + 1] * amp[i + 1];
    }
  }
  // h(x) = sum over k of h0(k) e^.. + conj(h0(-k)) e^..: its variance is twice the sum of |h0|^2
  const scale = RMS / Math.sqrt(Math.max(1e-12, variance * 2));
  const out = new Float32Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 2;
      const j = (((n - y) % n) * n + ((n - x) % n)) * 2;
      const o = (y * n + x) * 4;
      out[o] = amp[i] * scale;
      out[o + 1] = amp[i + 1] * scale;
      out[o + 2] = amp[j] * scale;
      out[o + 3] = -amp[j + 1] * scale;
    }
  }
  return out;
}

/** A disc of rings out to REACH, dense near the middle, as a flat grid at sea level. */
function surfaceGeometry(rings: number, sides: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let i = 1; i <= rings; i++) {
    const r = REACH * Math.pow(i / rings, 2.4);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  const at = (i: number, s: number) => 1 + (i - 1) * sides + (s % sides);
  for (let s = 0; s < sides; s++) idx.push(0, at(1, s + 1), at(1, s));
  for (let i = 1; i < rings; i++) {
    for (let s = 0; s < sides; s++) {
      const a = at(i, s);
      const b = at(i, s + 1);
      const c = at(i + 1, s);
      const d = at(i + 1, s + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), REACH * 1.5);
  return g;
}

export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly n: number;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly h0: THREE.DataTexture;
  private readonly ping: THREE.WebGLRenderTarget;
  private readonly pong: THREE.WebGLRenderTarget;
  private readonly disp: THREE.WebGLRenderTarget;
  private readonly normal: THREE.WebGLRenderTarget;
  private readonly spectrum: THREE.RawShaderMaterial;
  private readonly fft: THREE.RawShaderMaterial;
  private readonly displace: THREE.RawShaderMaterial;
  private readonly normals: THREE.RawShaderMaterial;
  private readonly material: THREE.ShaderMaterial;
  private depth: THREE.DataTexture | null = null;
  private time = 0;

  /** Whether this browser can run it: WebGL2 with float or half-float render targets. */
  static supported(renderer: THREE.WebGLRenderer): boolean {
    return renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  }

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    detailed: boolean,
  ) {
    this.n = detailed ? 256 : 128;
    const n = this.n;
    // Full floats for the FFT where they can be drawn to, half floats otherwise
    const fft = renderer.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
    const target = (type: THREE.TextureDataType, mips = false) =>
      new THREE.WebGLRenderTarget(n, n, {
        type,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        minFilter: type === fft && fft === THREE.FloatType ? THREE.NearestFilter : mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
        magFilter: type === fft && fft === THREE.FloatType ? THREE.NearestFilter : THREE.LinearFilter,
        generateMipmaps: mips,
      });
    this.ping = target(fft);
    this.pong = target(fft);
    // Displacement and normals are sampled smoothly (and the normals mipmapped against shimmer far off)
    this.disp = target(THREE.HalfFloatType);
    this.normal = target(THREE.HalfFloatType, true);
    this.normal.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    for (const rt of [this.ping, this.pong]) {
      rt.texture.minFilter = THREE.NearestFilter;
      rt.texture.magFilter = THREE.NearestFilter;
    }
    this.h0 = new THREE.DataTexture(initialSpectrum(n, 11, new THREE.Vector2(0.8, 0.6)), n, n, THREE.RGBAFormat, THREE.FloatType);
    this.h0.minFilter = THREE.NearestFilter;
    this.h0.magFilter = THREE.NearestFilter;
    this.h0.needsUpdate = true;

    const raw = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.spectrum = raw(SPECTRUM_FRAG, { uH0: { value: this.h0 }, uTime: { value: 0 }, uN: { value: n } });
    this.fft = raw(FFT_FRAG, { uInput: { value: null }, uN: { value: n }, uSize: { value: 2 }, uAxis: { value: 0 } });
    this.displace = raw(DISPLACE_FRAG, { uInput: { value: null }, uN: { value: n }, uScale: { value: 1 } });
    this.normals = raw(NORMAL_FRAG, { uDisp: { value: this.disp.texture }, uN: { value: n } });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri, this.spectrum);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.material = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uDisp: { value: null },
          uNormal: { value: null },
          uDepth: { value: null },
          uBounds: { value: new THREE.Vector4(-1, -1, 1, 1) },
          uAmp: { value: 1 },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color(1, 1, 1) },
          uSky: { value: new THREE.Color(0.7, 0.8, 0.9) },
          uLight: { value: 1 },
          uTime: { value: 0 },
        },
      ]),
    });
    this.material.uniforms.uDisp.value = this.disp.texture;
    this.material.uniforms.uNormal.value = this.normal.texture;
    this.mesh = new THREE.Mesh(surfaceGeometry(detailed ? 200 : 150, detailed ? 256 : 192), this.material);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
  }

  /** Depth and open sea over the land's extent, for how high the waves run and what colour the water is. */
  setTerrain(terrain: Terrain): void {
    const b = terrain.bounds;
    const res = DEPTH_RES;
    const data = new Uint8Array(res * res * 4);
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = b.minX + ((i + 0.5) / res) * (b.maxX - b.minX);
        const y = b.minY + ((j + 0.5) / res) * (b.maxY - b.minY);
        const depth = WATER_LEVEL - terrain.height(x, y);
        const o = (j * res + i) * 4;
        data[o] = Math.round(255 * Math.min(1, Math.max(0, depth / FULL_DEPTH)));
        data[o + 1] = depth > 0 && terrain.sea(x, y) ? 255 : 0;
        data[o + 3] = 255;
      }
    }
    this.depth?.dispose();
    this.depth = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
    this.depth.minFilter = THREE.LinearFilter;
    this.depth.magFilter = THREE.LinearFilter;
    this.depth.wrapS = THREE.ClampToEdgeWrapping;
    this.depth.wrapT = THREE.ClampToEdgeWrapping;
    this.depth.needsUpdate = true;
    this.material.uniforms.uDepth.value = this.depth;
    this.material.uniforms.uBounds.value.set(b.minX, b.minY, b.maxX, b.maxY);
  }

  private pass(material: THREE.RawShaderMaterial, out: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(out);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Moves the waves on by dt and centres the sea on `focus`. `wind` 0..1 (a typhoon is 1) raises the waves; the
   * sun's direction and colour, the sky's colour and the light level shade it.
   */
  update(dt: number, focus: { x: number; y: number }, wind: number, sun: THREE.Vector3, sunColor: THREE.Color, sky: THREE.Color, light: number): void {
    if (!this.mesh.visible) return;
    this.time = (this.time + dt) % LOOP;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.spectrum.uniforms.uTime.value = this.time;
    this.pass(this.spectrum, this.ping);
    let src = this.ping;
    let dst = this.pong;
    for (const axis of [0, 1]) {
      for (let size = 2; size <= this.n; size *= 2) {
        this.fft.uniforms.uInput.value = src.texture;
        this.fft.uniforms.uSize.value = size;
        this.fft.uniforms.uAxis.value = axis;
        this.pass(this.fft, dst);
        [src, dst] = [dst, src];
      }
    }
    this.displace.uniforms.uInput.value = src.texture;
    this.pass(this.displace, this.disp);
    this.pass(this.normals, this.normal);
    r.setRenderTarget(prev);
    r.autoClear = autoClear;

    // Snap the disc to a few meters so its vertices do not crawl over the waves as the view moves
    this.mesh.position.x = Math.round(focus.x / 8) * 8;
    this.mesh.position.z = Math.round(focus.y / 8) * 8;
    const u = this.material.uniforms;
    u.uAmp.value = 0.75 + 1.6 * wind;
    u.uSunDir.value.copy(sun).normalize();
    u.uSunColor.value.copy(sunColor);
    u.uSky.value.copy(sky);
    u.uLight.value = light;
    u.uTime.value = this.time;
  }
}
