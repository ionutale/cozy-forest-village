# Huts → New Villagers — Design (batch 6)

Status: **approved in chat 2026-10-05**; awaiting written-spec review. No implementation until the
spec is reviewed and the implementation plan is approved (HARD GATE).
Authority: `DESIGN.md` §2 (feel), §3 (contracts), §3.2 (binding numbers), §6 (UI zones).

## Goal

The village can **grow**: four hut plots on a second ring; each built hut brings one newcomer who
walks in from the forest edge and joins village life. The roster caps at 12; newcomers inherit every
existing rule (tasks, favors, phrasing, hearts, camera).

## Non-goals

- No uncapped growth, no per-hut identity choice UI, no new panels (three zones stay three).
- No new audio for arrivals in v1 (candidate later).
- No villager removal/leaving.
- No change to favor cadence (global 120 s/90 s rules, max-2).

## Player experience

1. Four new ghost plots appear on a wider ring. A hut costs **30 wood + 10 berries**; the existing
   card flow builds it.
2. ~**90 s** after a hut completes, a newcomer walks in from the south forest edge to that hut and
   settles. Their card appears with "Arriving…" until they reach the hut, then they are idle and
   assignable like anyone else.
3. First built hut → **Lily**, then **Rowan**, **Sage**, **Wren** (completion order, not plot order).
4. The panel list scrolls gently once it grows past the screen; everything else behaves exactly as
   it did with eight villagers.

## Part 1 — Sim model

### 1.1 Structures

- `StructureKind` gains `'hut'`. Four slots `hut-1…hut-4`, kind `hut`, positions on ring **r = 7.6**
  at **45° / 135° / 225° / 315°** (π/4, 3π/4, 5π/4, 7π/4).
- `STRUCTURE_COST.hut = { wood: 30, berries: 10 }`. `buildStructure` needs no special-casing beyond
  the arrival scheduling below (spend → built → `built` event as usual).
- Ghost/built visuals: the render layer's existing merge/instance machinery with a new low-poly
  cabin model (Part 4).

### 1.2 State (DESIGN §3)

```ts
export interface Arrival {
  structureId: string;   // the hut that was completed
  inMs: number;          // countdown to the walk-in (starts at HUT_SETTLE_MS)
  castIndex: number;     // 0..3, = (villagers.length − 8) + arrivals.length at schedule time
}
export interface GameState { /* … */ arrivals: Arrival[]; }
```

`VillagerState` gains `'arriving'` (a villager walking to their hut for the first time).

### 1.3 Constants

| Constant | Value | Meaning |
|---|---|---|
| `HUT_SETTLE_MS` | `90_000` | delay from hut completion to the walk-in |
| `VILLAGE_CAP` | `12` | hard roster cap (8 + 4 huts = 12 by construction) |
| `EDGE_SPAWN` | `{ x: 0, z: -12 }` | south forest edge — every newcomer enters here |
| ring | `r = 7.6`, angles 45/135/225/315° | hut plots |

### 1.4 Arrival flow

- When `buildStructure` completes a hut: push
  `{ structureId, inMs: HUT_SETTLE_MS, castIndex }` where
  `castIndex = (villagers.length − 8) + arrivals.length` at schedule time — unique per newcomer and
  order-preserving, including two huts completed in the same tick. `NEWCOMER_CAST[castIndex]` is
  the newcomer's row.
- `tick()` decrements every `arrival.inMs` by `dtMs` (floored at 0). At 0:
  1. If `villagers.length >= VILLAGE_CAP` (defensive; unreachable by construction) → drop the entry.
  2. Append the newcomer: `id = 'v' + (villagers.length + 1)`, name/hatColor from
     `NEWCOMER_CAST[arrival.castIndex]`, `state: 'arriving'`, `pos: EDGE_SPAWN`,
     `targetNodeId: arrival.structureId`, all progress fields zero.
  3. Append a fresh favor record `{ step: 0, active: false, progress: 0 }` to
     `favors.byVillager` — the two arrays never desynchronize.
  4. Remove the arrival entry.
- `'arriving'` reuses the existing walk: steering, trunk avoidance, structure arrival slot
  (`STRUCTURE_SLOT_RADIUS`/tight tolerance) for the hut target, and the fire-arc rules all apply
  unchanged. On arrival at the hut → `state = 'idle'`, task stays `null`.
- `assignTask` is a **no-op** while a villager is `'arriving'`.
- Favor offering/progress: a newcomer is eligible for the normal rules as soon as they exist (the
  global cadence and max-2 already pace the village).

### 1.5 Cast (fixed, in completion order)

| castIndex | Name | Hat color |
|---|---|---|
| 0 | Lily | `#e3b7c4` pale rose |
| 1 | Rowan | `#b03a3a` deep red |
| 2 | Sage | `#a8bd86` light sage |
| 3 | Wren | `#7d6a52` dark umber |

