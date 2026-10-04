# T02 Report — Pure sim core

Status: **DONE**. All acceptance gates green: `pnpm exec tsc --noEmit` clean,
`pnpm build` succeeds, `pnpm test` → 16/16 passing (3 files).

## Files

| File | Lines | Notes |
|---|---:|---|
| `src/sim/types.ts` | 40 | Edited: brought into exact DESIGN §3 compliance — added `VillagerState`, `Villager.facing`, `SimEvent`, `GameState.events` (T1 stub was missing all four). |
| `src/sim/rng.ts` | 12 | New: `mulberry32(seed)` per brief (replaces T1's LCG). |
| `src/sim/world.ts` | 55 | New: campfire at origin + 40 trees / 20 bushes, annulus r=6…28, rejection sampling, min gap 1.8, 12 tries (T1 approach, mulberry32-fed). |
| `src/sim/villagers.ts` | 33 | New: fixed 8-name roster, hat colors in order, spawn ring r=2.4…4.2, `facing: 0`. |
| `src/sim/tasks.ts` | 43 | New: `TASK_KIND` map, `nearestNode` (squared distance, ties by id ascending), binding constants (2.2 u/s, 0.45, 1400 ms, 4000 ms). |
| `src/sim/index.ts` | 150 | Rewritten: `createInitialState`, `assignTask`, `tick` + FSM (`walk`/`work`/`rest`), re-exports per DESIGN §3. |
| `src/sim/rng.test.ts` | 27 | New. |
| `src/sim/sim.test.ts` | 198 | New (replaces deleted `src/sim/index.test.ts`). |
| `src/sim/behavior.test.ts` | 83 | New: events lifecycle, facing, arrival boundary, end-to-end determinism. |
| `src/sim/index.test.ts` | — | Deleted (superseded). |

No files outside `src/sim/**` were touched. No new dependencies. No `any`,
no `@ts-ignore`. No `Math.random`/`Date`/timers in `src/sim/` (grep-verified).

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | Exit 0, no output (strict clean: `noUncheckedIndexedAccess`, `noUnusedLocals`, `verbatimModuleSyntax`, …). |
| `pnpm test` | Exit 0 — 3 files, 16 tests passed (146–156 ms). |
| `pnpm build` | Exit 0 — tsc + vite build; only the pre-existing >500 kB chunk warning (three.js bundle, unrelated to T02). |

## Test list (name → what it proves)

**`rng.test.ts`**
- `mulberry32 > produces the same sequence for the same seed` — determinism of the PRNG.
- `mulberry32 > produces different sequences for different seeds` — seed sensitivity.
- `mulberry32 > stays within [0, 1) …` — output range over 1000 draws.

**`sim.test.ts`**
- `createInitialState > is deterministic and matches the fixed shape` — two calls deep-equal; 8 villagers `v1…v8`, roster names/hat colors in order, all idle/null-target/`facing: 0`; 61 nodes (40/20/1); counters and `events` zeroed.
- `createInitialState > gives different seeds different worlds` — seed actually drives layout.
- `assignTask > targets the nearest node of the mapped kind and walks` — `chop`/`berries` → `walking` with `targetNodeId` equal to an independently recomputed nearest-node oracle.
- `assignTask > null stops …; unknown id is a no-op` — `null` → idle + target cleared; unknown id changes nothing.
- `walk → work > chop: reaches the tree, then +1 wood per 1400 ms` — arrival event, position within 0.45 of the node, exactly +1 wood after 1400 ms of work and +2 after 2800 ms (100 ms steps), `chop` event with villagerId.
- `walk → work > berries: …` — same for bushes with `gather` events and the berries counter.
- `rest > walks to the campfire, rests 4000 ms, then idles with one rest-done` — `resting` at the campfire, still resting at 3900 ms, at 4000 ms → `idle`, `task` null, target cleared, exactly one `rest-done` event.
- `reassignment > mid-walk retargets immediately; assignTask(null) stops` — new `targetNodeId` (nearest bush), still `walking`; `null` → idle.
- `tick with dtMs = 0 > is a safe no-op` — positions unchanged, no NaN, `tick` counter still increments per DESIGN §3 ("increments once per tick() call").

**`behavior.test.ts`**
- `events lifecycle > clears events at the start of each tick before appending` — a yield tick's `events` equal exactly `[{type:'chop', villagerId}]`; the next (non-yield) tick starts empty.
- `facing > is atan2(dx, dz) of the pre-move delta while walking; 0 when idle` — three.js convention verified against the pre-move delta; idle spawn facing is 0.
- `arrival boundary > arrives when the remaining distance drops to ≤ 0.45` — placed 0.68 from a tree: after one 100 ms step (0.22) still `walking` (0.46 > 0.45), after the second `working` (0.24 ≤ 0.45) with an `arrived` event.
- `determinism > identical seed + identical call sequence → deep-equal state` — two fresh states (seed 7) through an identical 10 s script of assigns/ticks end deep-equal (positions, resources, events).

## Design decisions / spec ambiguities resolved

1. **Work/rest accumulators are not on the public `Villager`.** DESIGN §3's
   `Villager` shape is the contract, so per-villager `workMs`/`restMs` live in a
   module-level `WeakMap<Villager, Accum>` keyed by object identity. The public
   `GameState` stays byte-for-byte the DESIGN §3 shape; two fresh states never
   share accumulators (different objects), which the determinism test relies on.
2. **No position snap on arrival.** The spec defines arrival as distance ≤ 0.45
   and never mentions snapping, so the villager stops where they are (movement is
   clamped to `min(step, dist)` to avoid overshoot). They end up within
   `[0, 0.45]` of the node — close enough for render, literal to the spec.
3. **`tick(state, 0)` still increments `tick` and clears `events`.** DESIGN §3
   says tick "increments once per tick() call" and events clear "at the start of
   each tick"; the brief's "no-op" is read as "no simulation movement" (its own
   parenthetical: "no NaN, positions unchanged"). Negative/NaN dt is treated the
   same defensive way (`!(dtMs > 0)`), so NaN can never reach positions.
