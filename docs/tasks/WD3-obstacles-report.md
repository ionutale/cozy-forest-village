# WD3 Report — obstacle-aware walking around tree trunks

**Status: DONE. No commit. Only `src/sim/**` + this file touched.**
**Date:** 2026-10-05

## What was implemented (`src/sim/index.ts`, `src/sim/tasks.ts`)

While walking, villagers now steer around tree trunks (trunks only — bushes stay
walkable-adjacent). The mechanism extends the existing steering system (fire-arc /
work-slot idiom), recomputed every tick with no new state fields:

1. **Trunk data source.** Sim nodes carry positions but no radius, so the constant is
   derived from the render sizes: render trunkGeo is `CylinderGeometry(0.26, 0.36, …)`
   with per-trunk scale 0.9–1.15 (`src/render/environment.ts:58,71-74`) → max visual
   footprint 0.36 × 1.15 ≈ 0.414, rounded up to **`TRUNK_RADIUS = 0.42`** (`tasks.ts`).
2. **Detour check.** After the existing fire-arc steering, `walk()` tests the segment
   villager → steering target against every `kind === 'tree'` circle within
   **`TRUNK_CLEAR_RADIUS` (0.62 = 0.42 + 0.2)** and steers to a deterministic
   **tangent-offset waypoint** around the nearest blocking trunk
   (`avoidTrunks` — tangent point nearer the steering target, exact ties prefer +;
   radial push-out if ever inside clearance). Next tick recomputes; arrival stays
   purely distance-based, so detours can never wedge the FSM.
3. **Contract preservation.**
   - The destination node's own trunk is excluded (walkers must reach its work slots).
   - Endgame: within **`OBSTACLE_ENDGAME_RADIUS` (1.0)** of the arrival point, steering
     goes direct — neighbour trunks sit ≥ 1.75 from work slots (2.5 min gap), so the
     0.45/0.02 slot landings stay exact (M3 cook test still measures 0.5031).
   - Campfire legs are structurally unaffected: village chords stay within r ≈ 4.5 of
     the fire while trunks grow at r ≥ 7.5, so the rest arcs are untouched and no
     detour can re-clip the fire ring (forest→rest legs detour only out at r ≥ 7.5).
   - Deterministic, pure over state; per-tick cost is ~40 cheap segment tests per
     walker, allocating only on ticks that actually detour (same style as the
     existing `restSpot`/`workSpot` temporaries).

## Verification & measurement

- `pnpm exec tsc --noEmit` clean, `pnpm build` ✓, `pnpm test` → **66/66** (63 pre-existing
  green **unchanged**, +3 new in `src/sim/obstacles.test.ts`).
- **(a)** Head-on construction (blocker dead on the chord, start 4 u past it): min
  non-target-trunk distance **0.620 on seeds 1–3** (= the clearance circle, by design;
  bar is 0.57) with arrival reached every time. Same setup with the detour disabled:
  **0.043–0.090** (straight through the trunk) — and the new test fails as it should.
- Sweep: 80 natural chop walks (seeds 1–10 × 8 villagers) + 5 forest→rest walks — all
  arrived, no stuck oscillation, worst non-target approach 2.037 (natural walks rarely
  engage; the forced cases above are the real proof), forest→rest min fire > 1.0.
- **(b)** all 63 existing tests pass unmodified. **(c)** new explicit test: scripted
  chop/berries/rest/tend play, per-tick position snapshots over 200 ticks, run twice →
  identical; plus detour-trace equality on the head-on walk.

## Proposed DESIGN §3.2 wording (orchestrator to apply — no DESIGN.md edits made)

> - **Trunk obstacles** (`TRUNK_RADIUS` 0.42, from the render trunk footprint): while
>   walking, any leg whose straight chord to its steering target passes within 0.62 of
>   a non-destination trunk centre bends via a deterministic tangent waypoint around the
>   nearest such trunk, recomputed every tick with no extra state. The destination
>   node's own trunk is never an obstacle, and within 1.0 of the arrival point steering
>   goes direct so slot landings stay exact. Bushes are walkable-adjacent (no avoidance).

## Files changed

| File | Change |
|---|---|
| `src/sim/tasks.ts` | `TRUNK_RADIUS`, `TRUNK_CLEAR_RADIUS`, `OBSTACLE_ENDGAME_RADIUS` |
| `src/sim/index.ts` | `avoidTrunks` + one hook in `walk()`; `segmentDistance` reused |
| `src/sim/obstacles.test.ts` | **New** — 3 WD3 tests (avoidance ×4 crossings, detour determinism, walk determinism) |
| `docs/tasks/WD3-obstacles-report.md` | This file (new) |
