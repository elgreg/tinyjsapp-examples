# coo3d — energy plan

Activity Monitor shows a noticeable energy impact. This plan is for a fresh
session; everything below was checked against the code on 2026-09-25.

## How it works now (the cost model)

- **Up to 34 windows.** 20 animal windows (each a full WKWebView with its own
  WebGL context and three.js scene), 6 crumb/salmon windows and 8 poop windows.
  All are transparent and frameless.
- **Every animal renders at display refresh, forever.**
  `src/frontend/app.js` `loop()` calls `requestAnimationFrame` every frame.
  That's 60 Hz, or 120 Hz on ProMotion. It runs even when the animal is
  standing still or loafing.
- **Renderer settings are expensive.** `antialias: true` with
  `setPixelRatio(min(dpr, 2))` renders a 400×400 canvas for an animal about
  60 px long. There's no `powerPreference`.
- **Every push goes to every window.** `app.push` broadcasts to ALL windows
  (`../tinyjsapp/runtime/bridge.js:1225`, `EVAL@*`). Each page then filters
  by `who`/`win`. The chatty events are:
  - `look`: per animal, every 3rd tick, which is about 8 Hz each. With 20
    animals that's roughly 160 pushes/s, and each one is evaluated in all 34
    pages, so about 5,400 JS evals/s.
  - `bird`: on every state change.
  - `say`: only the main window uses it, but all 34 pages receive it.
  - `crumbs`, `splat`, `fade`: each is for one window only.

  A per-window push already exists and isn't used here:
  `app.window(id).push(event, data)` (`bridge.js:1965`; `id === 'main'`
  targets the main window only).
- **The backend tick** (`src/main.js`, `TICK = 40` ms, 25 Hz) moves windows
  with `setPosition` only when an animal actually moved. That's already good,
  but moving 20 transparent windows at 25 Hz still costs WindowServer time.
- **Off-screen animals still render.** An `away` animal (flown off the screen
  for about 30 s) keeps rendering, and so does one behind a fullscreen app.

## Step 0: measure first (baseline, then after every step)

- `top -l 3 -s 5 -stats pid,command,cpu,power -o power | head -30`. Watch
  `coo3d`, `com.apple.WebKit.WebContent` (one per window, or shared; find
  out) and `WindowServer`.
- Or use the Energy tab in Activity Monitor (Avg Energy Impact over a few
  minutes).
- Test these scenarios, about 2 minutes each:
  1. 3 pigeons, idle.
  2. 20 pigeons (🌪️ Pandemonium).
  3. 3 bears eating a salmon.
  4. The flock "Live on the desktop".
- Write the numbers into this file so the next person can see what each step
  bought.

**Status 2026-09-25: stopped after step 4, by choice.** Steps 1 and 2 are
the wins. Step 3 kept only `low-power`, and step 4 wasn't needed. Steps 5
and 6 are deferred; pick them up only if Activity Monitor still complains.

## Steps, biggest expected win first

1. **Target the pushes.** ✅ DONE 2026-09-25: `tell(app, id, event, data)`
   in `main.js` wraps `app.window(id).push`. `app.push` on the main app IS a
   broadcast (`EVAL@*`), and `app.window('main')` is a plain `EVAL` that only
   main receives. Pushes to unopened ids are dropped by the launcher. Only
   `env`, `species` and `ask-tracking` still broadcast. Energy numbers: TBD.
   - In `main.js`, send `look` and `bird` via `bwin(app, b).push(...)`.
     Check that `app.push` on the main `app` object isn't itself a broadcast
     here: use `app.window('main').push` for the main animal if it is.
   - Send `say` only to `main`.
   - Send `crumbs`/`splat`/`fade` to `app.window(win)`.
   - Keep `species` and `env` as broadcasts; they're rare.
   - The pages' `who`/`win` filters can stay as a safety net.
