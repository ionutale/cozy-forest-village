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

---

# Round 2 — pre-playtest fix batch (I2, M10, M11a, M11b, M12)

Status: **DONE**. All five findings fixed and verified live. Still uncommitted.

Note: T05 (including round 1) was committed as `f456266`, and T06/T07 landed in between, so this
round started from a tree that now has `src/audio/` and `src/render/ambient.ts`. `main.ts` already
carried T06's `audio.update(state, dt)` call and that line is preserved verbatim inside the new
try/catch. Round 1's `onSelect` and two-tone ring were confirmed still present in `HEAD` before I
started (`onSelect` ×3, `ringGroup` ×7).

## Files changed in round 2

| File | Lines | Change |
|---|---|---|
| `src/ui/index.ts` | 264 (+29) | Stop button, pulse throttle, travel-state card labels |
| `src/styles/ui.css` | 180 (+13) | `.stop-btn` neutral + disabled styling |
| `src/main.ts` | 94 (+20) | frame-loop containment, `pagehide` teardown |
| `src/render/villagers.ts` | 252 (+2) | torso + head are the only shadow casters |

`src/render/index.ts` (170, T06-modified) was **not** touched — no finding needed it.
`git diff --stat` is now 4 files, +80/−19, all inside the T05 allow-list. No commit.

## F2.1 — Stop button (I2)

A fourth button in the existing task popover, so the player can always return a villager to idle:

```html
<button class="task-btn stop-btn" type="button" data-task="stop" aria-disabled="true">Stop</button>
```

- `onPopoverClick` branches on `data-task === 'stop'` first and calls
  `actions.assignTask(selectedId, null)` — the sim's existing "unassign" path, no new sim code.
- The handler re-checks `aria-disabled` before acting. CSS `pointer-events: none` already blocks the
  mouse, but a `<button>` is still keyboard-activatable, so the guard is what actually makes the
  disabled state honest.
- `syncActiveButtons` now also drives `stopBtn.setAttribute('aria-disabled', task === null ? 'true' : 'false')`,
  so it flips in the same frame the task changes, from the same source of truth.
- Styling is deliberately quiet: transparent background, `border-style: dashed`,
  `color: var(--ink-soft)`, `font-weight: 600`, and `.stop-btn:hover` keeps the plain border instead
  of the accent hover the task buttons use. Disabled is `opacity: 0.45; pointer-events: none`.
  It can never pick up `.active` — `syncActiveButtons` compares `dataset.task` against the villager's
  task, and `'stop'` is never a `TaskId`.
- Still no new zone: `#task-popover` is nested inside `#villager-panel`, and
  `document.querySelectorAll('#ui > *').length === 2` (`#hud`, `#villager-panel`) before and after.
  The popover now holds 4 `.task-btn` elements.

Verified:

| Check | Result |
|---|---|
| Stop while working | `aria-disabled="false"`, `pointer-events: auto`, styling `dashed` + `rgba(0,0,0,0)` |
| Press Stop (Maple, chopping) | `{ state: 'idle', task: null }`, card label back to `Idle` |
| Wood after Stop | `woodDelta = 0` over 3 s — the counters really stop |
| Stop while idle | `aria-disabled="true"`, computed `opacity 0.45` |
| Stop dispatched directly while disabled | no-op, sim keeps ticking |
| Select an idle villager | Stop already disabled |
| Assign `rest` then wait | label `Walking…` → `Resting`, Stop enabled, `Rest` the active button |

`docs/validation/T05-stop-and-labels.png` shows the popover with three accent-eligible task buttons
and the dashed Stop underneath, plus the label column in its new form.

## F2.2 — yield pulse throttle (M11a)

`PULSE_THROTTLE_MS = 600` with a `lastPulseAt` map keyed per resource. The counter update above it is
untouched, so **only the pulse is throttled**. The throttle permits a pulse but does not schedule one,
so with chop yields every ~250 ms the observed cadence settles at one pulse per ~700 ms rather than
one per yield.

Measured with 6 villagers chopping, over a 5.0 s window:

| | |
|---|---|
| `chop` events | 20 (≈4/s) |
| `.yield-pulse` class additions | **7** (≈1.4/s) |
| Unthrottled would have been | 20 |

Counters confirmed still instant: over a separate 3 s window, 12 `chop` events produced
`woodDelta === 12`.

## F2.3 — card label shows travel state (M11b)

New `cardLabel(villager)` helper replaces the old `villager.task ? TASK_LABELS[task] : 'Idle'`:

| `villager.state` | Label |
|---|---|
| `walking` | `Walking…` |
| `working` | the task label (`Chop wood` / `Gather berries`) |
| `resting` | `Resting` |
| `idle` | `Idle` |

