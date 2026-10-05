# F2 Report — Persist: schema v2 + additive v1 → v2 migration

**Status: DONE**
**Model:** deepseek-v4.1-flash
**Date:** 2026-10-05
**Plan:** `docs/superpowers/plans/2026-10-05-villager-favors.md` → Task F2
**Spec:** `docs/superpowers/specs/2026-10-05-villager-favors-design.md` → Part 5

## What was implemented

### `src/persist/index.ts`
- `VERSION = 2` (v2 = v1 + `favors`); `saveGame` always writes v2.
- `type V1GameState = Omit<GameState, 'favors'>` — the pre-favors schema.
- Split validation:
  - `isPlausibleV1State` — the existing B3 shallow checks (containers, fire/garden
    numbers, `pendingEvents`, per-villager activity fields), unchanged in substance.
  - `isPlausibleFavors` (new) — `byVillager` is an array of exactly `villagers.length`
    progress records, each with boolean `active` and finite `step` / `progress`;
    `nextOfferMs` finite. Wrong shape → `null` → fresh game (existing behavior).
  - `isPlausibleState` (v2) = v1 shape + plausible favors block.
- `loadGame` dispatch, still fully defensive (never throws, any failure → `null`):
  - `version === 2` → full shape check → return.
  - `version === 1` → v1 shape check → return `{ ...state, favors: createFavors(state.villagers.length) }`
    (spec Part 5 migration: village untouched, chains start fresh —
    `byVillager` all `{ step: 0, active: false, progress: 0 }`, `nextOfferMs = FIRST_OFFER_MS`).
  - anything else → `null`.
- Consumes `createFavors` (`../sim` value) and `FavorsState`, `GameState` (`../sim` types)
  from Task F1's public surface only. No `any`.

### `src/persist/index.test.ts` (extended, 7 new tests)
1. **v2 round-trip with an active favor** — save (asserts written `version === 2`), reload gives
   deep-equal state incl. `byVillager[0] = { step: 1, active: true, progress: 3 }` and
   `nextOfferMs = 12345` (Review Focus 1: reload mid-favor).
2. **v1 migration, handcrafted v1 blob** (no `favors` key) — tick / seed / resources / villager
   task+progress / fire / pot / gardenMs intact; `favors.byVillager` = one fresh record;
   `nextOfferMs === FIRST_OFFER_MS` (Review Focus 3: no instant offer).
3. v1 blob that fails the v1 shape check → `null`.
4. v2 with no `favors` block → `null`.
5. v2 with `byVillager` length ≠ roster length → `null`.
6. v2 with a non-finite / non-number favors value (`Infinity`, `NaN`, `'soon'`) → `null`.
7. v2 with non-record `byVillager` entries → `null`.

All pre-existing persist tests stay green (`VERSION` moved to 2; the "wrong version" test uses
`VERSION + 1` and still rejects).

## Files changed

| File | Change |
|---|---|
| `src/persist/index.ts` | `VERSION = 2`; v1/v2 shape checks; v1 → v2 additive migration in `loadGame`; always-write-v2 |
| `src/persist/index.test.ts` | +7 tests (v2 round-trip, migration, favors validation) |
| `docs/tasks/F2-favor-persist-report.md` | this report |

No other files touched (no git commands run).

## Verification

- `pnpm exec vitest run src/persist/index.test.ts` — **18 / 18 passed** (11 existing + 7 new).
- `pnpm exec tsc --noEmit` — **green** (exit 0; verified again after the full wave landed).
- `pnpm build` — **green** (exit 0).
- `pnpm test` — **138 / 138 passed, 9 files** (91 baseline + F1/F2/F3/F4 additions); no failures.
- Interim note: while implementing, F1's `FavorsState` / `createFavors` / `FIRST_OFFER_MS` had not
  landed yet, so the first gates failed only on missing F1 exports; the run was repeated after F1
  landed and all were green. Same for an interim F3 window (UI-only failures); the final snapshot
  above is all-green.

## Concerns

- None. Migration is shallow-by-design (spec Part 5) and rejects only wrong-shaped saves; a
  structurally valid v1 save always migrates without touching the village. `step` is checked as a
  finite number rather than an integer/range, matching the spec's "finite numbers everywhere"
  wording — a hand-corrupted fractional `step` would still load, per the deliberately shallow
  validation discipline.
