# B1 Report — Sim: fire, woodpile, Tend fire, warmth effects

**Status: DONE**
**Model:** longcat-2.5-preview-free
**Date:** 2026-10-04

## What was implemented

All deliverables from `docs/tasks/B1.md`, per the binding contracts in `DESIGN.md` §3 / §3.2.

### 1. Full batch-2 type surface (`src/sim/types.ts`)
- `TaskId` adds `'tend' | 'cook'`.
- New `StructureKind` union (`'woodpile' | 'pot' | 'garden' | 'bench' | 'lantern' | 'feeder'`),
  `Structure`, `Fire`, `Pot` interfaces.
- `Villager` gains `fedMs: number` and `carrying: boolean`.
- `SimEvent` gains `'fuel-add' | 'meal-cooked' | 'eat' | 'built'`; `villagerId` is now optional;
  added `structureId?: string`.
- `GameState` gains `structures`, `fire`, `pot`, `gardenMs`.

### 2. World gen (`src/sim/world.ts`)
- Inner scatter radius moved from 6 → **7.5** (DESIGN §3.2) so the village ring stays clear.
- Two scatter-parameter changes (see "World-gen fix" below): min gap 1.8 → **2.5**, and the
  radial distribution changed from uniform-area-density (squared radius) to **uniform-in-radius**.

### 3. Woodpile (`src/sim/index.ts` → `createInitialState`)
- `structures` contains the pre-built woodpile at (90°, r = 2.6) from the start.

### 4. Fire decay (`src/sim/index.ts` → `tick`)
- `fuel = max(0, fuel − 0.22·dt/1000)` every tick with `dt > 0`; floors at 0 (embers).

### 5. Tend fire keeper loop (`src/sim/index.ts` → `tendKeeper`)
- Per-tick keeper loop exactly per DESIGN §3.2: `carrying` → walk to campfire, deposit
  (+25 fuel capped at `max`, event `fuel-add`); else fetch a log when `wood ≥ 1 && fuel ≤ 75`
  (wood −1, `carrying = true`); else stand watch at the fire (task stays, state `working`).
- `targetNodeId` points at the woodpile/campfire; the walk FSM resolves targets against
  nodes **or** structures (`resolveTargetPos`). Keeper arrival at the campfire deposits;
  arrival at the woodpile takes a log.

### 6. Rest duration by fire (`src/sim/tasks.ts` → `restDuration`)
- `restDuration(fire)`: fuel ≥33 → 4000 ms · fuel >0 → 5500 ms · fuel = 0 → 7000 ms.
  Evaluated against the live fire each tick. The old fixed `REST_DURATION_MS` was removed.

### Supporting changes
- `src/sim/tasks.ts`: `TASK_KIND` is now `Partial` (tend/cook don't map to node kinds);
  added `TASK_STRUCTURE` (`tend → woodpile`, `cook → pot`), `nearestStructure`, and the fire
  constants (`FIRE_DECAY_PER_MS`, `LOG_FUEL`, `TEND_FETCH_FUEL`, `FIRE_ROARING`, `FIRE_STEADY`).
- `src/sim/villagers.ts`: each villager spawns with `fedMs: 0, carrying: false`.
- `src/sim/index.ts`: `assignTask` resolves structure-targeting tasks against `structures`.

## World-gen fix (required to keep the existing work-slots test green)

The mandated r = 7.5 change broke the existing `behavior.test.ts` "work slots" test
(pairwise ≥ 0.45). Root cause: with trees farther out, the nearest-tree assignment for the
8 villagers collapsed — two villagers (v3, v6) shared one tree, and golden-angle slots on a
shared tree are 0.419 apart (< 0.45). This is structural, not a bug in the test.

The design mandates r ≥ 7.5 but leaves the scatter parameters to the implementation. Two
changes (both within design bounds) restore distinct nearest trees robustly:
- **Min gap 1.8 → 2.5** — spreads trees more evenly.
- **Radial distribution uniform-in-radius** (was uniform-area-density) — more trees near the
  inner edge, so every villager's angular sector has a nearby tree.

Verified robust across seeds 1–50 (not overfit to the default seed). The existing test only
checks seed 1, but the fix holds broadly.

## Downstream type fix (`src/ui/index.ts`)

`TASK_LABELS: Record<TaskId, string>` required `'tend'` and `'cook'` entries once `TaskId`
expanded. Added the two labels (`'Tend fire'`, `'Cook'`) to satisfy the type. `TASK_ORDER` was
left unchanged — rendering the new task buttons is the UI task's job, not B1's. This is a
type-surface fix only; no UI behavior changed.

## Files changed

| File | Change |
|---|---|
| `src/sim/types.ts` | Full batch-2 type surface |
| `src/sim/world.ts` | r = 7.5, min gap 2.5, uniform-in-radius |
| `src/sim/villagers.ts` | `fedMs`, `carrying` spawn defaults |
| `src/sim/tasks.ts` | `TASK_STRUCTURE`, `nearestStructure`, `restDuration`, fire constants |
| `src/sim/index.ts` | fire decay, tend keeper, structure-aware walk, new initial state |
| `src/sim/fire.test.ts` | **New** — 8 B1 tests |
| `src/ui/index.ts` | Type fix: added `tend`/`cook` labels (no behavior change) |

## Verification

- `pnpm exec tsc --noEmit` — **green**
- `pnpm build` — **green**
- `pnpm test` — **32 passed** (24 existing + 8 new B1 tests)
- No `any`; no `Math.random` / `Date.now` inside `src/sim/` (deterministic).
- `src/sim/index.ts` is 262 lines (slightly over the ~220 soft target — the keeper/fire/structure
  logic is substantial; can be trimmed if the orchestrator requires).

## Concerns

- **`src/ui/index.ts` touched outside `src/sim/**`.** This was unavoidable: the expanded
  `TaskId` union is a breaking type change to `TASK_LABELS: Record<TaskId, string>`. The fix
  is two label strings with zero behavior change. Flagging it for the orchestrator's awareness.
- **Rest duration is evaluated against the live fire** (not locked at rest start). This matches
  the design's "rest duration by fire" wording and needs no extra state field. If the orchestrator
  prefers locking the duration at rest start, that would require a new state field.
- **Cook/eat/garden/other structures are clean seams** for B2: `TASK_STRUCTURE` resolves the
  pot, `restDuration` is a pure helper, and the walk FSM already handles structure targets.
