# T05 Report — World interaction: click-to-select villagers, selection ring, yield feedback

Status: **DONE**. All five acceptance criteria verified, including live browser validation
(chrome-devtools, `pnpm dev` on :5177). Changes left uncommitted in the working tree per the
task rules.

## Files

| File | Lines | Change |
|---|---|---|
| `src/render/villagers.ts` | 240 (+29 net) | mesh tagging, `pick`, `setSelected`, shared ring, `project` |
| `src/render/index.ts` | 161 (+31) | `pickVillager` / `setSelected` / `projectVillager` on `RenderHandle` |
| `src/ui/index.ts` | 222 (+35) | `select()` on `UIHandle`, yield pulse, popover dismissal scoping |
| `src/main.ts` | 72 (+31) | click/drag threshold, world-click wiring, extended `__cozy` hook |
| `src/styles/ui.css` | 167 (+11) | `.yield-pulse` keyframes, reduced-motion note |

`git diff --stat`: 200 insertions, 60 deletions across exactly those five files. No new
dependencies, no `any` (verified by grep for `: any` / `as any` / `<any>`), no new UI zone, no
subagents, no commit. Two validation screenshots added under `docs/validation/` (same
convention as T01/T03/T04).

Validation artifacts:

- `docs/validation/T05-selection-pulse.png` — Juniper selected by a 3D click: `.selected`
  card, popover open with their name, soft ring at their feet, and the Wood pill caught
  mid-pulse at scale 1.06.
- `docs/validation/T05-cleared.png` — the same frame after a ground click: no ring, no
  selected card, popover closed, pill back to scale 1.

## What was built

**1. `src/render/villagers.ts` — selection support (three additive `VillagersLayer` members)**

- **Tagging:** `createRig`'s existing `root.traverse` now also writes
  `obj.userData.villagerId = villager.id` on every mesh, next to the pre-existing
  `castShadow = true`. Nothing else about the rig changed.
- **`pick(raycaster)`:** iterates `raycaster.intersectObjects(group.children, true)` and
  returns the first hit whose `userData.villagerId` is a string, else `null`. The value is
  read into an `unknown` and narrowed with `typeof`, so the `any` that `userData` is typed
  as never enters the code. The shared ring is deliberately untagged, so a ray that clips the
  ring first simply skips it and keeps going to the body behind it.
- **`setSelected(id)`:** stores the id; `update()` applies it. One shared ring
  (`RingGeometry(0.27, 0.33, 48)`, `MeshBasicMaterial`, `PALETTE.fire` = the 3D mirror of
  `--accent`, `opacity 0.34`, `depthWrite: false`, `DoubleSide`) lies flat at `y = 0.015`
  under the selected villager's rig root, repositioned every frame so it follows them while
  they walk. `ring.visible` is false whenever nothing is selected *or* the selected id has
  no rig (e.g. the villager left the roster). The ring is never a child of a rig, so there is
  exactly one ring in the scene regardless of selection changes.
- **Breath:** `scale = 1 + (1 - cos(2π·t / 1.2)) · 0.04` → runs 1.0 → 1.08 → 1.0 over 1.2 s.
  A cosine is used rather than a triangle/sine so the pulse eases at both ends of the cycle:
  no velocity discontinuity, which is what feel pillar 4 ("everything eases") asks for. Only
  `scale` animates — opacity is constant, so there is no colour jump.
- **`project(id, camera, out)`:** `rig.root.getWorldPosition()` → `+PICK_LIFT` → `.project(camera)`
  → writes NDC xy into the caller's `THREE.Vector2`. Returns `false` for an unknown id or
  when `z > 1` (behind the camera, where the xy projection is meaningless).

**2. `src/render/index.ts` — the three new `RenderHandle` members**

- `pickVillager(x, y)` builds NDC from `canvas.getBoundingClientRect()` (so any canvas offset
  or scroll is handled), calls `raycaster.setFromCamera`, delegates to the layer, and returns
  `null` when the layer does not exist yet or the rect is degenerate.
