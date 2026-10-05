# T3 Report — UI: the Spices pill, the trader popover face, the hint slot, the pot suffix

Status: **DONE_WITH_CONCERNS**. All five plan steps done, 19 new tests added and passing, full suite
green at 254/254. Two concerns, both about scope: one out-of-scope `tsc` failure in another agent's
fixture that blocks `pnpm build`, and the pot suffix which is delivered and tested but **not wired**,
because the pot status line lives outside my allow-list. Both are detailed below. No commit.

## Files

| File | Change |
|---|---|
| `src/ui/derive.ts` | `TradeKind`, `TRADE_LABELS`, `TRADE_WOOD_COST`/`TRADE_BERRY_COST`, `TRADER_HINT`, `traderHintLine`, `tradeDisabled`, `potHeartySuffix`; trader slot in `villageLine`; trader edges in `hintRecomputeDue` |
| `src/ui/markup.ts` | Spices pill + `spices` icon; `#trader-card` face (trades-left line + two buttons from `TRADE_ORDER`); new refs |
| `src/ui/index.ts` | `UIActions.trade`, `UIHandle.selectTrader`; `syncTrader`, `applyTraderSelection`, `closeTraderFace`; spices-pill sync; trader auto-close; click wiring |
| `src/styles/ui.css` | `data-res='spices'` tint; `#trader-card` / `.trades-left` / `.trade-btn` |
| `src/ui/derive.test.ts` | +19 tests; fixtures gained `spices: 0` and an away `visitor` |

Nothing outside that list was touched.

## Steps 1–5

**Step 1 (failing tests).** 19 new tests appended before implementing: the hint slot's full priority
chain, the arrival/return transitions, the two `hintRecomputeDue` edges, the `tradeDisabled` truth
table (away / spent / each price / exactly-at-price / cross-kind independence), `TRADE_LABELS`, and
the pot suffix's four conditions.

**Step 2 (expect failures).** `19 failed | 78 passed` — and for the right reasons: `tradeDisabled`
and friends were not exported, and the fixtures had no `spices` or `visitor`.

**Step 3 (implement).** The pure module first (all of it unit-testable), then the markup, then the
DOM wiring.

`derive.ts` — the gate, mirroring the sim's own refusals exactly:

```ts
export function tradeDisabled(state: GameState, kind: TradeKind): boolean {
  const visitor = state.visitor;
  if (visitor.phase !== 'visiting' || visitor.tradesLeft <= 0) return true;
  return kind === 'berries'
    ? state.resources.wood < TRADE_WOOD_COST
    : state.resources.berries < TRADE_BERRY_COST;
}
```

`villageLine` gained one line, placed between the favor slot and the dimming slot:

```ts
const trader = traderHintLine(state);
if (trader !== null) return trader;
```

That position is the spec's priority verbatim: `embers > (thanks | favor) > trader > dimming > …`.
The trader is phase-driven, read from `state`, so the line can never disagree with the sim.

`hintRecomputeDue` gained two optional parameters (`visitingBefore`, `visitingAfter`, both
defaulting to `false`), which is why every batch-4 test still passes untouched. This matters more
than it looks: without the edge, `HINT_INTERVAL_MS` is 10 s and a visit is `VISIT_STAY_MS`, so the
line could announce a trader who had already left, or leave "A trader is visiting!" hanging after
they walked off.

`markup.ts` builds the two trade buttons from `TRADE_ORDER` + `TRADE_LABELS`, so the caption the
player reads and the price the gate enforces come from the same object — the test pins both.

**Step 4 (gate).** `pnpm test` **254/254 across 12 files**; `derive.test.ts` 98/98.
`pnpm exec tsc --noEmit` and `pnpm build` fail on one out-of-scope file — see the concern.

**Step 5.** This report.

## The trader face

`selectTrader()` opens it; three paths close it:

