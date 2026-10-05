# H1 Report — Sim: hut kind/cost, arrivals queue, fixe cast, `'arriving'` walker

**Status: DONE. No commit. Only `src/sim/**` + this file touched.**
**Date:** 2026-10-05

Implemented plan Task H1 steps 1–5 verbatim against DESIGN.md §3/§3.2 (binding numbers
followed to the letter; no DESIGN.md edits).

## What was implemented

- **`src/sim/types.ts`**: `StructureKind += 'hut'`; `VillagerState += 'arriving'`;
  new `Arrival { structureId: string; inMs: number; castIndex: number }`;
  `GameState.arrivals: Arrival[]`. (`Arrival` re-exported from `src/sim/index.ts` for H2.)
- **`src/sim/tasks.ts`** (where `STRUCTURE_COST` lives): `HUT_RING_RADIUS = 7.6`;
  `HUT_PLOTS` (`hut-1…hut-4` at 45/135/225/315°, positions precomputed);
  `HUT_SETTLE_MS = 90_000`; `VILLAGE_CAP = 12`; `EDGE_SPAWN = { x: 0, z: -12 }`;
  `NEWCOMER_CAST` (Lily `#e3b7c4` · Rowan `#b03a3a` · Sage `#a8bd86` · Wren `#7d6a52`);
  `STRUCTURE_COST.hut = { wood: 30, berries: 10 }`.
- **`src/sim/index.ts`**:
  - Public-surface re-exports `HUT_PLOTS`, `HUT_SETTLE_MS`, `VILLAGE_CAP`, `NEWCOMER_CAST`
    (existing re-export idiom; expected by H2/H3/H4).
  - `createInitialState`: `arrivals: []` + the four `HUT_PLOTS` structures appended unbuilt
    (kind `'hut'`).
  - `buildStructure`: after a hut's `built` emission, pushes
    `{ structureId, inMs: HUT_SETTLE_MS, castIndex: (villagers.length − 8) + arrivals.length }`
    (frozen at schedule time, completion order preserved — sequential calls index 0, 1).
  - `tick`: arrivals processed after the garden block, before the villager loop (dt-gated like
    every other time system): countdown floored at 0 via `Math.max`; at 0, in queue order —
    cap guard (`villagers.length >= VILLAGE_CAP` → drop) → append newcomer
    (`id 'v'+(len+1)`, cast row, `state 'arriving'`, fresh `pos` at `EDGE_SPAWN`,
    `targetNodeId` = hut, all progress fields zero) + fresh favor record
    `{ step: 0, active: false, progress: 0 }` (arrays never desync) → remove entry.
    Out-of-range `castIndex` also drops defensively (unreachable by construction).
  - `walk`: `'arriving'` handled in the state switch (reuses the walk); hut targets resolve
    through the existing structure branch (structure slot r = 0.9, 0.02 tolerance, trunk
    avoidance, fire arc — all unchanged); arrival flips `'arriving'` → `'idle'`
    (task stays `null`).
  - `assignTask`: early no-op while `'arriving'` (before the carrying settle; newcomers
    never carry).

## Verification & measurement (`src/sim/huts.test.ts`, 9 new tests)

- Scheduling: frozen `castIndex`/90 s; two huts one tick → `[hut-2, 0], [hut-1, 1]`.
- Firing: 89 s stream holds, 90th s fires v9 Lily at the edge with favor record appended
  same tick (lengths 9/9).
- Refusal: all six assigns (incl. `null`) leave task/state/target untouched.
- Walk-in (hut-3): reaches the v9 slot **exactly** (0.0000), flips to `idle`, task null;
  detour gate engaged 21 ticks, **min non-target trunk 0.620** (bar 0.57), min fire 6.803.
- Second hut → castIndex 1 → v10 Rowan → hut-2 + favor length 10; synthetic 12-villager
  state drops a pending arrival with no v13 and an untouched favor board.
- Gates: `tsc` clean on all sim files; vite build ✓; **209/209 tests green**
  (180 baseline + 9 H1 + concurrent H2/H4 additions). Pre-existing sim assertions updated
  for the new shape only (`structures` 7→11 in `fire`/`food` tests).

## Out-of-scope notes (not fixed — other tasks' files)

- `tsc` still reports 2 errors, both in H3's test files (`derive.test.ts:55`,
  `structure-card.test.ts:109`: mock states type `arrivals?` as optional). Runtime suite is
  209/209; H3 owns those files. H2's persist errors and H4's render errors cleared the moment
  this task's surface landed.
- One transient `vite build` failure mid-session was H3 mid-edit; re-ran clean.

## Files changed

| File | Change |
|---|---|
| `src/sim/types.ts` | `'hut'`, `'arriving'`, `Arrival`, `GameState.arrivals` |
| `src/sim/tasks.ts` | hut ring/plots/settle/cap/spawn/cast constants, `STRUCTURE_COST.hut` |
| `src/sim/index.ts` | init plots + queue, build scheduling, tick firing, walk/assignTask, 4 re-exports |
| `src/sim/huts.test.ts` | **New** — 9 H1 tests |
| `src/sim/fire.test.ts`, `src/sim/food.test.ts` | `structures` length 7→11 (+hut assertions) |
| `docs/tasks/H1-huts-sim-report.md` | This file (new) |
