import * as THREE from 'three';
import { SKY, SKY_GLSL } from './skyLight';
import type { Conditions } from '../sim/weather';
import { clock } from '../sim/weather';

const NIGHT_SKY = new THREE.Color(0x0d1630);
const DAWN_SKY = new THREE.Color(0xe9a46e);
const DAY_SKY = new THREE.Color(0xbcd8ea);
const DAY_ZENITH = new THREE.Color(0x4f86c9);
const NIGHT_ZENITH = new THREE.Color(0x050916);
const STORM_SKY = new THREE.Color(0x7d8790);
const FOG_SKY = new THREE.Color(0xc9ced1);

const SUN_DAY = new THREE.Color(0xfff1dc);
const SUN_LOW = new THREE.Color(0xffb46b);
const MOON = new THREE.Color(0x9fb4e6);
const HEMI_DAY = new THREE.Color(0xe8f2ff);
const HEMI_NIGHT = new THREE.Color(0x4a5a8c);

/**
 * Lit windows at night: walls of buildings get a grid of warm windows, some on and some off,
 * that glow as the light fades. Patched into a Lambert material's shader.
 */
export function addWindows(mat: THREE.MeshLambertMaterial, night: { value: number }, strength = 1): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        vWPos = (modelMatrix * wp).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uNight;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uNight > 0.01) {
          vec3 wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
          if (abs(wn.y) < 0.3 && vWPos.y > 1.0) {
            float along = abs(wn.x) > abs(wn.z) ? vWPos.z : vWPos.x;
            vec2 cell = vec2(along / 2.6, vWPos.y / 3.2);
            vec2 f = fract(cell);
            float pane = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
            float lit = step(0.42, fract(sin(dot(floor(cell) + floor(vWPos.xz / 40.0), vec2(12.9898, 78.233))) * 43758.5453));
            totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * pane * lit * uNight * ${strength.toFixed(2)};
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => `windows${strength}`;
  mat.needsUpdate = true;
}

/** Day and night, clouds, rain, snow, fog and lightning. */
export class SkySystem {
  /** 0 by day, 1 at night: lit windows and street lights */
  readonly night = { value: 0 };
  /** how bright the scene is, 0..1 (for unlit materials such as road markings) */
  light = 1;
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private clouds = new THREE.Group();
  private readonly drops: number;
  private flash = 0;
  private skyColor = new THREE.Color();
  /** smoothed weather, so the sky changes gradually */
  private now = { precip: 0, cloud: 0.1, fog: 0, wind: 0.15, snow: 0 };
  /** 0 calm .. 1 typhoon, eased like the rest of the weather */
  get wind(): number {
    return this.now.wind;
  }
  private bolt = 0;
  /** the sky itself: a gradient from the horizon up, with the sun's glow and stars at night */
  private readonly dome: THREE.Mesh;

  constructor(
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
    coarse: boolean,
  ) {
    this.drops = coarse ? 1500 : 3500;
    const pos = new Float32Array(this.drops * 6);
    for (let i = 0; i < this.drops; i++) {
      const x = Math.random() - 0.5;
      const y = Math.random();
      const z = Math.random() - 0.5;
      pos.set([x, y, z, x, y, z], i * 6);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaebfd0, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.drops * 3).map(() => Math.random()), 3));
    this.snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, transparent: true, opacity: 0.9, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.makeClouds();
    this.dome = skyDome(this.night);
    scene.add(this.rain, this.snow, this.clouds, this.dome);
  }

  private makeClouds(): void {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.6, depthWrite: false });
    const puff = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 26; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 4);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(puff, mat);
        const r = 30 + Math.random() * 35;
        m.scale.set(r * 1.4, r * 0.7, r);
        m.position.set((j - n / 2) * 45 + Math.random() * 20, Math.random() * 12, Math.random() * 40 - 20);
        cloud.add(m);
      }
      cloud.position.set((Math.random() - 0.5) * 6000, 260 + Math.random() * 120, (Math.random() - 0.5) * 6000);
      cloud.userData.order = Math.random();
      this.clouds.add(cloud);
    }
  }

  /**
   * `days`: game time; `w`: the weather where the camera looks; `target` and `span` place the rain
   * around what is on screen.
   */
  update(days: number, w: Conditions, dt: number, target: { x: number; y: number }, span: number, xray: boolean): void {
    // Ease towards the weather so a shower builds up and clears over a few seconds
    const k = 1 - Math.exp(-dt * 0.6);
    const n = this.now;
    n.precip += (w.precip - n.precip) * k;
    n.cloud += (w.cloud - n.cloud) * k;
    n.fog += (w.fog - n.fog) * k;
    n.wind += (w.wind - n.wind) * k;
    n.snow += ((w.snow ? 1 : 0) - n.snow) * k;

    const { month, hour } = clock(days);
    // The sun rises at six and sets at six, higher in summer
    const a = ((hour - 6) / 12) * Math.PI;
    const height = Math.sin(a);
    const summer = 0.5 - 0.5 * Math.cos(((month + 0.5) / 12) * Math.PI * 2);
    const peak = 0.75 + 0.45 * summer;
    const day = THREE.MathUtils.smoothstep(height, -0.12, 0.2);
    const low = Math.exp(-((height / 0.22) ** 2));
    this.night.value = 1 - THREE.MathUtils.smoothstep(height, -0.15, 0.08);
    const gloom = 1 - 0.65 * n.cloud * (0.4 + 0.6 * n.precip) - 0.25 * n.fog;

    // Sun by day, the moon by night (opposite side of the sky)
    const up = day > 0.02 ? Math.max(0.15, height) * peak : 0.6;
    const east = day > 0.02 ? Math.cos(a) : -Math.cos(a + Math.PI) * 0.6;
    this.sun.position.set(target.x + east * 600, Math.max(120, up * 700), target.y + 220);
    this.sun.target.position.set(target.x, 0, target.y);
    const sunColor = day > 0.02 ? SUN_DAY.clone().lerp(SUN_LOW, low) : MOON;
    this.sun.color.copy(sunColor);
    this.sun.intensity = day > 0.02 ? 2.1 * day * gloom : 0.35 * gloom;
    this.hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, day);
    this.hemi.intensity = (0.35 + 1.15 * day) * (0.55 + 0.45 * gloom);

    // Lightning: a bright flicker now and then
    this.flash = Math.max(0, this.flash - dt * 6);
    if (w.lightning && Math.random() < w.lightning * dt) {
      this.flash = 1;
      this.bolt = 0.15;
    }
    if (this.bolt > 0) {
      this.bolt -= dt;
      if (this.bolt < 0.07 && this.bolt + dt >= 0.07) this.flash = 0.8;
    }
    this.hemi.intensity += this.flash * 2.5;
    this.light = Math.min(1, 0.25 + 0.75 * day * gloom + this.flash);

    // Sky: night → dawn glow → day, greyed by cloud and fog
    const c = this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, day);
    c.lerp(DAWN_SKY, low * 0.55 * (1 - n.cloud));
    c.lerp(STORM_SKY.clone().multiplyScalar(0.25 + 0.75 * day), n.cloud * 0.7 * (0.4 + 0.6 * n.precip));
    c.lerp(FOG_SKY.clone().multiplyScalar(0.2 + 0.8 * day), n.fog * 0.8);
    if (this.flash) c.lerp(new THREE.Color(0xe8ecff), this.flash * 0.5);
    if (!xray) (this.scene.background as THREE.Color).copy(c);
    this.dome.visible = !xray;
    // The shared sky light: the horizon is the fog's colour (so the land fades into it), deeper blue overhead
    SKY.uSkyHorizon.value.copy(c);
    const z = SKY.uSkyZenith.value.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, day);
    z.lerp(c, Math.min(1, n.cloud * 0.75 + n.fog * 0.9));
    SKY.uSunDir.value.copy(this.sun.position).sub(this.sun.target.position).normalize();
    SKY.uSunColor.value.copy(sunColor).multiplyScalar(day > 0.02 ? Math.max(0, gloom) * day : 0.12);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(c);
    const thick = Math.sqrt(Math.max(n.fog, n.precip * 0.4));
    fog.near = THREE.MathUtils.lerp(1500, 10, thick);
    fog.far = THREE.MathUtils.lerp(4200, 520, thick);

    // Clouds drift with the wind; more of them the cloudier it is
    for (const cloud of this.clouds.children) {
      cloud.visible = cloud.userData.order < n.cloud * 1.1;
      cloud.position.x += dt * (6 + 40 * n.wind);
      if (cloud.position.x > target.x + 3000) cloud.position.x -= 6000;
      if (cloud.position.x < target.x - 3000) cloud.position.x += 6000;
      if (cloud.position.z > target.y + 3000) cloud.position.z -= 6000;
      if (cloud.position.z < target.y - 3000) cloud.position.z += 6000;
    }
    const cm = (this.clouds.children[0]?.children[0] as THREE.Mesh | undefined)?.material as THREE.MeshLambertMaterial | undefined;
    if (cm) cm.color.setScalar(1 - 0.5 * n.precip);

    // Rain and snow fill a box around what the camera sees
    const size = Math.min(1600, Math.max(260, span * 1.6));
    const tall = Math.min(500, size * 0.6);
    const rainy = n.precip * (1 - n.snow);
    this.rain.visible = rainy > 0.03;
    this.snow.visible = n.precip * n.snow > 0.03;
    if (this.rain.visible) {
      const count = Math.floor(this.drops * rainy);
      this.rain.geometry.setDrawRange(0, count * 2);
      const pos = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const fall = dt * 1.6;
      const slant = 0.012 + 0.05 * n.wind;
      for (let i = 0; i < count; i++) {
        const o = i * 6;
        let y = arr[o + 1] - fall;
        if (y < 0) y += 1;
        arr[o + 1] = y;
        arr[o + 4] = y + 0.035;
        arr[o + 3] = arr[o] - slant;
      }
      pos.needsUpdate = true;
      this.rain.position.set(target.x, 0, target.y);
      this.rain.scale.set(size, tall, size);
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.35 + 0.35 * this.light;
    }
    if (this.snow.visible) {
      const count = Math.floor(this.drops * n.precip * n.snow);
      this.snow.geometry.setDrawRange(0, count);
      const pos = this.snow.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        let y = arr[o + 1] - dt * 0.12;
        if (y < 0) y += 1;
        arr[o + 1] = y;
        arr[o] = (((arr[o] + dt * 0.01 * (n.wind + Math.sin(y * 20 + i))) % 1) + 1) % 1;
      }
      pos.needsUpdate = true;
      this.snow.position.set(target.x - size / 2, 0, target.y - size / 2);
      this.snow.scale.set(size, tall, size);
    }
  }
}

/** A dome drawn behind everything, always centred on the camera. */
function skyDome(night: { value: number }): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...SKY, uNight: night },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 4000.0, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform float uNight;
      varying vec3 vDir;
      float starHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyAlong(vec3(d.x, max(d.y, 0.0), d.z));
        // Stars on clear nights, above the haze near the horizon
        if (uNight > 0.05 && d.y > 0.08) {
          vec3 cell = floor(d * 320.0);
          float s = step(0.996, starHash(cell));
          col += vec3(0.85, 0.9, 1.0) * s * uNight * smoothstep(0.08, 0.35, d.y) * (1.0 - smoothstep(0.12, 0.3, length(uSkyZenith)));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  return dome;
}
