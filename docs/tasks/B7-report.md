# B7 Report — UI: fuel pill, task grid, structure cards, reset, labels

Status: **DONE_WITH_CONCERNS**. Everything in the brief is implemented and verified in a live
browser; two concerns need a ruling (a duplicated cost table and one bug I had to fix in
`main.ts`). Changes left uncommitted.

## Files

| File | Lines | Change |
|---|---|---|
| `src/ui/index.ts` | 458 (+190) | fuel pill, 2×3 task grid, structure card, reset button, work labels |
| `src/styles/ui.css` | 282 (+101) | fuel bar + states, reset button, task grid, structure card |
| `src/main.ts` | 128 (+18) | `build` / `resetVillage` actions, canvas pick order, `wiped` guard |

`git status` shows exactly those three files plus one validation PNG. No commit, no new deps,
no `any` (grep-verified), no sim/render/audio changes.

Validation artifact: `docs/validation/B7-task-grid.png` — HUD with the three pills + mini bar +
⟲, and the popover's 2×3 grid with *Tend fire* active and *Stop* dimmed.

## What was built

### 1. Fuel pill (HUD, zone 1)

Third pill `[data-res="fuel"]`: flame icon, a `.fuel-stack` with `Fire` + the rounded value on one
line and a 4 px `.fuel-bar` track below, whose `.fuel-fill` is `width = fuel/max %`. The track has
a **fixed 58 px width**, so a shrinking fill cannot reflow the pill — the bar is the only thing
that changes size. Fill transitions on `width` (220 ms) and colour (320 ms), so decay glides
instead of stepping.

`data-state` uses the DESIGN §3.2 thresholds — `roaring` ≥ 66, `steady` ≥ 33, `dim` > 0,
`embers` = 0 — as a warm-to-cool shift on the fill and the icon only:

| State | Fill | Icon |
|---|---|---|
| roaring | `--accent` | `--accent` |
| steady | `--wood` | `--accent` |
| dim | `--ink-soft` @ 0.6 | `--ink-soft` |
| embers | `--ink-soft` @ 0.28 | `--ink-soft` |

Value text and bar width are written inside one `dataset.value` guard, so a decaying fire writes
two DOM properties per change rather than per frame.

### 2. Task grid (popover, zone 3)

Six buttons in `.task-grid` (`grid-template-columns: 1fr 1fr`): Chop wood · Gather berries ·
Rest · Tend fire · Cook · Stop, i.e. 2 columns × 3 rows. Buttons are centred at 12.5 px so the
long labels fit; *"Gather berries"* wraps to two lines rather than clipping, and grid stretch
keeps both buttons in a row the same height.

Disabled states, all driven from state on every `syncActiveButtons`:

- **Cook** — `aria-disabled` unless `state.structures.some(s => s.kind === 'pot' && s.built)`.
  It ships **disabled in the markup** as well, so a stale state can never show it clickable before
  the first selection.
- **Stop** — `aria-disabled` when the selected villager's `task` is `null`.

One CSS rule dims and disables pointer events for both, and the click handler re-checks
`aria-disabled` so keyboard activation cannot slip past a `pointer-events: none` button.

### 3. Structure cards (same popover)

`selectStructure(id)` shows the structure in the **same popover** — the task grid hides, the
structure card appears, and the popover title carries the name. The popover never shows both.

