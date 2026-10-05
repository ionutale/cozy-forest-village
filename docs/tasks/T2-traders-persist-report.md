# T2 report — persist schema v4 (traders → spices)

**Task:** T2 of `docs/superpowers/plans/2026-10-05-traders-spices.md` ·
**Spec:** `docs/superpowers/specs/2026-10-05-traders-spices-design.md` Part 2 ·
**Authority:** `DESIGN.md` §3 "Persistence (save schema)" — `VERSION = 4`, chain v1 → v2 → v3 → v4.

**Files touched:** `src/persist/index.ts`, `src/persist/index.test.ts`, this report.
**Status:** DONE_WITH_CONCERNS — my files are fully green; the repo-wide `tsc`/`build` gate is red on
`src/ui/structure-card.test.ts` (T3's file, see Concern 1).

---

## Step 1 — failing tests (6 new + 1 helper)

| Test | Pins |
|---|---|
| v3 → v4: adds `spices: 0` + away visitor `{phase:'away', inMs: FIRST_VISIT_MS, visitMs: 0, tradesLeft: 0}`, every other field untouched | migration defaults |
| v3 → v4: a v3 blob failing the v3 shape check (missing `arrivals`) → `null` | the v3 branch validates its input |
| v1 → v4 chain keeps the village end-to-end (Focus 5 — the Focus 4 chain test extended with its v4 half) | full chain |
| v4 round-trip mid-visit: `visiting`, `inMs 75 000`, `visitMs 45 000`, `tradesLeft 1`, `spices 2` restore exactly; `raw.version === 4` | Focus 1 + WRITE always v4 |
| invalid visitor shapes → `null` (12 cases: missing, non-record, no `phase`, off-enum `phase`, negative `inMs`, negative `visitMs`, non-number `inMs`, non-finite `visitMs`, missing `tradesLeft`, `-1`, `TRADES_PER_VISIT + 1`, `1.5`) | visitor validation |
| both phases at the boundaries load (`away` @ `FIRST_VISIT_MS`; `visiting` `inMs 0`, `tradesLeft = TRADES_PER_VISIT`) | validator completeness |
| `spices` missing / `-1` / `Infinity` / `NaN` / `'pinch'` → `null`; `3` round-trips | spices validation |

New helper `asV3()` — a faithful batch-6 blob (huts + arrivals, no visitor, no spices); it copies
`resources` before the `delete` so it can never mutate the caller's state.

## Step 2 — run: **7 failed | 31 passed (38)**

All seven failures were the missing implementation: `VERSION` still 3, no v3 branch (a version-3
blob fell through to `null`), no visitor/spices rules.
**T1's gate was satisfied** by then — `Visitor`, `resources.spices`, `FIRST_VISIT_MS` all resolved;
`TRADES_PER_VISIT` was on the surface too and is consumed rather than duplicated. No waiting needed.

## Step 3 — implementation

- `VERSION = 4`. `V1GameState` / `V2GameState` / `V3GameState` share a `PreVisitor` fragment
  (`resources` without `spices`, no `visitor`), so each alias describes exactly what its schema
  actually wrote; `migrateV2toV3` now returns `V3GameState` so the chain can continue.
- New `isPlausibleVisitor` + new `isPlausibleState` (v4) = **v3 checks + `spices` finite ≥ 0 +
  visitor shape**. The old v3 guard became `isPlausibleV3State` (body unchanged). The two v4
  fields are read off the raw record *before* narrowing, so the guard needs no type casts.
- `migrateV3toV4()`: `resources: {…, spices: 0}` and `visitor: {phase:'away', inMs: FIRST_VISIT_MS,
  visitMs: 0, tradesLeft: 0}` — the spec's literal defaults.
- **Chain v1 → v2 → v3 → v4.** Every branch validates its input against its own schema first, then
  **re-validates the migrated result with `isPlausibleState(v4) ? … : null`** (the batch-6 review
  made post-migration validation a rule). The v3 branch does both: `isPlausibleV3State` on the
  input, `isPlausibleState` on the output.
- `saveGame` is unchanged — it writes `VERSION`, so WRITE is always v4.

### Interpretations

1. **`tradesLeft ∈ [0, TRADES_PER_VISIT]`** imports T1's `TRADES_PER_VISIT` (it *is* exported —
   unlike H2's `MAX_CAST_INDEX`, where the sim table was not on the surface and a literal was used).
2. **Migration always resets** `spices` to `0` and rebuilds the visitor from `FIRST_VISIT_MS`, even
   if an older blob happens to carry those keys — spec says "v3 → v4: `resources.spices = 0`;
   `visitor = {away, FIRST_VISIT_MS, …}`". A pre-v4 save has no trader by definition, so there is
   nothing stale worth salvaging (a mid-visit trader only exists in a v4 blob, which is migrated by
   no branch at all).
3. **`spices` and `visitor` are required on a v4 blob** — missing → `null` (fresh game), same
   treatment every other schema block has always had.
4. **Boundary values accepted** (tested): `inMs = 0` while visiting, `visitMs = 0` while away,
   `tradesLeft = TRADES_PER_VISIT`.
5. **The intermediate v3 inside the v1/v2 chains is not separately validated** — the final
   `isPlausibleState(v4)` runs every v3 rule (it calls `isPlausibleV3State`), so a broken
   intermediate can never escape; only the *v3 input branch* needed its own gate, per the plan's
   "v3 → validate → migrate to v4".

### Existing tests kept (edited only where the schema bump forces it)

- `expect(VERSION).toBe(3)` → `toBe(4)`; the arrivals round-trip's `raw.version` `3` → `VERSION`.
- Two `resources` equality checks gain `spices: 0` (the v1 load and the v2 → v3 migration test) —
  the migration now legitimately adds it.
- Chained-migration test: title `v1 → v2 → v3 chained (Focus 4)` → `v1 → v4 chained (Focus 4 + 5)`,
  plus its v4-half `visitor` assertion.
- Describe titles `v3 arrivals validation` / `v3 roster bound` → `v4 …` — they write
  `version: VERSION`, which is now 4; leaving "v3" there would misdescribe what they exercise.
- **Nothing deleted, weakened, or skipped.**

## Step 4 — verification

| Command | Result |
|---|---|
| `pnpm exec vitest run src/persist/index.test.ts` | **38/38 pass** (32 kept + 6 new) |
| `pnpm test` | **254/254 pass, 12 files** (includes concurrent T1/T3 additions) |
| `pnpm exec tsc --noEmit` | **0 errors in `src/persist/**`**; 4 errors in `src/ui/structure-card.test.ts` (not mine — Concern 1) |
| `pnpm build` | blocked by those same 4 errors (`build` = `tsc --noEmit && vite build`); the Vite step is never reached |

## Concerns for the orchestrator

1. **Repo-wide `tsc`/`build` are red on `src/ui/structure-card.test.ts` — 4 × TS2741
   "`spices` is missing"** (lines 112, 177, 178, 256). T1's `resources.spices` landed after that
   file's last write (mtime 23:02:38), so its four local `resources: {wood, berries}` literals no
   longer satisfy `GameState['resources']`. It is T3's file (outside my allow-list) and its mtime
   did not move across my retries (~2 min, 3 attempts), so I did not touch it. **Fix is one line per
   site: add `spices: 0`.** Nothing is left to fix in `src/persist/**`.
2. **No browser/`pnpm dev` pass** (rules): the v3 → v4 path and the mid-visit reload are covered by
   unit tests only — the orchestrator's live steps ("v3-save boot check", reload mid-visit) remain
   the outstanding evidence.
3. **Baseline moved under me:** the repo suite was 216 at my task start and is 254 now; my delta is
   persist 32 → 38 (+6). The rest is concurrent T1/T3 work.
