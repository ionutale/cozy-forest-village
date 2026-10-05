# B2 (highlight) — 3D cue for the selected structure

**Task:** batch-3 Wave B. Clicking a structure (ghost or built) opens its card in the popover; this
adds the in-world cue that tells the player *which* structure the card is about.
**Files touched:** `src/render/structures.ts`, `src/render/index.ts`, `src/main.ts` (+ this report).
**Status:** DONE. No commit.

> Note on naming: `docs/tasks/B2-report.md` is the batch-2 *sim* report and was left untouched. This
> report is the batch-3 Wave B highlight task.

---

## 1. What was built

A single shared ground cue in the structures layer: a **wide soft halo with a thin warm ring on
top**, scaled to the selected structure's footprint. Ghost and built are treated identically.

| File | Lines | Change |
|---|---|---|
| `src/render/structures.ts` | 629 (+143) | `setSelectedStructure` on `StructuresLayer`; the cue; `advanceCue`/`retarget`; reused liveness `Set` |
| `src/render/index.ts` | 213 (+10) | `setSelectedStructure` on `RenderHandle`; per-frame re-apply |
| `src/main.ts` | 167 (+13) | click chain mirrors the UI calls; `onSelect` clears the structure half |

`RenderHandle` gains exactly one method, as specified:

```ts
/** B2: ground ring around the selected structure's footprint (ghost or built); null clears it. */
setSelectedStructure(structureId: string | null): void;
```

`pickVillager`, `pickStructure` and A4's `pickHover` are **untouched**.

## 2. Cue design

### Two-tone, per-kind footprint

Deliberately a *sibling* of the villager selection ring (`src/render/villagers/ring.ts`), not a
twin — the brief called for "wider, thin", and that distinction matters because a villager can
easily stand inside the selected structure's footprint:

| | villager ring | this cue |
|---|---|---|
| outer radius | 0.37 | `FOOTPRINT[kind]`, 0.30 → 0.72 |
| accent band | 0.035 world units | 0.045 × radius (0.014 → 0.032) |
| colours | warm-white halo + `PALETTE.accent` | same pair |

Both rings use the same two-tone idea — a translucent warm-white halo so the mark reads on both
grass and the tan clearing disc, with a thin `PALETTE.accent` band on top that does the actual
"this is selected" work — because that is the house idiom and it is genuinely the right one here.
The difference is proportion: this cue is wide and its accent band is thin, so the two marks never
read as one when they overlap.

Geometry is two unit-space `RingGeometry`s laid flat by rotation, so **one geometry pair serves
every kind** and the footprint is a uniform scale:

```ts
const selCueHaloGeo = track(new THREE.RingGeometry(0.74, 1, 48));   // wide soft band
const selCueRingGeo = track(new THREE.RingGeometry(0.955, 1, 48));  // thin warm band on top
selCue.scale.setScalar(FOOTPRINT[kind] * cueAmount * breath);
```

`FOOTPRINT` is per kind — woodpile 0.44, pot 0.48, bench 0.60, garden 0.72, lantern 0.30, feeder 0.34
— so the ring hugs what it marks. Because the ring is rotationally symmetric, a uniform scale is
correct here, and the band thickens slightly with the footprint, which reads as "a ring sized to
this thing" rather than a fixed gauge.

Sits at `CUE_Y = 0.035`, above the grass (y 0), the clearing disc (0.01) **and the garden's soil
patch (0.02)** — the garden is the one structure whose own geometry would otherwise z-fight.
`renderOrder` 1/2 and `depthWrite: false` follow the villager ring so the halo can never win a
transparent sort against the ring on top.

### Ease in, ease out, and the breath

Both motions are pure functions of `timeSec` — no timers, no `Math.random`, no allocation:

- **Fade** — `CUE_FADE_MS = 220`, smoothstepped (`t*t*(3-2t)`), so slope is zero at both ends and
  there is no visible seam at either end of the transition.
- **Breath** — `CUE_PERIOD_S = 1.4` (≈ 0.71 Hz, inside the required 0.6–0.8 Hz band) with
  `CUE_BREATH = 0.04`, i.e. a peak-to-peak scale swing of 1.00 → 1.08.

Measured off the live scene, garden footprint 0.72, sampled every frame at 60 Hz over a 3 s sweep:

```
steady min 0.72000  max 0.77760  ->  ±3.85% of mean  (8% peak-to-peak)
zero crossings in 3.33 s: 2  ->  0.600 Hz          (0.714 Hz nominal, 3.33 s window is coarse)
fade-in peak / steady max: 1.0000                  (no overshoot)
```

