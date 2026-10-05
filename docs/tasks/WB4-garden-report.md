# Batch-3 Wave B — garden yield becomes audible (B9 #15)

## Files

| File | Change |
|---|---|
| `src/sim/index.ts` | Garden loop pushes `{ type: 'garden' }` per berry yield (one line). |
| `src/sim/types.ts` | **CONSTRAINT DEVIATION (orchestrator: please bless):** `SimEvent.type` union gains `\| 'garden'` (one line). The touch list omitted this file, but the union lives here — not in `index.ts` — and the spec directs "a new `garden` type". Additive only; no existing consumer matches on it. |
| `src/sim/food.test.ts` | New cadence test: yield → event; no event while not yielding. |
| `src/audio/index.ts` | `gardenPluck()` + priority rank 2 (just above `gather`); existing ranks renumbered monotonically (relative order unchanged). |
| `docs/tasks/B4-report.md` | This section (appended; batch-2 report above left intact). |

No deps, no `any`, no `Math.random`, nothing committed. `palette.ts` untouched (no new key).

## Why a new type (spec step 1)

The garden yield emitted **no** event — only `berries += 1`. Reusing `gather` was rejected
because it would affect an existing consumer: `src/ui/index.ts:429` pulses the berries HUD
pill on `ev.type === 'gather'`, and audio could no longer voice garden vs. bush gathering
differently (req 2 needs a distinct softer/higher pluck). `render/villagers` only reacts to
`'eat'` — unaffected. No existing event semantics altered.

## Audio (req 2)

`gardenPluck()`: same sine-glide family as the bush `pluck()` (520→780), transposed **+2
semitones** (`×2^(2/12)`), gain **0.05** (vs 0.08), ~0.2 s, same ±8 % seeded variation +
small random pan. Flows through the kept throttle (one SFX per batch, 400 ms per-type
cooldown, own `garden` timer). Priority renumber, existing relative order preserved:
built 7 > meal-cooked 6 > rest-done 5 > eat 4 > fuel-add 3 > **garden 2** > gather 1 > chop 0.

## Commands + results

- `pnpm exec tsc --noEmit` → exit 0 (proves the union addition breaks no consumer).
- `pnpm build` → exit 0 (`✓ built`).
- `pnpm test` → 6 files, **63/63 pass** (62 before + 1 new cadence test). Pre-existing garden
  test untouched and green (it asserts only berry counts).
- Temp stubbed-`AudioContext` test (created, run, **deleted**): garden batch → exactly 1 osc
  at 520·k±8 % with peak 0.05 < bush 0.08; garden beats `gather` in a shared batch. 1/1.
  (Two harness detours, both test-only: bed voices pollute osc counts — reset arrays after
  gesture; `toBeCloseTo(k, 1)` tolerance is tighter than the ±8 % jitter band — assert bands.)

## DESIGN §3 line for the orchestrator (do NOT edit per instructions)

`DESIGN.md:64` currently reads:
`type: 'arrived' | 'chop' | 'gather' | 'rest-done' | 'fuel-add' | 'meal-cooked' | 'eat' | 'built';`
→ append `| 'garden'`:
`type: 'arrived' | 'chop' | 'gather' | 'rest-done' | 'fuel-add' | 'meal-cooked' | 'eat' | 'built' | 'garden';`

## Audible (human check — never force-started)

Audibility needs a real gesture (synthetic events leave `ctx` suspended and `update`
correctly no-ops). Suggested: build garden, wait 30 s, confirm a soft higher blip under the
bush-gather register.
