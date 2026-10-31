import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';

/** What the player picks in 設定; 自動 starts from a guess at the graphics chip and keeps the frame rate up. */
export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type Tier = Exclude<Quality, 'auto'>;

export const QUALITY_CHOICES: [Quality, string][] = [
  ['auto', '自動'],
  ['low', '低'],
  ['medium', '中'],
  ['high', '高'],
];

interface Preset {
  /** highest device pixel ratio drawn at */
  pixels: number;
  /** bloom, colour grading and anti-aliasing after the scene */
  post: boolean;
  /** multisampling of the scene's render target (instead of FXAA) */
  samples: number;
  softShadows: boolean;
  shadowSize: number;
}

const PRESETS: Record<Tier, Preset> = {
  low: { pixels: 1, post: false, samples: 0, softShadows: false, shadowSize: 1024 },
  medium: { pixels: 1.25, post: true, samples: 0, softShadows: true, shadowSize: 2048 },
  high: { pixels: 2, post: true, samples: 4, softShadows: true, shadowSize: 2048 },
};

/** The frame rate the automatic setting holds on to. */
export const TARGET_FPS = 50;

/** A guess at what the graphics chip can do: phones and small integrated chips low, other integrated medium. */
export function guessTier(coarse: boolean): Tier {
  if (coarse) return 'low';
  let name = '';
  try {
    // A throwaway context, asked before the game's own is made (whether that one multisamples depends on this)
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // keep the default
  }
  if (/swiftshader|llvmpipe|software|mali|adreno|powervr/.test(name)) return 'low';
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|apple m\d (pro|max|ultra)|arc a\d/.test(name)) return 'high';
  return 'medium';
}

/** Lets three's fog also lay a light haze over the middle distance (aerial perspective): far things go paler and
 * take the sky's colour long before the fog proper closes in. */
export function installAerialPerspective(): void {
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float haze = ( 1.0 - exp( - vFogDepth * 0.00042 ) ) * 0.42;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, max( fogFactor, haze ) );
#endif
`;
}

/** Colour grading and a soft vignette, on the final image (after tone mapping). */
const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uNight: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uNight;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // A little more colour, a gentle S-curve, cool shadows and warm highlights
      col = mix(vec3(l), col, 1.1);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      col += vec3(-0.012, 0.0, 0.018) * (1.0 - l) + vec3(0.014, 0.006, -0.012) * l;
      // Darker corners, more so at night
      vec2 q = vUv - 0.5;
      col *= 1.0 - dot(q, q) * mix(0.32, 0.55, uNight);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/**
 * How the frame is drawn: straight to the screen on 低, or through bloom (lights glowing at night, sun glints by
 * day), colour grading and anti-aliasing on 中 and 高. On 自動 it watches the frame rate: when it drops under the
 * target the picture is drawn at a lower resolution (down to 60 %), and if even that is not enough it steps down
 * a level; with time to spare the resolution creeps back up.
 */
export class Graphics {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private fxaa: FXAAPass | null = null;
  private width = 1;
  private height = 1;
  /** resolution scale from the frame-rate governor, 0.6..1 */
  scale = 1;
  tier: Tier;
  /** frames per second, smoothed */
  fps = 60;
  private slow = 0;
  private fast = 0;
  private starved = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private camera: THREE.Camera,
    private readonly sun: THREE.DirectionalLight,
    public quality: Quality,
    private readonly guess: Tier,
  ) {
    this.tier = quality === 'auto' ? guess : quality;
    this.apply(true);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.tier = q === 'auto' ? this.guess : q;
    this.scale = 1;
    this.apply(false);
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    const pass = this.composer?.passes[0] as RenderPass | undefined;
    if (pass) pass.camera = camera;
  }

  private get preset(): Preset {
    return PRESETS[this.tier];
  }

  private apply(first: boolean): void {
    const p = this.preset;
    const soft = p.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== soft || this.sun.shadow.mapSize.x !== p.shadowSize) {
      this.renderer.shadowMap.type = soft;
      this.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      // Materials compiled for the other shadow filter are built again
      if (!first) this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const one of Array.isArray(m) ? m : [m]) one.needsUpdate = true;
      });
    }
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    this.fxaa = null;
    if (p.post) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: p.samples });
      const composer = new EffectComposer(this.renderer, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.35, 0.92);
      // A stray NaN or overflow in one pixel (half floats top out at 65504) would be blurred over the whole
      // screen by the bloom: such pixels are left out of it
      const high = this.bloom.materialHighPassFilter;
      high.fragmentShader = high.fragmentShader.replace(
        'vec4 texel = texture2D( tDiffuse, vUv );',
        `vec4 texel = texture2D( tDiffuse, vUv );
        if ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 );
        texel.rgb = clamp( texel.rgb, 0.0, 16.0 );`,
      );
      high.needsUpdate = true;
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GradeShader);
      composer.addPass(this.grade);
      if (!p.samples) {
        this.fxaa = new FXAAPass();
        composer.addPass(this.fxaa);
      }
      this.composer = composer;
    }
    this.resize(this.width, this.height);
  }

  private get pixelRatio(): number {
    return Math.min(devicePixelRatio || 1, this.preset.pixels) * this.scale;
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
  }

  /** Night 0..1: lights bloom more after dark. */
  render(night: number): void {
    if (!this.composer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.bloom) {
      this.bloom.strength = 0.12 + 0.22 * night;
      this.bloom.threshold = THREE.MathUtils.lerp(0.95, 0.86, night);
      this.bloom.radius = 0.3 + 0.1 * night;
    }
    if (this.grade) this.grade.uniforms.uNight.value = night;
    this.composer.render();
  }

  /** Called every frame with its length in seconds: keeps 自動 near the target frame rate. */
  govern(dt: number): void {
    if (dt <= 0 || dt > 0.5) return;
    this.fps += (1 / dt - this.fps) * Math.min(1, dt * 2);
    if (this.quality !== 'auto') return;
    if (this.fps < TARGET_FPS - 3) {
      this.slow += dt;
      this.fast = 0;
    } else if (this.fps > TARGET_FPS + 7) {
      this.fast += dt;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - dt);
      this.fast = 0;
    }
    if (this.slow > 1.5) {
      this.slow = 0;
      if (this.scale > 0.61) {
        this.scale = Math.max(0.6, this.scale * 0.88);
        this.resize(this.width, this.height);
        this.starved = 0;
      } else if ((this.starved += 1) >= 3 && this.tier !== 'low') {
        // Even at the lowest resolution it is too slow: a simpler level, back at full resolution
        this.tier = this.tier === 'high' ? 'medium' : 'low';
        this.scale = 1;
        this.starved = 0;
        this.apply(false);
      }
    } else if (this.fast > 4 && this.scale < 1) {
      this.fast = 0;
      this.scale = Math.min(1, this.scale * 1.06);
      this.resize(this.width, this.height);
    }
  }
}
