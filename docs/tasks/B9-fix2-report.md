# B9 fix batch 2 — Report

Status: **DONE**. C1, M1, M2, M5 and M6 all fixed and verified in a live browser. Changes left
uncommitted.

## Files

| File | Lines | Change |
|---|---|---|
| `src/ui/index.ts` | 470 (+12 net) | **C1** structure-selection early return, **M1** signature guard + hoisted pill lookups, **M6** sim-owned cost table |
| `src/render/villagers.ts` | 530 (+19) | **M2** `tend` stand-watch pose |
| `src/render/environment.ts` | 278 (��9) | **M5** doc correction + dead `__cozy` fallback deleted |
| `src/main.ts` | 131 (+3) | **M5** `pageshow` saves before reloading |

`src/styles/ui.css` was in the allow-list but needed **no changes** — none of these findings touch
styling.

`git diff --name-only -- src` confirms exactly those four files. `REPORT.md` and
`docs/tasks/B9-report.md` are modified/untracked from the orchestrator's own B9 work, not mine. No
commit, no new deps, no `any`, no sim changes.

Validation artifact: `docs/validation/B9-fix2-keepers.png` — eight villagers on tend around the
campfire, standing upright and calm instead of chopping at nothing.

## C1 — world-click on a villager no longer closes its own popover

The review was right and the two-line fix is the whole story. `applyStructureSelection` now
distinguishes "no structure under this click" from "clear the selection":

```ts
function applyStructureSelection(structureId: string | null, state: GameState): void {
  // C1: `null` means "no structure under this click", not "clear everything". main.ts calls
  // `ui.select(villagerId)` first, so clearing the villager selection here would undo a
  // world click on a villager in the same gesture. Drop the structure half only.
  if (structureId === null) {
    selectedStructureId = null;
    return;
  }
  clearSelectionVisuals();
  …
}
```

`clearSelectionVisuals()` still runs on the non-null path, so selecting a structure does clear a
villager selection — mutual exclusivity is preserved. Empty ground still clears both, because
`main.ts` calls `ui.select(null)` *before* `ui.selectStructure(null)`, and `select(null)` is the
path that clears the villager half.

I also added `lastStructureSignature = ''` right before the card renders on a fresh structure
selection, so a newly opened card always paints even if its signature happens to match the
previously selected structure's (e.g. re-selecting the same ghost). Without it the guard could
leave a closed card blank.

Verified, all through real pointer events on the canvas (not panel clicks):

| Path | popover | title | `.selected` card | grid | structure card |
|---|---|---|---|---|---|
| **World click on a villager** (`v1`) | open | `Maple` | `v1` | visible | hidden |
| **World click on a ghost** | open | `Bench` | none | hidden | visible |
| **Ground click** | hidden | — | none | — | — |
| Ghost open → world click villager | open | `Maple` | `v1` | visible | hidden |
| Ghost open → ground click | hidden | — | none | — | — |

The two regression orders (villager-then-ghost and ghost-then-villager) both behave, so no stale
structure state survives a switch.

## M1 — per-frame structure-card churn eliminated

`UIHandle.render` calls `syncStructureCard(state)` every frame, and the card's cost line is an
`innerHTML` assignment containing 1–2 inline SVGs. That was ~118 assignments in 2 s. Two changes:

**Signature guard.** `syncStructureCard` builds
`kind|built|wood|berries|meals`, compares it with `lastStructureSignature`, and returns early on a
match — before touching cost, status, `aria-disabled` or `hidden`. The visibility flags stay
*outside* the guard, because they must track which structure is selected rather than what it
shows; they are two boolean writes.

**Hoisted pill lookups.** `must<HTMLElement>(root, '#hud [data-res="…"]')` and the nested
`.pill-value` lookups ran twice per frame. Wood, berries and fuel pill/value/bar nodes are now
resolved once at `initUI`.

Measured on a real open ghost card:

