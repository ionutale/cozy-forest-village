# N1 Report — Sim: clock, derivations, gathering drift, evening rest stretch

**Status: DONE. No commit. Only `src/sim/**`, the two allowed UI test fixtures, and this file touched.**
**Date:** 2026-10-06

Implemented plan Task N1 steps 1–6 against spec Part 1 and DESIGN.md §3 / §3.2
("Day/night cycle" — binding numbers followed to the letter; no DESIGN.md edits).

## What was implemented

- **`src/sim/clock.ts` (new)** — the batch-8 public numbers and pure derivations:
  - `DAY_MS = 480_000`, `FRESH_START_T = 0.25`.
  - Integer-ms phase boundaries derived to avoid float edges:
    `DAWN_START_MS = DAY_MS*9/100` (43 200), `DAY_START_MS = DAY_MS*22/100` (105 600),
    `DUSK_START_MS = DAY_MS*78/100` (374 400), `NIGHT_START_MS = DAY_MS*91/100` (436 800).
  - `EVENING_REST_SCALE = 1.5`, `WARMING_RADIUS = 2.4`.
  - `dayT(state) = dayMs / DAY_MS`; `dayPhase(state)` lower-inclusive at each boundary
    (night → dawn → day → dusk → night); `dayFactor(state)` = 1 in day, 0 in night,
    smoothstep `t²(3−2t)` up through dawn and down through dusk (exact 0.5 at both
    midpoints, exact 1/0 where each ramp meets its flat stretch).
- **`src/sim/types.ts`** — `Clock { dayMs: number }`; `GameState.clock: Clock`.
- **`src/sim/rng.ts`** — exported `hash01(index, salt)` (the same deterministic formula the
  render layers already carry privately), so sim-side warm-seat jitter needs no RNG stream.
- **`src/sim/index.ts`**:
  - Re-exported the five-name surface `DAY_MS`, `FRESH_START_T`, `dayT`, `dayPhase`,
    `dayFactor`; exported the `Clock` type. `EVENING_REST_SCALE`/`WARMING_RADIUS` stay
    internal (the sim is their only spender).
  - `createInitialState` → `clock: { dayMs: DAY_MS * FRESH_START_T }` (mid-morning).
  - `tick` advances `state.clock.dayMs = (dayMs + dtMs) % DAY_MS` inside the `dtMs > 0`
    region, before the villager loop — one modulo, so a giant dt wraps once and can never
    skip a boundary (nothing is boundary-triggered).
  - **Gathering drift**: at dusk/night an `'idle'`, taskless villager farther than 0.35 u
    from their warm seat is set `'walking'`; `walk()` recognises the drift as
    `state === 'walking' && task === null`, steers to the deterministic seat
    (`angle = (index + 0.5) * 2.399963`, radius `WARMING_RADIUS ± 0.2` via `hash01(index, 101)`)
    at 0.5 × walk speed, and returns to `'idle'` on arrival (no `arrived` event — ambient).
    Lemma: `'walking' + null task` is reachable only via this drift, so the flag is exact.
    No new villager state; `assignTask` is untouched and wins instantly (its retarget path).
  - **Evening rest stretch**: at both `restMs` commit sites in `walk()`'s arrival branch
    (meal rest `EAT_REST_MS`, plain `restDuration(fire)`), multiply by
    `EVENING_REST_SCALE` while `dayPhase` is `'dusk' | 'night'` (×1 at day, so `4000 → 6000`,
    `5500 → 8250`; day values byte-identical). Work/cook/walk/fed timers untouched.
- **`src/sim/daynight.test.ts` (new)** — 10 tests.

## Verification

- `pnpm exec tsc --noEmit` → clean.
- `pnpm build` → ✓ (vite bundle built).
- `pnpm test` → **278/278, 15 files** green (260 baseline + 10 N1 + concurrent N2/N3 additions;
  the two UI fixtures repaired additively, no expectation changes).

N1 test coverage: clock dt-advance + exact single wrap under `DAY_MS * 17`; fresh start at
`DAY_MS * FRESH_START_T`; `dayT` range; phase boundaries at 0/43 199/43 200/105 599/105 600/
374 399/374 400/436 799/436 800; `dayFactor` endpoints + ½ at both ramp midpoints; drift
arrival to the ring (2.0 < r < 3.0) and idle-on-arrival; two seats never overlap (> 0.5);
day-inert (position frozen over 30 s); mid-drift `assignTask` retargets in the same call;
night rests 6000/8250 vs noon 4000/5500.

## Deviations / notes

- The plan's drift sketch said "reuse the arrival-walk machinery"; the drift target is not a
  node, so `walk()` gains a two-line `drifting` branch (target = warm seat, pace 0.5 ×,
  tight 0.05 settle) instead of a separate mover — obstacle/fire avoidance, facing and
  movement stay shared.
- `hash01` did not exist in `src/sim/**` (only private copies in the render layers, one of
  which imports three.js). Added the identical formula to `src/sim/rng.ts` rather than
  importing render code into the pure sim.
- No out-of-scope tsc/test failures were observed this run; the concurrent N2/N3/N4 files
  compiled and passed alongside.

## Files changed

| File | Change |
|---|---|
| `src/sim/clock.ts` | **New** — constants + `dayT`/`dayPhase`/`dayFactor` |
| `src/sim/types.ts` | `Clock` + `GameState.clock` |
| `src/sim/rng.ts` | exported `hash01` |
| `src/sim/index.ts` | init clock, tick advance, gathering drift, rest stretch, surface re-exports |
| `src/sim/daynight.test.ts` | **New** — 10 N1 tests |
| `src/ui/derive.test.ts` | fixture-only: `clock` added to the state factory |
| `src/ui/structure-card.test.ts` | fixture-only: `clock` added to the state factory |
| `docs/tasks/N1-daynight-sim-report.md` | This file (new) |
