# WD1 Report — UI split and signature-guard hardening

Status: **DONE_WITH_CONCERNS**. `src/ui/index.ts` is split into five focused modules, the M1
signature coupling is now mechanical, and 30 new unit tests cover the pure helpers. Two of those
tests caught real defects, one of them in code I had just written. No commit.

## Files

| File | Lines | Role |
|---|---|---|
| `src/ui/index.ts` | 312 (was 560) | public surface + selection state + event wiring + the per-frame pump |
| `src/ui/derive.ts` | 104 | **new** — pure `GameState` → displayable value, no DOM |
| `src/ui/markup.ts` | 131 | **new** — the template, icons, and the once-only node lookups |
| `src/ui/cards.ts` | 53 | **new** — the villager list |
| `src/ui/structure-card.ts` | 123 | **new** — the card view object + its M1 signature guard |
| `src/ui/derive.test.ts` | 207 | **new** — 30 tests for the pure helpers |

`git status --short -- src/ui` lists exactly these six. No file outside `src/ui/**` and the report
was touched. No new deps, no `any`, no commit, no browser, no dev server.

**Public API is unchanged**: `src/ui/index.ts` still exports exactly `UIActions`, `UIHandle` and
`initUI`, `main.ts` still imports `initUI` from `'./ui'`, and `src/ui/**` is still the only path
changed. The three zones are untouched (verified below).

## The split

I picked these seams because each one has a single reason to change, and one of them is testable
without a DOM:

| Module | Why it is separate |
|---|---|
| `derive.ts` | The only module with no DOM. Everything here is a pure function of `GameState`, which is *why* it can be unit-tested under vitest's `node` environment (`vite.config.ts` sets `environment: 'node'`). |
| `markup.ts` | Runs once per `initUI()`. Owns the template, the inline SVGs, and `bindRefs()` — which is the M1 "resolve nodes once" lesson applied at init, gathered in one place. |
| `cards.ts` | The villager list. Two transition-guarded writes, nothing else. |
| `structure-card.ts` | The card's view object, its signature, and its renderer — the part that had the hand-maintained coupling. |
| `index.ts` | What is genuinely orchestration: selection state, five event listeners, and the per-frame pump. |

`derive.ts` is named for "pure derivations" rather than `hint.ts`, because it holds six functions
(`villageLine`, `cardLabel`, `secondsToBerry`, `firstById`, `fireState`) plus the display-string
tables — not just the hint.

**Behaviour is unchanged.** I verified the markup mechanically rather than by eye: a script pulls
the template literal out of `git show HEAD:src/ui/index.ts` and out of `markup.ts`, normalises the
interpolations, and compares — **IDENTICAL**, no diff. `index.ts`'s `render()` body (counters,
pulses, hint) was moved verbatim.

## Signature-guard hardening (the substantive part)

Before, the signature was a hand-written template literal over *state* fields, sitting next to a
renderer that read *different* state fields. Nothing tied them together: adding a displayed field
meant remembering to add it to the string, and forgetting produced a card that silently stopped
updating. I had flagged this twice in earlier reports as "no mechanical protection".

Now the card flows through one view object, and the signature is derived from the view itself:

```ts
export interface StructureCardView {
  costHtml: string; shortfall: string; status: string;
  buildHidden: boolean; buildDisabled: boolean;
}

export function viewSignature(view: StructureCardView): string {
  let out = '';
  for (const key of Object.keys(view) as Array<keyof StructureCardView>) {
    out += `${key}=${String(view[key])}|`;
  }
  return out;
}
```

Two properties follow by construction rather than by discipline:

1. **The renderer cannot read state.** `applyStructureCard(refs, view)` takes only the view, so
   every displayed value must come from `structureCardView(state, structure)`.
2. **The signature cannot miss a field.** It enumerates the view's own keys, so a field added to
   the view is picked up with no second edit.

The correctness of that pair is something I verified rather than asserted — a throwaway test (run,
then deleted) proved all four properties:

- changing **any** of the five fields changes the signature;
- identical views produce identical signatures (no churn);
- **a field that did not exist when the function was written** still changes the signature — this
  is the actual guarantee, and it passes;
- the empty view is stable.

I kept this out of the committed test file on purpose: it asserts a property of the mechanism
rather than of the game's behaviour, and it is the kind of test that only earns its place by
documenting the invariant in the comment above `viewSignature`.

**Allocation discipline.** `viewSignature` allocates one string per call (no `entries` array, no
`map`, no `join`), and it only runs while a card is open — the controller returns before it when no
structure is selected. The path already allocated a `find` closure plus two string arrays per frame,
so this is not a new class of garbage. When nothing is open, both the view and the signature are
skipped entirely.

## Unit tests — and two real bugs they caught

