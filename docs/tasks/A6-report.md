# A6 Report — Render: split `src/render/villagers.ts` into focused modules

Status: **DONE**. Pure refactor, zero behaviour change. `pnpm exec tsc --noEmit`,
`pnpm build` and `pnpm test` all green — **62/62 tests passing**. Public API and
import path (`./villagers` → `createVillagers` / `VillagersLayer`) unchanged, so
`src/render/index.ts` needed no edit.

## Files

| File | Lines | Change |
|---|---|---|
| `src/render/villagers.ts` | 531 → **deleted** | replaced by the `src/render/villagers/` folder |
| `src/render/villagers/index.ts` | 128 | **new** — public surface: `VillagersLayer`, `createVillagers`, per-frame orchestration (`update`/`pick`/`setSelected`/`project`/`dispose`), `PICK_LIFT`, shared `track`/disposables, `selectedId`, `heartSerial`, `lastEventTick` |
| `src/render/villagers/rig.ts` | 184 | **new** — rig/model construction: `Rig` interface, `RigKit` + `createRigKit` (shared geometry + skin/tunic/log/hat materials, hat-material cache with `clearCache`), `armPivot`, `createRig`, `hash01`, dimension constants (`BODY_Y`…`LOG_Z`, `HEAD_Y` re-exported for `motion.ts`) |
| `src/render/villagers/motion.ts` | 152 | **new** — poses & motion: `Pose` interface, `pose()` (walking/working-cook/working-tend/working-chop·berries/resting/idle + carry & chill overrides), `animate()` (turn smoothing, eased blends, embers tremble, savoring head bob, arm swing/raise/stir, log scale/visibility), `angleDelta`, all pose/motion constants |
| `src/render/villagers/hearts.ts` | 148 | **new** — hearts/carry garnish: `Heart` interface, canvas `heartTexture()`, `createHeartPool` (fixed 4-sprite pool), `heartSlot` (free-else-oldest), `spawnHearts` (deterministic 2–3 burst, returns advanced serial), `advanceHearts` (ease-out lift + fade) |
| `src/render/villagers/ring.ts` | 52 | **new** — T05 selection ring: `createSelectionRing` (halo + accent pair, render-order, flat on ground), `updateSelectionRing` (trails the picked rig, cosine breath 1.0→1.08→1.0 over 1.2 s) |

Total 664 lines across 5 files vs 531 before (+133): the growth is module headers,
the `RigKit` interface that replaces the closure capture, and per-module constant
blocks — no logic added, removed or reordered.

## How the split preserves behaviour

- **Same closure state, same ownership.** `createVillagers` still owns `group`,
  `rigs`, `disposables`/`track`, `selectedId`, `scratch`, `heartSerial`,
  `lastEventTick`. The submodules are stateless helpers plus two factory functions
  (`createRigKit`, `createHeartPool`) and two constructors (`createRig`,
  `createSelectionRing`) that take `track` and the parent `group` explicitly, so
  the disposables list and creation order (kit → ring → hearts, then rigs lazily on
  first `update`) are byte-for-byte the same as before.
- **`heartSerial` threading.** `spawnHearts` was the only consumer of the mutable
  serial; it now takes the serial and returns the advanced value
  (`heartSerial = spawnHearts(hearts, rig, heartSerial)`), keeping the exact
  hash-input sequence (salt 93 for the count, 94/95 per heart) and the
  pool-exhausted early return.
- **`hatMats` cache disposal.** The cache moved inside `RigKit`; `dispose()` calls
  `rigKit.clearCache()` where it called `hatMats.clear()` — materials themselves
  still dispose through the shared `disposables`, as before.
- **`pose`/`animate` are pure over `Rig`.** They never touched layer state, so they
  moved verbatim; `motion.ts` imports `HEAD_Y` from `rig.ts` (the only cross-module
  constant dependency).
- **Constants distributed, not duplicated.** Each constant lives exactly once, in the
  module that owns it (dimensions → `rig.ts`, pose/motion tuning → `motion.ts`,
  heart tuning → `hearts.ts`, `RING_Y` → `ring.ts`, `PICK_LIFT` → `index.ts`).

## Verification

- `pnpm exec tsc --noEmit` — clean (strict, `noUnusedLocals`, `verbatimModuleSyntax`).
- `pnpm build` — clean; the >500 kB chunk warning is pre-existing (three.js).
- `pnpm test` — 6 files, **62/62 passed**.
- Grep audit: the only import of the render villagers module is
  `src/render/index.ts:8` (`createVillagers`, `VillagersLayer`), both exported from
  `src/render/villagers/index.ts`. `src/sim/index.ts`'s `./villagers` is the
  unrelated sim module. No file references any internal symbol (`Rig`, `Heart`,
  `pose`, `animate`, `spawnHearts`, …) from outside the folder.
- No `pnpm dev`, no browser, no commit, no subagents, no new dependencies, no `any`.
  Only `src/render/villagers.ts` (deleted) and `src/render/villagers/*` (new)
  touched; `docs/tasks/A6-report.md` is this report.
