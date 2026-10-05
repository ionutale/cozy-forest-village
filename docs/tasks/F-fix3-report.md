# F fix round 3 — M8 report

Status: **DONE**. M8 fixed; `src/render/villagers/index.ts` only. Changes left uncommitted.

## Finding

Independent review (F-review-report M8): step 0 is `{eat, self, 1}`, so every first-favor
completion lands on the same tick as the requester's own `eat`. The render event scan called
`spawnHearts` twice for the same rig in one tick — 2–3 hearts, then 2–3 more into
`HEART_POOL = 4` — and the second burst recycled the first burst's oldest hearts (`ageMs = 0`,
truncated), producing a stuttering burst on the most common completion path.

## Fix

One heart burst per villager per tick, with the `favor-done` burst winning because it is the same
visual moment (`src/render/villagers/index.ts:22`–`:28`, `:94`–`:110`):

```ts
/** M8: true when this tick's event batch holds a `favor-done` for `villagerId`. */
function hasFavorDoneFor(events: readonly SimEvent[], villagerId: string): boolean {
  for (const event of events) {
    if (event.type === 'favor-done' && event.villagerId === villagerId) return true;
  }
  return false;
}
```

```ts
if (event.type === 'eat') {
  rig.savoring = true; // the bob stays eat-only, even when the burst is de-duped
  // M8: step 0 completes on the requester's own meal tick, so the `favor-done` burst
  // would otherwise double-spawn into the 4-slot pool. One burst per villager per
  // tick; the completion wins (same visual moment). Other eats are untouched.
  if (hasFavorDoneFor(state.events, event.villagerId)) continue;
}
heartSerial = spawnHearts(hearts, rig, heartSerial);
```

Properties the brief asked for:

- **One burst per villager per tick.** The dedup is per `villagerId` and scans the whole batch, so
  it is independent of event order (`eat` is pushed before `favor-done` today, but the check does
  not rely on it). Heterogeneous batches stay correct: an `eat/any` completion tick with three
  eaters gives the requester its `favor-done` burst and the other eaters their eat bursts — one
  each.
- **Allocation-free.** A second read-only pass over the event batch; no `Set`, no array, no closure
  per tick. Event batches are bounded by the roster/one tick, so the O(n²) scan is a handful of
  comparisons.
- **Deterministic.** Pure membership test over the same batch; no iteration-order dependence, no
  RNG, no clock.
- **Savoring-bob (eat-only) untouched.** `rig.savoring = true` still arms on every `eat` even when
  the burst is de-duped, and `favor-done` still never arms it; release on leaving `resting`
  (`:79`) is unchanged.
- **Non-favor eats unchanged.** With no same-villager `favor-done` in the batch, the `eat` path is
  exactly today's: arm bob, `spawnHearts`.
- **Idempotence unchanged.** The `state.tick !== lastEventTick` gate and `heartSerial` threading are
  untouched, so an extra render pass over the same tick still cannot double-burst.

Header comment updated to state the one-burst-per-villager-per-tick rule
(`src/render/villagers/index.ts:6`–`:8`).

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 (vite build ok; only the pre-existing >500 kB chunk warning) |
| `pnpm test` | exit 0 — 9 files, **139/139** tests passed (baseline) |

No unit test added: F8 has no render test harness in the repo and the file allow-list excluded new
test files; the orchestrator live-checks the burst.

## Known gaps / concerns

1. **The two-burst path is now unobservable in the pool, not removed from the event stream.** Both
   events still flow to the other consumers (audio priority keeps `favor-done` over `eat`; UI thanks
   window untouched). Only the render burst is de-duped, which is the layer the review scoped.
2. **Pointer event ordering.** `heartSerial` advances once per retained burst (the favor's), not
   twice, so the deterministic stagger sequence legitimately shifts by one serial step at a
   completion vs. the pre-fix build. That is intended — the pool no longer resets `ageMs` — but it
   means the bursts are not pixel-identical to the old double-spawn.
3. **M4 shape.** A hypothetical `favor-done` with `villagerId === undefined` still cannot match the
   dedup (the helper takes a `string`); such an event is skipped by the pre-existing guard before
   the helper is called, same as before.
