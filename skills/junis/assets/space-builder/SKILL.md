---
name: space-builder
description: Build a single-file HTML game or interactive app that runs in the Junis preview and on a published page. Gives two tested skeletons (2D canvas, three.js) and the rules this runtime enforces. Use when asked for a game, a simulator, or an app that saves progress or posts scores.
---

# space-builder

The result is one complete HTML document in one `html` code block. It runs in a sandboxed frame, in the chat preview and on the published page alike.

## Steps

1. Pick one skeleton and read it — with `read_skill_file`, or with `space_app_guide` and the same path:
   - `skeletons/canvas2d-2.txt` — 2D canvas, no dependencies. The playfield is portrait (360 wide, 520–780 tall) and letterboxed in a wide frame: for tap, drag and swipe games on a phone held upright. To fill a landscape or desktop frame use `three-2` or no skeleton.
   - `skeletons/three-2.txt` — 3D with three.js 0.187.0; fills a frame of any shape.
   For a page with no game loop (a tool, a dashboard), skip the skeleton and follow "Rules for every page".
2. Copy the skeleton unchanged and write only between `<junis:region name="…">` and `</junis:region>`. Names that start with `jx-` belong to the kernel: never define, select or restyle them. The one you add yourself is the attribute `data-jx-ctl="name"` on your own HUD buttons, so that they receive taps.
3. The kernel already handles pointer and key input, a fixed 1/60 s step, pause (hidden tab, platform leaderboard, P key), sound unlock, the start/pause/game-over overlay, the best score (`window.junis.storage`, key `best`) and the leaderboard score (`window.junis.run`, short rounds as one run). Do not write these again or call `window.junis.run`.
4. A region may use: `G` (`G.score`, `G.t` = ms played, `G.best`, `G.mode`, your own fields), `gameOver(reason)` — `gameOver(reason, false)` when `G.score` is not a result —, `setMode(name)`, `rng.next()` / `rng.range(a, b)` / `rng.int(a, b)`, `hud.text(id, value)`, `sfx.tone()` / `sfx.noise()` / `sfx.drone()`, `clamp`, `lerp`, `damp`; in canvas2d also `L` (logical size) and `toLogical(inp.x, inp.y)` — input positions are CSS pixels of the whole frame, not playfield coordinates.
5. Put every tunable number and colour in the `config` region. Keep everything that decides the outcome in `G`, reset it all in `game.reset`, use `rng` for randomness. `game.onInput` is called only while playing. When a lower score is better, set `"sort":"asc"` in the `board` region: the kernel's best follows it and `G.best` is `null` until a round is scored.
6. Read `references/window-junis.md` (the same way) when the game saves more than the best score or shows its own leaderboard. The kernel already meets two of its lines: it draws the first frame without waiting for `ready()` (earlier calls are queued) and measures frame time with `performance.now()` — region code uses `G.t` and `dt`, never a clock. `await` works in a region.
7. If you have `space_check`, pass the whole page to it before you answer, fix what it reports and follow its `next`. Then answer with the whole HTML in one `html` block (your reply must contain the page).

## Rules for every page

- Browser storage: `localStorage` works — on a published page it is kept for each viewer (signed-in viewers on their account, 256 KB; guests on that device, 64 KB) — and `sessionStorage` lasts while the page is open. A CDN library's own saving is kept only if your script mentions `localStorage`. `indexedDB` and `document.cookie` throw or keep nothing in this frame.
- Read `references/data-and-devices.md` (the same way) before using an attached file, the camera or microphone, a photo picker, a file download, tilt or vibration, or data that grows or is shared — each has one way that works here. Shared data (votes, a team list) is `window.junis.storage` with `{scope:'shared'}`, never `localStorage`. Location does not work.
- AI inside the app (chat, summaries, generated text): `const r = await window.junis.llm.complete({prompt, system})` — only those fields (plus `json`); use `r.text` only `if (r && r.ok)`, otherwise show `r && r.reason` (a guest gets code `sign_in`); for JSON add `json: true` and use `r.data`. Call it when the person acts, never in a loop. Details: line 17 of `references/window-junis.md`. Never put an API key in a page.
- Scripts load only from `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `unpkg.com`, `cdn.tailwindcss.com` and `esm.sh`; stylesheets from the first three and `fonts.googleapis.com`. Anything else is blocked and the page stays blank.
- No `<iframe>` of a site (this one included) and no form that posts to another site; link with `target="_blank"` or use `fetch`.
- Input is Pointer Events (`pointerdown`, `pointermove`, `pointerup`) with `touch-action: none` on the control. Mouse-only input does not work on phones. If keys are used, add on-screen buttons too.
- Height is `100dvh`, not `100vh`. Keep bottom controls above `env(safe-area-inset-bottom)`.
- Sound, fullscreen and tilt need a tap first. For tilt handle three cases — allowed, denied, no sensor — and keep touch control in all of them.
- Check portrait and landscape: nothing off-screen, overlays never cover the controls, and no two elements share a class name by accident.
- Draw with code (shapes, canvas, CSS); use an image, sound or video file only when its `https://` address is in the conversation (attached or generated). Never invent an address.
- three.js 0.187.0 only through the skeleton's import map; controls and loaders come from `three/addons/`. Not in this version: `three.min.js`, `build/three.js`, `examples/js/`, `*BufferGeometry`, `THREE.Geometry`, `Face3`, `THREE.Math`, `.addAttribute()`, `.getInverse()`, `.applyMatrix()`. Silently ignored: `THREE.VertexColors`, `shading: THREE.FlatShading`, `texture.encoding`, `renderer.outputEncoding` (use `vertexColors: true`, `flatShading: true`, `texture.colorSpace = THREE.SRGBColorSpace`).