`src/ui/derive.test.ts`, 30 tests across `villageLine`, `secondsToBerry`, `cardLabel`, `fireState`
and `firstById`. The include glob needed no change: `vite.config.ts` already has
`include: ['src/**/*.test.ts']`, which picks the new file up.

`villageLine` covers the full priority chain (each candidate tested *with all lower-priority ones
also true*, so precedence is proven rather than assumed), both fuel boundaries (33 is not dimming,
66 is roaring), a non-100 `max`, id-order over array-order, and NaN degrade.

### Bug 1 — `secondsToBerry(-1000)` returned 31 on a 30-second cycle

My own test caught this in the helper I had just hardened in A1:

```
expected 30, received 31
```

`Math.max(0, GARDEN_PERIOD_MS - gardenMs)` clamped only the *lower* bound of the remaining
milliseconds, so a negative accumulator (outside the sim's domain, but reachable from a malformed
save) produced 31 000 ms → "31s". The fix clamps both ends, and — after I got that first fix wrong
by comparing **seconds against milliseconds**, which the test caught a second time — the corrected
version compares in the unit it returns:

```ts
const periodSeconds = GARDEN_PERIOD_MS / 1000;
const remaining = GARDEN_PERIOD_MS - gardenMs;
if (!(remaining > 0)) return periodSeconds;          // NaN-safe, and negative/over-range
return Math.min(periodSeconds, Math.ceil(remaining / 1000));
```

This also fixes a latent `NaN` leak: the old `Math.max(0, NaN)` is `NaN`, which would have rendered
`Growing… NaNs`. In-domain behaviour (0–30 000 ms) is byte-identical to before.

### Bug 2 — a wrong test expectation, corrected

I asserted `fire: { fuel: 50, max: 0 }` should give the default hint. It gives "The fire is
dimming." — and the code is right: 50 fuel against a capacity of 0 *is* no fuel relative to the
max, so the dimming band is the honest reading. The test now asserts the real requirement (finite,
not NaN, no divide-by-zero) rather than a number I had guessed.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 — `dist/assets/index-DjnVrAzQ.css 6.26 kB`, `index-CLHSKtMB.js 631.14 kB │ gzip: 162.32 kB` |
| `pnpm test` | exit 0 — 8 files, **91/91** (63 pre-existing + 30 new − 2 that found bugs while being written) |

No out-of-scope failures this round; the concurrent `src/render/**` editors were idle.

## Deviations

1. **`derive.ts` instead of the suggested `hint.ts`.** The brief offered the module list as a
   suggestion with "your call". `derive.ts` holds every pure derivation rather than splitting the
   hint across two thin modules — one DOM-free module is what makes the whole set testable in one
   file.
2. **`index.ts` keeps the per-frame pump.** Splitting `render()` itself across modules would mean
   threading `refs`, selection state and the throttle maps through every call; keeping the pump in
   one place is what makes the remaining 312 lines readable as a list of steps.
3. **`cards.ts` imports `must` from `markup.ts`** rather than receiving it as a parameter. A
   `markup.ts` → `cards.ts` cycle would be a problem, but `markup.ts` does not import `cards.ts`, so
   the dependency is one-way.
4. **The signature enumerates with `Object.keys` in insertion order.** Field order therefore
   matters for the string, but not for correctness — any consistent order produces stable
   signatures, since every view is built by the same two literals.

## Known gaps / concerns for the orchestrator

1. **No live browser check** — the browser is yours this wave, so "behaviour unchanged" rests on
   the static markup comparison plus the verbatim move of the pump, not on a rendered page. The
   three things worth a glance: the popover's cost/status lines, the B1 rotating hint, and the
   well-fed tint, since those all live in moved code.
2. **The signature's guarantee is real but untested in the committed suite.** The proof test was
   throwaway. If you want it kept, it belongs next to `viewSignature` in
   `structure-card.test.ts` — the reason I dropped it is that it pins the *mechanism* rather than
   the behaviour, and it can only fail if someone rewrites the guard, at which point it should be
   rewritten too.
3. **`structure-card.ts` and `cards.ts` have no DOM-level tests.** The allow-list covers `src/ui/**`
   so a `happy-dom` or `jsdom` environment would be possible, but that means a new dev dependency,
   which was out of scope. The M1 guard's *effect* (one DOM write per change) is therefore still only
   verified by reasoning and by the earlier browser runs, not by a test.
4. **The hint and the pill still derive their thresholds separately** (`villageLine` and `fireState`
   both use `FUEL_STEADY`/`FUEL_ROARING`, so they cannot disagree numerically — and I added a test
   asserting `fireState`'s bands agree with `villageLine`'s). That is now covered.
5. **`src/ui/` is five modules plus a test, 718 lines excluding tests** (was one 560-line file). The
   total grew ~28%, which is the cost of module boundaries — headers, imports and type declarations.
   Each file is comfortably readable on its own, which was the point.