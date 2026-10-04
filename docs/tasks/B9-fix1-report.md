# B9-fix1 Report — sim + persist batch (I1–I4, M3–M7 sim parts)

**Status: DONE except M3's acceptance threshold, which is unsatisfiable as specified (see §M3). Nothing committed.**
**Date:** 2026-10-05

Scope: `src/sim/**` + `src/persist/**` only, per DESIGN.md §3/§3.2 (updated). No other files touched.

## What was implemented

### I1 — out-of-tick events (`src/sim/types.ts`, `src/sim/index.ts`)
- `GameState` gains `pendingEvents: SimEvent[]` (DESIGN §3 contract).
- `createInitialState` fills `pendingEvents: []`.
- `buildStructure` pushes `built` to `pendingEvents` instead of `events`.
- `tick()` starts with `state.events = state.pendingEvents.slice(); state.pendingEvents.length = 0;`
  before appending this tick's events — consumers (e.g. B8's `built` SFX) never miss them.
- Test: `food.test.ts` build test now asserts `pendingEvents` immediately + `events` on the next
  tick with the queue emptied.

### I2 — stranded log (`src/sim/index.ts` → `assignTask`)
- If `villager.carrying` and the new task is not `'tend'` → `carrying = false`, `wood + 1`
  (settle first, then proceed through the normal assignment logic, including the `null` path).
- Tests (`fire.test.ts`): carrying keeper → `chop` refunds (wood 0→1, walking to chop);
  carrying keeper → `null` refunds and idles.

### I3 — universal flame-avoiding arc (`src/sim/index.ts` → `walk`)
- For **non-campfire** targets, after computing the steering target, the straight chord
  `villager.pos → target` is measured against the campfire centre (new `segmentDistance`
  helper, clamped projection, degenerate-safe). If it passes within **1.1**
  (`FIRE_AVOID_RADIUS`), steering goes via the bisector point on the r = 2.2 ring first
  (reuses `REST_ARC_RADIUS` / `signedAngDiff`; recomputed every tick, deterministic, no new
  state). Campfire-bound legs keep the existing ring-spot arrival + arc, untouched.
- Tests: tend-outbound (spawn→woodpile until log taken) and cook (spawn→pot until working)
  tracked per tick for **all 8 villagers** → min fire distance > 1.0 in every case.
  Control run with the bend disabled reproduced B9's numbers (cook walks dipping to 0.88).

### I4 — cook affordability per iteration (`src/sim/index.ts` → `work`)
- The berries/wood check moved **inside** `while (progressMs >= COOK_CHANNEL_MS)`; when dry
  mid-loop → idle + task cleared (+ `targetNodeId`/`progressMs` reset, as before).
- Test: `tick(state, 60000)` with 3 berries / 1 wood ends berries 0, wood 0, meals **1**,
  cook idle (was: −57/−19/20, still working).

### M3 — structure arrival slots (`src/sim/index.ts` → `walk`)
- Structure targets (`pot`, `woodpile` — resolved by id, any structure kind) arrive at
  `workSpot(center, villagerIndex)` (r = 0.75), straight steering subject to the I3 bend.
- Required consistency fix in `tendKeeper` (leg selection unchanged): the woodpile fetch leg
  now measures proximity against the same slot `walk()` arrives at. Without this the keeper
  stalls at the pile edge in `working` without ever taking the log (centre-disk entered before
  slot-disk → `walk()` never runs again → deadlock), symmetrically to the round-4 campfire fix.
- Test + **acceptance conflict** — see §M3 below.

### M7 — full-belly guard (`src/sim/index.ts` → rest arrival, `src/sim/tasks.ts`)
- Eat only when `fuel ≥ 33 && pot.meals > 0 && fedMs < FED_FULL_BELLY_MS (30000)`; otherwise a
  normal fire-state rest (no consumption, no `eat` event).