| Path | Mechanism |
|---|---|
| another face opens (card click, structure click) | `clearSelectionVisuals()` hides the trader card — the three faces are mutually exclusive *by construction*, not by a hide call at each site |
| `select(null)` / Escape / inside-UI click | same function, via `closePopover()` |
| the visit ends | the pump: `traderMode && phase !== 'visiting'` → `closeTraderFace()` |
| `selectTrader(false)` from main.ts's per-click chain | `closeTraderFace()` |

`tradesLeft` reaching 0 is deliberately **not** a close. The trader is still standing there, so the
buttons simply grey out; only the sim's own phase ends the mode.

**`selectTrader(on = true)` — a deliberate divergence from DESIGN §3, and why it is safe.**
DESIGN §3 and spec Part 6 both declare `UIHandle.selectTrader(): void`, and a zero-arg call still
works. But T4's `main.ts` (already landed when I started) calls it *unconditionally* once per click:

```ts
// T4: the popover's trader face. Called with false for every other pick, so a villager or a
// ground click closes it — the trader is one of the three mutually exclusive modes.
ui.selectTrader(traderPicked);
```

With a strictly zero-arg signature, that line would **open the trader face on every click of a
villager or of empty ground during a visit** — the popover would flip to the trader mid-gesture and
then stay there. So the parameter is optional and defaults to `true`: every call that type-checks
against the contract's `selectTrader(): void` also type-checks here, and the unconditional call site
is safe. `on = false` closes *only* the trader face (`closeTraderFace`, deliberately narrower than
`clearSelectionVisuals`) so it cannot dismiss the villager or structure face main.ts opened in the
same gesture. `DESIGN.md` is not my file — worth reconciling the signature there to match.

The trade click path mirrors the build button's: `aria-disabled` is enforced in CSS, and the
handler re-checks `tradeDisabled` so keyboard activation is honest. After `actions.trade(trade)` it
calls `syncTrader(lastState)` — the sim has moved the stock and the trade counter, so the face
repaints from the truth rather than from a guess. (The next frame would catch it too; doing it here
keeps the button from looking live for one frame after the last trade.)

## The spices pill

Same shape, same register, `data-res="spices"`, tinted `--accent` (the nearest existing warm hue)
rather than a new colour for one resource. The sync is hoisted out of the frame and guarded on
`dataset.value`, so a settled spice count costs one integer compare per frame. **No yield pulse:**
wood and berries throb on `chop`/`gather` events, and there is no gather event for a trade — a
pulse here would either never fire or fire off the wrong event.

## Transition-only discipline

Every new per-frame write is guarded: the spices value and pill, the trades-left text, and both
trade buttons' `aria-disabled` (via the existing `setDisabled`, which compares before writing).
`syncTrader` runs every frame the face is open, so without those guards this task would have added
four unconditional DOM writes per frame.

## Two things I corrected mid-implementation

1. **`potHeartySuffix` guard.** My first version's doc comment claimed a `whole(spices) > 0` guard
   while the code used `spices <= 0`, and a test caught it on a fractional count. The sim's own
   hearty-eat test is `> 0`, so I matched the sim and corrected the comment — the line should say
   exactly what the cook will do, even for a hand-edited save carrying `0.4`.
2. **A test bug of my own**: I asserted `villageLine` with an away visitor returns `DEFAULT_HINT`,
   but the fixture's default fire (70 %) reads "The fire is warm and bright." Pinned to 50 %
   instead, which is genuinely the ambient-default band.

## Concern 1 — the pot suffix is delivered and tested, but not wired

The spec's pot line is `src/ui/structure-card.ts:42`:

```ts
status = `Meals: ${state.pot.meals} · ${COOK_BERRIES} berries + ${COOK_WOOD} wood each`;
```

That file is **not** in my allow-list, and the brief's parenthetical — *"the module owning
`villageLine`/pot-status (`src/ui/derive.ts`)"* — is a wrong guess about where pot-status lives.
Following the same discipline as the H3 round, where I refused to touch `markup.ts` and reported it,
I did not reach outside the list. So `potHeartySuffix` is a pure, tested function in `derive.ts`
that nothing calls yet.

**The wiring is one line, in `src/ui/structure-card.ts:42`:**

