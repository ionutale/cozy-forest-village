# G1 — Permanent signature-guard test (`structure-card.test.ts`)

Status: **DONE**. The mechanical guarantee WD1 proved with a throwaway test and then deleted
(concern 3 of `WD1-ui-split-report.md`) is now committed as `src/ui/structure-card.test.ts`:
23 tests, all passing. `src/ui/structure-card.ts` itself is unchanged — the test needs no new
export.

## Files

| File | Change |
|---|---|
| `src/ui/structure-card.test.ts` | **new** — 23 tests: the signature is derived from the whole view, by construction |
| `docs/tasks/G1-signature-report.md` | this report |

No other files touched. No new deps, no `any`, no browser, no git, no source edit in the final
state (`git diff -- src/ui/structure-card.ts` is empty — see the mutation check below).

## What the tests pin

`viewSignature` enumerates the view's own keys (`Object.keys`) rather than a hand-written list,
and `applyStructureCard` consumes that same view. The suite pins all four properties:

| Brief | Test |
|---|---|
| (a) every currently-rendered field moves the signature | `it.each(VARIANTS)('changing $field changes the signature')` — one variant per view field, checked against `Object.keys(BASE)`, so the `VARIANTS` table cannot go stale when the view grows |
| (b) **the actual guarantee** — a field that did not exist when the function was written still changes it | *"picks up a field that did not exist when viewSignature was written"* — passes a `StructureCardView & { hatchProgress: number; emissive: string }`, asserts the signature differs and contains `hatchProgress=3` / `emissive=#ff8800` |
| (c) identical views → identical signatures | distinct `{ ...BASE }` literals compare equal; repeated calls are deterministic; and builder-produced views ignore state the card never shows (`tick`, `seed`, `gardenMs` on an unbuilt bench) |
| (d) the rendered output derives from the same view | `applyStructureCard` is driven with fake refs: each view field maps to its node, and the same single-field change that moves the signature moves **exactly one** rendered output (the `VARIANTS` table carries `field → output`). `createStructureCard`'s guard is observed end-to-end: first sync paints, an identical resync repaints nothing (a tampered node persists), a displayed change repaints exactly the builder's view, and `reset()` forces the next paint |

Extra coverage from the builder side: a built garden's `gardenMs` countdown and a built pot's
meal count both move the signature; every key any branch of `structureCardView` produces
(unbuilt and built, three kinds, five states) is named in the signature.

## The test seam

The environment is `node` (`vite.config.ts`), so the card's DOM is faked with only the refs the
code actually writes (`structureCost`, `structureShort`, `structureStatus`, `buildBtn`, plus the
two visibility toggles `taskGrid` / `structureCard`), cast `as unknown as UiRefs`. If a future
writer touches another ref, the test throws — deliberately loud rather than silently incomplete.

`BASE` is a fully-typed `StructureCardView` literal, so adding a required field to the interface
is a compile error here, which forces the field into `BASE` and then trips the coverage test
until a `VARIANTS` entry exists. Optional fields are still covered by (b), which is
enumeration-based and does not care what the field is.

## Mutation check (the tests fail on the regression they guard)

To prove (b) is load-bearing, I temporarily replaced the `Object.keys` loop in `viewSignature`
with a hard-listed template literal over the five known fields, then ran the file:

```
❯ src/ui/structure-card.test.ts (23 tests | 1 failed)
  × picks up a field that did not exist when viewSignature was written
  Tests  1 failed | 22 passed (23)
```

Only the synthetic-field test failed — exactly the regression case. The source was restored and
`git diff -- src/ui/structure-card.ts` is empty.

## Evidence

| Check | Result |
|---|---|
| `pnpm exec vitest run src/ui/structure-card.test.ts` | exit 0 — **23/23 passed** |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 — `dist/assets/index-uxLh0Pwa.css 6.47 kB`, `index-CWN0JAPQ.js 638.09 kB │ gzip: 164.88 kB` |
| `pnpm test` | exit 0 — **10 files, 180/180 passed** (149 baseline + my 23 + 8 added concurrently by other batch-5 tasks; 0 failed) |

## Concerns

1. **Transient concurrent redness.** While G2's `delightText` edit was mid-flight, project-wide
   `tsc` failed in `src/ui/derive.ts` / `src/ui/derive.test.ts` (not my files). It cleared once
   their edit landed; the final runs above are all green.
2. **Signature order is insertion order** (WD1 deviation 4). The tests do not pin field order;
   stability rests on every view being built by the same literals in the same order. The
   `Object.keys`-based coverage test tolerates any order.
