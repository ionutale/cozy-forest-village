# B1 Report — the rotating village line (B9 #20)

Status: **DONE_WITH_CONCERNS**. Implemented exactly to spec and verified by static analysis plus
a priority harness. No live browser check — the orchestrator owns the browser for this wave. One
concern is a deliberate visual trade-off (reserved line height). Changes left uncommitted.

## Files

| File | Lines | Change |
|---|---|---|
| `src/ui/index.ts` | +52 | `villageLine()` + `firstById()`, the two guards, `DEFAULT_HINT` shared with the markup |
| `src/styles/ui.css` | +5/−1 | `min-height: 2.4em` on `.panel-hint` so a longer line cannot shift the list |

`git status --short -- src/ui src/styles` lists exactly these two. No other file touched, no
commit, no browser, no dev server, no new deps, no `any`.

## What was built

`src/ui/index.ts` gets one pure function, one guard pair and one hoisted node reference.

**The line chooser** — priority order exactly as specified, thresholds reused from the constants
already in this file (`FUEL_STEADY = 33`, `FUEL_ROARING = 66`) so there is no third copy of the
§3.2 numbers:

```ts
function villageLine(state: GameState): string {
  if (state.fire.fuel <= 0) return 'Only embers left — someone should tend the fire.';
  const ratio = state.fire.max > 0 ? state.fire.fuel / state.fire.max : 0;
  if (ratio < FUEL_STEADY / 100) return 'The fire is dimming.';
  const cooking = firstById(state.villagers, (v) => v.state === 'working' && v.task === 'cook');
  if (cooking) return `${cooking.name} is cooking.`;
  const fed = firstById(state.villagers, (v) => v.fedMs > 0);
  if (fed) return `${fed.name} is well-fed.`;
  if (state.pot.meals > 0) return 'Meals are ready for a rest.';
  if (ratio >= FUEL_ROARING / 100) return 'The fire is warm and bright.';
  return DEFAULT_HINT;
}
```

**Two guards, at the end of `render()`** — the same shape as the M1 signature, so the DOM is
untouched unless the text really changes:

```ts
const now = performance.now();
if (now >= hintDueAt) {
  hintDueAt = now + HINT_INTERVAL_MS;
  const line = villageLine(state);
  if (line !== lastHint) {
    lastHint = line;
    panelHint.textContent = line;
  }
}
```

`UIHandle.render(state)` carries no `dtMs` (DESIGN §3 pins the signature), so the ~10 s clock is
wall time from `performance.now()` — the same mechanism the existing yield-pulse throttle already
uses. Accumulating `dtMs` would have meant changing the contract.

**`DEFAULT_HINT`** is now a module constant interpolated into the markup
(`<p class="panel-hint">${DEFAULT_HINT}</p>`) *and* returned as the fallback, so the two cannot drift
apart. It doubles as the initial `lastHint`, which means a fresh village (fire starts at 70 →
ratio 0.7 → "warm and bright", so it does write once) and any state that resolves to the default
both avoid a pointless DOM write.

**Determinism.** `firstById()` picks the lowest matching `id` by string comparison rather than
`Array.find`, so the line is stable by id even if the roster array were ever reordered or reloaded
from a hand-edited save. No `Math.random`, no clock, no hidden state — `villageLine` is a pure
function of `GameState`.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 — `dist/assets/index-DjnVrAzQ.css 6.26 kB`, `index-C-2ruOA4.js 629.45 kB │ gzip: 161.75 kB` |
| `pnpm test` | exit 0 — 6 files, **63/63** |

**Test count is 63, not the 62 in the brief.** A concurrent agent landed a test in this shared tree
during the session; all of them pass and none are in my files. Flagging so the delta is not mistaken
for something I did.

**Priority harness** — I mirrored `villageLine` + `firstById` in a node script and ran the
spec's cases plus the boundaries:

| Case | Line |
|---|---|
| embers, with cook + fed + meals also true | `Only embers left — someone should tend the fire.` |
| dimming (fuel 32), with cook + fed + meals true | `The fire is dimming.` |
| cooking + fed + meals | `V2 is cooking.` |
| fed + meals | `V1 is well-fed.` |
| meals, fire roaring | `Meals are ready for a rest.` |
| roaring, nothing else | `The fire is warm and bright.` |
| fuel exactly 33 (not `< 0.33`) | `Pick someone, then give them a task.` |
| fuel exactly 66 (`>= 0.66`) | `The fire is warm and bright.` |
| fuel 50, between the bands | `Pick someone, then give them a task.` |
| two fed villagers, array order `v7, v2` | `V2 is well-fed.` — id order, not array order |
| `fuel: NaN` | `Pick someone, then give them a task.` — no crash, no wrong line |

