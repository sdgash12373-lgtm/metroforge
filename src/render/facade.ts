import * as THREE from 'three';
import { SKY_GLSL, skyReflectionChunk, useSky } from './skyLight';

/**
 * What a box of a building is clad in. The pattern is drawn in the shader from the box's own size, so a wall gets
 * as many windows as fit it, and no texture has to be downloaded or kept in memory.
 */
export enum Skin {
  /** plain paint: only the shading below */
  Plain = 0,
  /** tiled 透天厝 and 公寓 walls with aluminium-framed windows on every floor */
  Tiled = 1,
  /** glass curtain wall of an office tower */
  Curtain = 2,
  /** corrugated 鐵皮 cladding */
  Tin = 3,
  /** a 鐵捲門 roller shutter */
  Shutter = 4,
  /** granite blocks of a podium */
  Stone = 5,
  /** a shop's glass front under the 騎樓 */
  Shopfront = 6,
  /** the bars of a 鐵窗 */
  Grille = 7,
}

/**
 * Facade patterns by day, lit windows and shop fronts by night, and shading baked into the walls: darker where
 * a building meets the ground or a part sits on another, a little darker low down in the street, and a light
 * edge down each corner. All of it is worked out per pixel from the box, so it costs no extra geometry.
 */
export function facadeMaterial(mat: THREE.MeshLambertMaterial, night: { value: number }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    useSky(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSkin;
        varying float vSkin;
        varying vec3 vBox;
        varying vec3 vSize;
        varying vec3 vObjN;
        varying vec3 vWPos;
        varying vec2 vHome;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vSkin = aSkin;
        vBox = position;
        vObjN = normal;
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vHome = instanceMatrix[3].xz;
          wp = instanceMatrix * wp;
        #else
          vSize = vec3(1.0);
          vHome = vec2(0.0);
        #endif
        vWPos = (modelMatrix * wp).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${SKY_GLSL}
        uniform float uNight;
        varying float vSkin;
        varying vec3 vBox;
        varying vec3 vSize;
        varying vec3 vObjN;
        varying vec3 vWPos;
        varying vec2 vHome;
        float facadeHash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        // 1 inside [a, b], with edges softened to about a pixel
        float band(float x, float a, float b) {
          float w = max(fwidth(x), 1e-4);
          return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
        }
        // dark lines of width t every period p, faded out where they would shimmer
        float lines(float x, float p, float t) {
          float f = fract(x / p) * p;
          float w = fwidth(x);
          return (1.0 - smoothstep(t, t + w, f)) * clamp(1.5 - w / p * 6.0, 0.0, 1.0);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        int skin = int(vSkin + 0.5);
        bool side = abs(vObjN.y) < 0.5;
        // across the face in metres, and the face's width
        float u = abs(vObjN.x) > 0.5 ? (vBox.z + 0.5) * vSize.z : (vBox.x + 0.5) * vSize.x;
        float width = abs(vObjN.x) > 0.5 ? vSize.z : vSize.x;
        // up from the bottom of this box, in metres
        float hy = vBox.y * vSize.y;
        float floorY = fract(hy / 3.2);
        float lit = 0.0;
        // how much of the sky the face mirrors: glass panes do, walls barely
        float gloss = 0.0;
        if (side) {
          if (skin == 1 && width > 1.6) {
            // small mosaic tiles, then windows centred on the wall, as many as fit
            diffuseColor.rgb *= 1.0 - 0.05 * max(lines(u, 0.3, 0.025), lines(hy, 0.3, 0.025));
            float n = max(1.0, floor(width / 2.6));
            vec2 cell = vec2(u / width * n, hy / 3.2);
            float fx = fract(cell.x);
            float frame = band(fx, 0.18, 0.82) * band(floorY, 0.24, 0.8);
            float pane = band(fx, 0.22, 0.78) * band(floorY, 0.29, 0.76);
            vec3 glass = mix(vec3(0.16, 0.2, 0.24), vec3(0.42, 0.5, 0.56), floorY * 0.6 + facadeHash(floor(cell) + vHome) * 0.25);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.8), frame * (1.0 - pane));
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, pane);
            lit = pane * step(0.42, facadeHash(floor(cell) + floor(vHome)));
            gloss = pane * 0.45;
          } else if (skin == 2) {
            // mullions every 1.5 m, a spandrel at each floor, panes catching the sky higher up
            float mull = max(lines(u + 0.05, 1.5, 0.1), band(floorY, 0.0, 0.12));
            float sheen = 0.85 + 0.35 * smoothstep(0.0, 80.0, vWPos.y) + 0.08 * (facadeHash(floor(vec2(u / 1.5, hy / 3.2)) + vHome) - 0.5);
            diffuseColor.rgb = mix(diffuseColor.rgb * sheen, vec3(0.82, 0.85, 0.87), mull);
            vec2 cell = vec2(floor(u / 3.0), floor(hy / 3.2));
            lit = (1.0 - mull) * band(floorY, 0.15, 0.95) * step(0.35, facadeHash(cell + floor(vHome)));
            gloss = (1.0 - mull) * 0.85;
          } else if (skin == 3) {
            // corrugated sheet: ridges every 25 cm, a seam every 3 m up
            float fade = clamp(1.5 - fwidth(u) * 10.0, 0.0, 1.0);
            diffuseColor.rgb *= 1.0 - 0.09 * fade * (0.5 + 0.5 * sin(u * 25.13)) - 0.08 * lines(hy, 3.0, 0.06);
          } else if (skin == 4) {
            // roller shutter slats and the bottom rail
            float fade = clamp(1.5 - fwidth(hy) * 12.0, 0.0, 1.0);
            diffuseColor.rgb *= 1.0 - 0.14 * fade * (0.5 + 0.5 * sin(hy * 62.8)) - 0.25 * band(hy, 0.0, 0.15);
          } else if (skin == 5) {
            // granite blocks, every other course offset by half a block
            float course = floor(hy / 0.8);
            float joint = max(lines(hy, 0.8, 0.04), lines(u + mod(course, 2.0) * 0.8, 1.6, 0.04));
            diffuseColor.rgb *= (1.0 - 0.18 * joint) * (0.94 + 0.08 * facadeHash(vec2(floor((u + mod(course, 2.0) * 0.8) / 1.6), course) + vHome));
          } else if (skin == 6 && width > 1.6) {
            // shop glass between frames, a fascia above
            float bays = max(1.0, floor(width / 3.0));
            float fx = fract(u / width * bays);
            float pane = band(fx, 0.05, 0.95) * band(hy, 0.2, vSize.y - 0.45);
            diffuseColor.rgb = mix(diffuseColor.rgb * 0.9, vec3(0.3, 0.28, 0.25), pane);
            lit = pane * 1.4;
            gloss = pane * 0.35;
          } else if (skin == 7) {
            // 鐵窗 bars with the dark balcony behind them
            float bars = lines(u, 0.14, 0.05);
            float rails = max(band(hy, 0.0, 0.1), band(hy, vSize.y - 0.1, vSize.y));
            diffuseColor.rgb *= mix(0.45, 1.05, max(bars, rails));
          }
          // a light edge down each corner, like a bevel
          float edge = min(u, width - u);
          diffuseColor.rgb *= 1.0 + 0.07 * (1.0 - smoothstep(0.0, 0.15 + fwidth(u), edge));
          // shading: where the building meets the ground, where a part sits on another, and low in the street
          float ao = mix(0.58, 1.0, smoothstep(0.0, 2.4, vWPos.y));
          ao *= mix(0.8, 1.0, smoothstep(0.0, 0.7, hy));
          ao *= mix(0.86, 1.0, smoothstep(0.0, 36.0, vWPos.y));
          diffuseColor.rgb *= ao;
        } else if (vObjN.y > 0.5) {
          // Flat roofs: grey concrete inside a parapet in the wall colour, tin roofs ridged like the walls
          if (skin == 1 || skin == 2 || skin == 5) {
            float rim = min(min(vBox.x + 0.5, 0.5 - vBox.x) * vSize.x, min(vBox.z + 0.5, 0.5 - vBox.z) * vSize.z);
            float inside = smoothstep(0.3, 0.3 + fwidth(rim) * 2.0, rim);
            vec3 slab = mix(vec3(0.6, 0.6, 0.57), vec3(0.47, 0.55, 0.5), step(0.6, facadeHash(floor(vHome))));
            slab *= 0.92 + 0.12 * facadeHash(floor(vWPos.xz * 0.7));
            diffuseColor.rgb = mix(diffuseColor.rgb, slab, inside * 0.85);
            diffuseColor.rgb *= 1.0 - 0.25 * (1.0 - smoothstep(0.3, 0.75, rim)) * inside;
          } else if (skin == 3) {
            float fade = clamp(1.5 - fwidth(vBox.x * vSize.x) * 10.0, 0.0, 1.0);
            diffuseColor.rgb *= 1.0 - 0.08 * fade * (0.5 + 0.5 * sin(vBox.x * vSize.x * 25.13));
          }
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (uNight > 0.01) totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * lit * uNight;`,
      )
      // Lit windows at night stay lit over the reflection
      .replace('#include <opaque_fragment>', `${skyReflectionChunk('gloss * (1.0 - lit * uNight)', 260)}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'facade';
  mat.needsUpdate = true;
}

/** Give a geometry drawn with the facade material a skin for each instance, all plain to begin with. */
export function addSkins(g: THREE.BufferGeometry, count: number): THREE.InstancedBufferAttribute {
  const skins = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  skins.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aSkin', skins);
  return skins;
}
