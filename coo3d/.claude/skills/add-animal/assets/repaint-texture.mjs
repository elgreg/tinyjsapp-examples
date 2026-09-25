// Worked example: the AnimalMesh3D sparrow's diffuse repainted as a male
// American goldfinch (how coo3d's goldfinch was made). Copy and retune the
// regions for a new texture:  node repaint-texture.mjs src.png out.png
//
// Technique:
// - drive every new colour from the SOURCE pixel's luminance, so feather/fur
//   detail survives as shading
// - regions are SOFT masks (ellipses with a smoothstep edge), authored in
//   1024-space; hard rectangles leave visible seams on the model
// - colour-key what you can (the red legs: r/g ratio) instead of drawing masks
// - keep eyes (and anything else tiny and dark) by mixing the original back in
//   — v1 of the finch painted over its eyes and the user noticed at once
// - look at the texture first (Read the PNG), then iterate: repaint → rebuild
//   → preview.html side view → adjust
import sharp from 'sharp';

const [SRC, OUT] = process.argv.slice(2);
const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, S = W / 1024;

const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const ell = (x, y, [cx, cy, rx, ry], soft = 0.15) =>
  1 - smooth(1 - soft, 1 + soft, Math.hypot((x / S - cx) / rx, (y / S - cy) / ry));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const BODY = [440, 262, 385, 232];         // the big top-centre blob (head at its right end)
const FOLDED_WING = [385, 325, 235, 118];  // dark streaky patch inside it
const CAP = [772, 262, 48, 40];            // forehead/crown, just above the beak
const BEAK = [806, 300, 20, 20];
const EYE = [724, 336, 16, 16];            // keep the original eye pixels
const YELLOW = [255, 212, 18];

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // flight feathers (everything outside the body): black, pale edges → white bars
    const featherBlack = [40 * lum, 38 * lum, 36 * lum];
    const featherWhite = [240 * lum, 240 * lum, 236 * lum];
    let o = mix(featherWhite, featherBlack, smooth(0.8, 0.55, lum));

    // body: lemon yellow shaded by the old pattern; folded wing inside it → black
    const k = 0.5 + lum * 0.7;
    const body = [YELLOW[0] * k, YELLOW[1] * k, YELLOW[2] * k];
    const wingW = ell(x, y, FOLDED_WING, 0.2) * smooth(0.5, 0.32, lum);
    o = mix(o, mix(body, [22 * lum, 20 * lum, 18 * lum], wingW), ell(x, y, BODY, 0.06));

    o = mix(o, [25 * lum + 8, 24 * lum + 8, 22 * lum + 8], ell(x, y, CAP, 0.3));
    o = mix(o, [240 * lum + 45, 150 * lum + 35, 100 * lum + 25], ell(x, y, BEAK, 0.3));
    o = mix(o, [r, g, b], ell(x, y, EYE, 0.25));

    // red legs → pale tan, colour-keyed so it only hits the legs
    o = mix(o, [185 * lum + 70, 150 * lum + 60, 130 * lum + 55], smooth(1.15, 1.45, r / Math.max(1, g)));

    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, o[c]));
  }
}
await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toFile(OUT);
console.log('wrote', OUT);
