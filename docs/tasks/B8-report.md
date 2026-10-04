# B8 Report — Audio: fire crackle tied to fuel + new SFX

## Files

| File | Lines | Change |
|---|---|---|
| `src/audio/index.ts` | 339 | Crackle grains, 4 new SFX, feeder chirp bonus. Throttle, lazy start, hook, dispose intact. |
| `docs/tasks/B8-report.md` | — | This report. |

Procedural only — no assets, no deps, no `any`, no `Math.random` (seeded `mulberry32` throughout).
Nothing committed.

## Implementation

- **Crackle** (`crackleGrain` + scheduling in `update`): one shared 1 s noise buffer created
  in `start()` (`crackleBuf`, seed 913) — no per-grain buffer allocation. Each grain is a
  20–60 ms slice at a PRNG offset, `playbackRate` 0.8–1.3, bandpass 1.2–4.5 kHz (Q 1.2),
  4 ms attack with exponential decay, random pan (±0.6), `onended` disconnect (F3 idiom).
  Rate/gain from DESIGN §3.2 states: roaring (≥66) ~3/s @ 0.08 · steady (≥33) ~1.5/s @ 0.06 ·
  dim (>0) ~0.5/s @ 0.05 · embers (=0) ~0.1/s @ 0.04. Interval is re-jittered per grain
  (`mean · (0.5 + rnd())`) — continuous, gentle, never rhythmic.
- **New SFX** (all through the kept `playSfx`: one per batch, 400 ms per-type cooldown):
  - `fuel-add` → `thud()`: triangle 180→90 Hz, 150 ms, peak 0.12.
  - `meal-cooked` → `mealBlip()`: two sine notes 520 then 660 (≈130 ms apart), 200/220 ms.
  - `eat` → `munch()`: lowpassed (800 Hz) slice of the shared noise buffer, 90 ms @ 0.04,
    plus a tiny 300→220 Hz sine (100 ms @ 0.03) — total ≤150 ms, gains ≤0.05.
  - `built` → `builtSfx()`: the existing `knock()` (±8 % variation included) + a single
    880 Hz sine blip 120 ms later — the "it's yours now" moment.
  - Batch priority (rarest first): built 6 > meal-cooked 5 > rest-done 4 > eat 3 >
    fuel-add 2 > gather 1 > chop 0; `arrived` stays silent. Implemented as an exhaustive
    `switch` + `consider()` — no casts.
- **Feeder bonus**: `state.structures.some(s => kind === 'feeder' && built)` halves the chirp
  interval: `base 2000 + rnd·4000` (2–6 s) instead of `4000 + rnd·8000` (4–12 s). Exact halving.
- Untouched: master gain 0.12, wind bed, pad, chirp cluster shape, lazy gesture start with
  silent-failure catch, dormant-before-gesture early return (also gates crackle — no backlog),
  `__cozyAudio` hook, `dispose()` (listeners + `close()` + `delete window.__cozyAudio`).

## Commands + results

- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm build` → exit 0 (`✓ built`).
- `pnpm test` → 6 files, 51 tests, all pass.
- Temp stubbed-`AudioContext` test (created, run, **deleted** — not in the diff): dormant
  pre-gesture (0 nodes, no throw); post-gesture 10 s at fuel 70 → grain count in the ~30
  band; 10 s at fuel 0 → ≤4 grains; 4-type batch → exactly `built`'s 2 voices; repeat batch
  at same timestamp → silence (cooldown); `fuel-add`/`meal-cooked`/`eat` → 1/2/1+sine voices;
  120 s chirp-osc count with feeder built strictly exceeds without. 1/1 passed.
- `grep` for `Math.random` / `: any` → clean (one comment mentions the absence).

## Browser / audible (left to orchestrator + human playtest)

No browser tooling here; audio was deliberately never force-started (no user activation from
synthetic events — `ctx.state` would stay `suspended` and `update` correctly no-ops).
Suggested human checks: crackle density steps down 70 → 40 → 10 → 0; thud/meal/munch/build
moments read without startling; feeder village chirps livelier.

## Deviations / concerns

1. One debug detour: the first smoke harness used `vi.fn(() => ctx)` as the `AudioContext`
   stand-in — arrow functions are not constructible, so `new` threw inside `start()` (silently
   swallowed by design). Test-harness artifact only; real `AudioContext` is a constructor.
   Re-ran with a `function` mock — all green. No source change needed.
2. `src/audio/index.ts` is now 339 lines (B8 sets no line budget; the growth is four SFX +
   crackle + scheduling). If the orchestrator wants it slimmer, `munch`/`crackleGrain` share
   an obvious future helper — left inline for review clarity.
