---
name: add-animal
description: Add a new animal (species) to coo3d from a downloaded rigged, animated 3D model — convert it, map its clips onto the flock brain's states, fix orientation/size/wings, give it food, poop and sounds, and verify it headlessly. Use when the user downloads a new model (Sketchfab zip, glTF/GLB) for coo3d or asks for "a version with <animal>".
---

# Adding an animal to coo3d

coo3d is ONE flock brain (`src/main.js`) wearing interchangeable costumes.
An animal is a `SPECIES` entry in two places plus a model file and,
optionally, a sound bank. The brain never changes per species. Pigeon,
goldfinch (a repainted sparrow) and bear are the three worked examples. Read
their entries in `src/frontend/app.js` and `src/main.js` before starting.

The assets in this skill's `assets/` folder:

| File | What it's for |
|---|---|
| `build-model.mjs` | glTF → trimmed GLB → `src/frontend/<name>-model.js` |
| `preview.html` | Pose, orientation and bone-axis grid with the app's own camera |
| `stub.js` | Fake tinyjs bridge, to run the real pages headlessly |
| `repaint-texture.mjs` | Worked example of recolouring a texture into another species |
| `cut-audio.sh` | Field recording → clean, normalized clips |

## 0. Source the model legitimately

- Only use models with **downloads enabled** by the author. Never extract
  from a viewer's network traffic or page source; the user asked for that
  once, and it was declined.
- The Sketchfab API searches without login:
  `curl "https://api.sketchfab.com/v3/search?type=models&q=<animal>&downloadable=true&animated=true&count=24"`
  (fields: `name`, `user.username`, `animationCount`, `faceCount`,
  `license.label`, `viewerUrl`).
- Prefer **AnimalMesh3D** (the same family as the pigeon, sparrow and bear):
  consistent rigs, CC-BY, a "personal use" note. Avoid "game-ripper" style
  uploads.
- Aim for more than 10 clips and under 20k faces.
- The user downloads it (login required, glTF format) to `~/Downloads`. Unzip
  into `coo3d/<name>/`. That folder is a raw download: never commit it.
- Put the credit in the README from `license.txt` straight away.

## 1. Inspect before building

With python/json on `scene.gltf`, list:
- animation names (`name.split('|')[-1]`);
- skins and joint count;
- materials and their extensions (Sketchfab uses
  `KHR_materials_pbrSpecularGlossiness`);
- image sizes;
- node/bone names.

Pick about 11 clips to keep for these roles:

| Role (key in `clips:`) | Played for brain state | Pigeon → finch → bear |
|---|---|---|
| `idle` | idle | Idle → look → stand breathing |
| `idleloop` | fallback loop | IdleLoop → look → stand breathing |
| `loaf` *(optional)* | loaf (defaults to idleloop) | — → — → lying breathing |
| `squat` *(optional)* | poop (defaults to idleloop) | — → — → stand breathing |
| `left` / `right` | one-shot idle flourishes | Left/Right → shake → stand2 / stand angry breathing |
| `walk` | walk | Walk → jump (hop) → walk |
| `peck` | peck and eat | Peck → bite → stand eating |
| `cooing` | coo | Cooing → look → stand angry breathing2 |
| `circle` | courtship strut | Circle → shake → hind breathing (stands up) |
| `takeoff` | once at flight start | TakeOff → jump → trot |
| `flyloop` | fly | FlyLoop → fly → run |
| `land` | once at landing | Land → jump → walk slow |

Flightless animals just run wherever birds fly, including across the sky. The
user explicitly wants the same logic for every species, with no special
cases.

## 2. Build the model file

From a scratch dir (the session scratchpad; set `npm_config_cache` there,
since `~/.npm` is outside the sandbox):

```sh
npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp
node <skill>/assets/build-model.mjs --src coo3d/<name>/scene.gltf --name <name> \
  --global <NAME>_GLB_B64 --keep "walk,run,stand eating,…"
```

Expect under 1.5 MB. If it's big, the script's sampler-disposal step
matters; check it didn't warn about missing `--keep` names.

## 3. Preview, then answer these questions from screenshots

Copy `three.bundle.js` and `pigeon-model.js` from `src/frontend/`, plus the
new model file and `preview.html`, into the scratch dir. Open it with the
puppeteer MCP (`file://…/preview.html?m=<name>-model.js:<NAME>_GLB_B64&cells=…`)
and take a screenshot. The info block lists the bounding box, clips and bones.

1. **Facing.** At `yaw = +π/2` the pigeon faces screen-right (+Z forward).
   If the new animal faces left there, it's −Z forward: set `flip: true`
   (the finch).
2. **Scale.** Compare the bounding box with the pigeon's (about 0.47 long ×
   0.21 tall). The user wants every animal about pigeon size, never
   distracting. Set `scale` (finch 0.8, bear 0.11; the bear rig is about 2.5
   units long). If the origin sits off the body, set `center: true`.
3. **Clips really move the bones.** Render each kept clip at a couple of
   times. A cell that looks like the bind (T) pose in some views but not
   others is usually real authored geometry, not a bug. Compare with
   Sketchfab's own viewer (the `…/models/<uid>/embed?autostart=1` page in
   puppeteer) before blaming three.js.
