# H2 — Persist: schema v3 with chained migrations — Report

Status: **DONE** (implementation + tests complete and green). Full-repo `tsc`/`build` are
currently red only in **other agents' in-flight files** (`src/ui/**`, H3's test-first step) — see
Concerns. `src/persist/**` type-checks clean and its suite is 30/30.

## Files

| File | Change |
|---|---|
| `src/persist/index.ts` | `VERSION = 3`; `V1GameState`/`V2GameState` schema types; `isPlausibleArrivals`; `isPlausibleV2State` + v3 `isPlausibleState`; `migrateV2toV3`; chained `loadGame` |
| `src/persist/index.test.ts` | 11 new tests (migration ×3, round-trip ×1, arrivals validation ×4, roster ×3); existing suite kept |
| `docs/tasks/H2-huts-persist-report.md` | this report |

No other file touched — `src/sim/**`, `src/ui/**`, `src/render/**` left to their concurrent owners.

## Step 1–2: failing tests first

11 tests written before the implementation (per plan Step 1): first run **11 failed / 19 passed** —
i.e. exactly the new ones, all existing ones still green.

## Step 3: what shipped

**Version + schema types**

```ts
export const VERSION = 3; // v3 = v2 + the four hut plots + arrivals; migrations chain v1 → v2 → v3
type V1GameState = Omit<GameState, 'favors' | 'arrivals'>; // pre-favors (B3)
type V2GameState = Omit<GameState, 'arrivals'>;            // batch 4, no huts/arrivals
```

Splitting the old `V1GameState = Omit<GameState, 'favors'>` from the new v2 type is what lets the
guard *narrow* a blob to the schema it claims: a v1/v2 blob legitimately has no `arrivals` key, so
`GameState` itself could never describe it.

**v3 validation = v2 checks + arrivals + roster (plan Step 3, spec Part 2)**

- `isPlausibleArrivals`: `Array.isArray`, every entry a record with `structureId: string`,
  `inMs` finite `≥ 0`, `castIndex` integer in `[0, 3]` (`MAX_CAST_INDEX`; `VILLAGE_CAP` and
  `HUT_PLOTS` are imported from `../sim`, so the cap has one source of truth).
- `isPlausibleState` (v3) = `isPlausibleV2State` + arrivals shape + `villagers.length ∈ [8, 12]`.

**`migrateV2toV3(state)`** — appends the `HUT_PLOTS` entries whose `id` the save does *not* already
have as `{ kind: 'hut', built: false }` (positions copied, never aliased to the read-only table) and
sets `arrivals: []`. Roster and every existing structure are untouched → an existing village simply
gains four empty plots (spec Part 2).

**`loadGame` chain**

```
version === VERSION (3) → isPlausibleState        → return
version === 2           → isPlausibleV2State      → migrateV2toV3          → return
version === 1           → isPlausibleV1State      → +createFavors → migrateV2toV3 → return
anything else           → null
```

`saveGame` writes `VERSION` unchanged, so **writes are always v3** (pinned by the round-trip test's
`raw.version === 3`).

## Step 4: tests (11 new, all green)

| Test | Pins |
|---|---|
| v2 → v3 appends four unbuilt huts + `arrivals: []`, village untouched | migration result |
| v2 → v3 never duplicates a hut the save already has | idempotence |
| **v1 → v2 → v3 chained** keeps the village intact + four empty plots + empty queue | Review Focus 4 |
| v3 round-trip: `'arriving'` villager at `EDGE_SPAWN` → hut, pending arrival at 45 000 ms | Review Focus 1 |
| arrivals missing / non-array → null | spec Part 2 |
| 8 bad arrival records (non-record, no/non-string `structureId`, missing/negative/NaN `inMs`, missing `castIndex`) → null | spec Part 2 |
| `castIndex` −1 / 4 / 1.5 → null; boundaries 0 and 3 accepted | spec Part 2 |
| 13 villagers (13 favor records) → null · 7 villagers → null · 12 villagers → loads | `[8, 12]` bound, both ends |

Existing tests kept: only the literal `expect(raw.version).toBe(2)` in the favor round-trip became
`expect(raw.version).toBe(VERSION)` plus `expect(VERSION).toBe(3)` (a schema bump must change that
assertion; nothing else in the suite was edited).

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | **zero errors in `src/persist/**`**. Repo-wide: exactly 2 errors remain, both in H3's files — `src/ui/derive.test.ts:55` and `src/ui/structure-card.test.ts:109`, their `state()` factories not carrying `arrivals` (mtime unchanged across my last retries → H3 appears finished without re-running tsc). Re-ran 8× over ~25 min per plan Step 4; did not touch them (outside the allow-list). |
| `pnpm build` | fails only at those same two `src/ui/**` tsc errors (the vite step never runs). Rerun once H3's factories gain `arrivals`. |
| `pnpm test` | **209/209 pass, 11 files** (180 baseline + my 11 + concurrent H1/H3 additions). `src/persist/index.test.ts` **30/30** (19 kept + 11 new). H1's `huts.test.ts`/`food.test.ts` failures seen mid-wave went green on retry. |

## Notes / interpretations

1. **Each older schema validates against *its own* rules before migrating — no post-migration
   re-validation.** Plan Step 3 states it exactly that way ("v2 → validate → migrate → return"),
   and it is what "existing tests stay" requires: the pre-existing v1 fixture has **one** villager,
   which a v3 roster check (`[8, 12]`) would reject. Consequence: a hand-corrupted v2 blob with, say,
   3 villagers loads as-is — same trust level the loader has always had for v1/v2 saves; the roster
   bound applies to what the game itself writes (v3).
2. **The v3 check does not require the four hut structures to be present** — plan Step 3 lists only
   "arrivals shape + `villagers.length ∈ [8, 12]`" as the v3 additions, so a v3 save with its hut
   plots hand-deleted still loads (fresh game would have them; the sim does not depend on them).
3. **`castIndex` ceiling is a local `MAX_CAST_INDEX = 3`** rather than `NEWCOMER_CAST.length` —
   spec Part 2 states the bound as the literal `[0, 3]`, and it keeps the H1 surface this task
   consumes to `HUT_PLOTS` + `GameState.arrivals`, exactly as the plan's Interfaces block specifies.

## Concerns for the orchestrator

1. **Repo-wide `tsc`/`build` are red on two H3 test files at my finish time** —
   `src/ui/derive.test.ts:55` and `src/ui/structure-card.test.ts:109`: their local `state()`
   factory spreads a base object that predates `GameState.arrivals`, so `arrivals` reads as
   optional and the literal no longer satisfies `GameState`. The fix is one line in each factory
   (`arrivals: []`), but both are outside this task's allow-list and neither file's mtime moved
   over my last three retries, so H3 appears to have finished without re-running tsc. Per plan
   Step 4 I noted it, re-ran (8 retries over ~25 min) and did not touch them. **Re-run
   `pnpm exec tsc --noEmit` and `pnpm build` after H3's owners apply that one-liner** — there is
   nothing left to fix in `src/persist/**` (0 persist errors).
2. **`createInitialState` now returns 8 structures (4 huts), which broke `food.test.ts`'s
   "woodpile plus six unbuilt ring spots"** during the wave; it went green on a later retry (H1's
   owner fixed it) — noted only so the orchestrator knows the ring test is hut-sensitive.
3. **No browser/`pnpm dev` pass** (rules): the migration path is fully covered by the unit suite,
   but nobody has yet booted the app against a real v2 localStorage blob — the orchestrator's
   post-wave live pass step 1 ("v2-save boot check") is still the outstanding evidence for that.
