# K (batch 9, bonds) — independent review report

**Reviewer:** fresh independent pass (read-only), 2026-10-06.
**Scope:** spec `docs/superpowers/specs/2026-10-06-bonds-design.md`; plan
`docs/superpowers/plans/2026-10-06-bonds.md`; `DESIGN.md` §3 / §3.2 / §3 persist (v6) / §6;
reports `K1…K4`; wave diff `44906b3` → `cbfad5f` (+ ledger `c95e90d`).
**Gate (re-run by reviewer):** `pnpm exec tsc --noEmit` → **exit 0**; `pnpm test` →
**309/309, 16 files**. Baseline matches the brief.

**Verdict:** the implementation matches the spec to the letter. No Critical findings. The
growth/levels/reunion/perk math, the v6 persist contract, the UI derivations and the
transition-driven hearts are all correct and covered. The gaps below are test-coverage and
doc-consistency items, not product defects.

---

## Important

### I1. Review-Focus pin 2's "every other timer byte-identical" has no test
`src/sim/bonds.test.ts:214-277` · `src/sim/index.ts:704-705`

The plan's Review Focus #2 requires "the perk is exact and leak-free — **every other timer
byte-identical**". The K1 tests pin the two periods (`1190 → 1071`, `1400 → 1260`) and the
no-effect cases (far / warming-only / idle), but nothing asserts that an *active* perk leaves the
other timers untouched — no control-vs-perk comparison of the cook channel, rest duration,
tend/fire, `fedMs` decay or the clock. The code is in fact correct: `work()` returns for `cook`
before the `period` line (`src/sim/index.ts:679-698`), and `hasCloseFriendNear` only reads. So this
is a coverage hole, not a behavior bug — but it is exactly the regression a byte-identical test is
meant to catch.

**Minimal fix:** add one test that runs a working close pair (level ≥ 2, in radius) with a
concurrent cook/rest villager and deep-compares a perk-on run against a perk-off control (same
seed/positions), asserting equality of every field except the perk worker's `progressMs`/yields.

---

## Minor

### M1. The spec's 3.0 boundary is never probed at exactly 3.0
`src/sim/bonds.test.ts:81-97`

Spec Part 5 / Review Focus #1 ask for the "boundary at 3.0". The test probes `2.999` (accrues) and
`3.001` (does not), but not exactly `3.0`. `stepBonds` and `hasCloseFriendNear` both use
`dx*dx + dz*dz <= reachSq` (inclusive), so 3.0 accrues — that is the behavior, but it is unpinned;
a future `<` would still pass the suite.

**Minimal fix:** add a `[3.0, 0]` case to the boundary test expecting score `1` after a 1 s tick.

### M2. No giant-`dt` "no burst" test for `bond-reunion`
`src/sim/bonds.test.ts:176-212`

Review Focus #1/#3 ("no burst on giant `dt`") is pinned for `bond-up`
(`bonds.test.ts:99-112`) but not for `bond-reunion`: the reunion test only steps in 1000 ms
increments. The structure guarantees one event per pair per tick (the near branch runs once and
resets `gapMs`), but that guarantee is untested for a single enormous step.

**Minimal fix:** after separating a pair, call `tick(state, 200_000)` once while near and assert
exactly one `bond-reunion`, then another near tick asserts none.

### M3. The card-heart condition (≥ 2) has no test
`src/ui/cards.ts:147` · `docs/tasks/K3-bonds-ui-report.md:116-119`

Spec Part 5 explicitly lists "the card heart condition (≥ 2)" as a UI test, but the predicate
lives only inside the DOM `syncCards` (`strongestBondLevel(...) >= 2`), and there is no DOM test
(the brief already notes `src/ui/index.ts` is untested; `cards.ts` is in the same boat). The pure
`bondsLine` half is fully covered; the card half is live-verified only.

**Minimal fix:** extract the one-line predicate to a pure helper in `derive.ts`
(e.g. `hasCloseFriend(state, id): boolean`) and unit-test the 1/2 threshold, then have
`syncCards` call it.

