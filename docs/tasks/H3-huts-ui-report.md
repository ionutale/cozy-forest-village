# H3 Report — UI: hut name, dynamic card reconcile, panel scroll, "Arriving…"

Status: **DONE**. All five plan steps done, 8 new tests added and passing, full suite green at
209/209. The delivery-round `tsc` blocker — an out-of-scope fixture in another agent's test — was
cleared in the micro-round at the end of this report; `pnpm exec tsc --noEmit`, `pnpm build`, and
`pnpm test` are all green with zero exclusions. No commit.

## Files

| File | Change |
|---|---|
| `src/ui/derive.ts` | `hut: 'Hut'` in `STRUCTURE_NAMES`; `'arriving' → 'Arriving…'` in `cardLabel`; new `villagersNeedingCards()` |
| `src/ui/cards.ts` | card HTML + registration extracted; new `appendCards()` reconcile |
| `src/ui/index.ts` | reconcile call in the pump; arriving gate in `syncActiveButtons`; `setDisabled` made transition-only |
| `src/styles/ui.css` | `#villager-list` max-height + quiet scrollbar |
| `src/ui/derive.test.ts` | +8 tests (`villagersNeedingCards`, `STRUCTURE_NAMES.hut`, `cardLabel` arriving); fixture updated for H1's `arrivals` |

`git status` on those paths lists exactly those five. Nothing outside my allow-list was touched.

## Steps 1–5

**Step 1 (failing tests).** Appended to `derive.test.ts` before implementing: the reconcile range
cases, `STRUCTURE_NAMES.hut`, and `cardLabel` for `'arriving'`.

**Step 2 (expect failures).** `8 failed | 65 passed` — and for the right reasons: `hut` resolved to
`undefined`, `Arriving…` unresolved, `villagersNeedingCards` not exported.

**Step 3 (implement).**

`derive.ts`:

```ts
export const STRUCTURE_NAMES: Record<StructureKind, string> = {
  …, feeder: 'Bird feeder',
  hut: 'Hut', // H3: batch 6
};
```

The `Record<StructureKind, string>` type is the compile-time guarantee the plan mentions — `'hut'`
could not be omitted without `tsc` failing. Cost display flows from `STRUCTURE_COST` automatically,
as the spec predicted.

```ts
export function cardLabel(villager: Villager): string {
  // H3: a walk-in has no task and cannot be given one, so "Arriving…" outranks everything.
  if (villager.state === 'arriving') return 'Arriving…';
  …
}
```

First in the chain deliberately: a walk-in cannot be given a task, so there is no label it should
prefer, and putting it first means no future state can accidentally mask it.

```ts
export function villagersNeedingCards(renderedCount: number, total: number): number[] {
  const from = Math.max(0, Math.floor(renderedCount));
  if (!(total > from)) return [];
  if (!Number.isFinite(total)) return [];
  const needed: number[] = [];
  for (let i = from; i < Math.floor(total); i += 1) needed.push(i);
  return needed;
}
```

`cards.ts` — `cardHtml(v)` and `registerCard()` extracted so the full build and the append share
one code path (the parts map, the heart, the hat colour, the transition flags). `appendCards()`
inserts only the missing tail:

```ts
const missing = villagersNeedingCards(cards.size, state.villagers.length);
if (missing.length === 0) return 0;
…
list.insertAdjacentHTML('beforeend', html.join(''));
for (const i of missing) { const v = state.villagers[i]; if (v) registerCard(list, cards, i, v); }
```

Existing cards are never touched — no `innerHTML` rewrite, no re-registration — so a newcomer's
arrival cannot reset an old card's fed tint, its favor heart, or an in-flight G3 goodbye pulse. The
whole batch goes in as **one** insert so the list reflows once rather than N times.

`index.ts` — the gate is a size comparison, so an unchanged roster costs one integer compare:

```ts
if (cards.size !== state.villagers.length) appendCards(list, cards, state);
```

`syncActiveButtons` disables the whole grid while the selected villager is arriving, and returns
early because the cook/stop gating is moot once everything is disabled.

**Step 4 (suite).** `209/209` across 11 files — baseline plus my 8.

**Step 5.** This report.

## Two things I hardened while in there

**1. `setDisabled` is now transition-only.** The arriving gate makes `syncActiveButtons` write
`aria-disabled` on six buttons, and that function runs **every frame** while a villager is
selected. Written naively that is six `setAttribute` calls per frame — a direct violation of the
transition-only discipline the brief told me to keep. So the single writer of that attribute now
compares first:

```ts
const next = disabled ? 'true' : 'false';
if (btn.getAttribute('aria-disabled') !== next) btn.setAttribute('aria-disabled', next);
```

This also covers the pre-existing Stop/Cook writes. `getAttribute` is a read, not a mutation, so a
steady state touches no DOM.

**2. Newcomer cards render their real label immediately.** `cardHtml` seeds `.task-label` with
`cardLabel(v)` instead of a hard-coded `Idle`, so an arriving villager reads `Arriving…` on its
first painted frame instead of flashing `Idle` for one frame. This also removes a redundant write
from `syncCards`. Applied to the initial full build too, so both paths behave identically.

## Panel scroll

```css
#villager-list { …; max-height: 360px; overflow-y: auto; padding-right: 2px;
                 scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
#villager-list::-webkit-scrollbar { width: 8px; }
#villager-list::-webkit-scrollbar-track { background: transparent; }
#villager-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
```

Scrollbar styling copies the panel's existing register exactly (`--border` thumb, transparent
track, 8 px, 4 px radius), plus the standard `scrollbar-width`/`scrollbar-color` pair so Firefox
matches rather than showing its default grey bar.

