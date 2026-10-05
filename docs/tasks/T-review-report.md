# T — Independent review: batch 7 (traders → spices)

Read-only review of the committed wave. **0 Critical · 1 Important · 5 Minor** (6 findings).

**Scope reviewed.** Spec `docs/superpowers/specs/2026-10-05-traders-spices-design.md` (all 7 parts +
Review-Focus pins), plan `docs/superpowers/plans/2026-10-05-traders-spices.md`, DESIGN §3 (surface,
`Visitor`, `SimEvent`, `pendingEvents`), §3.2 "Trader visits" / "Hearty meals", §3 persist v4,
§6 batch-7 line, task reports `T1`–`T4`, and the wave diff `a5ef302` (T1), `8040a94` (T2),
`40afad7` (T3), `3dff02a` (T4).

**Verification (read-only, this review).**
- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm test` → **254/254 passed, 12/12 files** (matches the stated baseline).
- `git diff --name-only 6744306..3dff02a` → 22 files: exactly the wave's file list plus the four
  task reports. No `package.json` change, no `: any` in the diff, no `src/render/selectionCue.ts`
  or `src/ui/cards.ts` churn.
- A docs-only commit `cf4a193` (REPORT.md + 4 validation PNGs) landed during this review; it
  touches no source, and both gates were re-run after it (still exit 0 / 254-254).

---

## Findings

### Critical

*none.*

### Important

**I1 — `src/render/trader.ts:322` — the walk-out cart yaw cancels the wrong angle, so the cart
counter-rotates during the turnaround and finishes 44° askew.**

```ts
cart.rotation.y = s.leaving ? (FIRE_FACING - s.facing) + Math.PI * s.turn : 0;
```

`s.facing` on the walk-out leg is `blendFacing(FIRE_FACING, OUT_FACING, turn)`
(`:178`), so `FIRE_FACING - s.facing` is exactly `−angleDelta · turn`, and the expression collapses
to **`cart.rotation.y = π · turn`**. The cart's world yaw therefore sweeps `FIRE_FACING →
FIRE_FACING + π` (**+180°, CCW**) while the trader sweeps `FIRE_FACING → OUT_FACING`
(**−135.90°, CW**).

Measured from the shipped constants (`EDGE (0, −12)`, stall r 4.2 @ 300°):

| quantity | value |
|---|---|
| `IN_FACING` | 14.10° |
| `OUT_FACING` | 194.10° |
| `FIRE_FACING` | −30.00° |
| actual turn arc `angleDelta(FIRE_FACING, OUT_FACING)` | **−135.90°** |
| cart world yaw at `turn = 1` | **150.00°** |
| walk heading at `turn = 1` | **194.10°** |
| error | **−44.10°** |

Two consequences, both visible on every visit's ~6 s walk-out:
1. **During the turn** the cart spins 180° one way while the trader turns 136° the other — relative
   to the body the cart rotates ~316° in ~1 s.
2. **At rest** the shafts (`:267`/`:268`, cart-local `+z`, commented *"reaching forward to the
   trader's hands"*) point 44.1° off the trader instead of at them.

The code's own stated goal (`:318-321`: *"the cart ends up behind them again, **facing the way they
walk**"*) is not met — `facing the way they walk` is 194.10°, not 150°. The premise in that comment
is also wrong: `cart.rotation.y` spins the cart about its own origin (`cart.position` is fixed at
`root`-local `(0, 0, CART_Z)`, `:249`), so a `0` here cannot "carry it around through the trader";
the *position* sweep is identical under either formula. Note the walk-in leg already uses `0`
(`:322` false branch) and the parked case uses `0` (`:341`), so walk-out is the odd leg out.

The expression's intent was clearly "cancel the body's sweep" — and cancelling the real arc
`angleDelta(FIRE_FACING, OUT_FACING)` (−135.90°) is algebraically **exactly `0`**. `Math.PI` is a
stand-in for an angle the code does not have.

*Minimal fix:* `cart.rotation.y = 0;` for both legs (i.e. drop the `s.leaving ? … :` ternary) — the
cart then trails aligned with the walk, matching walk-in and park. If the counter-term is wanted
for its own sake, use the real arc: `(FIRE_FACING - s.facing) + angleDelta(FIRE_FACING, OUT_FACING) * s.turn`.
Also worth correcting the `:318` comment: the turn rides the first 45 % of the leg
(`TURN_WINDOW`, `:177`), not "on the spot at the stall".

This is the same file, same class of assumption (scene-graph / transform correctness) as the wave's
live-caught Critical, and it is unreachable by `tsc` or the suite — `src/render/**` has no tests.

### Minor

**M1 — `src/ui/index.ts:247-253` (pump call at `:415`) — the visit-end auto-close closes the
popover but not the render ring, so the next visit opens with a lit ring and no face.**
`closeTraderFace()` flips `traderMode`, hides `traderCard` and (when nothing else is selected)
hides the popover — it never notifies `actions.onSelect`, so `main.ts:46`'s
`render.setTraderSelected(false)` never runs and `traderSelected` stays `true`
(`src/render/index.ts:116`, re-applied every frame at `:184`). While away the ring is invisible
(`trader.ts:298-300`), but the moment visit 2 starts `ringGroup.visible = selected` re-lights it
(`trader.ts:345`) under a closed popover — for the whole visit, until the player's next canvas
click (`main.ts:137`) or panel action. Reachable by simply opening the trader once and going idle.
*Minimal fix:* in `closeTraderFace()`, call `actions.onSelect(null);` — safe because `traderMode`
can only be `true` while `selectedId === null && selectedStructureId === null` (every other face
opens via `clearSelectionVisuals`, `:102-111`), so the villager/structure halves are no-ops.

**M2 — `src/sim/visitor.test.ts:140-161` — Review Focus 3's spice half has no test.**
The pin (spec `:136-137`, plan `:60-61`) reads *"big-dt does not double-consume spices or
trades"*. The two tests cover schedule single-fire and assert `tradesLeft === TRADES_PER_VISIT`
after a giant arrival (`:148`), which covers the **trades** half; the **spice** half is never
exercised — every hearty-eat test drives the sim in 50 ms steps (`:171`, `:189`, `:204`). The
implementation looks safe by construction (a `walk()` arrival resolves to `'resting'` in the same
tick, `sim/index.ts:556`, so one tick can eat at most once per villager), but nothing pins it.
*Minimal fix:* one test — set a `'walking'` villager with `pot.meals ≥ 1` and
`resources.spices = 2`, call `tick(state, 10_000_000)`, assert exactly one spice consumed, one
`eat` event, `state.resources.spices === 1`.

**M3 — `src/ui/derive.test.ts:730-750` — Review Focus 4's "simultaneously" half is pairwise only.**
The pin (spec `:137-138`) asks for *"hint priority with trader + thanks + favor **simultaneously**"*.
The test builds embers+trader, thanks+trader, favor+trader and trader+dimming/meals/roaring —
never a state with an active favor **and** a `thanks` name **and** a live visit. `villageLine` is a
linear if/return chain (`derive.ts:119`), so the pairwise results are transitive and I could
find no ordering defect; this is a coverage gap, not a bug. *Minimal fix:* one extra assertion —
`villageLine(state({visitor: visiting(), villagers: [villager('v1')], favors: favors([{active:true}])}), 'Fern')`
→ `'Fern is delighted!'`.

**M4 — `src/ui/index.ts` has no test file — the trader-face open/close matrix is unpinned.**
This is the gap already flagged in the brief (auto-close on deselect / ground / visit end /
`selectTrader(on?)`), and it is worth stating plainly because it is the same hole that shipped
batch 6's C1: everything in `ui/index.ts` — `applyTraderSelection` (`:224`), `closeTraderFace`
(`:247`), `selectTrader` (`:476`), `syncTrader` (`:212`), the `data-face` switch (`:109`,
`:236`) and the pump's `traderMode` branch (`:413-416`) — is covered only by the pure
`derive.ts` helpers. The suite has 12 files; none touches `src/ui/index.ts`, `src/render/**` or
`src/audio/**`. *Minimal fix:* none required by this spec (Part 5 asks only for the pure
`tradeDisabled` / hint / pot tests, which exist); record it as the standing DOM-test debt, and
keep M1 in mind while the face has no test.

**M5 — `src/render/trader.ts` scene-graph assumptions are load-bearing and untested.**
Judgement requested by the review brief. Enumerated:

| assumption | site | status |
|---|---|---|
| `group.add(root)` — the rig is actually in the graph | `:282` | **was** the shipped Critical; now correct, still only guarded by a human live pass |
| `group.visible = visiting` gates `pick()` (three.js skips invisible meshes) | `:296` → `:186` | correct; untested |
| ring parented to `group`, not `root`, so it does not inherit yaw | `:277` | correct; untested |
| ring position copied from `root` each frame while visiting | `:347` | correct; untested |
| `trader.group` added to `scene` on lazy first `render()` | `render/index.ts:166-168` | correct; untested |
| `dispose()` clears children before `disposeScene` (no double-dispose) | `:288-292` | correct; untested |

None of these is currently wrong. They are, however, exactly the class of defect that produced the
wave's Critical: invisible to `tsc`, invisible to the suite, and each one failing silently rather
than throwing. *Minimal fix (the one T4 itself proposes, `T4-traders-render-report.md:130-132`):*
one scene-graph assertion — a test that builds the layer and asserts
`group.children.includes(root)` and that a ray through the projected stall pixel hits a
`userData.trader` mesh while away and does not while visiting. Until then, keep that check in the
orchestrator's live pass for every subsequent render task.

---

## Review-Focus pin table

| # | pin (spec `:135-138`) | test | verdict |
|---|---|---|---|
| 1 | reload mid-visit resumes exactly (persist) | `persist/index.test.ts:314` "v4 round-trip mid-visit (Review Focus 1)"; arrivals twin at `:456` | ✅ |
| 2 | no trade while away, never negative resources (sim) | `visitor.test.ts:111` "refuses while away, out of stock, or unaffordable — changing nothing" (all three refusal paths + exact deltas + `pendingEvents` queue at `:91`) | ✅ |
| 3 | big-dt does not double-consume spices **or trades** (sim) | `visitor.test.ts:141` + `:152` (single arrival/departure, `tradesLeft === 3` at `:148`) | ⚠️ trades ✅ · spice half untested → **M2** |
| 4 | hint priority with trader + thanks + favor *simultaneously* (UI) | `derive.test.ts:730` "priority: embers > (thanks \| favor) > trader > dimming > …" | ⚠️ pairwise only → **M3** |
| 5 | v1→v4 migration chain intact end-to-end (persist) | `persist/index.test.ts:234` "v1 → v4 chained migration", `:267` roster-reject-after-chain, `:276` v3→v4 | ✅ |
| — | trader-face auto-close matrix (DOM) | *none* | ❌ known gap → **M4** |

Plan-step test scope is otherwise fully met: first visit at exactly 240 000 (`visitor.test.ts:50`),
stay 120 000 then a fresh 360 000 (`:63`), `tradesLeft` reset (`:76`), hearty eat / no-spice eat /
favor counting (`:164`, `:182`, `:196`), v3→v4 defaults (`persist:277`), invalid visitor shape
(`:334`), spices validation (`:373`), `tradeDisabled` truth table (`derive.test.ts:780-810`),
pot suffix (`:828-850`), hint slot (`:716-726`).

---

## Checked and clean (no findings)

**Schedule.** Constants exactly as spec Part 1.2 (`tasks.ts:124-137`: 240 000 / 120 000 / 360 000 /
6 000 / 3 / 90 000 / 5 / 4 / 6). `tick` steps single-shot (`sim/index.ts:275-296`): a giant `dt`
crosses at most one boundary, so no transition is ever skipped or double-fired — the excess time is
discarded, which is the safe direction (a looping implementation would silently swallow a whole
visit). `visitMs` is always reset in the same tick that ends the visit, so the render never sees an
out-of-range `visitMs`. Ordering matches the plan: visitor block after the arrivals loop, before
the villager loop, inside the `dtMs > 0` region (consistent with `arrivals`, and a save carrying
`inMs = 0` transitions on the next positive tick).

**`trade()`.** Exact rates; the three refusal paths (`:179-189`) each return before any mutation;
`tradesLeft` decremented once per call and guarded by `tradesLeft <= 0`, so nothing in `tick` can
double-consume. Event queued to `pendingEvents` (`:191`), seeded at the top of `tick` *before* the
`dtMs <= 0` early return, so it survives a `tick(state, 0)` and a save/load in between. `tradeKind`
present and correct on both kinds.

**Hearty eats.** Exactly one spice per arrival (`:541-552`), `fedMs = HEARTY_FED_MS` only in the
spice branch, `restMs = EAT_REST_MS` on both branches, full-belly guard untouched, `eat` keeps its
type so `favors.ts`'s `EVENT_TYPE_FOR` (`favors.ts:56-61`) counts it unchanged — pinned by
`visitor.test.ts:196`.

**Persist v4.** Chain v1 → v2 → v3 → v4 with **post-migration `isPlausibleState` re-validation on
every branch** (`persist/index.ts:237`, `:243`, `:254`) — batch 6's I1 is closed, and the closure is
the stronger form (v4-level, not stage-level). `spices` finite ≥ 0 (`:174-175`), visitor shape with
enum phase / finite ≥ 0 times / integer `tradesLeft ∈ [0, TRADES_PER_VISIT]` (`:146-163`), arrivals
shape and the `[8,12]` roster bound still live under `isPlausibleV3State` (`:131-138`).
`migrateV3toV4` matches spec Part 2 to the letter (`:204-210`). `pendingEvents` is required by
`isPlausibleV1State` (`:56`), so an older blob can never reach `tick` with an undefined queue.

**UI.** `tradeDisabled` (`derive.ts:193-199`) mirrors `trade()` field-for-field. The trader face
shows exactly title + `Trades left: N` + the two buttons: `data-face='trader'` hides `.task-grid`
and `.favor-line` (`ui.css:309-311`), `card.sync(state, undefined)` retires the structure card
(`ui/index.ts:237`), and `traderCard` is the only sibling shown — verified against the popover's
full child list in `markup.ts:69-96`. Hint priority is `embers > (thanks | favor) > trader >
dimming > …` (`derive.ts:119`), with both visit edges forcing an immediate recompute
(`hintRecomputeDue`, `derive.ts:168-176`; `ui/index.ts:445-460`). Pot suffix is derived, not
hand-written (`structure-card.ts:42-45`) and lands in the signed `status` view field, so it
repaints. `TRADE_LABELS` single-sources 5/4/6 from the sim constants (`derive.ts:46-49`), with the
unsanctioned spice yield documented as a literal (`:44`).

**Render.** Position, facing, wheel roll and the linger sway are all pure functions of
`(phase, visitMs)` / the render clock — `stepAt` fills a module-level `Step` (`trader.ts:122`,
`:145-146`) so it is **allocation-free**; `root.position` / `root.rotation.y` / `cart.rotation.*` /
`wheel*.rotation.x` are all absolute writes, never accumulated, so a reload mid-visit is exact.
`visitMs ∈ [0, VISIT_STAY_MS)` by construction, so the walk-out leg always runs and the trader
vanishes at the edge rather than mid-village. `pick` is gated on `group.visible`; the click chain in
`main.ts:126-146` is villager → trader → structure → ground with all three selection cues written
every click, and `ui.select(null)` → `ui.selectStructure(null)` → `ui.selectTrader()` lands the
trader face last so nothing clobbers it (`applyStructureSelection(null)` is a drop-only no-op,
`ui/index.ts:180-183`). Audio priorities match spec Part 4 exactly (`audio/index.ts:412-439`,
including `visitor-arrive 8` above `favor-start 7`), with the shared ~400 ms per-type cooldown for
both new cues (`:61`); `visitor-leave` and `arrived` stay silent (no `SfxKind`, no `case`).

**Discipline.** Three zones only, inside the §6 batch-7 whitelist (`DESIGN.md:366-367`); no new
deps, no `any`, no new UI zone, no `FOOTPRINT` / `selectionCue` churn, sim re-exports still the
sanctioned list. All four Part 7 DESIGN amendments are present (`§3:64-68, 79, 95, 117-123, 149-151,
170, 180`; `§3.2:280-287`; `§3 persist:298`; `§6:366`).

---

## Note

Fixes required by this report are I1 (render cart yaw) and optionally M1 (ring auto-close).
M2–M5 are test/observability gaps. No source file was modified by this review; `docs/tasks/
T-review-report.md` is the only file this reviewer created or changed.