| Scenario | `innerHTML` writes | `aria-disabled` writes |
|---|---|---|
| 2 s, sim idle | **0** (was ~118) | **0** |
| wood 6 → 20 (one real change) | 1 | 1 |
| then 20 → 21 → 22 | 3 total | — |
| 1.5 s after those changes | no further writes | — |

And the guard is not stale-cache-wrong — every state transition still repaints:

| Change | Card before → after |
|---|---|
| wood 2 (short) → 200 | `off: true, short: "Need 13 more wood"` → `off: false, short: ""` |
| 200 → 2 | back to `off: true, short: "Need 13 more wood"` |
| pot ghost → `built: true`, 0 meals | Build hidden, status `Meals: 0` |
| 0 → 3 meals | status `Meals: 3` |
| pot `built: false` again | Build visible, status empty |

## M2 — keepers no longer air-chop

`pose()`'s `working` case branched on `cook` and `berries`, so **every other task fell into the
chop pulse** — `LEAN_CHOP 0.19` at 2.2 Hz, which is what the review saw. Added a `tend` branch
before the berries/chop fallback:

```ts
const sway = Math.sin(t * TAU * TEND_HZ);
out = {
  bob: sway * TEND_BOB,                                  // ±0.012
  lean: TEND_LEAN + sway * 0.015,                        // ~0.02 rad, ±0.015
  swing: sway * TEND_SWING,                              // ±0.05
  raise: TEND_REACH + Math.sin(t * TAU * TEND_HZ * 0.5) * 0.05,  // ~0.24 rad forward
  stir: 0,
};
```

`TEND_HZ = 0.6` — the requested slow sway, and since `t` carries the per-villager `phase` offset
the eight keepers are not in lockstep. Values are deliberately an order of magnitude under the chop
pose: lean 0.02 vs 0.19, swing 0.05 vs 0.18, and the reach breathes on a *half* frequency so it does
not pulse in time with the sway. No new geometry, and the existing easing (`1 - exp(-dtSec * EASE)`)
still applies, so a state change cannot snap.

The `carrying` override sits *after* the switch and raises `raise` to `CARRY_RAISE` (0.95) whenever
a villager holds a log, so a keeper mid-fetch still reads as carrying. I deliberately set
`TEND_REACH = 0.24` well below 0.95 so that precedence is unaffected rather than accidental.

Verified with all eight villagers set to `tend`: 3 on stand-watch immediately, all 8 within a few
seconds, labels reading `Tending fire`, and the screenshot shows them upright around the fire with
no visible lean or swing. `__cozyRender.info().calls` 120 — unchanged, since the branch reuses the
existing rig channels.

## M5 — stale comments and the bfcache data loss

**`main.ts` `pageshow`.** The comment claimed "Slice 1 has no save system", false since B3, and the
branch silently discarded up to one autosave interval of progress. It now saves first:

```ts
window.addEventListener('pageshow', () => {
  if (!stopped) return;
  if (!wiped) saveGame(state);
  window.location.reload();
});
```

The `wiped` guard from the B7 reset fix is honoured, so a restore cannot resurrect a village the
player just wiped. Verified: dispatching `pageshow` **without** a prior `pagehide` wrote no save
(`stopped === false`, early return); after a real `pagehide` → wipe the key → `pageshow`, the save
was rewritten and the reload landed on a document with the save intact (`tick 24139`, all villagers
idle, wood 192, fuel 57) — i.e. the restore path now round-trips the state instead of losing it.

**`environment.ts`.** The `Environment.update` doc no longer claims render/index.ts calls
`update(timeSec)`; it says render always passes `state.fire` and that an omitted argument falls
back to a steady default. The `window.__cozy` hook fallback inside `resolveFire` is **deleted** —
render always passes the real state, so it was an unreachable branch and the only place the render
layer reached into global state. The safe default path for tests stays:

```ts
const f = fire ?? { fuel: 70, max: 100 };
if (!(f.max > 0)) return { ratio: 0.7 };
```

`window.__cozy?.getState().fire` no longer appears anywhere in the render layer.

