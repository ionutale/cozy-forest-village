# N4 — Day/night render: glows & ambience

Batch 8 wave N, Task N4 (plan `docs/superpowers/plans/2026-10-06-day-night-cycle.md`, spec Part 4).
Status: **DONE**. Implementer did not commit (orchestrator gates and commits).

## Scope

Files touched (only these):
- `src/render/structures.ts` — lantern glow + hut windows
- `src/render/ambient.ts` — species swap + motes → fireflies
- `docs/tasks/N4-daynight-ambience-report.md` (this file)

No `index.ts` change: both layers already receive `state` each frame. All work is per-frame material
scalars + a shared scratch — allocation-free, as the task required.

## What changed

### 1. Lantern glow (`structures.ts`)
- The lamp globe's material is now a `MeshLambertMaterial` (was `MeshBasicMaterial`), with
  `emissive: '#f6d9a0'` and `emissiveIntensity: 0` at build.
- Every frame: `lampMat.emissiveIntensity = LAMP_GLOW * night` with `LAMP_GLOW = 0.9` and
  `night = 1 − dayFactor(state)`. Exactly `0` by day (`dayFactor === 1` ⇒ `night === 0`), warm
  `#f6d9a0` at full night. The material is shared across every lantern, so this is one write/frame.

### 2. Hut windows (`structures.ts`)
- New `Slot` value `'window'`. Each hut bakes one extra chunk — a single `PlaneGeometry(0.22, 0.2)`
  = 2 tris — on its own shared `windowMat` (dark-glass base `#2f2c33`, `emissive '#ffd9a0'`).
- Placement is against the existing door: local `[0.28, 0.4, 0.505]`, i.e. beside the door on the
  same `+z` front face, `0.005` proud of the wall (the door is sunk deeper) so no z-fighting. Ghost
  huts reuse the chunk under `ghostMat` like every other part.
- Per frame: `windowMat.emissiveIntensity = WINDOW_GLOW * night` with `WINDOW_GLOW = 0.85`; exactly
  `0` by day.

### 3. Species swap (`ambient.ts`)
- **Birds & butterflies**: a smoothstep ramp on `dayFactor` — scale `0` below `SPECIES_FADE_FROM
  = 0.35`, easing to `1` above it — applied to the instance root matrix (`mRoot.scale`), so both
  species shrink away through dusk and return at dawn. No new meshes; species count stays three.
- **Motes → fireflies**: color lerps from `PALETTE.mote` (`#f6e7c6`) toward `#ffe1a0`;
  `opacity = 0.5 × (1 + night × 0.15 × sin(timeSec × 0.9))`; drift speed eases to `×0.6` through an
  integrated `driftSec` clock (so the speed change is continuous, no phase jump). At `night === 0`
  color, opacity and speed are the shipped values exactly. `transparent` was already set at build.
- `update` now uses its `state`/`dtMs` parameters (previously `_state`/`_dtMs`).

## Verification

- `pnpm exec tsc --noEmit` → clean (0 errors).
- `pnpm build` → success (`tsc --noEmit && vite build`, 38 modules, built).
- `pnpm test` → **278 passed (15 files)**, 0 failed. Baseline was 260/260 across 13 files; the
  delta is N1's `daynight.test.ts` and N2's persist additions. No unit tests cover these render
  layers (per the plan) — the orchestrator live-verifies with pinned `dayMs` screenshots.

## Concerns / notes

- **N1 dependency**: N1 (`src/sim/clock.ts`, `dayFactor`) landed mid-task as expected. I worked
  against the agreed interface and re-ran the gate until the tree settled; no `../sim` errors
  remain.
- **Curated offsets**: the window position/size (`x 0.28, y 0.4, plane 0.22×0.2`) and the darkness
  of the glass base are a sane starting position as the brief allowed — they want a look at the
  live pass. The window is deliberately a *single* quad per hut (~2 tris), so it sits on one side of
  the door; if the live review wants symmetry, it is a one-line addition of a mirrored quad.
- **Lantern `PointLight`**: intentionally unchanged (still `LAMP_LIGHT` with the existing slow
  flicker). The task's step 1 scoped the emissive ramp to the globe only.
- **Mote clock**: `driftSec` starts at `0` when the ambient layer is created, so its phase differs
  from the old `timeSec` by a constant offset; the *speed* and all other parameters match exactly at
  day. This is the only way to vary drift speed without a positional jump.

## Fix round — review M1 (night motes denser near the fire)

**Finding M1** (`N-review-report.md`): spec Part 4 asks the night motes to be "slightly denser near
the fire"; the shipped fireflies kept the uniform `r ≤ 20` scatter. The approved plan Step 3 had
dropped the density clause, so the implementation matched the plan but not the spec.

**Fix** (`src/render/ambient.ts` only): a new `MOTE_NIGHT_DENSITY = 0.5` constant and a per-frame
`near = 1 − MOTE_NIGHT_DENSITY × night` factor that scales each mote's **base XZ radius** (the two
`moteBase` horizontal components) when the frame's position is written. The Y column is height, not
fire distance, so it keeps the shipped scatter. The sine drift amplitudes are untouched.

- Deterministic, allocation-free (one extra scalar), and exactly factor `1.0` by day, so the day
  scatter is restored byte-identically (`x × 1` is exact).
- At full night the base scatter is halved: fireflies gather visibly nearer the campfire while the
  existing color / speed / opacity day-night behavior is unchanged.

**Re-verified:** `tsc --noEmit` clean · `pnpm build` success · `pnpm test` **279 passed (15 files)**,
0 failed. (`src/sim/index.ts` was briefly red mid-edit from the concurrent M2 fix; re-ran until the
tree settled — the only failures were never in this file.) No unit tests cover this layer; the
orchestrator re-shoots the night frame.
