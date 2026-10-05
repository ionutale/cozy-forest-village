# T1 Report — Sim: visitor schedule, trades, hearty eats, events, constants

**Status: DONE. No commit. Only `src/sim/**` + this file touched.**
**Date:** 2026-10-06

Implemented plan Task T1 steps 1–5 verbatim against the spec Part 1 and DESIGN.md §3/§3.2
("Trader visits", "Hearty meals" — binding numbers followed to the letter; no DESIGN.md edits).

## What was implemented

- **`src/sim/types.ts`**: `Visitor { phase: 'away' | 'visiting'; inMs: number; visitMs: number;
  tradesLeft: number }`; `resources` gains `spices: number`; `SimEvent.type` gains
  `'visitor-arrive' | 'visitor-leave' | 'trade'`; `tradeKind?: 'berries' | 'spice'`;
  `eat` gains `hearty?: boolean`; `GameState.visitor: Visitor`. (`Visitor` re-exported
  from `src/sim/index.ts` for T2.)
- **`src/sim/tasks.ts`** (batch-7 block): `FIRST_VISIT_MS = 240_000`,
  `VISIT_STAY_MS = 120_000`, `NEXT_VISIT_GAP_MS = 360_000`, `TRADER_WALK_MS = 6_000`,
  `TRADES_PER_VISIT = 3`, `HEARTY_FED_MS = 90_000`, plus internal trade rates
  (`TRADE_WOOD_COST/YIELD = 5/4`, `TRADE_BERRY_COST = 6`).
- **`src/sim/index.ts`**:
  - Public-surface re-exports of the six binding constants (existing re-export idiom).
  - `createInitialState`: `spices: 0`, away visitor
    (`inMs: FIRST_VISIT_MS`, `visitMs: 0`, `tradesLeft: 0`).
  - `tick`: schedule steps after the arrivals block, before the villager loop (dt-gated
    like every other time system). Away counts down (floored) → visiting with
    `inMs = VISIT_STAY_MS`, `visitMs = 0`, `tradesLeft = 3`, one `visitor-arrive`;
    visiting accumulates `visitMs`, counts down → away with `inMs = NEXT_VISIT_GAP_MS`,
    one `visitor-leave`. Single-shot transitions per tick — a giant dt crosses at most
    one boundary, so phases/events never double-fire.
  - `trade(state, kind)`: refuses (false, nothing touched) unless visiting, stock left,
    and affordable; otherwise exact deltas, `tradesLeft -= 1`, returns true. One trade
    per call by construction. **Note for T3:** the `trade` event queues to
    `pendingEvents` (same register as `buildStructure` — this runs out-of-tick), so it
    is observable in `events` on the next tick, not synchronously.
  - Hearty eat branch: with spices on hand the eater also consumes 1 spice,
    `fedMs = HEARTY_FED_MS`, `eat` carries `hearty: true`; otherwise the existing 60 000
    path. Rest duration, full-belly guard, and favor counting (matches on `type: 'eat'`)
    untouched.

## Verification (`src/sim/visitor.test.ts`, 12 new tests)

- Schedule: away/240000 initial; arrival at exactly 240 000 ms; 120 000 ms stay then
  leave with fresh 360 000 ms away timer; `tradesLeft` resets to 3 on the next visit.
- Trades: 5→4 / 6→1 exact deltas with kinded events; refusals (away, short 4/5 stock,
  emptied stock) change nothing; giant ticks fire exactly one arrival / one departure.
- Hearty: spice consumed once, `fedMs` 90 000, `restMs` 5500, `hearty: true`; no-spice
  path byte-identical (`{type:'eat', villagerId}`); an active eat-self favor completes
  on a hearty arrival exactly like a normal eat.
- Gates: `tsc` clean on all sim files; vite bundle builds ✓; suite **247/248**
  (216 baseline + 12 T1 + 20 concurrent additions; one pre-existing sim shape assertion
  updated for `spices`).

## Out-of-scope notes (not fixed — other tasks' files)

- `persist/index.test.ts` v2→v3 "village untouched" expects `resources` to equal
  `{wood:17, berries:0}`; its fixture comes from `createInitialState()`, which now
  additively carries `spices: 0`. One-word fix on T2's side (expect `spices: 0`);
  T2's v4 spices-default work touches the same lines anyway.
- `tsc`/`pnpm build` gate is red only on concurrently-edited T3/T4 files
  (`main.ts` selectTrader, render TraderLayer, ui markup/refs, ui mock states missing
  `spices`) — all outside this task's files, all mid-flight while this task ran
  (their errors changed between runs). No sim/persist-source errors remain.

## Files changed

| File | Change |
|---|---|
| `src/sim/types.ts` | `Visitor`, `resources.spices`, event union/payloads, `GameState.visitor` |
| `src/sim/tasks.ts` | six binding constants + internal trade rates |
| `src/sim/index.ts` | init, tick schedule, `trade` action, hearty branch, 6 re-exports + `Visitor` type |
| `src/sim/visitor.test.ts` | **New** — 12 T1 tests |
| `src/sim/sim.test.ts` | resources shape +`spices: 0` |
| `docs/tasks/T1-traders-sim-report.md` | This file (new) |

## Fix round — review finding M2 (spice half of Review Focus 3)

Added the missing pin (`visitor.test.ts`, hearty-eats block): a `walking` villager parked
0.5 short of its rest spot on its own ray (angular gap 0, so the walk steers straight and
resolves to a rest arrival in one tick), `meals = 1`, fuel 100, `spices = 2`, then a single
300 000 ms tick → `spices === 1`, `meals === 0`, exactly one `eat` carrying `hearty: true`,
`fedMs === HEARTY_FED_MS`. Two deviations from the brief's sketch, both forced by sim
mechanics: (1) a raw spawn spends a giant tick on the approach-arc bisector, never reaching
the spot — the 0.5-short parking (arrival-boundary-test idiom) is what makes it one tick;
(2) a literal 10 000 000 ms tick floors fuel to 0 in the decay step before the walk, so no
eat could fire at all — 300 000 ms still crosses the whole map in one step while leaving
fuel at 34 (≥ 33). No source changes; implementation eats once per arrival by construction.

Verification: `tsc` clean, `build` ✓, 260/260 green (254 baseline + this test + 5
concurrent additions).