**Sizing:** a card is ~33 px (8 px padding × 2, ~15 px label line, 2 px border) and the gap is 8 px,
so eight cards occupy ~320 px. `max-height: 360px` clears that with ~40 px of headroom, so the
founding eight never show a scrollbar and the first arrival causes **no layout shift**. Twelve cards
(~508 px) scroll. `padding-right: 2px` reserves the scrollbar gutter so it never overlays a card's
right edge when it does appear.

The list scrolls independently of `#villager-panel`, which already has its own `max-height` +
`overflow-y` — so the popover stays put while the list scrolls under it.

## Verification

| Command | Result |
|---|---|
| `pnpm test` | exit 0 — **11 files, 209/209** (201 baseline + 8 mine) |
| `pnpm exec vitest run src/ui/derive.test.ts` | 73/73 |
| `pnpm exec vite build` | exit 0 |
| `pnpm exec tsc --noEmit` | **exit 0 — clean, zero exclusions** (after the micro-round fix below) |
| `pnpm build` (`tsc --noEmit && vite build`) | **exit 0** |

The include glob needed no change (`vite.config.ts` already has `src/**/*.test.ts`), and no dev
dependency was added.

**Behaviour not verified in a browser** — the brief rules that out. Three things worth your eye:
the list scrolling with 9–12 cards, the popover going fully disabled on an arriving villager, and
the card reading `Arriving…` the instant it appears.

## Micro-round: the out-of-scope `tsc` failure, cleared

At delivery this task reported DONE_WITH_CONCERNS, because one error outside my allow-list blocked
`pnpm build`. The orchestrator ruled the fix in; this section records it.

```
src/ui/structure-card.test.ts(109,3): error TS2322: Type '{ … }' is not assignable to type 'GameState'.
  Types of property 'arrivals' are incompatible.
    Type 'Arrival[] | undefined' is not assignable to type 'Arrival[]'.
```

**Cause:** H1 added the required field `arrivals: Arrival[]` to `GameState`. The `state()` fixture in
`src/ui/structure-card.test.ts` — committed by the **G1** agent in the previous wave — builds a
`GameState` literal with `...over` spread and never defaulted `arrivals`, so the spread produced a
required-but-possibly-`undefined` field. Nothing to do with H3's behaviour.

**Fix applied** (`src/ui/structure-card.test.ts`, one line, the identical fix to the one already in my
own `derive.test.ts` fixture):

```ts
favors: { byVillager: [], nextOfferMs: 0 },
// H1 made `arrivals` required on GameState (batch 6 walk-ins); this fixture predates it.
arrivals: [],
...over,
```

It sits above the `...over` spread so a test can still override it. No behaviour change: the fixture
builds empty `GameState`s, and an empty arrivals list is what batch 6 starts from.

**Gate after the fix — zero exclusions:**

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0, no output |
| `pnpm build` | exit 0, `✓ built in 150ms` |
| `pnpm test` | exit 0 — 11 files, 209/209 |

No `src/render/villagers/motion.ts` transient appeared, so the retry-and-wait allowance was not
needed. Test count is unchanged at 209: the fixture was type-level only, which is exactly why
`pnpm test` had been green while `tsc` was not (vitest transpiles without typechecking).

## Deviations

1. **Styled `#villager-list` by id rather than adding the `.villager-list` class** the plan suggested.
   `src/ui/markup.ts` is not on my allow-list, and adding a class purely to change a selector would
   be a cross-module edit for no benefit. The existing element already has that id.
2. **`villagersNeedingCards` lives in `derive.ts`**, not `cards.ts`, even though it is index-space
   rather than `GameState`-space. It is pure and DOM-free, so putting it in `derive.ts` keeps it
   covered by the existing `derive.test.ts` without a second test file.
3. **Cards now render their real initial label** instead of a hard-coded `Idle` (see above). A
   one-frame difference, in the direction of less flashing.
4. **`appendCards` returns a count** so the caller could log or assert; `index.ts` ignores it. The
   return value is what makes the function unit-testable later without a DOM harness.

## Known gaps / concerns

1. **Resolved.** The out-of-scope `tsc` failure that blocked `pnpm build` at delivery was cleared in
   the micro-round (`arrivals: []` in `structure-card.test.ts`'s `state()` factory). The gate is now
   green with zero exclusions, so the next wave does not inherit it.
2. **No DOM-level test for `appendCards`.** The reconcile logic that matters — *that existing cards
   survive untouched* — lives in `insertAdjacentHTML` + index alignment, which needs a DOM. The pure
   part (`villagersNeedingCards`, the index range) is fully covered; the DOM part is verified by
   reading only. Testing it would need happy-dom/jsdom, i.e. a new dev dependency, which was out of
   scope.
3. **The `360px` max-height is derived from estimated card metrics** (33 px + 8 px gap), not
   measured in a browser, since I was told not to use one. It has ~40 px of headroom over the eight
   founding villagers, so the no-shift property should hold, but it is the one number in this task
   that would benefit from a real measurement.
4. **`syncActiveButtons` returns early when arriving**, which means the Cook "pot not built" state is
   not re-evaluated while a walk-in is selected. It is invisible (the grid is disabled), and the
   next frame after they stop arriving restores it — but it is an early return worth knowing about
   if that function grows.
5. Concurrent-tree note: `src/sim/**` is mid-flight from H1 (I saw `huts.test.ts` appear and
   `types.ts`/`index.ts`/`tasks.ts` change under me during the session). My changes only read
   `'hut'` and `'arriving'`, both of which H1 has now landed.