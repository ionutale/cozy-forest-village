# T03 Report — Forest environment: instanced world, light, fog

Status: implemented, `tsc` + `build` + `test` green. Live browser check NOT done here (no browser in this sandbox) — orchestrator to confirm via chrome-devtools MCP.

## Files

| File | Lines | Change |
|---|---|---|
| `src/render/environment.ts` | 203 (new) | `createEnvironment(nodes)` — 6 `InstancedMesh`es (trunk, crown, bush, rock, tuft, flower) + regular-mesh campfire (disc, ring, flame). `update()` no-op hook, `dispose()` disposes instanced meshes + tracked geo/mat. |
| `src/render/index.ts` | 120 (was 188) | Placeholder world code removed (`createKit`/`WorldKit`/`addTree`/`addBush`/`addCampfire`/`buildPlaceholderWorld` + `TRUNK_H`/`CROWN_H` constants). Camera/lights/fog/controls/resize/`RenderHandle` unchanged. Builds `createEnvironment(state.nodes)` once on first `render()`, calls `env.update()`, exposes `window.__cozyRender.info()` from `renderer.info`, disposes env on `dispose()`. |
| `src/render/palette.ts` | 18 (was 13) | Added exactly `rock: '#a49b8a'`, `tuftA: '#86b25f'`, `tuftB: '#79a555'`, `flowerWhite: '#f4efe2'`, `flowerPink: '#d9a3b8'` (DESIGN §4 values). |

## Implementation notes

- Instance counts: trunks 40 + crowns 40 (one per `tree` node), bushes 20 (one per `bush` node), rocks 24 (r=7…30 index hash), tufts 420 (r≤34, cone h=0.5 scaled 0.6–1.0 → ≤0.5u), flowers 60 (r=4…30), campfire disc r=4.2 `#ece0c3` + torus ring + `MeshBasicMaterial` flame.
- Variation: `hash01(index, salt)` (`fract(sin(i·127.1 + s·311.7)·43758.5453)`); crown scale 0.88–1.12 (±12%); crown/bush/tuft/flower colors via `setColorAt` lerps between the paired palette tones; subtle trunk brightness variation (±). No `Math.random`, no `any`, no new dependencies. All world materials `MeshLambertMaterial` except flame (`MeshBasicMaterial`). Shadows: trunks/crowns/bushes/campfire ring cast; rocks/tufts/flowers do not; ground + clearing disc receive.
- `update(_timeSec)` is a no-op hook for T6.

## Commands run (observed results)

- `pnpm exec tsc --noEmit` → exit 0, no output.
- `pnpm build` → exit 0 (`tsc --noEmit` + `vite build`, 19 modules, dist JS 573.89 kB / gzip 144.30 kB; pre-existing chunk-size warning only).
- `pnpm test` → exit 0, 3 files / 17 tests passed.
- `grep` checks → no `Math.random`, no `: any`/`<any>`/`as any`, no `buildPlaceholderWorld`/`WorldKit`/`addTree`/`addBush`/`addCampfire`/`createKit` remnants.

## `__cozyRender.info()` numbers

Live `__cozyRender.info()` was NOT observed (no browser in sandbox). Analytic values computed from the actual three.js geometry classes used:

- `calls` ≈ 12 (6 instanced + ring/flame/disc + ground + ambient/sun shadow pass) — budget < 80.
- `triangles` ≈ 12,392 (trunk 1120 + crown 640 + bush 2400 + rock 864 + tuft 4200 + flower 2880 + ring 168 + flame 16 + disc 40 + ground 64) — budget < 400,000.
- `geometries` ≈ 10 — budget < 30. `textures` = 0 (no textures).
- Orchestrator: please confirm live via `__cozyRender.info()` in the browser check.

## Deviations / known gaps

- No deviations from the brief. Trunk per-instance brightness uses `setColorAt` (white base material) — within "hue variation" requirement.
- Clearing disc color `#ece0c3` is a new literal (warm paper/grass blend, not a palette key) — brief allowed "a warm paper/grass tone" without naming a key.
- Browser acceptance criterion 2 (screenshot/sun shadows/campfire read) left to orchestrator validation.
