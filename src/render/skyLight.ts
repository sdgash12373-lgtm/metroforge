import * as THREE from 'three';

/**
 * The sky as light: its colours and the sun's, shared by every material that reflects it. Glass, car paint and
 * the sky dome all read these, so what shines in a window is the sky overhead at that time of day and weather.
 * Worked out from a few numbers in the shader (no environment map to render or keep).
 */
export const SKY = {
  uSkyHorizon: { value: new THREE.Color(0xbcd8ea) },
  uSkyZenith: { value: new THREE.Color(0x6f9fd0) },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
};

/** GLSL: the sky's colour seen along world direction r, with the sun's glow; and the sun's highlight. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
vec3 skyAlong(vec3 r) {
  float up = clamp(r.y, -1.0, 1.0);
  // Below the horizon: the ground and the city reflected, dim
  vec3 below = uSkyHorizon * 0.32 + vec3(0.03, 0.035, 0.03);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  float sun = max(dot(r, uSunDir), 0.0);
  sky += uSunColor * (pow(sun, 8.0) * 0.18 + pow(sun, 64.0) * 0.5) * step(-0.05, uSunDir.y);
  return mix(below, sky, smoothstep(-0.12, 0.04, up));
}
vec3 sunGlint(vec3 n, vec3 v, float sharp) {
  vec3 h = normalize(uSunDir + v);
  return uSunColor * pow(max(dot(n, h), 0.0), sharp) * step(0.0, uSunDir.y);
}
`;

/**
 * Makes a Lambert material reflect the sky: `gloss` is a GLSL expression (0 matte .. 1 mirror-like) that may use
 * values the material's own shader worked out earlier. A Fresnel term keeps it faint when looked at straight on
 * and strong at a glancing angle, as glass and lacquer are.
 */
export function skyReflectionChunk(gloss: string, sharp = 180): string {
  return /* glsl */ `
  {
    float glossAmt = clamp(${gloss}, 0.0, 1.0);
    if (glossAmt > 0.001) {
      vec3 vv = normalize(vViewPosition);
      vec3 nn = normalize(normal);
      vec3 rw = inverseTransformDirection(reflect(-vv, nn), viewMatrix);
      vec3 nw = inverseTransformDirection(nn, viewMatrix);
      vec3 vw = inverseTransformDirection(vv, viewMatrix);
      float fres = 0.06 + 0.94 * pow(1.0 - clamp(dot(nn, vv), 0.0, 1.0), 5.0);
      outgoingLight = mix(outgoingLight, skyAlong(rw), fres * glossAmt);
      outgoingLight += sunGlint(nw, vw, ${sharp.toFixed(1)}) * glossAmt * 1.2;
    }
  }
  `;
}

/** Wires a material's shader to the shared sky uniforms. */
export function useSky(shader: { uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, SKY);
}

/** Clear-coat paint: a plain Lambert material that also reflects the sky a little. */
export function glossy(mat: THREE.MeshLambertMaterial, gloss: number, key: string): void {
  mat.onBeforeCompile = (shader) => {
    useSky(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SKY_GLSL}`)
      .replace('#include <opaque_fragment>', `${skyReflectionChunk(String(gloss.toFixed(3)), 90)}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `glossy-${key}`;
  mat.needsUpdate = true;
}