Both boundaries agree with `fireState()` in the same file, so the HUD pill and the hint never
disagree about whether the fire is dim.

**Guard simulation** over 3 600 frames (60 s at 60 fps):

| Scenario | Recomputes | DOM writes |
|---|---|---|
| state already showing the chosen line | 7 | **1** |
| `lastHint` stale (one-time adoption) | 7 | **1** |

One `textContent` assignment per *actual* change, not per frame — so no flicker and no measurable
DOM cost. ~7 recomputes in 60 s is the specified ~10 s cadence (the first fires immediately).

**Not verified live** (browser is the orchestrator's): that the lines read well in situ and that the
reserved height looks acceptable. Everything else is a pure function of state plus one text node.

### Suggested orchestrator browser checks

1. Let the fire die to embers → the hint becomes the embers warning and **the villager list must not
   move**. This is the one case that would reveal a layout problem.
2. Build the pot, cook a meal, then rest → hint should pass through "…is cooking." → "Meals are
   ready for a rest." → "…is well-fed." → back to the fire line, one step per ~10 s.
3. Watch the panel for 30 s with nothing happening → the text must not flicker or rewrite.

## Deviations

1. **`fuel <= 0` instead of `fuel === 0`** for the embers branch. A superset of the spec: identical
   for every value the sim can produce (`fuel` is clamped at 0 by `Math.max`), and it means a
   negative value from a malformed save cannot slip past the most urgent line. Verified above that
   `NaN` also degrades safely to the default hint rather than throwing.
2. **Two lines of height are reserved unconditionally** (`min-height: 2.4em`) instead of letting the
   hint size itself. The longest candidate — the 45-character embers warning — does not fit on one
   line at 12.5 px inside a 250 px panel, so without the reservation the villager list below would
   shift ~15 px every time the line changed. Trading ~15 px of quiet air at rest for a guaranteed
   zero-jump hint seemed clearly right for a cozy game; the alternative (a shorter embers string, or
   a smaller font) would have deviated from the spec's exact wording. **This is a one-line revert**
   if the orchestrator prefers the tighter panel and accepts the jump.
3. **`villageLine` takes the whole `GameState`** rather than the three fields it reads. It keeps the
   call site a single argument and matches the neighbouring `syncStructureCard(state)` /
   `fireState(...)` helpers.

## Known gaps / concerns for the orchestrator

1. **The reserved second line is a visual trade, not a free win.** At rest the hint sits in a
   two-line box with ~15 px of empty space beneath it. If that reads as loose in the cozy review,
   the options are (a) accept the jump, (b) shorten the embers string, or (c) drop the font to ~11 px
   so the longest line fits. All three change something the brief specified, which is why I did not
   pick one unilaterally.
2. **No automated test covers `villageLine` or `firstById`.** This batch's allow-list is two source
   files. `villageLine` is a pure function of `GameState` and is the single most spec-shaped piece of
   UI logic I have written — the eleven-case table above would drop straight into a unit test and
   would lock the priority order and both boundaries. Worth a follow-up task that widens the
   allow-list.
3. **The 10 s clock is wall time, so a backgrounded tab can skip a step.** `performance.now()`
   advances while the tab is hidden, so on returning the next frame recomputes immediately. That is
   the desired behaviour here (the line catches up rather than waiting 10 s of stale state), and it
   costs nothing, but it does mean the cadence is "at most 10 s apart" rather than "every 10 s".
4. **The M1 structure-card signature is untouched** — confirmed in the diff, which shows no changes
   inside `syncStructureCard`, `buildCards` or the villager label loop. The hint has its own
   independent change-guard rather than being folded into that signature, since it is a different
   element with a different cadence.
5. `src/ui/index.ts` is now ~570 lines across the batch-3 additions (515 after A1). Still no size
   budget for batch 3, but the file is now clearly a candidate for a split into HUD / list /
   popover modules.