Per-frame trace, scale/opacity, fade in then out — they track each other exactly, because the two
are multiplied rather than added:

```
fade-in : 0.00/0.00 0.01/0.01 0.04/0.03 0.08/0.07 0.13/0.11 0.19/0.16 0.26/0.22 0.33/0.27
          0.39/0.33 0.46/0.38 0.51/0.43 0.56/0.46 0.59/0.49 0.60/0.50 0.60/0.50 0.60/0.50
fade-out: 0.60/on  0.59/on  0.57/on  0.53/on  0.47/on  0.41/on  0.35/on  0.28/on  0.21/on
          0.15/on  0.09/on  0.05/on  0.01/on  0.00/off 0.00/off 0.00/off 0.00/off
```

The fade-in reaches full size in exactly 14 frames (233 ms at 60 fps) and the ring goes
`visible = false` on the frame it hits zero, so a cleared cue costs **zero** draw calls.

### The bug this design review caught

My first pass set the fade target inside `setSelectedStructure` (`cueTo = id === null ? 0 : 1`).
The harness caught the consequence immediately: `setSelectedStructure('nope')` left a **lit ring at
the previously selected structure's position**, because the target was trusted and `cueKind` was
deliberately kept alive for the shrink-out. Only `update()` knows whether an id names a live
structure, so the target now resolves there:

```ts
retarget(found ? 1 : 0, timeSec);   // found = "this frame's state has a structure with cueId"
```

`cueKind` survives a clear (so a fade-out shrinks from where the ring actually was) but nothing
reads it unless `found`. Verified after the fix:

```
cleared                -> visible false, scale 0.0000
unknown id, 24 frames  -> visible false, scale 0.0000
live selection, then the structure vanishes from state -> visible false, scale 0.0000
```

The third line is a behaviour worth having: a selection whose structure disappears (reset race,
save/load edge) fades out on its own instead of stranding a ring on empty grass.

## 3. Why it stays pick-proof

The brief's non-negotiable. Two properties, both by construction and both measured:

1. **Neither cue mesh carries `structureId`.** `pick` resolves an id with
   `typeof hit.object.userData.structureId === 'string'` and *skips* anything else, exactly as it
   already skips the untagged villager ring. A hit on the cue is dropped and the scan continues to
   the structure behind it — the cue can neither steal nor shadow a hit.
2. **Nothing was added to the pick path.** `pick`, `pickVillager`, `pickStructure` and `pickHover`
   are byte-identical to before.

Measured with a throwaway harness that reconstructs the render camera and sweeps
**44 954 rays** — a full-screen 140×88 grid, a dense ±26 px window aimed at every structure at six
heights, and 2 016 rays aimed *directly at the cue's own ring band* (the only rays it could
intercept) — comparing `pick()` with the cue inactive against every structure selected in turn:

```
probes 44954, resolving to an id: 231   (bench:51 feeder:20 garden:64 lantern-a:6 pot:52 woodpile:38)
built-village pick mismatches with cue active: 0     (7 structures x 44954 rays)
ghost-village pick mismatches with cue active: 0     (7 structures x 42938 rays)
mid-fade pick mismatches: 0                          (15 consecutive frames of a partial fade)
MISMATCH TOTAL: 0
```

231 of those rays genuinely resolve an id (a plain full-screen grid almost entirely misses —
structures are a few pixels wide at the default camera), and not one of them changes with the cue
active, at rest or mid-fade, built or ghost. The harness was deleted after the run (`.probe/`,
`rm -rf`); nothing outside the three source files remains.

Also confirmed: the cue subtree contains **0** tagged ids, and it is the only untagged child of the
structures group.

## 4. `main.ts` mirroring — render and UI can never disagree

The click chain is unchanged except for the one added setter, and both setters are fed the *same
pair of ids* the UI is given, in the same order:

```ts
const villagerId = render.pickVillager(ev.clientX, ev.clientY);
const structureId = villagerId ? null : render.pickStructure(ev.clientX, ev.clientY);
render.setSelected(villagerId);
render.setSelectedStructure(structureId);
ui.select(villagerId);
ui.selectStructure(structureId);
```

Because `structureId` is already `null` whenever a villager wins, the three required cases fall out
of that one line each:

| gesture | villager cue | structure cue |
|---|---|---|
| click a villager | `pickVillager` id | `null` — cleared |
| click a structure | `null` — cleared | `pickStructure` id |
| click empty ground | `null` | `null` |

The second path matters just as much, and it is the one easy to miss. `UIActions.onSelect` fires on
card click, Escape and outside-click, and **every one of those UI paths calls
`clearSelectionVisuals()`**, which nulls the structure half. So `onSelect` now clears both:

