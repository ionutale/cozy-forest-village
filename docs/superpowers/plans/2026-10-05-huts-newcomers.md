# Huts → Newcomers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Project deviation (user instruction, takes precedence):** implementers **never run git and never
> commit** — each task ends by reporting to the orchestrator, who validates and commits. Tasks are
> dispatched as a **parallel wave** on **free models** (standing protocol; fallbacks on rate
> limits). H1's type additions land concurrently — H2/H3/H4 retry their gates until the sim types
> exist, exactly as the favor wave did.

**Goal:** Four hut plots on a second ring; each built hut brings a named newcomer who walks in from the forest edge and joins village life (cap 12), with a v3 save migration that keeps existing villages intact.

**Architecture:** Sim-owned arrivals queue (`GameState.arrivals`) scheduled by `buildStructure`, fired by `tick` into a `'arriving'` villager who reuses the existing walk; persistence chains v1→v2→v3; UI reconciles cards dynamically; render gets a hut model through the existing merge/ghost machinery.

**Tech Stack:** TypeScript (strict), three.js 0.186, vitest, Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-huts-newcomers-design.md`

## Global Constraints

- Touch only each task's listed files; no new deps; no `any`; no `Math.random` / clocks inside
  `src/sim/**`.
- Baseline: **180 tests green**. Every task keeps them green and adds its own.
- Constants (verbatim): ring **r = 7.6** at **45/135/225/315°** · cost **30 wood + 10 berries** ·
  `HUT_SETTLE_MS = 90000` · `VILLAGE_CAP = 12` · `EDGE_SPAWN = { x: 0, z: -12 }` ·
  cast Lily `#e3b7c4`, Rowan `#b03a3a`, Sage `#a8bd86`, Wren `#7d6a52` ·
  `castIndex = (villagers.length − 8) + arrivals.length` at schedule time.
- The orchestrator amends `DESIGN.md` (§3 shapes/kinds/surface, §3.2 huts bullet, §3 persist v3,
  §6 batch-6 allowance) **before** dispatch; implementers do not touch DESIGN.md.
- Each task reports to `docs/tasks/H<n>-<scope>-report.md`.

## Review Focus

Five inputs/failure modes the spec implies; each task adds the pinning test.

1. **Reload during walk-in**: an `'arriving'` villager's position/target and a pending arrival's
   countdown restore exactly (H2 test).
2. **Two huts in the same tick**: distinct `castIndex`es in completion order (H1 test).
3. **Array lockstep**: the newcomer's favor record appends in the same tick as the villager; index
   8+ flows through variants/voice/hearts without special cases (H1 + H3 tests).
4. **v1 chain**: v1 → v2 → v3 keeps the village intact and adds four unbuilt huts (H2 test).
5. **The long walk-in**: trunk avoidance + fire-arc rules hold on the edge→hut path, and
   assignment refusal cannot wedge the villager (H1 test).

---

### Task H1: Sim — huts, arrivals, cast, `'arriving'`

**Files:**
- Modify: `src/sim/types.ts` (kind/state/Arrival/GameState)
- Modify: `src/sim/tasks.ts` (ring/cost/cast/spawn/settle constants — where `STRUCTURE_COST` lives)
- Modify: `src/sim/index.ts` (init, build scheduling, tick firing, walk/assignTask)
- Test: `src/sim/huts.test.ts` (create)

**Interfaces (Produces — H2 depends on these):**
- `types.ts`: `StructureKind` += `'hut'`; `VillagerState` += `'arriving'`;
  `Arrival { structureId: string; inMs: number; castIndex: number }`; `GameState.arrivals: Arrival[]`.
- `tasks.ts`: `HUT_RING_RADIUS = 7.6`; `HUT_PLOTS: readonly { id: string; pos: Vec2 }[]`
  (`hut-1…hut-4` at 45/135/225/315°); `HUT_SETTLE_MS = 90_000`; `VILLAGE_CAP = 12`;
  `EDGE_SPAWN: Vec2`; `NEWCOMER_CAST: readonly { name: string; hatColor: string }[]`;
  `STRUCTURE_COST.hut = { wood: 30, berries: 10 }`.
- `sim/index.ts` public surface re-exports: `HUT_PLOTS`, `HUT_SETTLE_MS`, `VILLAGE_CAP`,
  `NEWCOMER_CAST` (DESIGN §3 sanctioned list grows).

- [ ] **Step 1: Write failing tests** (`src/sim/huts.test.ts`, driving `tick`/`buildStructure`
  directly): a built hut schedules one arrival with `castIndex = (villagers.length − 8) +
  arrivals.length` (Review Focus 2: two huts completed in one tick → indexes 0 and 1, in completion
  order); the countdown floors at 0 over a 90 s tick stream; at 0 the newcomer appends at
  `EDGE_SPAWN` with `id 'v9'`, cast row 0 (Lily, `#e3b7c4`), `state 'arriving'`,
  `targetNodeId` = the hut, and a fresh favor record appends in the same tick (arrays equal
  length — Review Focus 3); `assignTask` is a no-op while `'arriving'`; the walk reaches the hut
  slot and flips to `idle`; min distance to non-target trunks stays above the obstacle bar on the
  edge→hut path and the fire arc holds (Review Focus 5); a second hut schedules independently; the
  defensive `VILLAGE_CAP` path drops safely (synthetic 12-villager state).
- [ ] **Step 2: Run — expect failures** (module/type not found).
- [ ] **Step 3: Implement.** `createInitialState` gains `arrivals: []` and appends the four
  `HUT_PLOTS` structures (unbuilt). `buildStructure`: after a hut's `built` emission, push the
  arrival with the frozen `castIndex` formula. `tick`: process arrivals **after the events seed and
  before the villager loop** — countdown by `dtMs` (floored), fire at 0 (cap guard → append villager
  + favor record + remove entry). `walk`: treat `'arriving'` as walkable toward its structure target
  with the existing slot/tolerance/avoidance rules; arrival → `state 'idle'`. `assignTask`: early
  no-op for `'arriving'`.
- [ ] **Step 4: Full suite + `tsc` + `build`** green (out-of-scope concurrent failures: note,
  re-run, don't fix).
- [ ] **Step 5: Report** → `docs/tasks/H1-huts-sim-report.md`.

### Task H2: Persist — schema v3 with chained migrations

**Files:**
- Modify: `src/persist/index.ts`
- Test: `src/persist/index.test.ts` (extend)

**Interfaces:**
- Consumes: `HUT_PLOTS`, `Arrival` from H1's public surface.
- Produces: `VERSION = 3`; loader semantics below.

- [ ] **Step 1: Write failing tests**: a **v2** blob loads via migration — the four `hut-*`
  structures append unbuilt, `arrivals: []`, village untouched; a **v1** blob chains v1→v2→v3
  intact (Review Focus 4); a **v3** round-trip with an `'arriving'` villager mid-walk plus a pending
  arrival restores exactly (Review Focus 1); invalid arrivals (non-array, bad record, `castIndex`
  out of `[0,3]`) → null; `villagers.length` > 12 → null; existing tests stay.
- [ ] **Step 2: Run — expect failures.**
- [ ] **Step 3: Implement.** `VERSION = 3`; `loadGame`: v3 → full validate; v2 → validate →
  `migrateV2toV3` (append missing `hut-*` from `HUT_PLOTS`, `arrivals: []`) → return; v1 → validate
  → existing v1→v2 migration → `migrateV2toV3` → return. v3 validation = v2 checks + arrivals shape
  + `villagers.length ∈ [8, 12]`. WRITE always v3.
- [ ] **Step 4: Full suite + `tsc` + `build`** green.
- [ ] **Step 5: Report** → `docs/tasks/H2-huts-persist-report.md`.

### Task H3: UI — hut name, card reconcile, scroll, "Arriving…"

**Files:**
- Modify: the module owning `STRUCTURE_NAMES` (grep; likely `src/ui/derive.ts`) — add `hut: 'Hut'`
- Modify: `src/ui/cards.ts` (reconcile), `src/ui/index.ts` (popover gating), `src/styles/ui.css`
- Test: `src/ui/derive.test.ts` (extend)

**Interfaces:**
- Consumes: villagers length growth (H1), `StructureKind 'hut'`.
- Produces: pure `villagersNeedingCards(renderedCount: number, total: number): number[]`;
  `cardLabel` maps `'arriving'` → `'Arriving…'`.

- [ ] **Step 1: Write failing tests**: reconcile returns the missing index range; `cardLabel` for an
  `'arriving'` villager reads `'Arriving…'` (and existing labels unchanged); `STRUCTURE_NAMES.hut`
  is `'Hut'` (compile-forced by the Record anyway — assert the string).
- [ ] **Step 2: Run — expect failures.**
- [ ] **Step 3: Implement.** Cards: on each update, build cards for indices ≥ current count using the
  existing builder (parts map + transition guards reused verbatim). CSS: `.villager-list { max-height:
  …; overflow-y: auto; }` with a quiet scrollbar; no layout jump for 8. Popover: task buttons
  disabled while the selected villager is `'arriving'` (assignment is refused by the sim; the UI
  should not pretend otherwise).
- [ ] **Step 4: Full suite + `tsc` + `build`** green.
- [ ] **Step 5: Report** → `docs/tasks/H3-huts-ui-report.md`.

### Task H4: Render — hut model + ghost, rig-growth verify

**Files:**
- Modify: `src/render/structures.ts`
- Modify: `src/render/villagers/index.ts` **only if** an 8-length assumption exists (verify first)
- Report: `docs/tasks/H4-huts-render-report.md`

**Interfaces:**
- Consumes: `StructureKind 'hut'` (H1). Produces: visuals only.

- [ ] **Step 1: Verify rig growth.** Read `villagers/index.ts`: confirm rigs are created lazily per
  villager and nothing assumes a length of 8 (fix only that if found — smallest possible edit).
- [ ] **Step 2: Implement the hut model** in `chunksFor('hut')`: low-poly cabin — body (trunk/soil
  tones), gable roof (foliage-adjacent hue), door panel; merged vertex-colour geometry through the
  existing bake path; ghost shares the built geometry under `ghostMat`; per-hut draw cost ≤ 2.
  Deterministic, zero per-frame allocation, palette hexes from `PALETTE` (add a key only if truly
  needed).
- [ ] **Step 3: Full suite + `tsc` + `build`** green (no unit tests — orchestrator live-checks).
- [ ] **Step 4: Report** → `docs/tasks/H4-huts-render-report.md`.

---

## Post-wave (orchestrator)

1. Freeze → integrated gate → live pass: build a hut (fast-forward `arrivals[0].inMs = 0`) → watch
   the walk-in from the edge → card appears "Arriving…" → flips to assignable → assign + favor it →
   panel scroll at 8→12 → reload mid-walk-in → v2-save boot check (four empty plots).
2. Independent read-only review (mimo) over the wave diff → fix round if needed.
3. `REPORT.md` ledger + user handoff (task → model → evaluation table).
