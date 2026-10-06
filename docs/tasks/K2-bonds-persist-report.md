# K2 report — persist schema v6 (bonds, scores only)

**Task:** K2 of `docs/superpowers/plans/2026-10-06-bonds.md` ·
**Spec:** `docs/superpowers/specs/2026-10-06-bonds-design.md` Part 4 ·
**Authority:** `DESIGN.md` §3 "Persistence (save schema)" — `VERSION = 6`,
chain v1 → v2 → v3 → v4 → v5 → v6, `gapMs` never saved.

**Files touched:** `src/persist/index.ts`, `src/persist/index.test.ts`, this report.
**Status:** DONE — `tsc` clean, `build` green, `pnpm test` 309/309 (16 files). K1 had landed by
the end of my retry loop; no pending concerns.

---

## Step 1 — failing tests (8 new)

| Test | Pins |
|---|---|
| v5 → v6: fills `scores` and `gapMs` as `new Array(144).fill(0)`, every v5 field untouched | migration defaults |
| v5 → v6: a v5 blob failing the v5 shape check (missing `clock`) → `null` | the v5 branch validates its input |
| v6 round-trip mid-bonds: `119 / 120 / 719 / 720`, a fractional `12 345.5` and `BOND_SCORE_MAX` restore exactly; `gapMs` comes back all-zero | spec Part 4 / Review Focus 4 (level edges + no phantom reunions on reload) |
| v6 save shape: parsed blob's `state.bonds` has exactly `['scores']`; `gapMs` never reaches disk | the write contract |
| v6 validation: wrong length (`143`, `145`, `[]`) → `null` | score-array length 144 |
| v6 validation: `NaN`, `-1`, `BOND_SCORE_MAX + 1`, `Infinity`, `'close'` → `null` | score range / finiteness |
| v6 validation: bonds missing / non-record / `{}` → `null` | required block |
| v6 validation: `0` and `BOND_SCORE_MAX` both round-trip | accepted boundaries |

## Step 2 — run: **11 failed | 40 passed (51)**

All failures were the missing implementation (VERSION still 5; no v5 branch; no bonds rule) plus one
genuine bug caught during Step 3 (below). **K1 was mid-landing** at first contact — `BONDS.ts` and
the `GameState.bonds` type had landed but `createInitialState`/`BOND_SCORE_MAX` re-export had not —
so the repo-wide `tsc` was briefly red on K1's own in-flight lines. I waited (~20 s, then ~60 s) and
re-ran; by the final pass K1 had landed and my gate ran clean. No pending-K1 concern.

## Step 3 — implementation

- `VERSION = 6`; header/banner comment updated. `BOND_SLOTS = VILLAGE_CAP * VILLAGE_CAP` (144)
  derived from K1's `VILLAGE_CAP` so the length rule can never drift.
- **`PreBonds`-style types:** `PreBonds = Omit<GameState, 'bonds'>`; `V5GameState = PreBonds`;
  `PreClock = Omit<PreBonds, 'clock'>` (so `V1GameState`/`V2GameState`/`V3GameState`/`V4GameState`
  all correctly lack `bonds` too). `migrateV4toV5` now returns `V5GameState`.
- `isPlausibleBonds`: record whose `scores` is an array of exactly `BOND_SLOTS` (144) entries, each a
  finite number in `[0, BOND_SCORE_MAX]`. `gapMs` is never inspected — it is not persisted.
- `isPlausibleV5State` = the old v5 guard (v4 checks + clock); the new `isPlausibleState` (v6) = v5
  checks + bonds.
- `migrateV5toV6`: `{ scores: 144 zeros, gapMs: 144 zeros }`, every v5 field spread through.
- **Chain v1 → … → v6.** Every branch validates its input against its own schema first, then
  **re-validates the migrated result with `isPlausibleState(v6) ? … : null`** (batch-6 review I1);
  the new `version === 5` branch does the same. `saveGame` writes `VERSION`, so WRITE is always v6.

### The mid-flight bug and the load rehydration

`saveGame` writes `bonds: { scores }` only, so the first cut returned the parsed current-version
state verbatim — which therefore had **no `gapMs`** and broke every `toEqual(state)` round-trip
(11 reds). Fix: a new `hydrateGapMs(state)` rebuilds `bonds.gapMs` as `BOND_SLOTS` zeros and is
applied on the `version === VERSION` load branch. Migrated paths already build zeros in
`migrateV5toV6`, so all paths hand the sim a 144-long `gapMs` — no phantom reunions from any load.

### Save shape

`SavedGameState = Omit<GameState, 'bonds'> & { bonds: { scores: number[] } }`; `SaveFile.state` uses
it. `saveGame` builds `{ ...state, bonds: { scores: state.bonds.scores } }` — a shallow copy of
state, `gapMs` dropped at the serialization boundary, live state never mutated.

### Existing tests kept (edited only where the schema bump forces it)

- `expect(VERSION).toBe(5)` → `toBe(6)`; the mid-visit `raw.version` `5` → `6`.
- Fixture helpers `asV2`/`asV3`/`asV4` now also strip `bonds` (new `withoutBonds`), and a new `asV5`
  is the v5 → v6 input; each faithfully describes what its schema actually wrote.
- Chained tests `v1 → v5` → `v1 → v6`, `v3 → v5` → `v3 → v6`, `v4 → v5` → `v4 → v6`, each gaining
  its zeroed-bonds assertion while keeping every prior village-preservation assertion.
- `describe` titles `v5 …` → `v6 …` where they write `version: VERSION` (now 6).
- **Nothing deleted, weakened, or skipped.**

## Step 4 — verification

| Command | Result |
|---|---|
| `pnpm exec vitest run src/persist/index.test.ts` | **51/51 pass** (43 kept + 8 new) |
| `pnpm exec tsc --noEmit` | **0 errors** |
| `pnpm build` | **green** (`tsc --noEmit && vite build`, 39 modules) |
| `pnpm test` | **309/309 pass, 16 files** (baseline 282 + K1's `bonds.test.ts` and the wave's additions) |

## Concerns for the orchestrator

1. **No browser/`pnpm dev` pass** (rules): the v5 → v6 path, the round-trip mid-bonds and the
   no-`gapMs`-on-disk contract are covered by unit tests only. The live steps — reload mid-bonds on a
   real save — remain the orchestrator's evidence.
2. **Baseline moved under me:** the suite was 282 at task start; K1's new `src/sim/bonds.test.ts`
   (and sibling wave edits) landed concurrently, so the final repo count is 309. My delta is
   persist 43 → 51 (+8).
3. `BOND_SLOTS` is derived (`VILLAGE_CAP²`) rather than a literal `144`; if K1 ever re-exports an
   authoritative table-length constant, that would be the cleaner source. Behavior is identical.