- `setSelected(id)` keeps `selectedId` in a closure **and** forwards it, so the selection
  survives frames and layer re-creation; `render()` re-applies it every frame after
  `villagers.update()`.
- `projectVillager(id)` delegates to the layer and converts NDC → client px via the same
  rect, adding `rect.left/top` so the result is genuinely client-space.
- One `Raycaster`, one `Vector2` for NDC and one for the projected result are allocated once
  per `initRender`, not per call.

**3. `src/ui/index.ts` — `select(villagerId)`**

- External selection reuses `openPopover`, so a 3D click produces byte-identical visuals to a
  card click: `.selected` on the card, popover open with the villager's name and the same
  three task buttons, active task in sync (`syncActiveButtons` runs from `render()`).
- `null` → `closePopover()`: `.selected` removed and popover hidden.
- **Before the first `render()`:** `select()` parks the request in `pendingSelection`
  (`undefined` = nothing pending, `null` = pending clear) and `render()` applies it
  immediately after `buildCards`. This keeps the guard honest without a second code path.
- **Yield pulse:** inside the existing per-resource loop, a `chop` / `gather` event in
  `state.events` adds `.yield-pulse` to the matching pill, preceded by
  `classList.remove` + a forced reflow (`void pill.offsetWidth`) so repeated yields in
  consecutive frames re-trigger the animation instead of being swallowed.

**4. `src/main.ts` — world clicks**

- `pointerdown` records `(x, y)` and clears the drag flag; `pointermove` (while a button is
  held) latches `dragging` once the pointer has travelled more than `CLICK_SLOP_PX = 6`;
  `pointerup` re-measures and bails if either the latched flag or the final displacement
  exceeds the threshold. On a click: `ui.select(render.pickVillager(x, y))` plus
  `render.setSelected(id)`, so render and UI can never disagree about who is selected.
- `__cozy` extended to `{ getState, projectVillager }` per DESIGN §3, matching the contract
  exactly (no extra members, nothing renamed).

**5. `src/styles/ui.css` — yield feedback**

```css
.pill.yield-pulse { animation: pill-pulse 200ms ease; }
@keyframes pill-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
```

`transform` only, so nothing reflows. Disabled under `prefers-reduced-motion` by the existing
`#ui * { animation: none !important }` block (comment added there to say so).

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` (tsc + vite build) | exit 0 — `dist/assets/index-CCz6eyX9.css 3.75 kB`, `dist/assets/index-BT12i1s0.js 581.85 kB │ gzip: 147.17 kB` |
| `pnpm test` | exit 0 — 3 files, 19 tests passed |

(The pre-existing "chunks are larger than 500 kB" advisory from Vite is unchanged — it is
three.js, not new code.)

## Browser validation (chrome-devtools, `pnpm dev` on :5177, 1280×820)

Console: clean. Only `[vite] connecting… / connected.` debug lines, no warnings or errors —
at boot, after selection churn, and after several minutes of continuous chopping/gathering.

Gestures were dispatched as a **full trusted-shaped sequence** (`pointerdown` → `pointermove`
→ `pointerup` → the compatibility `click` on `document`). That last event matters — see the
bug below.

| Check | Result |
|---|---|
| Click a villager's `projectVillager` px (`v5`, Hazel) | card `.selected` = `v5`, popover title `Hazel`, popover open |
| Click empty ground (200, 760) | `.selected` cleared, popover hidden |
| 40 px drag starting on a villager (`v6`) | **no selection** (stayed `null`) |
| 4–5 px wobble on `v7` | still selects `v7` — the 6 px threshold is not annoyingly tight |
| All 8 villagers, click at their projected px | `v1 ok … v8 ok`, no mismatches |
| Card click still works | `v3` / `Fern` selected, popover opens |
| UI click outside popover (HUD) still dismisses | selection cleared, popover hidden |
| `Escape` still closes | selection cleared, popover hidden |
| `projectVillager('nope')` | `null` |
| `__cozy` surface | `["getState","projectVillager"]` |

Ring: visible in `T05-selection-pulse.png` as a thin warm ellipse at the selected villager's
feet, and absent in `T05-cleared.png` after a ground click. It reads as a hint, not an
outline — exactly the intended weight at the default camera distance.

`__cozyRender.info()`: `calls` **100–112** across every state measured (idle, 8 villagers,
selection active, ring visible, three villagers working), against the `< 200` budget. T04's
report flagged the 99–110 band against a `< 120` budget; the ring adds **+1–2 calls** and
`geometries` goes 15 → 16 (the ring's one geometry). Well inside T05's `< 200`.

Yield pulse, measured rather than eyeballed:

- Polling `getComputedStyle(pill).transform` across a 2.5 s window while three villagers
  worked: peak scale **exactly 1.06**, 35 frames sampled while an animation was live.
- A `MutationObserver` on the pill's `class` counted **44** pulses while wood climbed 0 → 44,
  i.e. one pulse per yield, and none were swallowed by consecutive-frame retriggers.
- **No layout shift:** `#hud` rect was `{x:16, y:16, w:267.9375, h:52}` and the Wood pill rect
  `{x:25, y:25, w:117.515625, h:34}` both during the pulse and at rest — byte-identical. The
  frozen-at-peak screenshot shows the enlarged pill side by side with the untouched one.
