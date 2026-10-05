# G5 — gentle camera focus on selection — Report

**Status: DONE. No commit. Only `src/render/index.ts`, `src/main.ts` + this file touched.**

## Files

| File | Lines | Change |
|---|---|---|
| `src/render/index.ts` | 213 → 266 (+53) | `focusVillager(id \| null)` on `RenderHandle` + ease state + per-frame ease in `render()` + canvas `pointerdown` cancel listener (removed on `dispose`) |
| `src/main.ts` | 168 → 173 (+5) | both selection paths call `render.focusVillager(...)`: the UI `onSelect` callback and the canvas `pointerup` click chain |

No other files touched. No new deps, no `any`, no sim changes, read-only over sim state.

## Behaviour (DESIGN §3 contract)

```ts
/** G5: gently ease the camera target toward a villager; null cancels any running ease. */
focusVillager(villagerId: string | null): void;
```

- **Ease.** In `render()`, when a focus id is set, the villager's ground position (`pos.x/pos.z`
  from the live sim state) is chased with an exponential ease: `step = 1 - exp(-3.5 * dtSec)`
  (`FOCUS_EASE_PER_SEC = 3.5`), so the approach is frame-rate independent and gentler as it gets
  close — no linear constant speed, no snapping.
- **Orientation and offset untouched.** The target leads and the camera is translated by the
  *same* delta each step (`controls.target.x/z += step; camera.position.x/z += step`). This keeps
  the camera→target offset vector and the look direction bit-identical across the ease; only the
  orbit rig translates. (Target-only mutation would have made OrbitControls pivot in place and
  change orientation — see "Interpretation" below.)
- **Clamp.** The focus point is clamped to `FOCUS_RADIUS_MAX = 8` around the village centre (the
  origin, where the campfire sits). A villager working a far tree (nodes live out to r = 28) pulls
  the rig only to the r = 8 rim; since the disk is convex, the eased target never leaves it.
- **Dead-zone.** `Math.hypot(dx, dz) > 0.4` (`FOCUS_ARRIVE_EPS`) gates the step: inside it nothing
  moves. A selected villager that then walks is picked up again the moment it exits the zone.
- **Cancellation.** `focusVillager(null)` clears `focusId`; `initRender` also adds its own
  `canvas.addEventListener('pointerdown', cancelFocus)` (the canvas is already the OrbitControls
  element), so any drag/orbit wins immediately. The listener is removed in `dispose()`.
- **Both selection paths** (`src/main.ts`):
  - UI: the `onSelect` callback (`src/main.ts:41`) now calls `render.focusVillager(villagerId)` —
    card clicks focus, and Escape/outside-click dismissals arrive as `null` and cancel.
  - World: the `pointerup` click chain (`src/main.ts:117`) calls `render.focusVillager(villagerId)`
    next to `setSelected`; a ground click or a structure pick arrives as `null` (cancel). A real
    drag returns before this block, so orbiting never re-arms the ease.
- **Zero per-frame allocations.** Index loop over `state.villagers` (no `find`/callback closure),
  scalar locals only, no vectors/objects/arrays created per frame; `dtSec` is the same clamp the
  villagers layer uses.
- **Nil-safety while layers are lazy.** `focusVillager` only stores an id; the ease reads sim
  state, never the lazily-created `villagers`/rigs, so it works even if called before the first
  `render()` has created the layers.

### Implementation (as landed)

```ts
const FOCUS_EASE_PER_SEC = 3.5;
const FOCUS_ARRIVE_EPS = 0.4; // u — inside this dead-zone the ease idles (never snaps)
const FOCUS_RADIUS_MAX = 8; // u — clamp around the village centre (the origin / campfire)
```

```ts
      if (focusId !== null) {
        const roster = state.villagers;
        for (let i = 0; i < roster.length; i += 1) {
          const villager = roster[i];
          if (villager === undefined || villager.id !== focusId) continue;
          let fx = villager.pos.x;
          let fz = villager.pos.z;
          const centreDist = Math.hypot(fx, fz);
          if (centreDist > FOCUS_RADIUS_MAX) {
            const clampScale = FOCUS_RADIUS_MAX / centreDist;
            fx *= clampScale;
            fz *= clampScale;
          }
          const dx = fx - controls.target.x;
          const dz = fz - controls.target.z;
          if (Math.hypot(dx, dz) > FOCUS_ARRIVE_EPS) {
            const dtSec = Math.min(Math.max(dtMs, 0), 100) / 1000;
            const blend = 1 - Math.exp(-FOCUS_EASE_PER_SEC * dtSec);
            const stepX = dx * blend;
            const stepZ = dz * blend;
            controls.target.x += stepX;
            controls.target.z += stepZ;
            camera.position.x += stepX;
            camera.position.z += stepZ;
          }
          break;
        }
      }
      controls.update();
```

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 (pre-existing chunk-size warning for the three.js bundle, unrelated) |
| `pnpm test` | exit 0 — 10 files, **180/180** passed |

Baseline note: an intermediate run caught a concurrently-edited `src/ui/derive.ts` mid-flight
(`delightText is not defined`, 4 failures in another agent's new UI tests); I did not touch it,
and after that agent's edit landed the full suite passed above. Excluding that file, 9/9 files and
all pre-existing tests were green throughout.

## Interpretation call (worth an orchestrator glance)

"Orientation and offset untouched" is implemented as *translate target + camera together*: the
OrbitControls offset is re-derived as `camera.position - target` on every `update()`, so mutating
the target alone would leave the camera in place and pivot it (`lookAt(target)`), changing
orientation. Translating both by the same step preserves view direction and orbit distance
exactly, which is the classic gentle focus glide. The target's approach is identical either way;
if the intended effect was a pivot-in-place, only the two `camera.position` lines would drop.

## Live-check pointers for the orchestrator

1. Click a walking villager → the view glides so the villager sits under the orbit pivot within
   ~0.5–1 s, no jump, no zoom/pitch change.
2. Press-drag mid-ease → ease stops instantly and the orbit proceeds from wherever the camera is
   (no snap-back).
3. `Escape` / outside click (UI dismissal) and a ground/structure click → ease cancels.
4. Far-tree villager (r > 8) → target settles at the r = 8 rim toward them, not on them.
5. Re-select a villager who is within 0.4 u of the target → no visible motion (dead-zone).

## Known gaps / concerns

1. **No live-browser validation** in this task (per brief: no `pnpm dev`/browser); verified by
   tsc/build/test + code inspection only. The ease is pure `render()` arithmetic on top of the
   existing `controls.update()`, so the blast radius is small.
2. **DESIGN.md needs no change** — §3 already lists `focusVillager(villagerId: string | null): void`
   (line 128), and the implementation matches it exactly.
3. `window.__cozy` does not expose `focusVillager`; not part of the contract, so omitted.