- Tests: `fedMs = 55000` rests 4000 ms with the meal untouched and no `eat`; `fedMs = 29999`
  (boundary, decay-safe downward only) still eats.

### M4 — stricter `loadGame` shape check (`src/persist/index.ts`)
- `isPlausibleState` additionally requires: `fire.fuel`/`fire.max` numbers, `gardenMs` number,
  `pendingEvents` array, and per villager `restMs`/`fedMs` numbers, `carrying` boolean,
  `task` string-or-null, `state` string. Anything else → null (never throws, unchanged).
- Tests (`src/persist/index.test.ts`): non-numeric fuel, non-numeric `gardenMs`, missing
  `pendingEvents`, villager missing `restMs`, non-boolean `carrying` → null; valid `task: null`
  still loads.

### M5 — stale comment (`src/sim/tasks.ts`)
- `restDuration` doc: "Evaluated against the live fire each tick" → "Evaluated once, at rest
  start, and committed to the villager's restMs." Code unchanged (it was already correct).

### M6 — `STRUCTURE_COST` source of truth (`src/sim/index.ts`)
- `export const STRUCTURE_COST: Readonly<Record<StructureKind, { wood: number; berries: number }>>`
  from `src/sim/index.ts`, aliased off the `tasks.ts` table (woodpile {0,0} included).
  Internal use (`buildStructure`) reads through the same binding. UI import is Fix-2's job —
  `src/ui/index.ts` untouched.

## §M3 — acceptance threshold unsatisfiable as specified (evidence, no implementation freedom left)

The mandated test ("all 8 cooks settle with pairwise separation ≥ 0.45") **fails at 0.4187**
(deterministic, default seed). This is not an implementation bug — it is slot geometry:

- 8 golden-angle points (2.399963 rad) on an r = 0.75 ring have minimum angular gap 32.46°
  (pairs v7/v2, v8/v3, v6/v1) → minimum slot chord **2·0.75·sin(16.23°) = 0.4192 < 0.45**.
- All cooks share one pot, so unlike the chop case (B1 fixed it via distinct nearest trees)
  sharing is unavoidable; approach rays from the village to the pot at (30°, r = 5.2) are
  near-radial, so stop offsets (≈0.34–0.45 short of each slot) stay near-parallel and the
  settled separation lands at ≈ slot separation.
- Measured min pair across step sizes 25/50/100 ms: 0.4158 / 0.4187 / 0.4187 — robustly ~0.42.
  With the I3 bend disabled the result is **identical** (0.4187), so the bend is not the cause.
- Even snapping exactly onto slots would give 0.4192 < 0.45. Nothing within the mandated
  implementation (r = 0.75, golden angle, arrival 0.45, array-index slots) can clear 0.45.
- Note the settled 0.42 still exceeds body width (~0.34): no visual clipping, just under the
  transplanted 0.45 bar.

**Options for the orchestrator:** (a) accept ≥ 0.40 for the shared-pot case (measured 0.4158+,
thin but deterministic margin); (b) raise the structure slot radius (r = 0.85 → floor 0.475);
(c) restate M3 as no-stacking (≥ body width). The implementation itself needs no change —
only the bar. The test is committed at the mandated ≥ 0.45 so the conflict stays visible.

## Files changed

| File | Change |
|---|---|
| `src/sim/types.ts` | `GameState.pendingEvents` + events-comment update |
| `src/sim/index.ts` | I1 (queue/flush), I2 (log settle), I3 (chord bend + helper + const), M3 (structure slots; keeper fetch-leg alignment), I4 (in-loop cook check), M7 (belly guard), M6 (`STRUCTURE_COST` export) |
| `src/sim/tasks.ts` | M5 comment fix; `FED_FULL_BELLY_MS = 30000` |
| `src/sim/food.test.ts` | I1 contract update; new I4 ledger, M3 separation, I3 cook-arc, M7 guard + boundary tests |
| `src/sim/fire.test.ts` | New I2 refund ×2, I3 outbound-arc (all 8) tests |
| `src/persist/index.ts` | M4 shape check |
| `src/persist/index.test.ts` | New M4 malformed-shape tests |
| `docs/tasks/B9-fix1-report.md` | This file (new) |