2. **Cap the frame rate** in `loop()`. ✅ DONE 2026-09-25: `FPS_AIR = 60`
   for `fly`/`land` and `FPS_GROUND = 30` for everything else.
   - The first version tried 30 for everything that moves and 15 when still.
     The user checked it in the app: goldfinch flight looked off at 30, and
     idle looked fine at any rate.
   - The user suggested 90 for flight. 60 was chosen because 90 doesn't
     divide 120 Hz, so it would judder.
   - The headless harness, on a 120 Hz display, measured idle/walk at 30
     renders/s and fly at 60, down from 120.
   - Keep `requestAnimationFrame`, but accumulate `dt` and render at most at
     30 fps.
   - Drop to about 12 fps when the animal is still: state `idle`/`loaf`/`eat`,
     `!moving`, no wing fold in progress (`wingOpen` settled), and yaw/scale
     eases converged. Pass the accumulated dt to `mixer.update` so animation
     speed doesn't change.
   - Check the goldfinch wing snap and the bear run still look right at 30.
3. **Cheaper renderer.** ⚠ PARTLY DONE 2026-09-25: only
   `powerPreference: 'low-power'` was kept. The pixel ratio went back to
   `min(dpr, 2)`: at 1.5x the user saw the animals looking grainy in the real
   app. That's the non-integer 300→400 px resample done by the compositor,
   which the smooth upscale in the harness below hid. Don't retry a
   fractional ratio. Only 1x (an integer scale, but soft) is left, if ever.
   - Compared side by side from one frozen frame, with extra
     `WebGLRenderer`s on the harness page's own `scene`/`cam`, upscaled
     the way a 2x screen shows them. 1.5x antialiased is indistinguishable
     from 2x and draws 56% of the pixels. 1.5x without antialiasing is
     jaggy, and 1x is soft.
   - Try `setPixelRatio(1)` (or 1.5) and `powerPreference: 'low-power'`.
   - Try `antialias: false` with pixel ratio 1.5 versus `antialias: true` at
     1. Pick by screenshot. The harness in
     `.claude/skills/add-animal/assets/` renders the real page, so compare
     side by side.
4. **Stop rendering what nobody can see.** ⏭ NOT NEEDED (measured
   2026-09-25). WebKit already suspends rAF in hidden or occluded windows.
   A temporary probe logged renders per 10 s per window with the binary run
   directly (`./dist/coo3d > log`):
   - `away` (hidden) windows drew 0 frames, with `visibilityState` hidden.
   - Behind a fullscreen app, or with the screen locked, every window drew
     0 within one sample.
   - The same log confirmed the step 2 caps in the real app: about 300 per
     10 s on the ground and up to about 550 flying.

   The original idea, kept for reference:
   - When the backend sets `b.away` (the animal flew off-screen), push a
     `pause`/`resume` to that window and skip rendering in `loop()` while
     paused.
   - Same when the app is hidden, the screen is locked or the display
     sleeps. Check `onSystem` / `onWindowState` in `references/api.md` of
     the tinyjs skill for the event names.
5. **Backend tick.**
   - When every animal is idle and no crumbs or poop are fading, consider a
     slower tick (for example 100 ms) that snaps back to 40 ms on any cursor
     movement, crumb throw or state change.
   - Check how often `raiseFlock` / y-sort re-raising runs; if it's chatty,
     throttle it.
6. **Only if still needed:** fewer WebGL contexts. For example, render several
   animals into one window. That's a big architectural change; don't start
   there.

## Working notes for this repo (learned the hard way)

- **Build:** from `coo3d/`, run `../../tinyjsapp/tinyjs build`. It needs the
  Bash sandbox disabled, because the icon step's `sips` writes to the system
  temp dir.
- **Launching is blocked in the sandbox.** Ask the user to run
  `! coo3d/relaunch.sh` from the repo root (`--build` builds first). It
  kills any running copy, then opens the dist build.
- **You can't see the real app.** Screen capture isn't permitted. Verify
  pages with the stub-bridge harness (see the add-animal skill) and ask the
  user to confirm in the app.
- **Nothing is committed yet.** Shortcut changes, House-trained, goldfinches,
  bears and credits are all local. `bear/`, `sparrow/` and a stray `.bin.gz`
  are raw downloads, not to be committed. The user doesn't sign builds; see
  memory.
