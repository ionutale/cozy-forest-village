# F1 — Sim: favors model, chains, offering, completion

Status: **DONE**. All plan steps 1–6 executed; full verification green at the time of writing
(`tsc` / `build` / suite — see Evidence). Changes left uncommitted for the orchestrator.

## Files

| File | Change |
|---|---|
| `src/sim/types.ts` | `FavorWant` / `FavorProgress` / `FavorsState`; `GameState.favors`; `SimEvent.type` += `'favor-start' \| 'favor-done'` |
| `src/sim/favors.ts` | **new** — constants, `createFavors`, `favorWantFor`, `tickFavors` |
| `src/sim/index.ts` | init (`favors: createFavors(villagers.length)`), `tick()` calls `tickFavors` last, public-surface re-exports |
| `src/sim/favors.test.ts` | **new** — 17 tests |
| `docs/tasks/F1-favor-sim-report.md` | this report |

No new deps, no `any`, no `Math.random` / clocks inside `src/sim/**` (grep-verified). No other
files touched.

## What was built (per plan step 3)

- **State:** `byVillager[i] = { step, active, progress }` in roster order; `nextOfferMs` starts at
  `FIRST_OFFER_MS`. `createFavors(count)` is the only factory; `createInitialState` uses the roster
  length.
- **Chain content (`favorWantFor`):** step 0 → `{eat, self, 1}`; step 1 → even `{gather, 6}` /
  odd `{chop, 4}`; step 2 → `index % 3` → `{eat, any, 3}` / `{build, 1}` / `{fire, 120000}`;
  `null` at `step ≥ 3`. `FIRE_WARM_FUEL = FIRE_STEADY` (33), imported, not re-declared.
- **Offering (`tickFavors`):** countdown floored at 0; when 0 and `activeCount < 2`, one uniform
  pick from the eligible list (`!active && step < 3`) via a fresh
  `mulberry32(seed ^ 0x9e3779b9 ^ (completedSteps + activeCount) * 2654435761)` — pure derive,
  documented in-file, no stored RNG. Offer resets `nextOfferMs = NEXT_OFFER_GAP_MS`; if ineligible
  or capped, the countdown holds at 0 and retries each tick. `favor-start` carries `villagerId`.
- **Completion:** per active favor, this tick's `eat` (self = requester only; any = any villager),
  `gather` / `chop` / `built` events, or `dtMs` accumulated while `fuel ≥ 33`. On threshold:
  `step += 1`, `active = false`, `progress = 0`, `nextOfferMs = max(nextOfferMs, GAP)`, exactly one
  `favor-done` with `villagerId`. Step 3 completion retires the villager.
- **Semantics choice (documented in code):** only favors active *before* the offer pass can complete
  on that tick's events / `dt` — a favor opened at the end of a tick cannot instantly consume the
  same tick's history (matters for the fire `+= dtMs` case).
- **Wiring:** `tick()` runs `tickFavors(state, dtMs)` after the villager loop (existing
  non-finite / `dt ≤ 0` early-return path unchanged). Public surface re-exports
  `createFavors` + `FIRST_OFFER_MS` / `NEXT_OFFER_GAP_MS` / `MAX_ACTIVE_FAVORS` / `CHAIN_LENGTH`;
  `tickFavors` / `favorWantFor` stay internal (unit tests import `./favors` directly, like
  `restDuration` from `./tasks`).

## Test coverage (`src/sim/favors.test.ts`, 17 tests)

First offer exactly at 120 000 ms (not before) · same-seed requester identical, seeds 1 vs 2 differ ·
cap of 2 with hold-at-zero retry · eligible-only and active-skipping selection · ≥ 90 000 ms wait
after completion (89 999 ms → none, 90 000 → offer) · `eat/self` ignores other villagers, exactly
one `favor-done`, no re-emission · `eat/any` ×3 · `gather` 6 / `chop` 4 / `build` 1 · fire
accumulates at fuel = 33 exactly, pauses below without losing progress, completes once, cannot
double-fire · one event advances two shared `eat/any` favors +1 each (never ×2) · step 3 retires
(no further offers with nobody eligible) · real end-to-end: a rest-eat through `tick()` completes
the requester's favor · initial state shape + full chain-content table.

## Evidence

| Check | Result |
|---|---|
| `pnpm exec vitest run src/sim` | **7 files / 72 tests passed** (55 pre-existing sim + 17 new) |
| `pnpm test` | **9 files / 138 tests passed, 0 failed** (91 baseline + F1 17 + F2/F3 landed concurrently) |
| `pnpm exec tsc --noEmit` | exit 0, no output |
| `pnpm build` | exit 0 (`tsc` + vite; only the pre-existing >500 kB chunk advisory) |
| grep `src/sim` | no `Math.random` / clocks / `any` types |

Transient note: mid-task, `tsc`/suite failures existed in `src/ui/**` while F3's edits were
in flight (anticipated by F3's plan step 2); they cleared once F3 landed, without fixes from this
task. Nothing outstanding.

## Concerns

None material. Two deliberate, documented behaviors worth the orchestrator's eye:
1. A newly offered favor never consumes the tick it was offered on (events / fire `dt` belong to
   the moment before it existed).
2. With every villager retired, `nextOfferMs` stays at 0 forever (retries harmlessly each tick).