It reuses the existing `.task-label` element and the existing "only write when changed" guard, so no
new DOM and no extra writes. The eight-card label column reads correctly in the screenshot:
`Maple/Birch/Fern/Pip = Chop wood`, `Hazel = Gather berries`, `Juniper = Idle`, `Moss = Resting`,
`Clover = Idle`. Transition verified by polling until the label flipped and confirming the sim state
at that moment: `Walking…` while `state === 'walking'`, `Chop wood` once `state === 'working'`.

Note this changes the meaning of a subtle existing behaviour: a villager with a `rest` task now
reads `Resting` while resting and `Walking…` on the way, instead of showing `Rest` throughout. That
is the point of the finding.

## F2.4 — shadow draw calls (M10)

`castShadow` moved out of the blanket `root.traverse` and onto the two meshes that matter:

```ts
// Shadow casters are the torso and head only (M10): letting arms, hat and pom cast too
// cost ~32 shadow draws for a silhouette difference nobody can see at play distance.
torso.castShadow = true;
...
const face = new THREE.Mesh(headGeo, skinMat);
face.castShadow = true;
```

The traverse keeps only the `userData.villagerId` tagging that selection depends on.

Measured A/B rather than estimated — I reverted the change, reloaded, sampled 30 frames, restored it,
reloaded, sampled again, all at the default camera with 8 villagers:

| | `__cozyRender.info().calls` |
|---|---|
| All 6 meshes casting (before) | **117** (min 117, max 117) |
| Torso + head only (after) | **85** (min 85, max 85) |

−32 draws, exactly the predicted figure. Visual check: `docs/validation/T05-shadows-before.png` and
`T05-shadows-after.png` are the same framing at the same zoom. Villagers still drop clear soft
shadows in both; the only difference is that the hat cone, pom and arm nubs no longer add small
bumps to the shadow's edge. At play distance the two are indistinguishable, which is what "barely
noticeable" asks for.

## F2.5 — frame containment and dispose wiring (M12)

```ts
let frameErrorLogged = false;
function frame(now: number): void {
  try {
    const dt = Math.min(now - last, 100);
    last = now;
    tick(state, dt); render.render(state, dt); audio.update(state, dt); ui.render(state);
  } catch (err) {
    if (!frameErrorLogged) {
      frameErrorLogged = true;
      console.error('[cozy] frame loop failed; later frame errors are not logged', err);
    }
  }
  requestAnimationFrame(frame);
}

window.addEventListener('pagehide', () => { render.dispose(); ui.dispose(); audio.dispose(); });
```

`requestAnimationFrame` sits **outside** the try, so a throw can never stop the loop, and `last` is
updated before anything can throw, so `dt` stays sane.

Verified by injecting a real fault: with 3 villagers chopping I removed the `.pill-value` node that
`ui.render()` requires on every counter change, so the next chop yield made the frame body throw
`UI element missing: #hud [data-res="wood"]`:

| | |
|---|---|
| Threw | yes |
| `console.error` calls | **1** — one-shot flag held across 2 more seconds of further yields |
| Message | `[cozy] frame loop failed; later frame errors are not logged` |
| Loop survived | yes — `tick` kept advancing |
| Rendering continued | yes — `calls` still reported |

`pagehide` verified by dispatching a real `PageTransitionEvent`: `window.__cozyRender` went from
`object` to `undefined`, `#ui` children 2 → 0, `.villager-card` count 8 → 0. So all three layers
dispose.

## Console

Clean during normal play: 8 villagers working, selection changes, Stop presses, pulse and label
transitions — only the two `[vite] connecting… / connected.` debug lines. No errors or warnings.

## Deviations (round 2)

1. **`Stop` renders `aria-disabled` rather than the native `disabled` attribute.** A natively
   disabled button drops out of the tab order and loses its tooltip/hover affordance entirely;
   `aria-disabled` + `pointer-events: none` + reduced opacity dims it while keeping it discoverable
   in the popover, and the handler re-checks the attribute so keyboard activation cannot bypass it.
   Flagging in case the orchestrator prefers the native attribute for accessibility reasons.
2. **The pulse throttle permits rather than schedules.** A permitted pulse still only happens when a
   yield actually arrives, so the real cadence is ~700 ms with 6 choppers rather than exactly 600 ms.
   That is the intended "at most once per ~600 ms" reading and avoids a timer, but it means the
   stated bound is an upper bound on frequency, not a fixed period.
3. **`console.error` after the first frame failure is suppressed entirely**, per the "first error
   only" instruction. A genuinely new and different failure later in the session would therefore be
   silent. The one-shot flag is deliberately not time-boxed. Easy to relax if the orchestrator
   prefers "log the first error of each distinct message".