4. **Tie-break in `nearestNode` is lexicographic on node id** (the literal
   reading of "node id ascending" for string ids). Exact squared-distance ties
   are measure-zero in floating point, so this is belt-and-braces.
5. **`assignTask` to any non-null task always re-walks**, per brief behavior
   rule 2 ("unless null → `state: 'walking'`", unqualified) — this also makes
   mid-work reassignment retarget coherently.
6. **T1's LCG replaced by `mulberry32`** as the brief mandates; world scatter and
   spawn-ring approach unchanged, so the village layout algorithm is identical,
   only the random stream differs.

## Deviations

None from the brief or DESIGN §3.1. The only edit outside new files was
`src/sim/types.ts`, which T02 owns — and the edit *adds* the missing DESIGN §3
contract fields (`facing`, `events`, `SimEvent`, `VillagerState`) that the T1
stub had omitted.

## Known gaps

- Slice-1 scope per DESIGN §3.1: nodes never deplete, no needs/relationships,
  no save/load. Out of scope by design.
- `walk` has a defensive branch for a missing target node (cannot occur with
  the fixed 61-node world; kept so corrupted state can never wedge the FSM or
  produce NaN).
- Render-side concerns (villager overlap at a shared node, walk bobbing) are T4's
  problem; the sim guarantees only the §3.1 invariants.

## Round 1 — orchestrator finding F1 (must-fix, resolved)

**F1: module-level `WeakMap` accumulators broke "GameState is the single source
of truth"** (serialization, replay, debugging). Fixed by moving the timers into
the public state:

- `Villager` gains `progressMs: number` — ms accumulated in the current
  activity (work yield timer / rest timer); `0` while idle or walking.
  (DESIGN §3 and §3.1 now document this field.)
- `createInitialState` → every villager spawns with `progressMs: 0`.
- `assignTask(...)` resets `progressMs` to `0` on every assignment, including
  `null`.
- Arrival resets `progressMs` to `0` before entering `working`/`resting`.
- `work`/`rest` accumulate into `villager.progressMs`; `work` keeps the
  remainder across yields (`progressMs -= 1400` per yield), `rest` resets to
  `0` on completion.
- `WeakMap`, `accOf`, `resetAcc` deleted entirely — no hidden per-object state
  remains; `GameState` is fully JSON-serializable.

Tests updated/added:
- Initial-state shape test now asserts `progressMs === 0` for every villager.
- New `serializability > survives a JSON round-trip mid-work and stays in
  lockstep`: mid-work on a chop (`progressMs = 700`), `JSON.parse(JSON.stringify(state))`,
  then both original and copy ticked identically for two yield periods —
  resources match (2 wood each) and both produced the same events.

Re-verified: `pnpm exec tsc --noEmit` clean, `pnpm build` ✓, `pnpm test` →
17/17 passing (3 files).

## Round 2 — live-playtest field bug (fixed)

**Bug: resting villagers stood inside the campfire ring.** The campfire node sits
at the ring centre and `ARRIVAL_DISTANCE` (0.45) is smaller than the ring radius
(0.92), so villagers parked ~0.43 from the fire, visually overlapping the flame.

Fix (DESIGN §3.1 updated to match):
- `src/sim/tasks.ts`: added `REST_RING_RADIUS = 1.6` alongside the other binding
  constants, plus `restSpot(campfirePos, villagerIndex)` — the rest target point
  = campfire position + `(cos a, sin a) × 1.6` with
  `a = villagerIndex × 2.399963` (golden angle). Deterministic; spreads the 8
  villagers evenly around the fire.
- `src/sim/index.ts`: `tick` now iterates with the villager's index and passes
  it to `walk`; `walk` moves toward / arrives at (≤ `ARRIVAL_DISTANCE`) the
  ring spot when `task === 'rest'`, all non-rest behavior unchanged.
  `targetNodeId` stays `'campfire'`; `facing` points toward the spot; the
  `arrived` event still fires on arrival.

Tests:
- `rest ring > settles on the ring around the campfire, not inside it` — after a
  rest assignment and enough ticks: state `resting`, `targetNodeId` still
  `'campfire'`, distance from the campfire ∈ [1.15, 2.05] (|d − 1.6| ≤ 0.45).
- `rest ring > spreads multiple villagers around the fire` — two villagers on
  rest settle pairwise > 1.0 apart.
- `facing` test updated: expected facing now computed against `restSpot`
  (index 0) instead of the campfire origin.

Re-verified: `pnpm exec tsc --noEmit` clean, `pnpm build` ✓, `pnpm test` →
19/19 passing (3 files).