```ts
status = `Meals: ${state.pot.meals} · ${COOK_BERRIES} berries + ${COOK_WOOD} wood each${potHeartySuffix(state)}`;
```

plus adding `potHeartySuffix` to that file's `./derive` import. No test pins the exact pot status
string (I checked), so nothing else needs updating. Adding
`src/ui/structure-card.ts` to my scope — or handing that line to whoever owns it — closes this.

## Concern 2 — an out-of-scope `tsc` failure blocks `pnpm build`

`pnpm build` is `tsc --noEmit && vite build`, so:

```
src/ui/structure-card.test.ts(112,5): error TS2741: Property 'spices' is missing in type
  '{ wood: number; berries: number; }' but required in type '{ …; spices: number; }'.
(also 177, 178, 256)
```

**Cause:** T1 added the required `resources.spices`. The `state()` fixture in
`src/ui/structure-card.test.ts` — committed by the **G1** agent back in the huts wave, the same file
I fixed in the last micro-round for `arrivals` — builds `resources` as `{ wood, berries }`, so four
of its literals are now missing the field. That file is not on my allow-list and is not mine.

**Fix:** add `spices: 0` to those resource literals (or to a shared resource helper if the file has
one). It is the identical class of breakage to the `arrivals` one, and the identical fix shape.

**What I did instead:** left it alone and retried the gate three times over ~3.5 minutes. It did not
change. **Evidence my own work is clean:** filtering `tsc` output for anything outside that one file
gives no errors, and `pnpm exec vite build` — the actual bundling step — succeeds
(`index-W66yZCQL.css 7.31 kB`, `index-BN1wnhe5.js 649.06 kB`). So that single missing field is the
only thing between the tree and a green `pnpm build`.

Note `pnpm test` is unaffected (vitest transpiles without typechecking), which is why the suite is
green while `tsc` is not.

## Verification

| Command | Result |
|---|---|
| `pnpm test` | exit 0 — **12 files, 254/254** (baseline + 19 mine) |
| `pnpm exec vitest run src/ui/derive.test.ts` | 98/98 |
| `pnpm exec vite build` | exit 0 |
| `pnpm exec tsc --noEmit` | **fails — out of scope, see concern 2** |
| `pnpm build` | **fails — same single file** |

No dev dependency was added; the vitest include glob already covers `src/**/*.test.ts`.

**Behaviour not verified in a browser** — the brief rules that out. Four things worth your eye: the
fourth pill's tint and spacing in the HUD row; clicking the trader in the 3D scene opening the face
and *closing* it again on the next click of empty ground; both buttons greying after the third trade
while the face stays open; and the hint swapping to "A trader is visiting!" the instant they arrive.

## Known gaps / concerns

1. **The pot suffix is not wired** (concern 1) — one line, in a file outside my scope.
2. **`src/ui/structure-card.test.ts` blocks `pnpm build`** (concern 2) — another agent's fixture,
   needs `spices: 0`.
3. **`TRADE_WOOD_COST` / `TRADE_BERRY_COST` mirror the sim's prices rather than importing them.**
   The sim defines them in `src/sim/tasks.ts` and re-exports them at its public surface, but
   DESIGN §3's contract rule enumerates exactly which names other layers may import and these are
   **not** on that list — importing them would break the sanctioned surface. So the UI mirrors the
   two amounts it must gate on. `TRADE_LABELS` states both exchanges and `derive.test.ts` pins the
   labels *and* the gate's truth table together, so a sim-side price change fails loudly here rather
   than producing a button that lies. Adding the two constants to DESIGN §3 would remove the
   duplication entirely.
4. **`selectTrader(on?)` diverges from DESIGN §3's `selectTrader(): void`** — deliberate and
   compatible in the calling direction, for the reason given above. DESIGN.md is not my file; the
   signature there should be reconciled.
