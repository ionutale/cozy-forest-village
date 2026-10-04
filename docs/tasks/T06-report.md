# T06 Report — Ambient life + procedural WebAudio

## Files (final line counts)

| File | Lines | Change |
|---|---|---|
| `src/render/ambient.ts` (new) | 209 | Birds (6, 3 instanced meshes), butterflies (8, 2 wing + 1 body instanced meshes), motes (60, 1 `THREE.Points`). Hash-derived phases, no `Math.random`. 7 draw calls total. |
| `src/audio/index.ts` (new) | 180 | `initAudio()` — lazy `AudioContext` on first `pointerdown`/`keydown`, wind bed (looped noise → 400 Hz lowpass + 0.08 Hz LFO) + detuned-sine pad (gain 0.015), chirps every 4–12 s (3–5 blips, 1.5–3.8 kHz, random pan), `chop`/`gather`/`rest-done` SFX. Seeded `mulberry32`, no `Math.random`. Master gain 0.12. `__cozyAudio` hook exposed. |
| `src/render/environment.ts` | 220 | Added `crownBase` records + breeze in `update(timeSec)`: tilt ≤ 0.03 rad, 0.6–1.0 Hz per-tree phase. Trunks untouched, exports identical. |
| `src/render/index.ts` | 170 | Creates/adds/updates/disposes the ambient layer (`ambientLayer`; the name `ambient` was already taken by the HemisphereLight). |
| `src/render/palette.ts` | 23 | Added exactly `bird: #8d7d6b`, `mote: #f6e7c6`, `accent: #e08a3c` (= CSS `--accent`). `fire` kept. |
| `src/render/villagers.ts` | 249 | Accent swap only: selection ring uses `PALETTE.accent` instead of `PALETTE.fire` (+ comment update). |
| `src/main.ts` | 77 | `const audio = initAudio()` after UI setup; `audio.update(state, dt)` in the frame loop. |

No new dependencies, no textures/assets, no `any`, no new UI zones. Nothing committed (working tree only).

## Commands + results

- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm build` → exit 0 (`✓ built`, only the pre-existing >500 kB chunk-size warning).
- `pnpm test` → 3 files, 19 tests, all pass.
- Temp smoke test (created, run, **deleted** — not in the diff): `createAmbient().update()` at t=0 vs t=2 changes instance matrices; same-t updates are bit-identical (deterministic); `dispose()` clean; `createEnvironment().update()` sways without error. 2/2 passed.
- `grep` for `Math.random` / `any` in all touched files → clean (only the words in comments).

## Browser verification

**Not done by me — no browser tooling is available in this session. Left to the orchestrator:**
console-clean load, birds/butterflies/motes visibly moving across ~2 s samples, crown sway, `__cozyRender.info()` (`calls < 200`, `triangles < 600000`), `__cozyAudio.state() === 'none'` pre-gesture with no errors. Audio audibility is a human playtest check; I deliberately did not force-start audio (per spec §4).

## Deviations / gaps / concerns

1. `src/render/index.ts` uses `ambientLayer` instead of `ambient` — forced rename, `ambient` was already the HemisphereLight (compile error otherwise). Behaviour matches spec.
2. `environment.ts` is exactly 220 lines (spec: ≤ ~220) — no functional compromise.
3. Butterfly wing amplitude is ±0.45 rad ("tiny" per spec) at 7 Hz; bird flap ±0.35 rad at 3 Hz — both gentle, nothing aggro.
4. `voice()` stereo pan falls back to mono when `createStereoPanner` is missing — defensive, untestable here.
