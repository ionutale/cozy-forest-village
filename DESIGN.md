# Cozy Forest Village — Design & Orchestration Spec

Status: approved by user (2026-10-04). This file is the binding authority for every task.
Code is written by free-model subagents, validated by the orchestrator, committed only after validation.

## 1. Pitch

A cozy 3D village sim in a forest clearing. ~8 villagers live around a campfire. The player
assigns them tasks (chop wood, gather berries, rest). Resources accumulate in a warm, calm,
gently-animated world. Single player, browser only, no backend, no external assets.

## 2. Feel pillars (binding for every task)

1. **Cohesion over fidelity.** Muted, warm palette. Consistent low-poly primitives. Soft fog
   + warm key light. No saturated primaries, no default greys, no pure black/white.
2. **Characters read cozy via hats + proportions** (big head, small body), not detail.
3. **Ambient life is sparing:** at most 2–3 ambient species at any time; nothing loud or aggro.
4. **Motion is gentle:** everything eases; no snappy or jerky animation.
5. **UI is cozy:** cream paper panels, warm ink text, radius ≥ 12px, soft shadows, one accent
   color. At most three UI zones (see §6). Additions fold into existing zones — never stack.
6. **Performance is part of feel:** forest uses `InstancedMesh`; renderer pixel ratio capped at 2.

## 3. Architecture

```
index.html            canvas#world + div#ui
src/
  main.ts             boot + single requestAnimationFrame loop (tick → render → ui.render)
  sim/                pure TypeScript. No DOM, no three.js, no timers. Deep module (T2 owns).
  render/             three.js layer (T1 scaffold, T3 environment, T4 villagers, T6 ambient)
    palette.ts        single source of 3D colors (mirrors CSS tokens)
  ui/                 cozy DOM UI (T1 owns)
  styles/             tokens.css + ui.css
  audio/              procedural WebAudio (T6 owns)
docs/tasks/           task briefs + implementer reports (orchestration artifacts)
```

### Public contracts

`src/sim/index.ts` — the only entry other layers may import:

```ts
export type TaskId = 'chop' | 'berries' | 'rest';
export type VillagerState = 'idle' | 'walking' | 'working' | 'resting';
export interface Vec2 { x: number; z: number }
export interface ResourceNode { id: string; kind: 'tree' | 'bush' | 'campfire'; pos: Vec2 }
export interface Villager {
  id: string; name: string; hatColor: string;
  task: TaskId | null;
  state: VillagerState;
  pos: Vec2;
  facing: number;            // radians, updated while walking (render reads it)
  targetNodeId: string | null;
}
export interface SimEvent {
  type: 'arrived' | 'chop' | 'gather' | 'rest-done';
  villagerId: string;
}
export interface GameState {
  tick: number;              // increments once per tick() call
  seed: number;
  resources: { wood: number; berries: number };
  villagers: Villager[];
  nodes: ResourceNode[];
  events: SimEvent[];        // events from the latest tick; cleared at the start of each tick
}
export function createInitialState(seed?: number): GameState;
export function assignTask(state: GameState, villagerId: string, task: TaskId | null): void;
export function tick(state: GameState, dtMs: number): void;
```

`src/render/index.ts`:

```ts
import type { GameState } from '../sim';
export interface RenderHandle { render(state: GameState, dtMs: number): void; resize(): void; dispose(): void }
export function initRender(canvas: HTMLCanvasElement): RenderHandle;
```

`src/ui/index.ts`:

```ts
import type { GameState, TaskId } from '../sim';
export interface UIActions { assignTask(villagerId: string, task: TaskId | null): void }
export interface UIHandle { render(state: GameState): void; dispose(): void }
export function initUI(root: HTMLElement, actions: UIActions): UIHandle;
```

Contract rules: other layers import **types** from `../sim` and **nothing else** from it. Internal
sim modules (`rng.ts`, `villagers.ts`, `tasks.ts`, `world.ts`) are implementation detail.

### 3.1 Simulation rules (slice 1 — binding numbers)

- Movement: straight line (no pathfinding), speed **2.2 units/s**; arrival when distance **≤ 0.45**.
- Work: one yield per **1400 ms** of continuous work — `chop` → wood +1, `berries` → berries +1.
  Villagers keep working until reassigned; nodes never deplete in slice 1.