## M6 — cost table duplication removed

`STRUCTURE_COST` is now exported from `src/sim/index.ts` (DESIGN §3 updated: "import **types** and
the read-only `STRUCTURE_COST` data table from `../sim`"), so the UI imports it and its local copy
and drift warning are deleted:

```ts
import type { GameState, StructureKind, TaskId, Villager } from '../sim';
import { STRUCTURE_COST } from '../sim';
```

The sim is now the single source of truth for the binding §3.2 numbers and `tsc` type-checks the
UI against them. Everything that consumed the old local table (`syncStructureCard`) works
unchanged — verified end to end: bench card shows cost `15` and enabled Build at 200 wood, disabled
with `Need 13 more wood` at 2 wood.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test` | exit 0 — 6 files, **62/62** tests passed |

## Browser validation (chrome-devtools, `pnpm dev` on :5177, 1440×900)

Console: clean — no errors, no warnings. Zones: `#ui > *` still **2**, popover nested in the panel.
`__cozyRender.info()`: `calls 120`, `triangles 28052`, `geometries 38`, `textures 2` — inside the
`< 200` budget. Structure click coordinates were found by scanning the canvas rather than by
projecting, because structures have no projection hook (that is a B7-report note, still true).

Every result in the C1, M1, M2 and M6 tables above came from live DOM/state assertions; the keeper
pose is additionally evidenced by `docs/validation/B9-fix2-keepers.png`.

## Deviations

1. **`lastStructureSignature = ''` on selection** (in `applyStructureSelection`, just before the
   card renders) is one line beyond the review's two. Without it, re-selecting a structure whose
   signature equals the last-rendered one would leave the card unpainted. Cheap insurance against a
   guard that is otherwise correct.
2. **The visibility flags stay outside the signature guard.** `taskGrid.hidden` and
   `structureCard.hidden` track *which* structure is selected, not what the card shows, so caching
   them against the signature would be wrong when switching between two ghosts of the same kind.
   They are two boolean writes per frame, not the innerHTML/SVG churn the finding was about.
3. **`if (!wiped)` on the new `pageshow` save** — the review asked for `saveGame(state)` before the
   reload. Taken literally that would resurrect a wiped village on a restore, undoing the B7 reset.
   The guard keeps the reset correct; noted so the deviation from the literal instruction is visible.

## Known gaps / concerns for the orchestrator

1. **M3 (arrival slots for structure targets), M4 (plausible-but-empty save shapes) and M7 (no
   "already well-fed" guard) were not in this batch** and remain open. All three live in
   `src/sim/**`, which this batch's file allow-list excluded, and the brief did not list them.
   M3 is the one with visible symptoms (villagers stacking on the pot).
2. **The M5 finding also named a stale comment in `src/sim/tasks.ts:33-34`** (`restDuration` doc
   says "each tick" where the code evaluates once at rest start). `src/sim/**` is outside this
   batch's allow-list, so I did not touch it. It is a one-line comment fix whenever a sim owner
   picks it up.
3. **The M1 guard is a correctness risk if a future field is added to the card and forgotten in the
   signature** — the symptom would be a card that silently stops updating. The signature lists all
   five inputs the card currently reads, and the negative-control test above confirms each one still
   repaints, but nothing enforces that mechanically. A comment on the signature would help; I put
   the field list in the signature construction itself so it is visible at the point of use.
4. **M2's numbers are taste, not spec.** The review asked for "near-neutral, slow ~0.6 Hz sway with
   a small forward arm poke"; the concrete values (`TEND_LEAN 0.02`, `TEND_SWING 0.05`,
   `TEND_REACH 0.24`, `TEND_BOB 0.012`) are my reading of that. They are grouped with the other B6
   pose constants so a later art pass can retune them in one place.
5. **`src/ui/index.ts` is now 470 lines and `src/render/villagers.ts` 530.** Both were already large
   before this batch (458 / 511). No budget was set for batch 2, but the UI file now holds four
   distinct concerns and is a candidate for a split.