### M4. DESIGN §3.2 overstates the level event on a giant tick
`src/sim/bonds.ts:169-176` · `DESIGN.md:322-324`

DESIGN §3.2 says "every level crossing emits one `bond-up`", but a single giant tick that carries
a score across 120 → 300 → 720 emits **one** event at the final level (a deliberate choice, blessed
by plan Review Focus #3 and the brief's "one `bond-up` per tick"). The behavior is right; the
DESIGN sentence is unqualified and reads as three events.

**Minimal fix:** add a clause to DESIGN §3.2, e.g. "a single oversized `dt` that crosses several
thresholds emits one `bond-up` at the level reached (never a burst)".

### M5. DESIGN's `bondPartners` return type is looser than the spec's
`DESIGN.md:143` vs `src/sim/bonds.ts:92-117`

The spec's public surface types the partner `level` as `1 | 2 | 3` (level-0 partners are filtered,
per `bonds.test.ts:349-350`), and the implementation returns `1 | 2 | 3`. DESIGN §3 declares
`level: BondLevel` (which includes `0`), so the contract doc disagrees with both the spec and the
code.

**Minimal fix:** change DESIGN line 143 to `level: 1 | 2 | 3`.

### M6. K1 report misattributes `bondLevelAtIndex` to `stepBonds`
`docs/tasks/K1-bonds-sim-report.md:87-89` vs `src/sim/bonds.ts:169-173`

The report says the private index primitive is "kept for … `stepBonds`", but `stepBonds` inlines
`levelOfScore(bonds.scores[idx] ?? 0)` directly and never calls `bondLevelAtIndex` (which only
serves `strongestBondLevel` / `bondPartners` / `hasCloseFriendNear`). Functionally identical — the
brief's phrasing ("the private index variant used by `stepBonds`") describes index-based logic,
which `stepBonds` does use — but the report's inventory is inaccurate.

**Minimal fix:** correct the K1 report sentence (or have `stepBonds` call
`bondLevelAtIndex`, a no-op refactor).

---

## Verified clean (against the letter)

- **Growth:** exact `(dtMs/1000) × 1` per `i<j` within `<= 3.0`, `gapMs = 0` near / `+= dtMs`
  apart, never decays, capped at `BOND_SCORE_MAX`, one `bond-up` per pair per tick
  (`bonds.ts:153-186`); boundary-inclusive; documented giant-`dt` convention.
- **Levels/helpers:** thresholds 120/300/720 with `>=`; `bondLevelFor` by **ids** with the private
  index primitive retained; `strongestBondLevel` / `bondPartners` pure and ordered level desc →
  score desc → roster index asc.
- **Reunions:** `gapMs > 90_000` on first contact, reset-to-0 natural cooldown, no fresh-contact or
  continuous-near phantom.
- **Perk:** `hasCloseFriendNear` read-only, level ≥ 2 within radius; `×0.9` only in the chop/berries
  `period`; `1190 → 1071`, `1400 → 1260`; no effect far / warming-only / idle; cook path untouched.
- **Persist v6:** `VERSION = 6`; write is `bonds.scores` only (test proves the blob has no `gapMs`);
  load/migrations zero `gapMs`; `isPlausibleBonds` = length 144, finite, `0..BOND_SCORE_MAX`;
  v1→v6 chain with post-migration `isPlausibleState` on every branch.
- **UI:** `bondsLine` top-two / exact wording / `null` below level 1; card heart toggled in the
  per-frame `syncCards`; Bonds line hidden off the villager face via `data-face`; markup above the
  task grid; no new zones; no new dependency, no `any`.
- **Render:** hearts strictly transition-driven, gated on `state.tick`; both villagers for
  `bond-up`, single each for `bond-reunion`; pooled, allocation-free; `bond-up`/`bond-reunion`
  consume before the eat/favor branch.
- **Known/acknowledged (not counted):** hearts visuals live-verified only; no DOM test for
  `src/ui/index.ts`; the live perk measurement's night-drift re-run (harness artifact).