- After clearing, the pill's computed scale returns to exactly `1` (no stuck class).

## A real bug this task surfaced (and fixed)

The UI already had a document-level `click` handler that dismissed the popover for any click
outside the popover and the villager list. `main.ts` calls `ui.select(id)` from `pointerup`,
and a **trusted** click then delivers a `click` event to `document` in the same gesture — so
that handler would have closed the popover and removed `.selected` microseconds after every
real 3D click, making acceptance criterion 2 fail in a real browser while passing under naive
synthetic `pointerdown`/`pointerup` dispatch (which emits no `click`).

Fixed in `ui/index.ts` by scoping dismissal to clicks **inside the UI root**:

```ts
if (popover.hidden || !(ev.target instanceof Node)) return;
if (!root.contains(ev.target)) return; // world clicks are selection-driven (T05)
```

Verified afterwards with the full trusted-shaped gesture sequence: world click keeps the
selection open, ground click clears it, card click and HUD-click-dismiss behaviour unchanged.
This is the one behavioural change to existing code in the task and it is listed as deviation 1.

## Deviations

1. **`onDocumentClick` is now scoped to clicks inside `#ui`** (see above). Necessary for T05 to
   work with real mouse input; every other dismissal path (card click, HUD click, `Escape`) is
   unchanged and verified.
