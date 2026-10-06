# N2 report — persist schema v5 (day/night clock)

**Task:** N2 of `docs/superpowers/plans/2026-10-06-day-night-cycle.md` ·
**Spec:** `docs/superpowers/specs/2026-10-06-day-night-cycle-design.md` Part 2 ·
**Authority:** `DESIGN.md` §3 "Persistence (save schema)" — `VERSION = 5`, chain
v1 → v2 → v3 → v4 → v5.

**Files touched:** `src/persist/index.ts`, `src/persist/index.test.ts`, this report.
**Status:** DONE — full gate green (`tsc` · `build` · `test` 278/278).

---

## Step 1 — failing tests first

Five new tests written before the implementation (the plan's four cases, split into a positive and
a negative for clock validation):

| Test | Pins |
|---|---|
| v4 → v5: `clock = { dayMs: DAY_MS × FRESH_START_T }`, every v4 field untouched | migration default (fresh morning) |
| v4 → v5: a v4 blob failing the v4 shape check (missing `spices`) → `null` | the v4 branch validates its input |
| v5 round-trip mid-evening: `dayMs 400_000` → save/load → `400_000` exactly | Review Focus 1 |
| v5 clock rejection: missing · non-record · `{}` · `'soon'` · `NaN` · `Infinity` · `−1` · `DAY_MS` · `DAY_MS + 1` → `null` | v5 validation rule |
| v5 clock acceptance: both ends `0` and `DAY_MS − 1` round-trip | exclusive upper bound |

The existing v1 → v4 chained test became **v1 → v5**, keeping every village-preservation assertion
and gaining the `clock` one; the v3 → v4 migration test became **v3 → v5** with a clock assertion.

## Step 2 — run

N1's `Clock` / `DAY_MS` / `FRESH_START_T` had not landed at first write, so the initial `tsc` was
red only on those missing names (`src/persist/**` had no other errors — verified by inspection).
Polled `src/sim` every 20 s; N1 landed after ~100 s and the persist suite went **43/43**.

## Step 3 — implementation

- `VERSION = 5`; `PreClock = Omit<GameState, 'clock'>`; `V4GameState = PreClock`; the v1/v2/v3
  aliases now omit from `PreClock`, so each describes exactly what its schema wrote (no `clock`
  before v5).
- New `isPlausibleClock`: a record with a finite `dayMs` in `[0, DAY_MS)` (`DAY_MS` imported from
  `../sim` — one source of truth; the upper bound is exclusive).
- The old v4 guard became `isPlausibleV4State` (body unchanged: `spices` finite ≥ 0 + visitor
  shape + `isPlausibleV3State`); the new `isPlausibleState` (v5) = v4 checks + the clock, read off
  the raw record before narrowing.
- `migrateV3toV4` now returns `V4GameState` (unchanged body) and `migrateV4toV5` adds
  `clock: { dayMs: DAY_MS * FRESH_START_T }` — the spec's literal default.
- **Chain v1 → v2 → v3 → v4 → v5.** Every branch validates its input against its own schema first,
  then re-validates the migrated result with `isPlausibleState(v5) ? … : null` (the batch-6 review
  rule, I1). A new `version === 4` branch runs the v4 input guard before migration.
- `saveGame` is unchanged — it writes `VERSION`, so WRITE is always v5.

### Existing tests kept (edited only where the schema bump forces it)

- `expect(VERSION).toBe(4)` → `toBe(5)`; the two mid-round-trip `raw.version` assertions → `5`.
- Describe titles that exercise the **current** schema renamed `v4 …` → `v5 …` (round-trip with
  favors, round-trip mid-visit, visitor validation, spices validation, round-trip with arrivals,
  arrivals validation, roster bound); `v1 → v4 chained` → `v1 → v5 chained`.
- Fixtures: new `withoutClock()` helper; `asV2()` / `asV3()` now strip `clock` too, and a new
  `asV4()` builds a genuine batch-7 blob (spices + visitor, no clock).
- **Nothing deleted, weakened, or skipped.**

## Step 4 — verification

| Command | Result |
|---|---|
| `pnpm exec vitest run src/persist/index.test.ts` | **43/43 pass** (38 kept + 5 new) |
| `pnpm exec tsc --noEmit` | **exit 0 — 0 errors repo-wide** |
| `pnpm build` | exit 0 (only the pre-existing >500 kB chunk-size warning) |
| `pnpm test` | **278/278 pass, 15 files** (260 baseline + N1/N3/N4 concurrent additions + my 5) |

## Concerns for the orchestrator

1. **No browser/`pnpm dev` pass** (rules): the v4 → v5 default, the mid-evening round-trip and the
   clock rejection cases are unit-covered; the live pass ("reload mid-evening resumes the exact
   `dayMs`") remains the orchestrator's outstanding evidence.
2. **Concurrent counts moved under me:** the repo suite was 260/13 at task start; N1 added
   `src/sim/daynight.test.ts` (13 → 15 files) so the repo total is 278. My delta is persist
   38 → 43 (+5).
3. **Boundary choice:** `dayMs` is accepted on `[0, DAY_MS)` — `DAY_MS` itself is rejected because
   the sim wraps to 0 (the plan's `DAY_MS` / `DAY_MS + 1` rejection cases, both tested).
