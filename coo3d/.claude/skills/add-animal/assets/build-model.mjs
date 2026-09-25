// Sketchfab glTF download → trimmed GLB → coo3d/src/frontend/<name>-model.js
//
//   node build-model.mjs --src <dir>/scene.gltf --name bear --global BEAR_GLB_B64 \
//     [--keep "walk,run,stand eating"] [--texture repainted.png] [--tex 512] [--keep-normal]
//
// What it does (every step was needed for the finch or the bear):
// - drops clips not in --keep. It disposes each dropped clip's samplers and
//   accessors EXPLICITLY; Animation.dispose() alone leaves the keyframe data
//   orphaned in the file (the bear stayed 5.8 MB until this was fixed; after,
//   0.9 MB)
// - KHR_materials_pbrSpecularGlossiness → metal-rough (three.js ignores
//   spec-gloss; Sketchfab exports use it)
// - resample + dedup + prune
// - diffuse → N px webp (optionally swapped for a repainted PNG); normal and
//   metal-rough maps dropped (invisible at ~60 px on screen)
// - writes the GLB as a base64 global in a classic script (no fetch/modules)
//
// Needs: npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp
// (run from a scratch dir; set npm_config_cache to a writable dir in the sandbox)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough, prune, dedup, resample } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const flag = (k) => process.argv.includes('--' + k);
const SRC = arg('src'), NAME = arg('name'), GLOBAL = arg('global');
const KEEP = arg('keep') ? arg('keep').split(',').map((s) => s.trim().toLowerCase()) : null;
const TEX = +arg('tex', 512), TEXTURE = arg('texture');
const OUT = arg('out', path.resolve(path.dirname(new URL(import.meta.url).pathname),
  '../../../../src/frontend', NAME + '-model.js'));
if (!SRC || !NAME || !GLOBAL) { console.error('need --src --name --global'); process.exit(1); }

// clip key, matching app.js short(): last '|' segment; single words drop an '_' prefix
const key = (n) => { const t = n.split('|').pop(); return (t.includes(' ') ? t : t.split('_').pop()).toLowerCase(); };

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();
console.log('source clips:', root.listAnimations().map((a) => key(a.getName())).join(' | '));
if (KEEP) {
  for (const a of root.listAnimations()) {
    if (KEEP.includes(key(a.getName()))) continue;
    for (const s of a.listSamplers()) { s.getInput()?.dispose(); s.getOutput()?.dispose(); s.dispose(); }
    for (const c of a.listChannels()) c.dispose();
    a.dispose();
  }
  const missing = KEEP.filter((k) => !root.listAnimations().some((a) => key(a.getName()) === k));
  if (missing.length) console.warn('WARNING: --keep names not found:', missing);
}
await doc.transform(metalRough());
for (const m of root.listMaterials()) {
  if (!flag('keep-normal')) m.setNormalTexture(null);
  m.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.85);
}
await doc.transform(resample(), dedup(), prune());
for (const t of root.listTextures()) {
  const srcImg = TEXTURE ? fs.readFileSync(TEXTURE) : Buffer.from(t.getImage());
  const webp = await sharp(srcImg).resize(TEX, TEX).webp({ quality: 82 }).toBuffer();
  t.setImage(new Uint8Array(webp)).setMimeType('image/webp');
}
doc.createExtension(ALL_EXTENSIONS.find((E) => E.EXTENSION_NAME === 'EXT_texture_webp')).setRequired(true);
await doc.transform(prune());

const glb = await io.writeBinary(doc);
fs.writeFileSync(OUT,
  `// The ${NAME} — see README for model credit + license. GLB as base64,\n` +
  `// loaded on demand by app.js (SPECIES.${NAME}.script).\n` +
  `const ${GLOBAL} =\n"` + Buffer.from(glb).toString('base64') + '";\n');
console.log(`wrote ${OUT}: ${(glb.byteLength / 1024).toFixed(0)} KB glb; kept clips:`,
  root.listAnimations().map((a) => key(a.getName())).join(' | '));