Frozen against the existing eight (Maple `#c96f4a`, Birch `#7fa653`, Fern `#b0577a`, Pip `#6f8fb0`,
Hazel `#d9a441`, Juniper `#8a6fae`, Moss `#4e8f76`, Clover `#b0724b`). Indexes 8–11 flow through
all existing index rules (favor step variants, phrasing voice) with no special cases.

## Part 2 — Persist (schema v3)

- `VERSION = 3`. v3 = v2 + the four `hut` structures + `arrivals`.
- Migration: **v1 → v2 (existing) → v3**, chained in the loader; then v3 validation. v2 → v3 appends
  `hut-1…hut-4` (unbuilt) if absent and sets `arrivals: []`. The roster is untouched on load —
  existing 8-villager villages simply gain four empty plots.
- `isPlausibleState` (v3) additionally requires: `arrivals` an array of records (string
  `structureId`, finite `inMs ≥ 0`, integer `castIndex` in `[0, 3]`), `villagers.length` in
  `[8, 12]`, and `favors.byVillager.length === villagers.length` (already enforced — keep).
- Round-trip: a save with one villager mid-walk-in (`'arriving'`, target hut) and one pending
  arrival restores exactly.

## Part 3 — UI (still exactly three zones)

- `STRUCTURE_NAMES.hut = 'Hut'`; cost display flows from `STRUCTURE_COST` automatically.
- **Card reconcile**: when `state.villagers.length` grows, append cards for the new villagers using
  the existing card builder (same parts map, same transition guards). Nothing else changes for the
  old cards.
- **Panel scroll**: the villager list gains a gentle `max-height` + `overflow-y: auto` so 12 cards
  fit the column; scroll styling stays in the panel register.
- **Arriving label**: `'Arriving…'` in the card status position; the popover's task buttons are
  disabled for that villager (assignment is refused by the sim anyway).
- Hint/popover phrasing for newcomers works automatically (name-keyed voice).

## Part 4 — Render

- New hut model + ghost in `structures.ts`: low-poly cabin (body + gable roof + door; palette
  register — `trunk`/`soil` tones, roof in a foliage-adjacent hue) built through the same
  `chunksFor`/bake path; static parts merge, ghosts share the built geometry under `ghostMat`.
- Villager rigs are created lazily per villager (post-A6 behaviour) — newcomers render with zero
  layer changes; the walk-in uses the existing walking pose. Verify no 8-length assumption exists;
  fix it if one does (the only expected edit, if any).
- Draw calls: +1 ghost or +1–2 built per hut; worst case stays far under budget.

## Part 5 — Tests

- **Sim**: hut completion schedules an arrival at 90 000 ms; countdown floors at 0; arrival appends
  the newcomer at `EDGE_SPAWN` with the right cast row in completion order; a fresh favor record is
  appended in the same tick (lengths always equal); `assignTask` refused while `'arriving'`;
  the walk reaches the hut (structure slot) and flips to `idle`; trunk avoidance holds on the long
  edge walk; a second hut schedules independently; the defensive cap path drops safely.
- **Persist**: v2 → v3 appends four unbuilt huts (village untouched); v1 → v3 chains intact;
  v3 round-trip mid-arrival; each invalid arrivals shape → null.
- **UI**: pure tests for the reconcile decision (which new villagers need cards) and the
  `'Arriving…'` label mapping; DOM append and scroll are orchestrator-live-checked.

## Part 6 — Execution plan (after spec approval + plan)

One parallel, file-disjoint wave on **free models** (roster refreshed 2026-10-05: space-bunny,
muse-spark, longcat, mimo, ling, nemotron; fallbacks on rate limits):

| Task | Files | Scope |
|---|---|---|
| H1 sim | `src/sim/**` | kind/cost/arrivals/cast/'arriving'/tests |
| H2 persist | `src/persist/**` | v3 + chained migrations + tests |
| H3 UI | `src/ui/**`, `src/styles/ui.css` | hut name, card reconcile, scroll, arriving state |
| H4 render | `src/render/structures.ts` (+`villagers/index.ts` only if an 8-assumption exists) | hut model + ghost, rig-growth verify |

Then: freeze → live pass (build hut → walk-in → assign → favors with 12) → commits → independent
review (mimo) → fix round. H1's type additions land concurrently — H2/H3/H4 retry their gates until
the sim types exist, exactly as the favor wave did.

## Part 7 — DESIGN.md amendments (applied by the orchestrator with this spec)

1. §3: `StructureKind` += `'hut'`; `STRUCTURE_COST.hut`; `GameState.arrivals`; `VillagerState` +=
   `'arriving'`; Arrival shape.
2. §3.2: new “Huts” bullet — ring/cost/settle/cap/spawn/cast order, walk-in via existing walk.
3. §3 persist: schema v3 + migration chain.
4. §6: batch-6 allowance line (card reconcile + list scroll — inside the existing panel).
