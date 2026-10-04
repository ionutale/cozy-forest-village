# Cozy Forest Village

A cozy 3D village sim in a forest clearing. Around eight villagers live by a campfire; you
assign them tasks (chop wood, gather berries, rest) and resources accumulate in a warm, calm,
gently animated world.

Single player · browser only · no backend · no external art or audio assets.

## Getting started

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Vite dev server with hot reload |
| `pnpm build` | Type check (`tsc --noEmit`) + production bundle into `dist/` |
| `pnpm preview` | Serve the production build locally |
| `pnpm test` | Vitest unit tests (`vitest run`) |

## How the code is laid out

```
index.html          canvas#world + div#ui
src/
  main.ts           boot + the single requestAnimationFrame loop
  sim/              pure TypeScript simulation (no DOM, no three.js, no timers)
  render/           three.js scene layer + the single source of 3D colors
  ui/               cozy DOM UI (three zones: HUD, villager panel, task popover)
  styles/           design tokens + cozy UI stylesheet
  audio/            procedural WebAudio (ambient life task)
docs/tasks/         task briefs and implementer reports
```

`DESIGN.md` is the binding design spec: feel pillars, public contracts, palette tokens,
file ownership and anti-bloat rules.

## Public contracts

- `src/sim/index.ts` — the only sim entry point other layers import from.
  Other layers import **types** from it and nothing else.
- `src/render/index.ts` — `initRender(canvas): RenderHandle`
  with `render(state, dtMs)`, `resize()`, `dispose()`.
- `src/ui/index.ts` — `initUI(root, actions): UIHandle` with `render(state)` and `dispose()`.

## Testability hook

`window.__cozy.getState()` returns the live `GameState`, which lets automated browser checks
assert on simulation state without reaching into module internals.