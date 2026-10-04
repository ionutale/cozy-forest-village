# B6 Report — Render: villager poses — carry, stir, eat, shiver, hearts

Status: **DONE**. `tsc --noEmit`, `pnpm build` and `pnpm test` all green; all four poses verified
in a live browser (chrome-devtools, `pnpm dev` on :5177), console clean, worst-case draw calls
**168** against the 200 budget. Changes left uncommitted in the working tree.

## Files

| File | Lines | Change |
|---|---|---|
| `src/render/villagers.ts` | 511 (+258) | carry pose + held log, cook stir, eat hearts + savoring bob, embers shiver |
| `src/render/palette.ts` | 27 (unchanged) | no new colours needed |

`git status` shows exactly `src/render/villagers.ts` plus the new validation PNGs. **No commit, no
subagents, no new dependencies, no `any`.** The dev server on :5177 has been stopped and the port
confirmed free.

Validation artifacts:

- `docs/validation/B6-poses-carry-cook-hearts.png` — keeper mid-carry (log across the chest), cook
  stirring at the pot, hearts rising over the resting eater, all in one frame
- `docs/validation/B6-hearts-eat.png` — three hearts mid-arc above the resting villager's head
- `docs/validation/B6-carry-keeper.png` — the keeper alone, log at full scale, both arms raised
- `docs/validation/B6-cook-stir.png` — the cook alone, arms up at the rim, body leaning in
- `docs/validation/B6-embers-shiver.png` — fire at 0, eight villagers idle in a line, all hunching
- `docs/validation/B6-poses-default.png` — fresh village wide shot

## What was built

### The rig grew four eased blends, not four more code paths

`Rig` gained `raise`, `stir`, `carry`, `chill` and `savor` alongside the existing `bob`/`lean`/
`swing`, plus `head` and `log` references. `pose()` grew a `chill` argument and returns a `Pose`
record with `raise` and `stir`; `animate()` eases every one of those toward its target with the
existing exponential filter, so **every addition inherits the slice-1 "nothing snaps" property for
free**. The only pose-level change to existing behaviour is `armL/armR.rotation.set()` replacing the
two separate `.z` writes — same values on the z axis, with the new x pitch added.

### 1. Carry pose

`villager.carrying` raises both arms to `CARRY_RAISE = 0.95` rad at the shoulder and adds
`CARRY_LEAN = 0.1` to the lean, on top of whatever the villager was already doing (walking, working,
idle) — a keeper carrying a log down to the fire leans into the walk rather than losing it.

The log itself is a `CylinderGeometry(0.05, 0.052, 0.44, 8)` in `PALETTE.trunk`, pre-rotated onto the
x axis so it lies across the body, `rotation.y = 0.28` so it is angled rather than bolted to the
front. It is a **child of `body`**, so the carry lean tips it with the villager — it reads as
carried rather than stuck on.