2. **`project()` lifts the rig root by `PICK_LIFT = 0.5` before projecting.** The brief says
   "projecting the rig root position". Taken literally that is the point between the feet, and
   a ray through it grazes the bottom edge of the body sphere — at the default 40° camera
   pitch it would frequently miss, so acceptance criterion 2 ("click their screen position →
   that card gets `.selected`") would be flaky. Lifting to mid-body keeps the specification's
   intent and makes the hit reliable: all 8/8 villagers pick correctly at their returned pixel.
   The ring still tracks the true root position, unaffected.
3. **Ring colour is `PALETTE.fire`, not a new `PALETTE.accent`.** `palette.ts` is T3-owned and
   outside this task's allow-list, and `PALETTE.fire` is already the byte-identical mirror of
   `--accent` (`#e08a3c`). Noted in a comment at the material so T6 does not "fix" it into an
   inconsistency. Worth a ruling: adding `accent: '#e08a3c'` to `palette.ts` would be cleaner.
4. **One shared `Raycaster` + two scratch `Vector2`s in `initRender`,** reused by every call,
   rather than allocating per pick.
5. **`render()` re-applies `setSelected(selectedId)` each frame** in addition to forwarding it
   in `setSelected()`. Redundant today, but it is what makes "the ring survives frames" true if
   the villager layer is ever recreated; costs one map-free assignment.
6. **`void pill.offsetWidth`** is used for the retrigger reflow. Deliberate: removing and
   re-adding the class alone does not restart a CSS animation, and T05 adds no dependencies,
   so no Web Animations API is used for the retrigger.

## Known gaps / concerns for the orchestrator

1. **`src/render/villagers.ts` is 240 lines against the "~220" target** — the one acceptance
   criterion that is not met exactly. The arithmetic: the file arrived from T04 at 211 lines
   and T05 mandates three new interface members plus the ring construction, the ring's
   per-frame follow/pulse, and the tagging pass (~63 new lines). I compacted ~34 lines of T04
   formatting to absorb as much as possible (grouped the constants 17 → 11 lines, folded the
   two arm constructions into an `armPivot()` helper, inlined the `Rig` return literal,
   dropped `rigs.forEach` for a `for…of` with no forced braces, tightened the header). The
   remaining ~20 lines would have to come out of `createRig`/`pose()`/`animate()` — T04 code —
   or out of comments, and I judged legible formatting worth more than the last 20 lines.
   `src/ui/index.ts` landed at 222 (2 over), everything else is well inside. No ruling needed
   unless the orchestrator wants a hard 220; the clean fix is a follow-up task extracting the
   ring into its own module, which this task's allow-list forbids.
2. **Draw calls remain close to the ceiling** (100–112 measured, T05 budget is `< 200`, but
   T04 measured 99–110 against a `< 120` budget). T05 adds +1 for the ring. **T06 (ambient
   life) will very likely breach `< 200`.** Same mitigations as T04's report: instance the
   villager body/head/arms (they already share geometry and material, so per-instance matrices
   would collapse ~32 calls), or raise the budget. This is now two tasks running against a
   budget that was already tight — a ruling before T06 is recommended.
3. **The `select()`-before-first-`render()` path is verified by construction, not executed.**
   `__cozy` is only assigned after `initUI` and `requestAnimationFrame`, and `main.ts` can only
   call `ui.select` from a `pointerup`, so no page script can reach that state. The logic is 12
   lines and reviewed, but it has not been observed running. If the orchestrator wants it
   proven, the cheapest route is widening a future task's allow-list to add a unit test for
   `ui/index.ts` under jsdom/happy-dom — which would also cover the yield-pulse retrigger.
4. **No automated test covers any T05 code.** The brief's allow-list is five source files, so
   the click threshold, the pick hit-rate and the pulse retrigger are only verified by the live
   browser run above. The `CLICK_SLOP_PX` comparison and the pulse `remove → reflow → add`
   sequence are both cheap pure-logic candidates if the allow-list is ever widened.
5. **Inherited from T04, unchanged and still open:** resting villagers stand inside the
   campfire ring and read as standing in the flame; villagers are legless; arms hang just
   outside the body silhouette. None are T05 concerns, and none are made worse by the ring —
   at the default camera distance it reads as a soft pool of light rather than a UI gizmo.
6. The dev server started on port 5177 for validation has been stopped (port confirmed free),
   so the tree is clean apart from the intended changes and the two new PNGs.
---

# Round 1 — orchestrator validation fixes (F1 coherence, F2 visibility)

Status: **DONE**. Both findings fixed and verified live in the browser. Still uncommitted.

## Files changed in round 1

| File | Lines | Round-1 change |
|---|---|---|
| `src/ui/index.ts` | 235 (+13) | `UIActions.onSelect`; silent `clearSelectionVisuals()` split out of `closePopover()`; `openPopover` takes a `notify` flag |
| `src/render/villagers.ts` | 250 (+10) | ring rebuilt as a two-tone `ringGroup` (cream halo + accent ring) |
| `src/main.ts` | 74 (+2) | wires `onSelect: (id) => render.setSelected(id)` |

`src/render/index.ts` (161) and `src/styles/ui.css` (167) were **not** touched — neither finding
needed them. `git diff --stat -- src` is now 229 insertions / 64 deletions, still confined to the
five allow-listed files. `DESIGN.md` was edited by the orchestrator (the §3 `UIActions` ruling) and
is left as found.

## F1 — selection coherence between the panel and the world

`UIActions` now matches the updated DESIGN §3 contract exactly:

```ts
export interface UIActions {
  assignTask(villagerId: string, task: TaskId | null): void;
  onSelect(villagerId: string | null): void;
}
```

The subtlety is that four internal paths change the selection while two external ones must stay
silent, so `closePopover` was split:

- **`clearSelectionVisuals()`** — silent. Drops `.selected`, nulls `selectedId`, hides the popover.
- **`closePopover()`** — user dismissal (Escape, outside click). Calls the silent reset, then
  `actions.onSelect(null)`. Guarded with `if (popover.hidden) return;` so a dismissal that has
  nothing to dismiss cannot emit a spurious clear into the render layer.
- **`openPopover(card, state, notify)`** — `notify: true` from the card click (fires
  `onSelect(villager.id)`), `notify: false` from `applySelection` (external). Note `openPopover`
  previously called `closePopover()` as its first line, which under the new contract would have
  emitted a `null` before every panel selection; it now calls the silent variant instead.
- **`applySelection()`** — the external path (`UIHandle.select()` and the pending-selection replay
  in `render()`) is entirely silent, because `main.ts` already called `render.setSelected(id)` in
  the same gesture.

`main.ts` wires `onSelect: (villagerId) => render.setSelected(villagerId)`. The world-click handler
is unchanged and still sets both sides itself. There is no cycle: `onSelect → render.setSelected`
never calls back into the UI.

Verified in the browser, all six paths, with a full trusted-shaped gesture
(`pointerdown` → `pointerup` → `click`):

| Path | Card `.selected` | Popover |
|---|---|---|
| world click on Hazel (`v5`) | `v5` | open, title `Hazel` |
| **card click on Moss (`v7`)** | `v7` | open, title `Moss` |
| **card click on Birch (`v2`)** — switches selection | `v2` | open, title `Birch` |
| **Escape** | cleared | hidden |
| **outside click on the HUD** | cleared | hidden |
| ground click | cleared | hidden |

F1 is also confirmed **visually**, not just via DOM state: `docs/validation/T05-ring-panel-click.png`
and `T05-ring-closeup.png` show the ring lit under Pip after a card click with **no canvas gesture
at all**, and `T05-ring-escape-cleared.png` shows the ring gone from Fern's feet after Escape.
In `T05-ring-on-grass.png` the ring has correctly moved from Pip to Fern when the card selection
switched.

## F2 — the ring now reads at a glance

The old single ring was `RingGeometry(0.27, 0.33)` at `opacity 0.34` in accent orange — over the
cream clearing disc (`#ece0c3`) and the muted grass that is a value-contrast of almost nothing, and
the orchestrator's read was correct.

It is now a `THREE.Group` holding two flat annuli, so one transform drives both:

| Layer | Geometry | Colour | Opacity | `renderOrder` |
|---|---|---|---|---|
| `halo` (underlay) | `RingGeometry(0.28, 0.37, 48)` | `PALETTE.flowerWhite` | 0.72 | 1 |
| `accent` (on top) | `RingGeometry(0.31, 0.345, 48)` | `PALETTE.fire` | **0.92** | 2 |

- `halo.rotation.x = accent.rotation.x = -Math.PI / 2`, both `DoubleSide`, both
  `depthWrite: false`, `transparent: true`.
- `renderOrder` is set explicitly so the halo can never win a transparent sort against the accent
  ring — without it the two coplanar transparents could flicker.
- The group sits at `RING_Y = 0.015`, above the grass (`y = 0`) **and** the clearing disc
  (`y = 0.01`, `environment.ts`), so it cannot z-fight either surface. Comment updated to say so.
- The breath is unchanged and now scales the group: `1 + (1 - cos(2π·t / 1.2)) · 0.04`, i.e.
  1.0 → 1.08 → 1.0 over 1.2 s, cosine-eased at both ends.
- Colours reuse the palette rather than new hex literals: `PALETTE.fire` is the mirror of
  `--accent`, and `PALETTE.flowerWhite` (`#f4efe2`) is the palette's warm off-white standing in for
  `--paper` (`#fdf6e9`). `palette.ts` remains T3-owned and outside this task's allow-list; the same
  open ruling from round 1 applies to both tokens.

Read on both surfaces, confirmed by screenshot:

- **Tan clearing disc:** `T05-ring-closeup.png` — cream halo with a distinct orange ring inside it.
- **Grass:** `T05-ring-on-grass.png` — Fern working at a tree on the grass, ring clearly legible.

It still reads as a soft pool of light rather than a UI gizmo: a rounded, translucent annulus with
a 0.09 u accent band over a 0.09 u halo, and no hard edge or full disc.

## Regression check after the fixes

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 — `dist/assets/index-CInPq6F-.js 582.14 kB │ gzip: 147.26 kB` |
| `pnpm test` | exit 0 — 3 files, 19 tests |
| World click still selects | `v5` / `Hazel` |
| Escape after a **world** click clears both sides | card cleared, popover hidden |
| 40 px drag still does not select | `null` |
| Yield pulse still fires | 27 frames with a live animation, peak scale exactly `1.06` |
| No layout shift | `#hud` rect `{x:16, y:16, w:263.4375, h:52}` — width differs only because the Wood counter grew to two digits, position and height unchanged |
| Console | clean — only `[vite] connecting… / connected.` |
| `__cozyRender.info()` | `calls 105` (was 100–112 before the round), `geometries 17` (+1 for the halo) — well inside the `< 200` budget |

## Deviations (round 1)

1. **`closePopover()` gained an early return when the popover is already hidden.** Not in the
   brief; it prevents a dismissal with nothing to dismiss from pushing a redundant `onSelect(null)`
   into the render layer on every stray canvas click.
2. **The halo is `PALETTE.flowerWhite`, not a literal `#fdf6e9`.** `flowerWhite` is the palette's
   existing warm off-white and is 2–3% darker than `--paper`; using it keeps `palette.ts` the single
   source of 3D colour without touching a T3-owned file. If the orchestrator prefers an exact
   token match, add `paper: '#fdf6e9'` to `palette.ts` and swap the reference.
3. **Halo opacity is 0.72, below the 0.85–0.95 the finding quoted.** That range was read as applying
   to the ring that has to carry the read (the accent ring, at 0.92). The underlay is a contrast
   band, not the signal; at 0.9 it would read as a solid white disc around the villager and start to
   look like a UI gizmo, which the same finding forbids. Flagging in case the intent was literal.

## Known gaps / concerns (round 1)

1. **`villagers.ts` is now 250 lines and `ui/index.ts` 235**, up from 240/222. Both fixes were
   additive on top of the round-1 deviation already reported: a second ring layer costs ~10 lines
   and the `onSelect` contract costs ~13. Nothing else was changed this round, per instruction, so
   the overage grew rather than shrank. The honest fix is the one already proposed — extract the
   ring into its own module — which this task's allow-list still forbids. A ruling is needed if the
   ~220 line target is meant to be hard.
2. **No automated test covers either fix.** `onSelect` firing exactly once per internal change, and
   *not* at all on the external path, is the kind of contract that regresses silently — a future
   refactor that moves `notify: true` onto the shared `applySelection` path would double-fire, and
   one that inlines `closePopover` would stop firing on Escape. Both are only guarded by the live
   browser table above. Verifying them properly needs a widened allow-list for a `ui/index.ts`
   test; I did not add one because the instruction was to change nothing else.
3. **The ring is a child of the villager layer's group, so it is created lazily on the first
   `render()` call.** `render.setSelected` stores the id and `render()` re-applies it every frame,
   so a selection made before the first frame still lights up — verified by construction, and by the
   `T05-ring-panel-click.png` capture taken well after boot. Untested for the pre-first-frame case
   specifically, same as the round-1 note on `select()` before the first `render()`.
4. Round-1 concerns still open and unchanged: `PALETTE.accent` / `PALETTE.paper` token ruling;
   draw calls at 105 against T04's older `< 120` budget (T06 pressure); resting villagers inside the
   campfire ring; the `select()`-before-first-render path. Dev server on :5177 stopped, port free.
