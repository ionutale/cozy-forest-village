# F4 Report — Audio cues + hearts trigger for favors

**Status: DONE.** Nothing committed (per wave protocol; orchestrator commits).
**Date:** 2026-10-05

Scope: `src/audio/index.ts` + `src/render/villagers/index.ts` only, per
`docs/superpowers/plans/2026-10-05-villager-favors.md` Task F4 / spec Part 4. No other files touched.

## What was implemented

### Step 1 — Audio (`src/audio/index.ts`)
- `SfxKind` gains `'favor-start' | 'favor-done'`; both `lastSfx` entries seeded at `-10`
  (the existing per-type ~400 ms cooldown applies unchanged).
- `favor-start` → `favorAsk()`: soft two-note "hm?" (330 → 415 Hz, sine, gains 0.035/0.03),
  deliberately below the chirp register (1.5–3.8 kHz) and quieter than every existing cue.
- `favor-done` → `favorChime()`: warm rising two-note chime C5 → G5 (523.25/783.99 Hz, sine,
  gains 0.045/0.04) — pitched clear of `rest-done` (660/880 Hz) and quieter than `built`
  (knock 0.14 + 880 Hz chime 0.05).
- Priority table renumbered verbatim per plan: `built 10 > favor-done 9 > meal-cooked 8 >
  rest-done 7 > favor-start 6 > eat 5 > fuel-add 4 > garden 3 > gather 2 > chop 1`; relative
  order otherwise unchanged (`'arrived'` stays silent). Lazy start / cooldown / dispose untouched;
  audio is never force-started.

### Step 2 — Hearts (`src/render/villagers/index.ts`)
- The per-update event scan now also bursts the existing pooled hearts on `favor-done`:
  identical `spawnHearts(hearts, rig, heartSerial)` call as `eat` — same pool, same 2–3 burst
  rules, same deterministic serial, no new geometry, no allocation.
- The savoring head bob stays `eat`-exclusive; `favor-done` only bursts hearts.
- Existing tick-gating unchanged, so an extra render pass over the same events still cannot
  double-spawn. Header comment updated to note the F4 behavior.

## Verification

- `pnpm exec tsc --noEmit` → clean (exit 0).
- `pnpm build` → clean (exit 0; only the pre-existing >500 kB chunk-size warning).
- `pnpm test` → **9 files, 138 tests passed** (91 baseline + F1–F3 additions; F4 adds no unit
  tests per plan). Exit 0.
- Gate timing note: the first gate runs were blocked solely by the concurrent wave — F1's union
  members / `sim/index.ts` wiring and F3's UI signature were still landing. Each was re-checked
  every ~45–60 s and the full gate re-run once they settled; no failure ever appeared in an F4
  file.

## Concerns

None. Audible quality (the "hm?" vs chime character) is intentionally the orchestrator's live
browser pass — this environment never force-starts the AudioContext.