- Rest: at the campfire; after **4000 ms** the villager becomes idle, `task` clears, one `rest-done` event.
- Task → node kind: chop → tree, berries → bush, rest → campfire. Target = nearest node of that
  kind (squared distance; ties broken by node id ascending).
- `assignTask(state, id, null)` → idle, target cleared. Reassigning mid-walk retargets immediately.
- Events: `tick()` clears `state.events`, then appends this tick's events; consumers read after `tick`.
- Determinism: same seed + same call sequence → identical state. No `Math.random`, no clocks inside `sim/`.
- `facing` updates while walking: `atan2(dx, dz)` in three.js convention (x right, z toward viewer).

### Villager roster (fixed, used by T1 stub and T2 generation)

Names: Maple, Birch, Fern, Pip, Hazel, Juniper, Moss, Clover.
Hat colors: `#c96f4a #7fa653 #b0577a #6f8fb0 #d9a441 #8a6fae #4e8f76 #b0724b` (in order).

### Testability hook (all layers)

`main.ts` exposes `globalThis.__cozy = { getState: () => state }` for automated validation.

## 4. Palette & tokens (binding values)

`src/styles/tokens.css` defines exactly these custom properties:

```css
--paper:#fdf6e9; --paper-2:#f6ead5; --ink:#4a3b2f; --ink-soft:#7d6c58;
--border:#e3d3b7; --accent:#e08a3c; --accent-ink:#fff8ee;
--leaf:#7fa653; --berry:#b0577a; --wood:#8c6242;
--radius:14px; --radius-sm:9px; --gap:8px;
--shadow:0 6px 18px rgba(74,59,47,.18);
--font:"Nunito","Trebuchet MS",system-ui,sans-serif;
```

`src/render/palette.ts` mirrors the 3D colors:

```ts
export const PALETTE = {
  sky: '#cfe0ea', fog: '#d8e4cf', grass: '#8fb768',
  trunk: '#7a5941', foliageA: '#6f9e4f', foliageB: '#7fae5b',
  sun: '#ffe3b3', ambientSky: '#cfe0ea', ambientGround: '#7fa653',
  fire: '#e08a3c',
} as const;
```

Fonts: Google Fonts link for Nunito (400, 600, 800) in `index.html`, with the fallback stack above.

## 5. File ownership (one writer per file at any time)

| Path | Owner |
|---|---|
| `src/sim/**`, `src/sim/*.test.ts` | T2 |
| `src/render/environment.ts` | T3 |
| `src/render/villagers.ts` | T4 |
| `src/render/index.ts`, `src/main.ts` | T1 creates; T5 modifies |
| `src/ui/**`, `src/styles/**` | T1 creates; T5 refines |
| `src/render/ambient.ts`, `src/audio/**` | T6 |
| README.md, index.html, configs | T1 creates; later tasks only with a ruling |

## 6. Anti-bloat rules (binding)

- Exactly three UI zones: (1) resource HUD, (2) villager panel, (3) task popover.
- No settings menus, modals, tutorials, or new permanent panels unless the user asks.
- New features fold into an existing zone or replace something in it.
- No feature may add a fourth zone; the orchestrator rejects such diffs.

## 7. Validation protocol (orchestrator)

Per task: `pnpm build` (tsc --noEmit + vite build) → `pnpm test` → live browser check via
chrome-devtools MCP (console clean, screenshot, scripted DOM/behavior assertions) → visual/cozy
review → commit + REPORT.md entry. Failures → reprompt the same subagent (max 3 rounds, then
escalate model). Implementers never commit; the orchestrator commits validated work.

## 8. Orchestration & reporting

Every dispatch records: task, model ID, attempts, validation evidence, evaluation (1–5), notes
in REPORT.md. Free models only. If free quota is exhausted: stop and ask the user, proposing the
cheapest OpenCode Go models first.

## 9. Iteration loop (after the first playable slice)

Free model proposes improvements → orchestrator curates **10 improvements ordered by difficulty**
(easy → hard) + own QA notes → user playtests (dev server URL provided) and adds their list →
user picks 5–6 → next batch dispatched. Repeat.

## 10. Non-goals for slice 1

No save/load, no day/night cycle, no building placement, no villagers needs/relationships,
no multiplayer, no external art/audio assets, no mobile-specific layout (desktop first).