## Verification

- `pnpm exec tsc --noEmit` — clean.
- `pnpm build` — ✓ (tsc + vite; only the pre-existing three.js chunk-size warning).
- `pnpm test` — **61/62 passing**: all 51 pre-existing tests green (contracts updated per DESIGN:
  one `built`-event assertion), 10 of 11 new tests green; the single failure is the new M3
  separation test at the mandated ≥ 0.45 bar (measured 0.4187, floor math §M3 above).
- No `Math.random`/clocks in `sim/`; determinism tests untouched and green.

## Micro-round: ruling option (b) — `STRUCTURE_SLOT_RADIUS = 0.85` (NOT sufficient, measured)

Per the ruling, structures got their own ring: `STRUCTURE_SLOT_RADIUS = 0.85` +
`structureSpot(structurePos, villagerIndex)` in `tasks.ts` (`WORK_SLOT_RADIUS` stays 0.75
for nodes); `walk()` structure arrivals and the keeper woodpile fetch-leg proximity re-pointed
at the 0.85 slot; everything else from fix1 byte-identical. M3 test kept at the mandated ≥ 0.45.

**Result: still fails — 0.3896 at 50 ms steps** (same v3/v8 pair; 25 ms → 0.4135,
100 ms → 0.4643). The ruling's floor premise (≈0.475) assumes settlers land *on* slots, but
arrival is stop-within-0.45 (no snap, per the round-1 contract): settled separation =
|Δslot + Δoffsets|, and the stop offsets (magnitude ≤ 0.45, pointing back along each
villager's approach ray) are the same order as the slot spacing, so they dominate. Measured
offsets for the pair: (−0.358, +0.059) vs (−0.174, −0.302) — difference 0.405 anti-aligned
with the 0.475 slot gap → 0.3896. Larger radius moved the slots but re-rolled the same
offset luck (at r = 0.75 it happened to net ≈0 net; at 0.85 it subtracts 0.085). Values
straddle the bar across step sizes — no ring radius makes this robust while slop ≈ spacing.

Unchanged from fix1: `tsc` clean, `build` ✓, **61/62** (all 51 pre-existing + 10/11 new green;
sole red is M3 at ≥ 0.45). Body width (~0.34) is still cleared (0.3896), so nothing clips —
only the bar is missed. Further options for the orchestrator: (a) accept ~0.39 for the
shared-pot case; (b2) snap *structure* arrivals exactly onto slots (deterministic 0.4751 ≥
0.45 by construction — but a contract change vs the no-snap rule); (c) restate the bar.
No further radius tuning attempted deliberately — any passing radius would be overfit
geometry luck, as this round demonstrates.

## Micro-round 2 (round 3): tight structure arrival tolerance — PASSES

Per the ruling, the operative variable was the tolerance, not the radius:
`STRUCTURE_SLOT_RADIUS = 0.9`, and structure arrivals use a dedicated
`STRUCTURE_ARRIVAL_DISTANCE = 0.02` (`tasks.ts`, DESIGN §3.2). Because movement clamps to
the remaining distance, the final step lands essentially exactly on the slot, so settled
separation ≈ slot floor chord(0.9, 32.46°) ≈ 0.503. `walk()` carries an `arrivedTol`
(0.45 everywhere except structure slots); the keeper's woodpile fetch-leg proximity uses
the same 0.02. Node arrivals and campfire/rest behaviour unchanged.

Measured 8-cook minimum pairwise separation (default seed): **0.5031 at 25, 50 and
100 ms steps** (same close-slot pair family each time, value identical to 4 decimals —
settlers are on their slots; margin 0.05 over the bar).

Verification: `tsc` clean, `build` ✓, `pnpm test` → **62/62 passing** (6 files).