4. **`.stop-btn` reuses the `.task-btn` class** rather than introducing a new button type, to keep
   the popover's spacing, radius, font and focus ring inherited. Only three properties are overridden.

## Known gaps / concerns for the orchestrator

1. **`pagehide` disposes the layers but the frame loop keeps running**, and this is now the one place
   where M12's own teardown argues with M12's containment. Two concrete symptoms, both observed:
   - After `pagehide`, the next frame calls `ui.render()` on an emptied `#ui`, which throws
     `UI element missing: #hud [data-res="wood"]` — caught by the new try/catch and logged once. So
     containment is doing its job, but the log is noise produced by our own teardown.
   - `render.dispose()` calls `renderer.dispose()`, yet `render.render()` recreates `env` and
     `villagers` on the next frame because it nulls them; three.js then logged
     `GL_INVALID_OPERATION: glTexStorage2D: Texture is immutable` while rendering against a disposed
     renderer.

   On a normal unload nobody sees either. On a **bfcache restore** (`pagehide` with
   `event.persisted === true`) the page comes back and would be rendering on a disposed renderer. The
   remedy is one line — a `disposed` flag in `main.ts` that skips `requestAnimationFrame(frame)` after
   teardown — but that stops the game loop, which is a behaviour change beyond what this round was
   told to make, so I am flagging rather than doing it. **Recommend a ruling.**
2. **No automated test covers any of the five fixes.** The pulse throttle and `cardLabel` are pure
   functions of `(state, now)` and the Stop contract is a two-line branch, yet all five are verified
   only by the live browser runs above. The pulse throttle in particular is the kind of thing that
   silently regresses if someone later moves the counter update inside the throttle. Verifying them
   properly needs the allow-list widened for a `src/ui/*.test.ts`.
3. **File sizes keep growing against the ~220 line target**: `ui/index.ts` is now 264 and
   `villagers.ts` 252. Every finding in this batch was additive, so the overage reported in rounds 0
   and 1 has grown. `ui/index.ts` is now over by 20% and is the file most likely to need splitting
   (popover concerns vs card concerns) if the target is meant to be enforced.
4. **Carried over from earlier rounds, still open:** the `PALETTE.accent` / `PALETTE.paper` token
   ruling; draw calls now 85–89 against T04's older `< 120` budget, which M10 has bought real
   headroom for T07+; resting villagers standing inside the campfire ring; the
   `select()`-before-first-`render()` path verified by construction only.
5. Dev server started on :5177 for validation has been stopped and the port confirmed free.

### Round 2 addendum — teardown ruling (M12 concern 1 closed)

The orchestrator ruled on the gap I flagged above: dispose without stopping the loop. Fixed in
`src/main.ts` only (+11 lines, 94 → 105). No other file touched.

```ts
let stopped = false;
function frame(now: number): void {
  if (stopped) return;              // halt before any layer is touched again
  try { /* tick / render / audio.update / ui.render */ }
  …
  requestAnimationFrame(frame);
}

window.addEventListener('pagehide', () => {
  stopped = true;                   // set first, so no frame can see a half-disposed layer
  render.dispose(); ui.dispose(); audio.dispose();
});

window.addEventListener('pageshow', () => {
  if (stopped) window.location.reload();   // bfcache restore: nothing to restore, boot clean
});
```

The guard sits at the very top of `frame()`, above the try, so a stopped loop touches nothing and
schedules nothing.

Verified in the browser (fresh reload, default camera):

| Check | Result |
|---|---|
| `pagehide` halts the loop | `tick` **129 → 129**, unchanged across 120 frames + 800 ms + 30 frames |
| `pagehide` disposes all three | `__cozyRender` `object` → `undefined`; `#ui` children 2 → 0; cards 8 → 0 |
| **Console after `pagehide` + many frames** | **clean** — only the two `[vite]` debug lines |
| The two round-2 symptoms | `[cozy] frame loop failed: UI element missing: #hud [data-res="wood"]` — **gone**; three.js `GL_INVALID_OPERATION: glTexStorage2D: Texture is immutable` — **gone** |
| `pageshow` after a stop reloads | sentinel set on `window` before `pageshow` is **gone** afterwards, so a real navigation ran |
| Reboot is healthy | fresh document (age 13.6 s), `__cozyRender` back, 8 cards, `calls 85`, ticking at 61/s |
| No reload loop | the fresh document's own `pageshow` fires with `stopped === false`, so it does not re-reload — it ran 13.6 s and 810 ticks without looping |

No new console noise, no dependency change, no `any`. Commands: `pnpm exec tsc --noEmit` exit 0,
`pnpm build` exit 0, `pnpm test` exit 0 (3 files, 24 tests). Dev server on :5177 stopped, port free.