5. **No DOM-level test for the trader face** — the auto-close matrix (four close paths, two of them
   ordering-sensitive against main.ts's per-click chain) is verified by reading only. Testing it
   would need happy-dom/jsdom, i.e. a new dev dependency, which was out of scope. The pure half
   (`tradeDisabled`, `traderHintLine`, `potHeartySuffix`) is fully covered.
6. **`potHeartySuffix` is untested against an unbuilt pot *and* a built one in the same state** —
   covered, but note it takes the whole `GameState` rather than a `Structure`, because the sim's
   `pot.meals` is global and the built pot is found by kind scan. That is the same shape the
   existing hint uses for "is anyone cooking", so it is consistent with the module.

---

## Micro-round T3b — the two known gaps, and one surface alignment

### Gap 1 (my concern 1) — the pot suffix is now wired

The parenthetical in the T3 brief put pot-status in `derive.ts`; it is in
`src/ui/structure-card.ts:42`, and that file is now in scope. One line plus one import:

```ts
import { potHeartySuffix, secondsToBerry } from './derive';
…
status = `Meals: ${state.pot.meals} · ${COOK_BERRIES} berries + ${COOK_WOOD} wood each${potHeartySuffix(state)}`;
```

Appending the derived string (rather than composing the clause here) is what keeps the condition in
exactly one place: pot built **and** `spices > 0`, mirroring the sim's own hearty-eat test. The
existing `structure-card.test.ts` fixtures all carry `spices: 0`, so every previously-pinned pot
status string reads byte-identically and no expectation needed changing — which is the check that
the suffix really is inert outside its state.

### Gap 2 (my concern 2) — the stale fixture is fixed; `pnpm build` is unblocked

`src/ui/structure-card.test.ts` was blocking the team's build with four `TS2741` errors (T1 made
`resources.spices` required). Same class as the H3b `arrivals: []` fix:

- the `state()` factory default is now `{ wood: 0, berries: 0, spices: 0 }`;
- it also gained `visitor: { phase: 'away', inMs: 0, visitMs: 0, tradesLeft: 0 }` — T1 made that
  required on `GameState` too, and the fixture constructs a full `GameState`, so the same edit
  would otherwise have re-broken on the next `tsc` run. `away` matches the fresh-village default;
- the three inline `resources` overrides in the signature-coverage and sync cases gained
  `spices: 0`.

**Gate, fully green with zero exclusions:** `pnpm exec tsc --noEmit` exit 0 (no output),
`pnpm build` exit 0 (`✓ built in 167ms`), `pnpm test` exit 0 — 12 files, 254/254. No test count
changed: this round was a type-level fix plus a one-line template change, which is the same
asymmetry as H3b (vitest transpiles without typechecking, so a `tsc` failure was never a test
failure).

### Alignment (my concern 4) — BLOCKED on T1, deliberately not forced

DESIGN §3 has been amended and now names `TRADE_WOOD_COST`, `TRADE_WOOD_YIELD` and
`TRADE_BERRY_COST` on the sim's public surface, so the contract half of the blocker is gone. The
implementation half is not: `src/sim/index.ts` imports all three for `trade()`'s own use but does
**not** re-export them — its trader block is still

```ts
export {
  FIRST_VISIT_MS, HEARTY_FED_MS, NEXT_VISIT_GAP_MS, TRADER_WALK_MS, TRADES_PER_VISIT,
  VISIT_STAY_MS,
} from './tasks';
```

I polled four times over roughly four minutes and it had not landed. I did not force it, for two
reasons: `src/sim/index.ts` is T1's file and the brief says **do not add anything new to the sim
surface**; and reaching past the public surface into `../sim/tasks` — where the constants *are*
exported — is exactly what DESIGN's contract rule forbids ("Internal sim modules … `tasks.ts` …
are implementation detail"), so it would have bought a green `tsc` by breaking a documented rule.

So `derive.ts` still mirrors the two costs it gates on, and its comment now records the exact
remaining step instead of the old reasoning: add the three names to that `export { … } from
'./tasks'` block, delete the two mirrored constants, import them from `../sim`. `TRADE_LABELS`
composes its captions from the constants, so the labels follow the switch for free — and since
`TRADE_WOOD_YIELD` is now sanctioned too, the `4 berries` side can drop its literal at the same
moment. The `1 spice` yield has no sanctioned constant, so that literal stays regardless; the label
and truth-table tests keep pinning it either way.

