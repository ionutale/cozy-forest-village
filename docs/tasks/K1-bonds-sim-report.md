# K1 Report — Sim: bonds module, growth, levels, reunions, the work perk

**Status: DONE. No commit. Only `src/sim/**`, the one fixture break, and this file touched.**
**Date:** 2026-10-06

Implemented plan Task K1 steps 1–5 against the spec Parts 1 + 5 (binding numbers followed to
the letter; no DESIGN.md edits).

## What was implemented

- **`src/sim/bonds.ts` (new)**
  - Constants: `BOND_RADIUS = 3.0`, `BOND_RATE_PER_S = 1`, `BOND_REUNION_GAP_MS = 90_000`,
    `BOND_SCORE_MAX = 100_000`, `FRIEND_PERK_LEVEL = 2`, `FRIEND_PERK_SCALE = 0.9`.
  - `pairIndex(a, b)` — sorts `(min, max)` → `min * 12 + max` (order-independent cell).
  - Levels thresholds 120 / 300 / 720, mapped with `>=` (`119→0, 120→1, 299→1, 300→2,
    719→2, 720→3`).
  - Pure `bondLevelFor(state, a, b)` (roster indices, mirroring `pairIndex`),
    `strongestBondLevel(state, villagerId)`, `bondPartners(state, villagerId)` ordered
    level desc → score desc → roster index asc (level-0 filtered, unknown id safe).
  - `stepBonds(state, dtMs)` — growth `(dtMs/1000) × BOND_RATE_PER_S` per `i < j` pair within
    the radius (capped at `BOND_SCORE_MAX`), gap reset to 0 when close / `+= dtMs` when apart;
    one `bond-up` per level crossing (giant dt emits exactly one, at the reached level); one
    `bond-reunion` when first contact follows a gap `> BOND_REUNION_GAP_MS` (gap reset makes the
    cooldown fall out naturally; a fresh pair with gap 0 never fires a phantom reunion).
    Allocation-free loops, no RNG, no clocks.
  - `hasCloseFriendNear(state, villager)` — true only for a `FRIEND_PERK_LEVEL`-or-better partner
    within `BOND_RADIUS`. Exported from `bonds.ts` for the sim, **not** on the public surface.
- **`src/sim/types.ts`**: `BondLevel = 0 | 1 | 2 | 3`; `BondsState { scores; gapMs }`;
  `SimEvent.type` gains `'bond-up' | 'bond-reunion'`, plus `otherId?: string` and
  `bondLevel?: BondLevel`; `GameState.bonds: BondsState`.
- **`src/sim/index.ts`**
  - Type re-exports `BondLevel`, `BondsState`; public re-exports of the six constants and the
    three helpers (the `STRUCTURE_COST` re-export idiom).
  - `createInitialState`: `bonds` with both arrays length 144, zeroed.
  - `tick`: `stepBonds(state, dtMs)` runs in the `dtMs > 0` region **after** the villager loop
    (positions final) and **before** `tickFavors` (events visible to the favor consumer).
  - `work` (chop/berries): `let period = fedMs > 0 ? 1190 : 1400;` then
    `if (hasCloseFriendNear(state, villager)) period *= FRIEND_PERK_SCALE;` — exactly like the
    well-fed modifier; the cook channel and every other timer are untouched.

## Fixture repair (fixture clause)

- `src/ui/derive.test.ts`: already repaired concurrently by K3 (it owns `bondsLine` and adds a
  `bonds()` fixture helper) — **not touched by K1**.
- `src/ui/structure-card.test.ts`: added `bonds: { scores: 144×0, gapMs: 144×0 }` to the state
  factory (additive; no expectation changes — the H3b/T3b/clock precedent).

## Verification

- `pnpm exec tsc --noEmit` — clean.
- `pnpm build` — clean (tsc + vite build ✓).
- `pnpm test` — **16 files, 309/309 green** (15-file / 282 baseline + 16 K1 tests + 11 concurrent
  K3 tests; K2's persist-bonds changes had landed too and stay green).
- `src/sim/bonds.test.ts` (new, 16 tests): growth exact at 2.9 u / zero at 3.1 u; boundary 2.999
  accrues / 3.001 does not; giant tick caps at `BOND_SCORE_MAX` with one level-3 event;
  thresholds 119/120 · 299/300 · 719/720 + self/unknown → 0; never-decay (score held over 200 s
  apart); `bond-up` once per crossing, silent while a level holds; reunion once after
  `> 90 s` apart with the natural cooldown and no fresh-contact phantom; perk exact
  (`1190 → 1071`, base `1400 → 1260`) and unchanged when far / warming-only / idle; two identical
  fixed-dusk runs deep-equal; newcomers start at zero and join in; favor counting ignores the new
  events; partner ordering pins; fiction pin (fast-forwarded evenings warm the neighbours
  gathered at the fire, strongest ≥ level 2); `stepBonds` guards 0 / NaN / negative dt.

## Concerns

- **DESIGN.md is not amended in the working tree**: `grep -i bond DESIGN.md` finds nothing. The
  task brief called it "freshly amended"; spec Part 7 lists those amendments as orchestrator work.
  No implementation impact — the spec/plan carried every binding number.
- `bondLevelFor(state, a, b)` takes **roster indices** (the `pairIndex` twin); the spec fixes
  `villagerId` only for `strongestBondLevel` / `bondPartners`. All three are pure and covered by
  tests. Flag if the intended signature was villager ids.

## Files changed

| File | Change |
|---|---|
| `src/sim/bonds.ts` | **New** — constants, `pairIndex`, level/partner helpers, `stepBonds`, `hasCloseFriendNear` |
| `src/sim/bonds.test.ts` | **New** — 16 K1 tests |
| `src/sim/types.ts` | `BondLevel`, `BondsState`, event union/payloads, `GameState.bonds` |
| `src/sim/index.ts` | init, tick hook, work-perk multiplier, type + constant/helper re-exports |
| `src/ui/structure-card.test.ts` | Fixture-only: additive `bonds` zero table (no expectation changes) |
| `docs/tasks/K1-bonds-sim-report.md` | This file (new) |

## K1b — public-surface consistency (concern 2 resolved)

`bondLevelFor(state, a, b)` now takes villager **ids** (`string`), matching its sibling helpers and
the DESIGN §3 surface now that the amendment has landed. Both ids resolve through the existing ≤12
linear `indexOf`; the old index-based logic is the private `bondLevelAtIndex` primitive kept for
`strongestBondLevel` / `bondPartners` / `hasCloseFriendNear` / `stepBonds`. Tests updated to pass
ids (self id and an unknown id both read 0). Gate re-run: `tsc` clean · `build` ✓ · **309/309, 16
files** green.
