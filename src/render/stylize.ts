import * as THREE from 'three';

/** Value noise shared by the ground and water shaders. */
const NOISE = `
  float styleHash(vec2 p) {
    p = fract(mod(p, 4096.0) * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
  }
  float styleNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(styleHash(i), styleHash(i + vec2(1.0, 0.0)), f.x), mix(styleHash(i + vec2(0.0, 1.0)), styleHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;

/** Pass the world position of each vertex to the fragment shader as vWorld. */
function worldVarying(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWorld;${NOISE}`);
}

/**
 * 整地 view: the ground coloured by height (blue below the plain, green on it, yellow, orange and brown up the
 * hills to white peaks) with a contour line every 5 m, and the brush drawn on the ground (x, z, radius; 0 = none).
 */
export const groundView = { uRelief: { value: 0 }, uLandBrush: { value: new THREE.Vector4(0, 0, 0, 0) } };

/**
 * Grass that isn't one flat green: big patches of darker, lusher and sun-dried grass, smaller tufts inside them,
 * and a fine speckle up close. Only green ground takes it; sand, rock and peaks keep their colour.
 */
export function naturalGround(m: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  m.onBeforeCompile = (shader) => {
    worldVarying(shader);
    shader.uniforms.uRelief = groundView.uRelief;
    shader.uniforms.uLandBrush = groundView.uLandBrush;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRelief;\nuniform vec4 uLandBrush;')
      .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec2 g = vWorld.xz;
      float green = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 6.0, 0.0, 1.0);
      float patches = styleNoise(g / 90.0) * 0.6 + styleNoise(g / 23.0) * 0.4;
      float dry = smoothstep(0.55, 0.85, styleNoise(g / 140.0 + 17.0));
      float speck = (styleHash(floor(g * 2.5)) - 0.5) * clamp(1.4 - length(fwidth(g * 2.5)), 0.0, 1.0);
      vec3 base = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))), 0.18);
      vec3 grass = base * (0.74 + 0.48 * patches + 0.1 * speck);
      grass = mix(grass, grass * vec3(1.22, 1.06, 0.66), dry * 0.7);
      diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 + 0.05 * speck), grass, green);
      if (uRelief > 0.5) {
        float hh = vWorld.y;
        vec3 rc;
        if (hh < -0.3) rc = mix(vec3(0.36, 0.62, 0.86), vec3(0.16, 0.24, 0.62), clamp(-hh / 8.0, 0.0, 1.0));
        else if (hh < 0.3) rc = vec3(0.42, 0.74, 0.36);
        else if (hh < 20.0) rc = mix(vec3(0.78, 0.86, 0.36), vec3(0.96, 0.82, 0.30), hh / 20.0);
        else if (hh < 60.0) rc = mix(vec3(0.96, 0.82, 0.30), vec3(0.92, 0.52, 0.22), (hh - 20.0) / 40.0);
        else if (hh < 150.0) rc = mix(vec3(0.92, 0.52, 0.22), vec3(0.62, 0.36, 0.22), (hh - 60.0) / 90.0);
        else rc = mix(vec3(0.62, 0.36, 0.22), vec3(0.95, 0.94, 0.92), clamp((hh - 150.0) / 200.0, 0.0, 1.0));
        float c5 = abs(fract(hh / 5.0 + 0.5) - 0.5) * 5.0;
        float line = 1.0 - smoothstep(0.0, max(fwidth(hh) * 1.5, 0.05), c5);
        line *= step(0.3, abs(hh));
        diffuseColor.rgb = mix(rc, rc * 0.45, line * 0.85);
      }
      if (uLandBrush.z > 0.0) {
        float bd = distance(vWorld.xz, uLandBrush.xy);
        float rim = 1.0 - smoothstep(0.0, max(fwidth(bd) * 2.0, 0.6), abs(bd - uLandBrush.z));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + 0.08, step(bd, uLandBrush.z) * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), rim);
      }`,
    );
  };
  m.customProgramCacheKey = () => 'naturalGround';
  return m;
}

/**
 * Water with moving ripples, glints of sun on the wave tops, and a lighter, more opaque sheen far off where it
 * would reflect the sky. `time` is advanced by the world each frame.
 */
export function livelyWater(m: THREE.MeshLambertMaterial, time: { value: number }): THREE.MeshLambertMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    worldVarying(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 w = vWorld.xz;
        float fine = clamp(1.6 - length(fwidth(w / 6.0)), 0.0, 1.0);
        float waves = styleNoise(w / 6.0 + vec2(uTime * 0.35, uTime * 0.2)) * 0.6 + styleNoise(w / 2.5 - vec2(uTime * 0.25, -uTime * 0.4)) * 0.4;
        float swell = styleNoise(w / 60.0 + uTime * 0.03);
        diffuseColor.rgb *= 0.88 + 0.18 * swell + 0.16 * (waves - 0.5) * fine;
        diffuseColor.rgb += vec3(0.5, 0.48, 0.42) * smoothstep(0.78, 0.92, waves) * fine * 0.35;
        float far = smoothstep(150.0, 900.0, distance(vWorld, cameraPosition));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.76, 0.84), far * 0.35);
        diffuseColor.a = mix(diffuseColor.a, 1.0, far * 0.6);`,
      );
  };
  m.customProgramCacheKey = () => 'livelyWater';
  return m;
}