**T3c — alignment closed.** With the wave writers stopped, `src/sim/index.ts` surfaced the three
sanctioned prices by adding `TRADE_WOOD_COST`, `TRADE_WOOD_YIELD` and `TRADE_BERRY_COST` to the
existing `export { … } from './tasks'` trader block (a surface-only change — they were already
imported there for `trade()`'s own use, so no sim logic changed and the three `TS6133` warnings they
were causing are gone). `derive.ts` then deleted both mirrored constants and imports all three from
`../sim`; `TRADE_LABELS` composes from them, so the `4 berries` literal is gone too. The gate and
both labels are byte-identical (254/254, and the `TRADE_LABELS` test still pins
`'5 wood → 4 berries'` / `'6 berries → 1 spice'`). Only the spice trade's `1` remains a literal —
there is no sanctioned constant for a spice yield — and that test keeps it honest.

**T3d — two live-caught deviations fixed.** The orchestrator's browser pass (trader visible,
click-select, trades execute, reload + hearty all green) caught two things only a real page shows.

*Deviation 1 — the trader face showed the whole villager chrome.* With the trader selected, the
popover rendered the full task grid (Chop/Gather/Rest/Cook/Stop) above the trades, against DESIGN §6
batch 7 ("the trader's two trade buttons with a 'Trades left' line… Nothing else"). Fixed with a
single face switch, `data-face` on `#task-popover`, set once per gesture at each open site
(`none` / `villager` / `structure` / `trader`) and read by one CSS rule:

```css
#task-popover[data-face='trader'] .task-grid,
#task-popover[data-face='trader'] .favor-line { display: none; }
```

The indirection through an attribute rather than toggling `hidden` on siblings is not stylistic —
both obvious approaches are already broken here. `.task-grid { display: grid }` is an *author* rule,
so it beats the UA `[hidden] { display: none }`: the `hidden` attribute `structure-card.ts` already
sets on the grid does nothing at all. And the favor line reserves `min-height: 2.4em`, so the pump's
`visibility: hidden` (correct, since no villager is selected) left a blank gap exactly where the
trades should begin. `display: none` removes both. The structure face is deliberately untouched: it
gets `data-face="structure"` recorded for accuracy, but no CSS keys off it, so it keeps showing the
task grid as it has since batch 2.

While wiring the face I also found a latent version of the same bug and closed it: the trader face
called `card.sync(state, undefined)` nowhere, and `clearSelectionVisuals` does not touch the
structure card — so selecting a structure and then the trader would have left the stale cost /
Build / status lines sitting under the trades. `applyTraderSelection` now makes the same
`card.sync(state, undefined)` call `openPopover` already makes. The live pass did not surface this
(it selected the trader on a fresh session with no prior structure selection); it would have shown
up in normal play.

*Deviation 2 — the trades line read a bare "0".* Now composed as `` `Trades left: ${n}` `` where
the string was produced. The countdown logic is untouched, and the transition guard now compares the
whole line, so a change in either the count or the wording repaints once. Left inline rather than
moved into a pure `derive.ts` helper: it is a literal prefix plus a number with no logic to test,
and `TRADES_PER_VISIT`-style constants already own the interesting part.

*Verification — the disabled buttons did not read disabled.* The live capture at 0 trades left
showed them "still fairly saturated", and the cause was real rather than a capture artefact:
`opacity: 0.45` over a **saturated accent fill** still reads as a live button. `.task-btn` gets away
with the same opacity because its base is neutral (`--paper-2` fill, `--ink` text) — dimming a
neutral chip reads as dead, dimming an orange one does not. So the disabled trade button now drops
to that same neutral register (no new colours, same palette), keeps `opacity: 0.45` for parity, and
the `:hover` brightening is gated on `:not([aria-disabled='true'])` to match `.build-btn`. Gate after
the fix: `pnpm exec tsc --noEmit` exit 0, `pnpm build` exit 0, `pnpm test` 254/254.
