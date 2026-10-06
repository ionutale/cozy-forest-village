# K3 Report — UI: the card heart mark and the Bonds line

Status: **DONE**. All five plan steps done; 3 new tests added and passing; full gate green —
`tsc --noEmit` exit 0, `pnpm build` exit 0, `pnpm test` **309/309 across 16 files**. No commit.

## Files

| File | Change |
|---|---|
| `src/ui/derive.ts` | `bondsLine(state, villagerId)` + `BOND_WORDS`; imports `bondPartners`, `strongestBondLevel` from `../sim` |
| `src/ui/derive.test.ts` | `bonds()` fixture helper; `bonds` added to the base `state()` factory; 3 new tests |
| `src/ui/cards.ts` | `.bond-heart` glyph in `cardHtml`; `CardParts.bondHeart` + `CardParts.bond`; per-frame `syncCards` toggle by `strongestBondLevel ≥ 2` |
| `src/ui/markup.ts` | `<p class="bonds-line"></p>` above the task grid; `UiRefs.bondsLineEl` + `bindRefs` lookup |
| `src/ui/index.ts` | per-frame text sync of the Bonds line from `bondsLine`, next to the favor-line sync |
| `src/styles/ui.css` | `.bonds-line` (reserved slot, muted), `.bond-heart` (accent, hidden rule), `data-face` hide rule |
| `docs/tasks/K3-bonds-ui-report.md` | this report (new) |

Nothing outside that list was touched. No new dependency, no `any`, no new UI zone.

## Steps 1–5

**Step 1 (failing tests).** Three tests appended to `derive.test.ts`, and the `state()` fixture gained
a required `bonds` (K1's new `GameState.bonds`), via a sparse `bonds([[a, b, score]])` helper that
writes the `min*12 + max` cell of the row-major table:

- ordering — level first, then score desc, then roster index asc;
- the three wordings — `Warming to` / `Close with` / `Best with`;
- hidden below level 1 — all-zero → `null`, `119` → `null`, `120` (warming-only) → shown.

**Step 2 (expect failures).** Bailed at import time until K1 landed `bondPartners` /
`strongestBondLevel`; the retry rule from the brief applied (see *Concurrent tree* below).

**Step 3 (implement).**

`derive.ts` — the top two partners are simply the first two `bondPartners` (already ordered
level desc / score desc / index asc), the wording is one small table, and the guard is the spec's
exact condition:

```ts
const BOND_WORDS: Record<1 | 2 | 3, string> = { 1: 'Warming to', 2: 'Close with', 3: 'Best with' };

export function bondsLine(state: GameState, villagerId: string): string | null {
  if (strongestBondLevel(state, villagerId) === 0) return null;
  const partners = bondPartners(state, villagerId);
  if (partners.length === 0) return null;
  return partners.slice(0, 2).map((p) => `${BOND_WORDS[p.level]} ${p.name}`).join(' · ');
}
```

`markup.ts` — the line is a bare `<p class="bonds-line"></p>` above `.task-grid`, in the villager
face. `UiRefs.bondsLineEl` resolves it once at init (the M1 lesson).

`index.ts` — one guarded write per frame, immediately after the favor-line sync, so a bond forming
or a level crossing appears without a re-render trigger:

```ts
const bondsText = selectedIndex >= 0 ? bondsLine(state, state.villagers[selectedIndex]!.id) ?? '' : '';
if (bondsLineEl.textContent !== bondsText) bondsLineEl.textContent = bondsText;
```

Villager-face-only is enforced twice, deliberately: `selectedIndex >= 0` means a villager is
selected (structures and the trader set the id to `null`, so the text is `''`), and the CSS rule
`#task-popover:not([data-face='villager']) .bonds-line { display: none; }` uses the existing
`data-face` mechanism so the structure face (which keeps the task grid by pre-existing design) and
the trader face never carry the villager's friends.

`cards.ts` — the heart mark is a second tiny glyph in `.villager-name`, toggled **in the per-frame
`syncCards`**, not in `cardHtml`:

```ts
const bond = strongestBondLevel(state, villager.id) >= 2;
if (parts.bond !== bond) {
  parts.bond = bond;
  parts.bondHeart.hidden = !bond;
}
```

This is the point of the step: a score crossing the level-2 threshold (`300`) flips the mark on the
next frame with no re-render trigger, exactly like the well-fed tint's per-frame read. The write is
transition-guarded against `CardParts.bond`, so an idle frame touches no DOM.

`ui.css` — `.bonds-line` sits in the panel register (`--ink-soft`, 12.5px, 600) and reserves one
line (`min-height: 1.4em`) so a first bond never jumps the task grid; `.bonds-line:empty` is
`visibility: hidden` (the slot stays, the text does not show). `.bond-heart` is the card's single
accent (`--accent`), `inline-block`, with the explicit `[hidden]` rule so the attribute stays in
charge — the favor-heart pattern verbatim.

**Step 4 (gate).** `pnpm exec tsc --noEmit` exit 0 · `pnpm build` exit 0 ·
`pnpm test` **309/309 across 16 files** (baseline 282 + K1/K2/K3 additions).

**Step 5.** This report.

## Concurrent tree

- K1 (`bondPartners` / `strongestBondLevel` / `GameState.bonds`) had not landed when I started.
  I implemented against the agreed interface and polled: the first two `tsc` runs failed on K1's own
  mid-flight `src/sim/index.ts` (unused `stepBonds` import, then `FRIEND_PERK_SCALE` not in scope) and
  on the un-repaired `src/ui/structure-card.test.ts` fixture. Per the brief I did not touch them;
  both cleared on a later run, and K1 landed the `bonds.ts` cap fix its own file needed. No stale
  edit of mine remains — the final tree is green with zero exclusions.
- K1 also held an additive fixture-repair allowance on `derive.test.ts`. My `bonds` factory addition
  and K1's landed edits coexist cleanly (the final file type-checks and all four `bondsLine` tests
  pass); no duplicate `bonds` key.