4. **Wings.** The sparrow's flight wings sit half-open in every clip. Its fix
   was `wings: /shoulder/`, which scales those bones to 0.001 on the ground
   and snaps them open for `fly`/`land`. The folded wing is painted on the
   body texture. Test with a `hide <regex> 0.001` cell.
5. **Root motion.** Find the bone whose `.position` track moves in
   walk/run. Look at its per-axis span across clips, then find which local
   axis is world-up from the parent's `matrixWorld` basis. Use
   `pin: { re: /<Bone>\.position$/, keep: <upAxisIndex> }`. The pigeon/finch
   default keeps index 1 (Y); the bear's pelvis keeps 2 (Z-up, Y-forward).
   Wrong pinning makes the animal slide or kills the hop.
6. **Squat hinge.** Use `bone <Name> <axis> <rad>` cells on the tail, hips
   and spine. For all three rigs so far, +Z on the tail lifts it and −Z on
   the hips tips the bird forward or drops the bear's rump. Tipping the
   hips can lift the front legs; the bear counters with the spine
   (`squat: { tail: 0, hips: -0.35, spine: 0.35 }`). Check the sign: −0.3
   made it worse.
7. **Bones for** `bones: { hips, tail, spine }`. The hips bone drives the
   contact shadow; spine drives the look-pitch. Use the exact names from the
   info block (three keeps names like `RigPelvis_04`).

## 4. Wire it in

**`src/frontend/app.js`**
- Add a `SPECIES.<name>` entry with `b64`, `script: '<name>-model.js'`
  (on-demand), `flip`, `tint: false`, `scale`, `center`, `bones`, `clips`,
  and optionally `pin`, `wings`, `squat`. Update the comment above `SPECIES`.
- Add a voice table (`<NAME>_KINDS`) and a `BANKS` entry
  (`script: '<name>-sound.js'`); wire it into `playKind`'s lookup.
- Kinds are `coo`, `coolong` (strut), `call` (alarm), `takeoff`, `scatter`,
  `distant` and `munch` (per bite of food). Omit a kind to stay silent; the
  bear has no takeoff.

**`src/main.js`**
- Add to `SPECIES` (`icon`, `one`, `many`, `food` label, `foodIcon`).
- Add a menu item in the 🐾 Animals submenu (`sp-<name>`).
- If its poop isn't pigeon-sized, extend `poopSize()`.

**Food and poop pages**
- `crumbs.html` and `poop.html` switch on `species`. Add a draw path if the
  animal eats something else (the salmon is the model: a flesh layer with
  `destination-out` bites over a skeleton clipped to the body outline) or
  poops bigger (`bearPile`).

**`README.md`**
- Credit the model and each recording, with its license.

## 5. Sounds (optional, but the user cares)

- Birds come from **xeno-canto**. Its API v3 needs a key, and the site has an
  anti-bot wall: don't bypass it. The user downloads a recording (grade A/B)
  and reports its license and recordist from the page. Avoid ND licenses if
  you'll trim.
- Mammals: the NPS pages (for example `nps.gov/subjects/bears/sounds.htm`)
  list direct mp3 URLs in the HTML. NPS-only credits are public domain; a
  co-credit (like "NPS & MSU Acoustic Atlas") may carry rights, so flag it.
- Never extract audio from apps (for example Merlin).
- Map the recording with a spectrogram plus an RMS envelope (numpy, scipy
  and matplotlib in a scratch venv, with `PIP_CACHE_DIR` and
  `MPLCONFIGDIR` set in the scratch dir). You can't listen (audio output is
  sandboxed), so choose by eye and tell the user you did.
- Drop broadband noise blocks (wind, handling).
- Cut with `assets/cut-audio.sh` (peak-normalize, never loudnorm), check the
  clips' spectrograms again, then bundle to `<name>-sound.js`.

## 6. Verify headlessly, then hand over

- Copy the frontend files plus `stub.js` into the scratch dir. Make a
  harness page: `stub.js` → `three.bundle.js` → `pigeon-model.js` →
  `coo-sound.js` → `app.js`, with the stage and canvas markup from
  `index.html`. Open `harness.html?sp=<name>`.
- Drive it with `push(...)` and screenshot each state: idle, walk, eat, loaf,
  circle, fly, poop. Poses under a second long (the squat) must be frozen:
  see `stub.js`.
- Check `logs` for `ERR`, and that `say` kinds play the new bank.
- For crumbs/poop pages, inject `stub.js` before their `<script>` and wrap
  them in iframes at the real window size.
- Build: `cd coo3d && ../../tinyjsapp/tinyjs build` with the Bash sandbox
  disabled (the icon step's `sips` needs the system temp dir).
- `open` is blocked in the sandbox: ask the user to quit the app and run
  `! open "/Users/elgreg/dev/opc/tinyjsapp-examples/coo3d/dist/Coo 3D.app"`.
- You can't screenshot the real app (no screen-recording permission), so say
  plainly what was verified headlessly and what the user should check.
