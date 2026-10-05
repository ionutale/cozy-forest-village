# G4 — Sim: recurring favors (chains loop instead of retiring)

Status: **DONE**. Final verification after the micro-round: `pnpm exec tsc --noEmit` exit 0,
`pnpm build` exit 0 (only the pre-existing >500 kB chunk advisory), `pnpm test` **10 files /
180 tests passed**, `vitest run src/sim` **74/74**. Transient red during the task was confined to
concurrently-edited `src/ui/**` / `src/render/**` files and cleared once that wave landed.

## Files

| File | Change |
|---|---|
| `src/sim/favors.ts` | Completion wraps `step` to 0 on the last chain step instead of advancing to `CHAIN_LENGTH`; `CHAIN_LENGTH` doc comment updated |
| `src/sim/favors.test.ts` | Retirement test replaced by looping coverage; six step-3-completion expectations updated `3 → 0` |
| `docs/tasks/G4-recurring-report.md` | this report |

No other files touched. No new deps, no `any`, no `Math.random` / clocks in `src/sim/**`.

## Change (per DESIGN §3.2 as amended)

- In `tickFavors`' completion pass:
  `progress.step = progress.step + 1 < CHAIN_LENGTH ? progress.step + 1 : 0;` — completing the
  third chain step lands on `step 0`, so the villager stays eligible (`step < CHAIN_LENGTH`) and
  the chain re-runs. Previously `step += 1` left the villager at `3` (retired).
- Everything else is unchanged: the 90 000 ms gap is still re-enforced on every completion
  (`nextOfferMs = max(nextOfferMs, NEXT_OFFER_GAP_MS)`), max-2 active favors, `activeBefore`
  semantics, the pure requester derive (its `completedSteps` term now cycles, still deterministic
  per seed), and no persist/schema change. A wrapped save holds a plain `step: 0`, and
  `isPlausibleState` still accepts integers in `[0, CHAIN_LENGTH]` (persist code untouched).

## Tests (19 in `src/sim/favors.test.ts`)

- The old "completing step 3 retires the villager" test is replaced by
  *"completing step 3 loops the chain to step 0: eligible again, offer waits the full gap"*:
  a step-2 (chain step 3) `eat/any` completion lands on `{ step: 0, active: false, progress: 0 }`,
  emits one `favor-done`, re-enforces the gap from a due countdown (`nextOfferMs = 90 000`), then
  no `favor-start` arrives across 89 s and exactly one arrives at the 90 s mark — back to the
  same villager at step 0.
- Six expectations in existing step-3-completion tests (`eat/any`, `build`, zero-dt `built`, fire,
  shared `eat/any`) changed from `step: 3` to `step: 0`. All other tests unchanged in spirit;
  step 0→1 and 1→2 advancement, counting semantics, cadence, cap, determinism, and the
  `favorWantFor(0, 3) === null` content guard all still pass.

## Evidence

| Check | Result |
|---|---|
| `pnpm exec vitest run src/sim/favors.test.ts` | **19/19 passed** |
| `pnpm exec vitest run src/sim` | **7 files / 74 passed** |
| `pnpm test` (first snapshot, my change in place) | **9 files / 149 passed, 0 failed** (one test replaced, so count is unchanged) |
| `pnpm test` (later snapshot while concurrent tasks landed) | 172 tests, 2 failures — both in `src/ui/derive.test.ts` (concurrent copy/signature change), none in `src/sim/**` |
| `pnpm exec tsc --noEmit` (scoped to `src/sim/**` via a temp tsconfig) | exit 0, no output |
| `pnpm exec tsc --noEmit` (project-wide) | **fails only in concurrently-edited files** — errors moved `src/ui/cards.ts` → `src/render/index.ts` → `src/ui/derive.test.ts` across runs; nothing in `src/sim/**` |
| `pnpm build` | fails for the same concurrent-file reasons (build = `tsc && vite build`) |

## Concerns

1. **Concurrent edits:** project-wide `tsc` / `build` were red on `src/ui/**` and `src/render/**`
   during this task (another batch-5 agent mid-edit; error locations shifted between runs). The
   orchestrator should re-run both once the wave lands. My files are clean.
2. **Legacy `step: 3` saves:** ~~parked villagers stay permanently ineligible~~ **RESOLVED in the
   micro-round below** — the offer pass now heals `step >= CHAIN_LENGTH` to 0 before the
   eligibility scan and the max-2 gate.
3. ~~**Stale comment outside my scope:** `src/sim/types.ts:72` still reads
   `// 0..CHAIN_LENGTH (3 = chain complete, retired)`.~~ **RESOLVED in the micro-round below.**

## Micro-round follow-up — legacy `step: 3` heal (same day)

Per the orchestrator's ruling, retired batch-4 records come back to life:

- `tickFavors`' offer pass now normalizes every record with `step >= CHAIN_LENGTH` to `step = 0`
  **before** the eligibility scan and the max-2 gate, so a fully-retired save rejoins the loop at
  the next due offer whether or not the board is full. Completion wrap, gap re-enforcement, and
  persist validation are unchanged (`step = CHAIN_LENGTH` stays a legal persisted value; it heals
  on the next due tick). The completion-pass defensive null-want path is kept for active legacy
  step-3 records seen before a heal pass.
- `src/sim/types.ts` `step` comment now reads: `0..CHAIN_LENGTH; completing the last step wraps
  back to 0 (no retirement)`.
- Tests: the old "unretired eligibility" test became *"heals batch-4 retired records (step 3) to
  step 0 before the eligibility scan"* — a fully-retired board heals and one `favor-start` opens;
  with two actives plus a retired v0, v0 heals to `{ step: 0, active: false, progress: 0 }` while
  the cap blocks any offer. *"Skips the requester of an already-active favor"* now asserts the
  offer lands on some other villager instead of pinning v1 (its step-3 parking now heals). The
  loop test holds the cap with a second live favor so no offer can slip in during the completing
  tick, then re-checks the 90 s boundary.

Evidence after the micro-round: `vitest run src/sim` **74/74 passed**; scoped `tsc` over
`src/sim/**` exit 0; then the concurrent wave landed and the project-wide gates all pass:
`pnpm exec tsc --noEmit` exit 0, `pnpm build` exit 0 (pre-existing chunk advisory only),
`pnpm test` **10 files / 180 passed**.