```ts
onSelect: (villagerId) => {
  render.setSelected(villagerId);
  render.setSelectedStructure(null);
},
```

Without this, pressing Escape on a structure card would leave the ring lit under a closed popover
— the exact "render and UI disagree" failure the brief forbids. `main.ts` was **not** touched
beyond these two hunks.

`render/index.ts` keeps `selectedStructureId` in the handle closure and re-applies it every frame,
mirroring how `selectedId` works: `structures` is created lazily on the first `render()`, so a
click that lands before that frame must still be honoured.

## 5. Cost

**+2 draw calls, and only while a structure is selected.** Two meshes in one group; `castShadow`
is left false so the cue adds nothing to the shadow pass; `visible = false` when cleared, so an
idle village pays nothing at all. Against A5's worst case of ~111 calls, this is ~113.

Memory: **+2 geometries, +2 materials**, both tracked in `disposables` and freed by `dispose()`.

**No per-frame allocation.** The added code is arithmetic over module-scope scalars — no `new`, no
array or object literal, no closure, no `.map`/`.filter`, no template string. While I was in this
function I also removed a genuine pre-existing per-frame allocation, A5's
`new Set(state.structures.map((s) => s.id))`, replacing it with a reused `liveIds` set refilled by
the structure loop that was already running. The liveness sweep was re-verified after that change
(group children 15 → 11 when two lanterns leave the state, i.e. both variants of each evicted).

Honest caveat on measurement: I tried to put a number on retained heap over 600 frames of
`update()` + `setSelectedStructure()` churn, but `global.gc` is not exposed in the vitest fork, so
the figures I got (319 KiB with churn vs 305 KiB control) are dominated by uncollected garbage and
prove nothing. The allocation claim above rests on the code containing no allocating constructs,
not on that measurement. The remaining per-frame closures in `update()` are A5's code and were left
alone.

## 6. Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0, clean |
| `pnpm build` | exit 0 — `dist/assets/index-QeAVLaLu.js 629.45 kB │ gzip: 161.77 kB` |
| `pnpm test` | exit 0 — **6 files, 63/63 passed** |

63 rather than the brief's 62: a concurrent agent added a test. All 63 pass. Two interim `tsc`
failures during this round were unused-local errors in `src/ui/index.ts` from a concurrent agent's
in-flight edit to a file outside this task's scope — they cleared on their own by the final run and
were not touched.

## 7. Concerns and deviations

1. **Not browser-validated.** The brief assigned the browser to the orchestrator. §3 is an exact
   differential against the real three.js raycaster and geometry pipeline, so picking is safe; but
   the *look* of the cue — whether the halo reads too faint on grass, or the thin band too faint at
   the default camera distance — is genuinely unverified by eye. Worth one screenshot with a ghost
   selected and one with a built one.
2. **Accent band width scales with footprint.** A consequence of one geometry pair for all kinds:
   the band is ~0.014 world units on a lantern and ~0.032 on a garden, against the villager ring's
   0.035. I judged the variation worth the saving of 1 geometry and 1 material per kind, and the
   halo underneath carries the read either way, but at the default camera the lantern's band is
   genuinely fine — roughly 1–2 device pixels at dpr 2. If it reads as too fine in the browser, the
   fix is to raise the band's inner radius from 0.955 and accept a slightly heavier garden ring.
3. **The two cues are distinguished by proportion, not by colour or form.** A wide thin warm ring
   versus a small wider-accented ring. I think that is enough, but it is a judgement call made
   without eyes on it — see 1.
4. **`DESIGN.md` §3's `RenderHandle` contract block does not yet list `setSelectedStructure`.**
   `DESIGN.md` was outside this task's allow-list, so it is unsynced; the orchestrator should add
   the one method to the published contract, as it did for A4's `pickHover`.
5. **`src/render/structures.ts` is now 629 lines.** It was 490 before this task and already well
   past the ~220-line guidance in earlier briefs. The cue is ~145 lines including comments, and it
   is a cohesive unit that could move to `src/render/selectionCue.ts` alongside the villagers'
   `ring.ts` — but that is a new file, outside this task's allow-list. **Recommend it as the next
   structures-layer task**, especially since A6 already split `villagers.ts` for exactly this reason.
6. **`__cozyRender.info()` was not read.** The brief forbade the browser. +2 draw calls while a
   structure is selected, 0 otherwise, is an exact count by inspection of the scene graph (two
   meshes, no shadow casting), not a `renderer.info` reading.
