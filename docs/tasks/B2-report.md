# B2 Report — Sim: build API, full structure ring, cook, meals, eat/fed, garden

**Status: DONE**
**Model:** longcat-2.5-preview-free
**Date:** 2026-10-04

## What was implemented

All deliverables from `docs/tasks/B2.md`, per the binding contracts in `DESIGN.md` §3 / §3.2.

### 1. Structure ring (`src/sim/index.ts` → `createInitialState`, `src/sim/tasks.ts`)
- Added the six build spots on the village ring (r = 5.2, angles 30°–330°): `pot`, `bench`,
  `garden`, `lantern-a`, `lantern-b`, `feeder`, each `built: false`. The B1 woodpile is kept.
- `STRUCTURE_RING` / `STRUCTURE_RING_RADIUS` in tasks.ts; `STRUCTURE_COST` per kind
  (pot 20 wood · bench 15 · garden 25 · lantern 10 · feeder 10 wood + 5 berries).

### 2. `buildStructure(state, id)` (`src/sim/index.ts`)
- Spends the cost, sets `built = true`, emits `built` (with `structureId`). Returns false for
  unknown / already built / unaffordable — never partially spends.

### 3. Cook (`src/sim/index.ts` → `assignTask`, `work`)
- `assignTask('cook')` resolves the pot; if it isn't built, the villager is left idle (not actionable).
- Cook channels **3000 ms** per meal: costs **3 berries + 1 wood**, `pot.meals +1`, emits
  `meal-cooked`. Loops while ingredients last; when they run out → idle, task cleared.
- Affordability is checked every tick, so the cook stops as soon as ingredients run out.

### 4. Eat + fed (`src/sim/index.ts` → `walk`, `tick`, `work`)
- On rest arrival at `fuel ≥ 33` with `pot.meals > 0`: consume 1 meal, `fedMs = 60000`,
  rest **5500 ms**, emit `eat`. Otherwise rest by fire state (`restDuration`).
- The rest duration is **committed at arrival** (`Villager.restMs`): 5500 ms when eating, else
  `restDuration(fire)` at the moment of arrival. `rest()` uses the committed value.
- `fedMs` decays by `dtMs` every tick in **every state** (runs before the state switch so an eat
  this tick sets `fedMs` after the decay). While `fedMs > 0` the chop/berries work period is
  **1190 ms** (15 % faster); otherwise 1400 ms.

### 5. Garden (`src/sim/index.ts` → `tick`)
- While built: `gardenMs += dt`; each **30000 ms** → berries +1. Unbuilt → nothing.

### Supporting changes
- `src/sim/types.ts`: `Villager` gains `restMs: number` (committed rest duration).
- `src/sim/villagers.ts`: spawn `restMs: 0`.
- `src/sim/tasks.ts`: added `COOK_CHANNEL_MS`, `COOK_BERRIES`, `COOK_WOOD`, `FED_MS`,
  `FED_WORK_PERIOD_MS`, `EAT_REST_MS`, `GARDEN_PERIOD_MS`, `STRUCTURE_COST`, `STRUCTURE_RING`.
- `src/sim/fire.test.ts`: updated the B1 `structures` length assertion 1 → 7 (the ring spots).

## Files changed

| File | Change |
|---|---|
| `src/sim/types.ts` | `Villager.restMs` |
| `src/sim/villagers.ts` | spawn `restMs: 0` |
| `src/sim/tasks.ts` | cook/fed/garden constants, `STRUCTURE_COST`, `STRUCTURE_RING` |
| `src/sim/index.ts` | structure ring, `buildStructure`, cook, eat/fed, garden, `restMs` |
| `src/sim/food.test.ts` | **new** — 9 B2 tests |
| `src/sim/fire.test.ts` | B1 assertion update (structures length 1 → 7) |

## Verification

- `pnpm exec tsc --noEmit` — **green**
- `pnpm build` — **green**
- `pnpm test` — **41 passed** (32 existing + 9 new B2)
- No `any`; no `Math.random` / `Date.now` inside `src/sim/` (deterministic).

## Concerns

- **`src/sim/index.ts` is 342 lines** (soft target ~220). The sim core now carries the full FSM:
  walk with the rest approach arc, the tend keeper loop, work with cook + fed periods, and rest
  with eat. The logic is inherent to the binding numbers; condensing further would harm
  readability. Flagging for the orchestrator — happy to extract helpers (e.g. rest-arc steering,
  tend keeper) into `tasks.ts` if a hard cap is required.
- **Rest duration is committed at arrival** (was live-evaluated against the fire in B1). This is
  required so an eating rest is a fixed 5500 ms, and it is consistent: the duration is decided when
  the villager settles. No existing test depended on live re-evaluation (fuel stays in the same
  band across a single rest in every test).
- **Cook affordability is checked every tick** (not just at channel boundaries), so the cook stops
  immediately when ingredients run out rather than wasting a full 3000 ms channel. This matches
  "when they run out → idle".
- **No UI touch needed.** The B1 `TASK_LABELS` fix already covers the `cook` task id; B2 adds no
  new `TaskId` values, so `src/ui/index.ts` was not modified.