| Structure state | Card contents |
|---|---|
| Ghost, affordable | cost line (reusing the HUD's wood/berry icons at `.cost-icon` + amount) and an enabled **Build** button |
| Ghost, unaffordable | same cost line, Build `aria-disabled`, plus a `.structure-short` line naming the shortfall: *"Need 8 more wood"*, *"Need 3 more berries"* — the missing amount is spelled out rather than just greying the button |
| Built | no cost, no Build button, one status line: pot → `Meals: N`, garden → `Growing…`, everything else → `Built` |

Build calls `actions.build(id)`; the card re-renders from state on the next `ui.render`, so the
ghost-to-built flip needs no extra bookkeeping. Villager and structure selection are mutually
exclusive: `applyStructureSelection` calls the same silent `clearSelectionVisuals()` that the
villager path uses, so selecting one always clears the other.

### 4. Reset (HUD)

`#hud .reset-btn` renders `⟲`. First click arms it — label becomes `Sure?`, `data-armed="true"`,
`aria-label` becomes "Click again to wipe the village", and the button turns accent-filled — with
a 3 s `setTimeout` that quietly disarms it (verified: after 3.2 s the label is back to `⟲` and
`data-armed` to `false`). A second click inside the window calls `actions.resetVillage()`. No
modal, no panel. The armed state widens the button from 30 px to auto, which grows the HUD
rightward from its fixed left edge — nothing else is anchored to it, so nothing shifts under the
pointer.

### 5. Card labels

`cardLabel()` now maps through a `WORK_LABELS` table separate from the button labels, so the card
can use the gerund without changing what the buttons say:

| `villager.state` | Card label |
|---|---|
| `walking` | `Walking…` (unchanged — including while walking to the pot or woodpile) |
| `working` | `Chop wood` / `Gather berries` / **`Tending fire`** / **`Cooking`** |
| `resting` | `Resting` |
| `idle` | `Idle` |

### 6. `main.ts` wiring

```ts
build: (structureId) => { buildStructure(state, structureId); },
resetVillage: () => { wiped = true; stopAutosave(); clearSave(); window.location.reload(); },
```

Canvas pick order, one of the two ids is always null:

```ts
const villagerId = render.pickVillager(ev.clientX, ev.clientY);
const structureId = villagerId ? null : render.pickStructure(ev.clientX, ev.clientY);
render.setSelected(villagerId);
ui.select(villagerId);
ui.selectStructure(structureId);
```

Villagers win where they overlap a structure (they walk over the ring), empty ground clears both,
and the 6 px drag threshold is untouched.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 — `dist/assets/index-lbHAc8rD.css 6.21 kB`, `dist/assets/index-BnZJdHwy.js 616.16 kB │ gzip: 157.53 kB` |
| `pnpm test` | exit 0 — 6 files, 49 tests passed |

## Browser validation (chrome-devtools, `pnpm dev` on :5177, 1440×900)

Console: clean throughout — no errors, no warnings. `__cozyRender.info()` reported `calls: 148`
with three structures built, comfortably inside the `< 200` budget. Zones: `#ui > *` is still
**2** (`#hud`, `#villager-panel`) with the popover nested in the panel — still three zones.

**Fuel pill tracks decay** — sampled every 700 ms while a fire ran down:

| t | `state.fire.fuel` | value text | bar width | `data-state` |
|---|---|---|---|---|
| 0 | 41.7 | `42` | 42.5 % | steady |
| 1 | 41.5 | `42` | 42.5 % | steady |
| 2 | 41.4 | `41` | 41.5 % | steady |
| 3 | 41.2 | `41` | 41.5 % | steady |
| 4 | 41.1 | `41` | 41.5 % | steady |

Later samples crossed into `dim` (fuel 32.1), and the screenshot shows the pill reading `Fire 100`
with a full bar while two villagers were actively refuelling. All three states seen live:
`roaring`, `steady`, `dim`; `embers` was seen on a save that loaded with fuel 0.

**Reset** — armed → `Sure?` (accent background `rgb(228,155,87)`, aria-label updated), auto-disarmed
after 3.2 s, then a second click inside the window:

| | before | after reload |
|---|---|---|
| `resources.wood` | 99 (injected marker) | **0** |
| structures | all built | `woodpile:true`, everything else `false` |
| `fire.fuel` | ~0 | ~70 (`data-state: steady`) |

**Task grid and labels:**

| Check | Result |
|---|---|
| Fresh idle villager, pot unbuilt | `cook: aria-disabled=true`, `stop: aria-disabled=true` |
| Direct click on the disabled Cook | `task` stays `null` — no-op |
| Assign **Tend fire** | `task: 'tend'`, label `Walking…`, Stop becomes enabled |
| Let it run | labels observed: `Walking…` **and** `Tending fire` |
| Press **Stop** | `task: null`, label `Idle`, Stop disabled again |
| Pot built, assign **Cook** | `task: 'cook'`, labels observed `Walking…` **and** `Cooking`, `pot.meals 0 → 1`, `resources.berries 40 → 37` |

**Structure card** — driven by real world clicks on the ghosts:

| Probe | Title | Cost | Shortfall | Build | Status |
|---|---|---|---|---|---|
| Pot, wood 12 of 20 | Cooking pot | 20 | `Need 8 more wood` | disabled | — |
| Feeder, wood 12 ok / berries 2 of 5 | Bird feeder | 10 + 5 | `Need 3 more berries` | disabled | — |
| Woodpile (pre-built) | Woodpile | — | — | hidden | `Built` |
| Pot, funded | Cooking pot | 20 | — | **enabled** | — |
| Pot, after Build | Cooking pot | — | — | hidden | `Meals: 0` |
| Pot, after a meal cooked | Cooking pot | — | — | hidden | `Meals: 1` |
| Garden, after Build | Garden | — | — | hidden | `Growing…` |
| Lantern (still a ghost) | Lantern | 10 | — | enabled | — |

Build spent correctly: wood `40 → 20` for the pot, `22` left after also building the garden
(25 from 47). Task grid hidden and structure card shown in every structure probe; selecting a
villager hid the card and showed the grid.

**Selection and clicks:**

| Check | Result |
|---|---|
| Click a structure | structure card, no villager card `.selected` |
| Click a villager | task grid, structure card hidden |
| Click empty ground | popover hidden, no card selected — both cleared |
| 40 px drag on the canvas | selection unchanged (nothing opened or closed) |

## Deviations

1. **The UI keeps its own copy of the build costs.** `STRUCTURE_COST` lives in the sim's internal
   `src/sim/tasks.ts` and is **not** re-exported from `src/sim/index.ts`; DESIGN §3 says other
   layers may import types from `../sim` and nothing else. So `STRUCTURE_COSTS` is duplicated in
   `ui/index.ts` with a comment pointing at §3.2. Values match the sim exactly (pot 20, bench 15,
   garden 25, lantern 10, feeder 10+5, woodpile 0) and every affordability assertion above ran
   against the real `buildStructure`, which is the arbiter — the UI copy only decides what to
   *show* and whether to grey the button. **This is the one thing I would change with a ruling**:
   exporting `STRUCTURE_COST` from `src/sim/index.ts` would delete the duplication entirely.
2. **The armed reset button widens from 30 px to fit "Sure?"**, which nudges the HUD's right edge.
   The HUD is anchored top-left and nothing else depends on its width, so nothing shifts under the
   pointer. The alternative (fixed width + `title` tooltip only) would hide the confirmation the
   brief asked for.
3. **Cost amounts are `textContent`-equivalent HTML built from the cost table** rather than static
   markup — `structureCost.innerHTML` is reassigned on each structure selection (not per frame),
   which is why it is safe: the interpolated values are integers from a local table, never user
   input.
4. **The structure name is derived from `kind`,** so both lanterns read "Lantern" rather than
   distinguishing `lantern-a` from `lantern-b`. The ids differ, so building and picking are still
   correct; only the label is shared.

## A bug I had to fix in `main.ts` (outside the brief's letter, inside its intent)

The reset did not work on the first attempt. `resetVillage` did `clearSave(); location.reload();`
— but a reload fires the M12 `pagehide` handler, which does `stopAutosave(); saveGame(state);`.
So the wipe was immediately undone: the reload happened, then loaded the save that `pagehide` had
just written. Observed exactly that — wood stayed at the injected 99 across the reload, with the
save key present afterwards.

Fix, one flag plus one guard:

```ts
let wiped = false;
// in resetVillage: wiped = true;  before clearSave()
// in pagehide:    if (!wiped) saveGame(state);
```

Verified after the fix: wood 99 → **0**, all six structures back to ghosts, fire back to ~70.
Without this the brief's item 4 does not work at all, so I treated it as in scope rather than
reporting it as broken.

I also found and fixed a straight inversion of my own while testing: `syncStructureCard` set
`taskGrid.hidden = !structure`, which kept the task grid *visible* behind the structure card. Now
`taskGrid.hidden = structure !== undefined`, verified across seven structure probes.

## Known gaps / concerns for the orchestrator

1. **The duplicated cost table (deviation 1)** is the main structural concern. Two sources of truth
   for binding numbers is exactly the kind of thing that drifts silently — a designer rebalancing
   the pot to 18 wood would see the sim refuse a Build the UI happily enabled. Cheap fix, needs a
   `src/sim/index.ts` export and a one-line import in the UI.
2. **No automated test covers any B7 code.** Every claim above is a live browser assertion. The
   genuinely testable pure pieces are `cardLabel`/`WORK_LABELS`, `fireState`, the shortfall
   formatting, and the affordability predicate — all pure functions of `GameState`. The brief's
   allow-list is three source files, so no test file was added.
3. **The structure card lives in the popover only.** There is no list of the seven structures
   anywhere, so the player can only reach a structure by clicking it in the world. That matches
   DESIGN §6's wording and the brief, but it does mean "which structures can I still build?" is
   answered by walking around the ring. If the playtest wants a roster, that is a §6 ruling, not a
   B7 fix.
4. **No 3D highlight for a selected structure.** Selecting a ghost shows the popover card but
   nothing changes in the world — the villager selection ring has no structure counterpart, and
   `src/render/structures.ts` exposes no selection API (and is B5's file). Cosmetic; flagging so it
   is a conscious gap rather than an oversight.
5. **"Gather berries" wraps to two lines in the grid** at the panel's 250 px width. It stays inside
   its button and the row heights match, but it is the one label that does not sit on a single
   line. Shortening it would deviate from the brief's wording, so I left it.
6. **The browser bridge wedged at the very end of the run** (chrome-devtools MCP could not reattach
   to its own Chrome instance), so I have one screenshot (`B7-task-grid.png`) instead of two. The
   structure-card states above were therefore verified by DOM assertions rather than visually — I
   deleted a `B7-structure-card.png` that had been captured with the popover closed, since it was
   not evidence of anything. I did not kill the MCP's Chrome to recover it, because that instance
   has other sessions' pages open.
7. **My in-page camera reconstruction drifted** partway through the session (off by ~45 px at the
   edge of the frame), so structure click coordinates had to be found empirically. This is a test
   harness limitation, not a product issue — `pickStructure` returning the right ids was proven
   directly in B5, and here the picks landed on the intended structures ("Bird feeder", etc.).
8. `src/ui/index.ts` is now 458 lines, up from 268. Batch 2 set no line budget, but for the record
   the file now holds three distinct concerns (HUD, villager list, popover/structure card) and is a
   candidate for splitting if it grows further.