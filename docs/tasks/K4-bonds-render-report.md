# K4 Report — Render: hearts on the two bond events

**Status: DONE.** Nothing committed (wave protocol; the orchestrator gates, live-verifies and commits).
**Date:** 2026-10-06
**Wave:** bonds (batch 9). **Plan:** `docs/superpowers/plans/2026-10-06-bonds.md` Task K4.
**Spec:** `docs/superpowers/specs/2026-10-06-bonds-design.md` Part 3.

Scope: `src/render/villagers/index.ts` only, plus this report. No other files touched. No new
dependencies, no `any`, no new objects/geometry, no audio.

## What was implemented

The existing event→hearts path (one scan per sim tick, gated on `state.tick` — so an extra render
pass over the same batch cannot double-spawn) now also consumes the two bond events, reusing the
same 4-slot pooled sprite machinery as `eat` / `favor-done`:

- **`bond-up` → one gentle puff at both villagers.** `burstHeartsAt(...)` looks up each of
  `villagerId` and `otherId` and calls the existing `spawnHearts(hearts, rig, serial)` — the same
  2–3-heart burst the meal/favor pulse uses. A same-id pair (impossible for the pair table, but a
  cheap guard) spawns once; a missing rig is a no-op.
- **`bond-reunion` → a subtler single puff at each.** `spawnSingleHeart(...)` takes exactly one slot
  from the shared pool via `heartSlot(hearts)`, sets the same `Heart` fields `spawnHearts` would,
  keeps `spread = 0` (a lone heart needs no fan) and derives its wobble phase from the same
  deterministic serial hash. Two events per reunion pair → two hearts; a level-up pair → 4–6.

Both handlers sit *before* the `eat`/`favor-done` branch and `continue`, so the savoring-bob arming
stays `eat`-exclusive (a bond event never touches `rig.savoring`). Strictly transition-driven: the
sim emits each event once per real crossing/reunion, and the tick gate keeps the spawn one-shot.

Header comment updated to note the B9 behavior. The deterministic `heartSerial` continues to be the
only stagger source; never `Math.random`.

## Why a local single-heart helper

`hearts.ts` was **not** in K4's allowed file set, so `spawnHearts`' fixed 2–3 burst could not gain a
count parameter. `spawnSingleHeart` therefore reuses the exported pool (`heartSlot`) and hash
(`hash01`) and mirrors the field writes inline. Allocation-free (it only mutates a pooled object);
no per-frame cost beyond the existing tick-gated scan.

## Verification

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 (clean) |
| `pnpm build` (`tsc --noEmit && vite build`) | exit 0, `✓ built` (only the pre-existing >500 kB chunk warning) |
| `pnpm test` | **16 files / 309 passed**, 0 failed |

Baseline was 282/282 (15 files); the run is 309/309 (16 files) — green including every concurrent
K1/K2/K3 addition. This layer has no unit tests by design (plan Step 2); the orchestrator
live-verifies staged reunions and level-ups.

**Dependency note (applied):** the first gate failed only on K1's still-landing surface
(`bond-up`/`bond-reunion` union members + `otherId` in `src/sim/types.ts`) and, in the same run,
K1/K3's own in-flight reds. Polled `src/sim/types.ts` until the members landed (~120 s), then
re-ran the gate until the whole wave settled (`tsc` clean on the 5th attempt, ~150 s). No error ever
appeared in a K4-owned line beyond the expected missing-symbol ones.

## Concerns

1. **`spawnSingleHeart` mirrors `spawnHearts`' field initialization** rather than sharing it, because
   `hearts.ts` was out of scope. If the `Heart` layout changes, both must change. A one-line
   follow-up (optional `count`/`spread` param on `spawnHearts`, then this helper deleted) would
   remove the duplication — deliberately not done here to respect the file boundary.
2. **Pool pressure at simultaneous bursts.** `bond-up` spawns 4–6 hearts from a 4-slot pool, so a
   level-up landing beside a meal can recycle (shorten) the oldest hearts sooner. This is the
   existing pool's intended recycle behavior (`heartSlot` picks the oldest when full), not a leak or
   a crash; worth a glance in the live pass if two level-ups coincide.
3. **"Subtler" is count-based** (one heart vs a 2–3 fan); per-heart size/opacity live in
   `advanceHearts` and were not changed. If the live pass reads the single heart as too plain, the
   optional-param refactor in (1) is the lever for a size/alpha variant.
