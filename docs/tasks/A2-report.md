# A2 Report — Warmth disc ("can eat here" telegraph)

## Files

| File | Change |
|---|---|
| `src/render/environment.ts` | Warmth disc: one mesh, scale/opacity updates only. |
| `docs/tasks/A2-report.md` | This report. |

`palette.ts` untouched — no new key needed (`PALETTE.fire` reused). No deps, no `any`,
no `Math.random`, nothing committed. No other files touched (concurrent tree respected).

## Implementation (`environment.ts`, campfire block + `update`)

- One `THREE.Mesh` with unit `CircleGeometry(1, 40)` + `MeshBasicMaterial`
  (`color: PALETTE.fire`, `transparent`, `depthWrite: false`), laid flat at y = 0.02 —
  just above the clearing disc (0.01), below the stone ring. Unlit basic material so it
  reads as a soft glow, not shaded ground. Geometry/material tracked in `disposables`;
  mesh leaves with `group.clear()`.
- Per frame (inside the existing B4 fire guard, refs added to its condition):
  - `warmDisc.scale.setScalar((1.2 + 3.8 · ratio) · (1 + 0.1 · flick))`
  - `warmDiscMat.opacity = (0.04 + 0.06 · ratio) · (1 + 0.1 · flick)`
  - Fuel 0 → r ≈ 1.2, opacity ≈ 0.04 (faint ember warmth); full → r = 5.0, opacity ≈ 0.10
    max — subtle at every state, overall feel over detail (DESIGN §2).
- **Flicker source reused verbatim** (the B4 line, now shared by flame + light + embers + disc):
  `const flick = 0.6 * Math.sin(timeSec * TAU * 0.9) + 0.4 * Math.sin(timeSec * TAU * 1.7 + 1.3);`
  Same value object, same time math — the disc breathes in sync with the flame (±10 % via
  the `1 + 0.1 · flick` factor). Pure function of `timeSec` + fuel; zero per-frame allocations.

## Perf

Draw calls: **+1** (the disc mesh; the light adds none, unchanged). Budget allows +1.

## Commands + results

- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm build` → exit 0 (`✓ built`).
- `pnpm test` → 6 files, **62/62 pass** (all failures would have been out-of-scope; none occurred).
- Temp smoke test (created, run, **deleted** — not in the diff): exactly one radius-1 circle
  mesh at y = 0.02 with `depthWrite: false`; scale/opacity match the formula to 1e-10 at
  fuel 70/0/100; opacity ≤ 0.11; repeat calls bit-identical; ≤0.05 scale / ≤0.005 opacity
  drift across 50 ms (gentle); default no-arg path steady, `dispose()` clean. 1/1 passed.
- `grep` for `Math.random` / `: any` in `environment.ts` → clean.

## Browser verification (left to orchestrator)

No dev server, no browser tooling per task constraints. Suggested: screenshot fuel 70/20/0 —
the warm halo should swell/shrink/fade with the flame without ever reading as a UI element.

## Deviations / concerns

None. One judgment call: reused `PALETTE.fire` instead of adding a key — the disc is the
same warm hue as the flame and point light, so it reads as one coherent heat source.