Arrival and departure are eased by a dedicated, slower filter (`EASE_CARRY = 5.5` per second vs the
body's `9`): the log's scale rides the `carry` blend from 0 → 1, and `log.visible` cuts at
`carry > 0.004`. **On deposit the log shrinks into the hands rather than popping out of existence.**

Measured (browser, 6 frames after `carrying` flipped true): `carry` 0.088 → 0.423, `raise`
0.133 → 0.564, log scale tracking `carry` exactly, `log.visible` true from the first frame.

### 2. Stir pose

`state === 'working' && task === 'cook'` gets its own branch inside the `working` case — it must not
be lumped in with the chop pulse, or the cook would chop at 2.2 Hz. It leans `STIR_LEAN = 0.17`,
holds both arms at `CARRY_RAISE * 0.78` (hands at the rim), and the **right arm alone** gets a
circular offset of `STIR_RADIUS = 0.17` rad: `x` from a sine, `z` from a cosine of the same phase.
The circle rides on top of `raise`, so the hand traces a loop over the cauldron instead of
oscillating on one axis.

The bob is driven by the same sine at ±0.008 u, so the whole body participates in the stir rhythm
rather than only the arm.

**Verified frequency: 1.19 Hz** against the brief's ~1.2 Hz, by mean-crossing count over a 5.48 s
window at 60 fps (13 crossings / 2 half-cycles per cycle / 5.48 s). Amplitude ±0.1358 rad on z,
±0.17 rad on x.

### 3. Eat garnish

`state.events` is scanned once per **sim tick**, not per render pass:

```ts
if (state.tick !== lastEventTick) { lastEventTick = state.tick; /* scan for 'eat' */ }
```

This is the load-bearing detail. `tick()` clears `state.events` and refills it, so a tick number
that has already been consumed is the idempotency key — an extra `render()` over the same state
(possible on a slow frame, or from a test harness) **must not spawn a second set of hearts**. Each
`eat` event for a villager with a rig does two things: arms `rig.savoring` (the head bob, released
the moment the villager leaves `resting`), and calls `spawnHearts`.

**Hearts are a fixed pool of 4 sprites sharing one canvas-drawn `CanvasTexture`.** `heartTexture()`
draws a bezier heart on a 64×64 canvas at boot — `PALETTE.flowerPink` for the body, a 50 %-lift
toward `PALETTE.flowerWhite` for the highlight — and sets `generateMipmaps = false` +
`LinearFilter` (a sprite is drawn tiny; mips only cost memory) and `SRGBColorSpace`. `minFilter` and
`magFilter` are both linear so the sprite stays crisp when the camera is close.

`spawnHearts` emits **2 or 3** hearts (`2 + round(hash01(serial, 93))`), fanned by a deterministic
`-0.8…0.8` spread and a per-heart phase, and `heartSlot()` returns the first inactive heart or
recycles the **oldest** one — so a burst of meals back to back can never exceed 4 sprites or
allocate anything. Each heart rises `HEART_RISE = 1` u with an ease-out (`1 - (1-life)²`, so the lift
decelerates at the top), fades in over the first 15 % of life and out with `1 - life²`, and sways
±0.05 u horizontally. Idle hearts are `visible = false` and cost nothing.

**Verified pool behaviour:** two meals ~0.5 s apart produced a burst of 6 requested hearts against a
pool of 4 — peak active stayed at exactly **4**, then drained to 0. Two hearts at full life measured
`y` 0.75 → 1.72 with opacity peaking at 0.98.

**The savoring bob rides on the head, not the body** (`rig.head.position.y = HEAD_Y + sin(...) *
SAVOR_BOB * rig.savor`, `SAVOR_HZ = 0.8`, `SAVOR_BOB = 0.016`). A body bob would read as breathing or
stepping; a head-only dip reads as savouring. Measured head-y travel 0.5979 – 0.6044.

**Plain rests get nothing.** Verified directly: a rest with `pot.meals = 0` produced 0 active hearts
and `savoring === false` across 5 frames while the neighbouring eater had 3 hearts up.

### 4. Embers shiver

`fire.fuel <= 0` **and** the villager is `idle` or `resting` sets a `chill` target. The filter is
`<= 0` rather than `=== 0`: the sim floors fuel at 0, but `<= 0` also survives a hand-edited or
restored save that carries a negative value.

The tremble is two **detuned** sines per axis at `CHILL_HZ = 7`, weighted 0.6/0.4 so `|sum| ≤ 1`
and the peak stays inside the brief's ±0.006 u — `CHILL_AMP = 0.006` multiplies that bounded sum, so
the hard ceiling is the brief's number, not an approximation of it. x uses `1.0 / 0.63` Hz, z uses
`0.77 / 0.51` Hz: the axes never line up, which is what makes it read as a tremble rather than a
shake. `CHILL_HUNCH = 0.05` adds to the lean, scaled by the eased `chill` blend so the hunch fades
in with the tremble.

**Verified:** x amplitude ±0.00593 u, z amplitude ±0.00582 u (both inside ±0.006), **6.96 Hz on x**
measured by mean-crossing count over 2.52 s. `chill` ramps 0.14 → 1.0 over 5 frames on ignition,
never snapping. With `state` pinned to `walking` via a getter the blend stays at **0** for 80 frames;
switching the pin to `idle` ramps it 0.14 → 0.9994 over 50 frames. Walking and working villagers do
not shiver.

### Determinism

No `Math.random` anywhere in `src/render/`. Heart spread and phase come from `hash01(serial, salt)`
against a monotonic `heartSerial` counter — the same event sequence produces the same hearts. All
smoothing state lives in the `Rig` records and the heart pool inside the layer; nothing is written
back into the sim.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` (tsc + vite build) | exit 0 — `dist/assets/index-JcIS3XIF.js 611.60 kB │ gzip: 156.13 kB` |
| `pnpm test` | exit 0 — 6 files, 49 tests passed |

## Browser validation (chrome-devtools, `pnpm dev` on :5177, 1440×900 CSS)

Console: **clean** — no errors, no warnings, at boot, during every staged pose, and after reload
with the temporary probe removed (`typeof __cozyProbe === 'undefined'` confirmed).

**Draw calls** (`__cozyRender.info()`) against the `< 200` budget:

| Scene | calls | triangles | geometries | textures |
|---|---|---|---|---|
| Fresh village | 120 | 28 052 | 36 | 2 |
| All 7 structures built + **8 villagers carrying** | **168** | 30 376 | 40 | 3 |
| 8 carrying + a live 3-heart burst | 168 | 29 424 | 40 | 3 |

168 is the true ceiling and it is an artificial one — the sim never puts more than one villager in
the carry pose at a time, because only the keeper has `carrying` set. Headroom is 32 calls.
`textures` went 1 → 2 at boot for the heart canvas and 3 under a burst (the third is the environment's
own, created later).

**Method.** `VillagersLayer` exposes no internals, so I temporarily added a `__cozyProbe` to
`villagers.ts` that reported rig scalars and the heart pool, drove the poses through the **real sim
path** wherever possible (assign `tend` / `cook` / `rest`, let the sim emit its own `fuel-add`,
`meal-cook` and `eat` events), and **removed the probe afterwards** — the shipped file has no
`window` reference, verified by grep. For the screenshots I held poses with a `setInterval` from the
console; no source file was modified to produce any artifact.

One harness lesson worth recording: `tick()` does `state.events = []` (a **reassignment**, not
`length = 0`), so a `Proxy` on the array loses the sim's own events the moment it is replaced. Any
event injection has to be a getter/setter pair with a stable backing array.

## Deviations

1. **No `palette.ts` change.** The brief allowed it "if needed". Every new element resolves to an
   existing key: the log is `PALETTE.trunk` (the same colour as the woodpile's logs), the heart is
   `PALETTE.flowerPink` lifted toward `PALETTE.flowerWhite` for its highlight. No new hue was
   invented.
2. **`Pose` is a named interface, not an inline type.** `pose()` previously returned an anonymous
   `{ bob; lean; swing }`. With five fields the inline type was getting unreadable at the return
   site, so the shape moved to a `Pose` interface beside `Rig`.
3. **`raise` is shared by the carry and the stir.** The brief describes "arms raise" for the carry
   and "one arm circles" for the stir; modelling the raise as a general shoulder pitch that both use
   (with the stir's circle layered on the right arm) is one filter instead of two that would have to
   be kept in agreement. The visible result matches the brief.
4. **`fire.fuel <= 0`, not `=== 0`** — see above, robust to a hand-edited save.
5. **The log is tagged as part of the villager** (`root.traverse` runs after it is added), so it
   inherits `userData.villagerId` and clicking the log selects its owner. That falls out of the
   existing tagging pass rather than being a separate decision.

## Known gaps / concerns for the orchestrator

1. **No automated test covers any B6 code.** The allow-list is `villagers.ts`, `palette.ts` and this
   report, and `src/render/` has no test file at all — so carry, stir, hearts and shiver are
   verified only by the browser run above. The two pieces most worth a unit test if the allow-list
   ever widens are the **`state.tick` guard** (a regression there would silently double every heart
   burst, and it looks like a harmless dedupe check) and `heartSlot()`'s recycle-oldest path.
2. **`villagers.ts` is now 511 lines**, up from 253. For the record against T05's "~220"
   convention. It is one pose table plus one heart pool with no branching depth, but it is now the
   longest file in `src/render/`; if B8/B9 add more ambient motion to characters, splitting the
   heart pool into its own module would be the natural cut.
3. **Heart placement is world-anchored, not head-anchored.** A heart follows its owner's rig x/z
   each frame, so a villager reassigned mid-meal takes its hearts with it. Correct here (the eater
   rests in place), but if a future task lets a villager eat while walking, the hearts will slide
   along with them rather than staying where the meal happened.
4. **The cook's stir is symmetric with the lean.** `STIR_LEAN` leans toward the pot, but nothing
   turns the torso to square up to it — the cook reads correctly because the sim already points
   `facing` at the pot on arrival. A cook mid-channel stays put, so the two never disagree.
5. **The shiver was verified numerically, not visually.** ±0.006 u at 7 Hz is roughly a pixel of
   screen motion at play distance and is *supposed* to be barely visible — that is the brief's
   "never distracting". `B6-embers-shiver.png` shows the eight hunching villagers; the tremble
   itself needs the probe numbers above to confirm, and it is the one deliverable a still frame
   cannot fully demonstrate.
6. **`hearts.length = 0` in `dispose()`** runs before `group.clear()`, so the sprites are dropped
   from the scene graph while the pool still references them. The materials and the texture are in
   `disposables` and are disposed on the line above, so nothing leaks, but the ordering reads as
   deliberate when it is incidental.