# B4 Report — Render: fire visuals + warm light tied to fuel

## Files

| File | Lines | Change |
|---|---|---|
| `src/render/environment.ts` | 278 | Flame scale/tint by fuel, warm flickering `PointLight`, ember bed. Breeze untouched. |
| `src/render/palette.ts` | 25 | Added `ember: '#a5502f'` after `fire`. |
| `docs/tasks/B4-report.md` | — | This report. |

No new dependencies, no `any`, no `Math.random`, nothing committed.

## Implementation

- **Flame by fuel** (`environment.ts`, campfire block + `update`): uniform scale
  `s = (0.25 + 0.75 · fuel/max) · (1 + 0.06 · flicker)`; cone base pinned at y ≈ 0.075
  (`FLAME_BASE_Y + 0.525 · s`) so the tip breathes while the base sits in the stone ring.
  Tint lerps `PALETTE.ember → PALETTE.fire` by fuel ratio — at 0 the cone is a small
  (0.25×) dark-orange ember nub, at 100 a full warm flame.
- **Warm point light**: one `THREE.PointLight(PALETTE.fire, 1.4, 14, 2)` at (x, 1.1, z),
  `castShadow` untouched (default false — no shadow cost). Intensity
  `(0.25 + 1.15 · ratio) · (1 + 0.06 · flicker)` per spec.
- **Flicker**: slow two-sine noise `0.6·sin(2π·0.9·t) + 0.4·sin(2π·1.7·t + 1.3)`, ±6 % on
  flame scale and light intensity, plus a ±0.03 positional wobble on the flame. All sines —
  eased by construction, no strobing. Ember opacity breathes ±10 % on the same signal.
- **Embers**: 16 deterministic `THREE.Points` dots (hash salts 25–27, r ≤ 0.8, y 0.1–0.55),
  `PointsMaterial` size 0.09, opacity `0.15 + 0.75·(1 − ratio)` — a dim bed at full fire,
  the visible glow at fuel 0. The clearing cools via the light dropping to 0.25.
- **Fuel plumbing**: `update(timeSec, fire?)` — the second param is optional so the frozen
  caller (`render/index.ts:129`, owned by another task, still `env.update(timeSec)`) keeps
  compiling. Resolution order: explicit arg → live `window.__cozy.getState().fire` hook →
  steady default `{fuel: 70, max: 100}` (hook absent in unit tests / before boot).
  `max ≤ 0` and out-of-range fuel are clamped; never NaN. Only `Fire`/`ResourceNode`
  *types* imported from `../sim` — contract rules hold.

## Perf

Net new draw calls: +1 (ember `Points`); the light adds none. Total scene stays far below
the `calls < 200` budget (was single digits of environment meshes + villagers + ambient).

## Commands + results

- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm build` → exit 0 (`✓ built`).
- `pnpm test` → 6 files, 49 tests, all pass.
- Temp smoke test (created, run, **deleted** — not in the diff): fuel 70/0/100/20 via the
  explicit arg — scale ≈ 0.775/0.25/1.0, intensity ≈ 1.055/0.25/1.4, ember opacity
  high at 0 / faint at 100, tint exactly `#a5502f` at 0 and `#e08a3c` at 100, `castShadow`
  false; identical outputs on repeat calls (deterministic); ≤0.02 scale drift across a
  50 ms step (gentle); default no-hook path renders steady without throwing. 1/1 passed.
- `grep` for `Math.random` / `: any` in touched files → clean.

## Browser verification (left to orchestrator)

No browser tooling in this session. Suggested: mutate fuel via `__cozy.getState().fire.fuel =
70 / 20 / 0`, screenshot each — flame height/tint, light warmth and ember glow must read
instantly without being loud; console clean; `__cozyRender.info().calls < 200`.

## Deviations / concerns

1. Fuel arrives via the `__cozy` hook rather than a widened caller signature because
   `render/index.ts` is frozen for this task. If the orchestrator later lets the caller pass
   state, the optional `fire?` param is already there — `env.update(t, state.fire)` just works.
2. At fuel 0 the light keeps intensity 0.25 (per the spec formula) — the clearing cools but
   never goes fully dark; intentional, matches "embers, never a failure state" (§3.2).
