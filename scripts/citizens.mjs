// Pack the citizen models (Metroforge_Citizens, made in Blender for this game) for the web:
//   node scripts/citizens.mjs <Metroforge_Citizens folder>
// Each material's colour becomes a vertex colour (shirts marked 1 and scooter bodies 2 in _DYE, so the game can
// colour them per person), every part of a mesh is joined into one, normals and UVs are dropped (drawn flat-shaded),
// only the clips and riders the game uses are kept, and the result is quantized and meshopt-compressed into
// public/citizens.
import { mkdirSync, readdirSync } from 'node:fs';
import { join as path } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, meshopt, prune, quantize, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const src = process.argv[2];
if (!src) throw new Error('usage: node scripts/citizens.mjs <Metroforge_Citizens folder>');
const out = new URL('../public/citizens/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
/** Simplify away detail smaller than this share of a model's size (the tiny chamfers on every block). */
const DETAIL = Number(process.env.DETAIL ?? 0.002);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

/** Riders the game uses: no children on bikes, only grown-ups on scooters. */
const RIDERS = /^(0[1-6]_.*_bicycle|0[1-4]_.*_motorcycle)\.glb$/;
/** Clips kept per folder. */
const CLIPS = { characters: ['Idle', 'Walk', 'Run'], riders: ['Bicycle', 'Motorcycle'] };

for (const dir of ['characters', 'riders']) {
  for (const file of readdirSync(path(src, dir)).filter((f) => f.endsWith('.glb') && (dir !== 'riders' || RIDERS.test(f)))) {
    const doc = await io.read(path(src, dir, file));
    const root = doc.getRoot();
    for (const a of root.listAnimations()) if (!CLIPS[dir].includes(a.getName())) a.dispose();
    const flat = doc.createMaterial('Flat');
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        const [r, g, b] = mat?.getBaseColorFactor() ?? [1, 1, 1, 1];
        const name = mat?.getName() ?? '';
        const dye = name.startsWith('Clothes_') ? 1 : name.startsWith('Scooter_') ? 2 : 0;
        const n = prim.getAttribute('POSITION').getCount();
        const color = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) color.set([r, g, b], i * 3);
        prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(color));
        prim.setAttribute('_DYE', doc.createAccessor().setType('SCALAR').setArray(new Float32Array(n).fill(dye)));
        for (const s of ['NORMAL', 'TEXCOORD_0']) prim.getAttribute(s)?.dispose();
        prim.setMaterial(flat);
      }
    }
    await doc.transform(prune(), join({ keepNamed: false }), weld(), dedup(), resample(), prune());
    const tris = () => root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0);
    const before = tris();
    if (DETAIL > 0) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: DETAIL }));
    await doc.transform(quantize({ quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder }));
    console.log(file, before, '→', tris(), 'triangles');
    await io.write(path(out, file), doc);
  }
}