## Verification

| Command | Result |
|---|---|
| `pnpm exec vitest run src/ui/derive.test.ts` | exit 0 — 102/102 |
| `pnpm exec tsc --noEmit` | exit 0 (no output) |
| `pnpm build` | exit 0 — `✓ built in 256ms` |
| `pnpm test` | exit 0 — 16 files, **309/309** |

Browser/live verification is the orchestrator's (the brief rules it out for implementers). Three
things worth the live eye: a level-2 crossing adding the heart mark to a card mid-play (card
re-render must not be required); the Bonds line wording and separators in the villager popover; and
the line being absent on the structure and trader faces. No DOM-level test is added — that would
need happy-dom/jsdom (a new dev dependency), which is out of scope; the pure `bondsLine` half is
fully covered and the DOM half is two guarded writes over existing patterns.

## Known gaps / concerns

1. **`DESIGN.md` §6 batch-9 allowance was not visible at my start commit.** The brief says §6 was
   freshly amended with the card-mark + Bonds-line allowance, but at `f62a432` §6 ends at batch 8.
   `DESIGN.md` is not in my allow-list, so I left it to the orchestrator (who holds the amendment).
   The implementation adds no zone and no fourth area — both additions fold into existing zones 2
   and 3, which is what the allowance permits.
2. **The Bonds line sits above the task grid and below the favor line**, in that order. If the
   orchestrator prefers it below the favor line but above the grid *after* a reserved favor slot,
   that is the current layout: favor (2-line reserve, `visibility`) → bonds (1-line reserve,
   `visibility`) → grid. Two quiet reserved rows in the villager face; the grid stays put as bonds
   come and go.
3. **No re-export or new constant added to `src/sim`** — `bondPartners` / `strongestBondLevel` were
   already on K1's public surface, so `derive.ts` and `cards.ts` import them read-only, as the
   contract requires.

---

## Fix round after the batch-9 review

### M3 — the card-heart condition is now a pure, tested helper

The review (K-review-report M3) noted the spec's "card heart condition (≥ 2)" was live-verified only:
the predicate sat inside the DOM `syncCards`, with no unit test. Extracted it to
`derive.ts` alongside `bondsLine`:

```ts
export function hasCloseFriend(state: GameState, villagerId: string): boolean {
  return strongestBondLevel(state, villagerId) >= 2;
}
```

`syncCards` in `cards.ts` now calls it (`const bond = hasCloseFriend(state, villager.id);`) and no
longer imports `strongestBondLevel` from `../sim` at all — the level knowledge stays in `derive.ts`.
The name is deliberately distinct from the sim's `hasCloseFriendNear`, which answers the *physical*
proximity question for the work perk; this one answers the bond-level card question.

One test added, pinning the 1/2 threshold on both sides: level 0 (`[]`, `119`) → false, level 1
(`120`, `299`) → false, level 2 (`300`, the exact crossing) → true, level 3 (`720`) → true.

**Gate:** `pnpm exec tsc --noEmit` exit 0 · `pnpm build` exit 0 ·
`pnpm test` exit 0 — 16 files, **310/310** (one new test; baseline for this round was 309).
