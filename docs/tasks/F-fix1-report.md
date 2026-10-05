# F — Fix round 1: review M2, M3, M4, M5

Applies the minimal fixes from `docs/tasks/F-review-report.md` for M2–M5. No new deps,
no `any`, deterministic sim rules untouched.

## M2 — zero-dt tick skipped the favor consumer

`src/sim/index.ts:163-169`. The `!(dtMs > 0)` guard now calls `tickFavors(state, 0)`
after the event seeding and before returning. `tickFavors` clamps `dt` internally, so
no warm-fire time accrues; only this tick's seeded events (e.g. a `built` queued by
`buildStructure`) reach the completion pass.

Pinned by `src/sim/favors.test.ts:313` — opens a `build` favor, queues
`pendingEvents` with a `built`, calls `tick(state, 0)`, expects the chain advance and
exactly one `favor-done`.

## M3 — `isPlausibleFavors` accepted out-of-range `step`

`src/persist/index.ts:63-79` (import at `:6`). Now requires `step` to be a number,
integer and within `[0, CHAIN_LENGTH]`, and `progress` to be a non-negative finite
number. Values are narrowed to locals before comparison (no `unknown` arithmetic).

Pinned by `src/persist/index.test.ts:170` — `step` of `1.5`, `-1`, `CHAIN_LENGTH + 1`
and `progress = -1` all reject; `step = CHAIN_LENGTH` (retired) still round-trips.

## M4 — `favor-done` lacked the roster guard of `favor-start`

`src/sim/favors.ts:139,147`. `const villager = state.villagers[i]` is hoisted and the
event is pushed only when the roster entry exists, mirroring the `favor-start` guard at
`:101`. The chain still advances; only the unrenderable id-less event is suppressed.

## M5 — requester determinism pinned for the first offer only

`src/sim/favors.test.ts:56-106` (helpers), `:168-176` (test). `requesterSequence(seed,
offers)` drives offer → complete → offer cycles through real `tick()` calls, completing
each open favor with crafted input for its want (all five kinds, including a `fire`
completion at `want.ms`), and throws if a favor fails to complete. The test asserts two
independently driven states seeded with `1` produce 3 defined requester ids and
`sequenceA` equals `sequenceB`. The existing single-offer test is kept unchanged.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | success (35 modules; pre-existing >500 kB chunk warning only) |
| `pnpm test` | 149/149 pass, 9 files |

Note: the working tree gained 7 tests in `src/ui/derive.test.ts` from a concurrent fix
round while this round ran, so 149 = 139 review baseline + 7 concurrent + 3 added here.
All 35 tests in the two files touched by this round pass.
