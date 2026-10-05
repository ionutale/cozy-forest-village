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
export type TaskId = 'chop' | 'berries' | 'rest' | 'tend' | 'cook';
export type VillagerState = 'idle' | 'walking' | 'working' | 'resting';
export type StructureKind = 'woodpile' | 'pot' | 'garden' | 'bench' | 'lantern' | 'feeder';
export interface Vec2 { x: number; z: number }
export interface ResourceNode { id: string; kind: 'tree' | 'bush' | 'campfire'; pos: Vec2 }
export interface Structure { id: string; kind: StructureKind; pos: Vec2; built: boolean }
export interface Fire { fuel: number; max: number }
export interface Pot { meals: number }
export interface Villager {
  id: string; name: string; hatColor: string;
  task: TaskId | null;
  state: VillagerState;
  pos: Vec2;
  facing: number;            // radians, updated while walking (render reads it)
  progressMs: number;        // ms in the current activity (work yield / rest timer); 0 when idle or walking
  restMs: number;            // rest duration committed when the rest starts (fire state + meal at arrival)
  fedMs: number;             // >0 → well-fed: work period 1190 ms; decays with time in every state
  carrying: boolean;         // keeper carrying a log (render shows the carry pose)
  targetNodeId: string | null;  // resolves against nodes OR structures
}
export interface SimEvent {
  type: 'arrived' | 'chop' | 'gather' | 'rest-done' | 'fuel-add' | 'meal-cooked' | 'eat' | 'built' | 'garden';
  villagerId?: string;
  structureId?: string;
}
export interface GameState {
  tick: number;              // increments once per tick() call
  seed: number;
  resources: { wood: number; berries: number };
  villagers: Villager[];
  nodes: ResourceNode[];
  structures: Structure[];
  fire: Fire;
  pot: Pot;
  gardenMs: number;          // accumulator for the built garden's +1 berry / 30000 ms
  events: SimEvent[];        // events from the latest tick; cleared at the start of each tick
  pendingEvents: SimEvent[]; // queued by out-of-tick producers (e.g. buildStructure); flushed into events at tick start
}
export function createInitialState(seed?: number): GameState;
export function assignTask(state: GameState, villagerId: string, task: TaskId | null): void;
export function buildStructure(state: GameState, structureId: string): boolean;
export const STRUCTURE_COST: Readonly<Record<StructureKind, { wood: number; berries: number }>>;
export const GARDEN_PERIOD_MS: number;
export const COOK_BERRIES: number;
export const COOK_WOOD: number;
export function tick(state: GameState, dtMs: number): void;
```

`src/render/index.ts`:

```ts
import type { GameState } from '../sim';
export interface RenderHandle {
  render(state: GameState, dtMs: number): void;
  resize(): void;
  dispose(): void;
  /** T5: screen-space hit test against villager meshes (client px). */
  pickVillager(clientX: number, clientY: number): string | null;
  /** T5: visual selection highlight (soft ring under the villager). */
  setSelected(villagerId: string | null): void;
  /** T5: project a villager to screen client px (testability + UI anchoring). */
  projectVillager(villagerId: string): { x: number; y: number } | null;
  /** B5: screen-space hit test against structure meshes. */
  pickStructure(clientX: number, clientY: number): string | null;
  /** A4: hover cue — true over a villager (checked first) or a structure; read-only (no selection/camera side effects). */
  pickHover(clientX: number, clientY: number): boolean;
  /** B2: ground ring around the selected structure's footprint (ghost or built); null clears it. */
  setSelectedStructure(structureId: string | null): void;
}
export function initRender(canvas: HTMLCanvasElement): RenderHandle;
```

`src/ui/index.ts`:

```ts
import type { GameState, TaskId } from '../sim';
export interface UIActions {
  assignTask(villagerId: string, task: TaskId | null): void;
  /** T5: fires on internal selection changes (card click, dismissal) so the world ring stays in
      sync. The external select() path does NOT fire it (that path is already the sync target). */
  onSelect(villagerId: string | null): void;
  /** B7: build a ghost structure. */
  build(structureId: string): void;
  /** B7: wipe the save and start a fresh village. */
  resetVillage(): void;
}
export interface UIHandle {
  render(state: GameState): void;
  dispose(): void;
  /** T5: external selection (e.g. clicking a villager in the 3D scene). */
  select(villagerId: string | null): void;
  /** B7: external structure selection (ghost or built). */
  selectStructure(structureId: string | null): void;
}
export function initUI(root: HTMLElement, actions: UIActions): UIHandle;
```

Contract rules: other layers import **types** and the read-only data constants
(`STRUCTURE_COST`, `GARDEN_PERIOD_MS`, `COOK_BERRIES`, `COOK_WOOD`) from `../sim`, and **nothing
else** from it. Internal sim modules (`rng.ts`, `villagers.ts`, `tasks.ts`, `world.ts`) are
implementation detail.

### 3.1 Simulation rules (slice 1 — binding numbers)

- Movement: straight line (no pathfinding), speed **2.2 units/s**; arrival when distance **≤ 0.45**.
- Arrival points: work tasks (`chop`, `berries`) aim at a per-villager slot around the target node —
  offset radius **0.75**, angle = villager index × golden angle (same idiom as rest) — so villagers never
  stack inside the same trunk/bush. `targetNodeId` stays the nearest node.
- Work: one yield per **1400 ms** of continuous work — `chop` → wood +1, `berries` → berries +1.
  Villagers keep working until reassigned; nodes never deplete in slice 1.
- Rest: the target is a spot on a ring of radius **1.6** around the campfire, angle = villager index ×
  golden angle (2.399963 rad) — deterministic and spread out. **Approach arc:** while the shortest angular
  difference to the spot exceeds **0.25 rad**, the walk aims at a point on the **r = 2.2** ring at the
  angle bisector; when it is ≤ 0.25 rad, straight to the spot. Paths never pass within ~1.1 of the fire
  centre. After **4000 ms** of resting the villager becomes idle, `task` clears, one `rest-done` event.
- Task → node kind: chop → tree, berries → bush, rest → campfire. Target = nearest node of that
  kind (squared distance; ties broken by node id ascending).
- `assignTask(state, id, null)` → idle, target cleared. Reassigning mid-walk retargets immediately;
  re-assigning the *same* task with the *same* resolved target while not idle is a no-op (keeps progress).
- `tick` treats non-finite `dtMs` (NaN / ±Infinity) as 0.
- Events: `tick()` clears `state.events`, then appends this tick's events; consumers read after `tick`.
- Progress: `progressMs` accumulates `dtMs` while `working`/`resting`; reset on assignment, on
  arrival, and on completion. All timers live in the state — no hidden per-object storage.
- Determinism: same seed + same call sequence → identical state. No `Math.random`, no clocks inside `sim/`.
- `facing` updates while walking: `atan2(dx, dz)` in three.js convention (x right, z toward viewer).

### 3.2 Batch 2 — warmth, food, growth (binding numbers)

- **Fire**: `fuel` 0–100, starts 70, decays **0.22/s** (floor 0 — embers, never a failure state).
  States: roaring **≥66** · steady **≥33** · dim **>0** · embers **=0**. One log = **+25** fuel
  (cap 100); logs come from `resources.wood`.
- **Tend fire** (`tend`): keeper loop, re-evaluated every tick — if `carrying` → walk to the campfire,
  deposit (+25 fuel, event `fuel-add`); else if `wood ≥ 1 && fuel ≤ 75` → walk to the woodpile, take a
  log (`wood −1`, `carrying = true`); else stand watch (task stays, state `working`). The fire-side leg
  (deposit **and** stand-watch) uses the villager's own spot on the rest ring (golden angle, r=1.6) and
  the **rest approach arc**, exactly like `rest` — keepers never walk through or stand in the flames.
  When `tend` is reassigned away (or stopped) while `carrying`, the log settles first: `carrying = false`
  and `wood + 1` (no stranded logs, no permanent carry pose).
- **Arrival slots** cover structures too: `pot` and `woodpile` targets use the same per-villager
  golden-angle idiom at **r = 0.9**, with a tight arrival tolerance of **0.02** (movement clamps to the
  remaining distance, so villagers land essentially on their slot — shared-structure arrivals stay
  ≥ ~0.46 apart, above the 0.45 no-stacking bar). Nodes keep r = 0.75 / arrival 0.45.
- **Any walking leg** whose straight chord passes within **1.1** of the campfire centre is bent via the
  r = 2.2 bisector point (this covers tend-outbound and cook legs, not just rest/campfire arrivals).
- **Trunk obstacles** (`TRUNK_RADIUS` 0.42, from the render trunk footprint): while walking, any leg
  whose straight chord to its steering target passes within 0.62 of a non-destination trunk centre
  bends via a deterministic tangent waypoint around the nearest such trunk, recomputed every tick
  with no extra state. The destination node's own trunk is never an obstacle, and within 1.0 of the
  arrival point steering goes direct so slot landings stay exact. Bushes are walkable-adjacent.
- **Out-of-tick events**: producers outside `tick()` (e.g. `buildStructure`) push to
  `state.pendingEvents`; `tick()` seeds `events` from the queue and empties it — consumers never miss them.
- **Rest duration by fire** (evaluated at rest start, committed to `villager.restMs`): fuel ≥33 →
  4000 ms · fuel >0 → 5500 ms · fuel = 0 → 7000 ms.
- **Cook** (`cook`): requires the pot built; channel **3000 ms** per meal — costs **3 berries + 1 wood**,
  yields 1 meal (`pot.meals +1`, event `meal-cooked`); loops while ingredients last; **affordability is
  re-checked before every deduction**; when they run out → idle, task cleared (like rest completion).
- **Eat**: a villager arriving to rest at `fuel ≥ 33` with `pot.meals > 0` **and `fedMs < 30000`**
  consumes 1 meal (`pot.meals −1`), rests **5500 ms**, sets `fedMs = 60000`, event `eat`. A full belly
  (`fedMs ≥ 30000`) rests normally without consuming. Well-fed villagers work 15 % faster (**1190 ms**
  per yield); `fedMs` decays with `dtMs` in every state.
- **Structures**: fixed ring r=5.2 at angles 30°, 90°, 150°, 210°, 270°, 330° →
  pot (20 wood) · bench (15 wood) · garden (25 wood) · lantern (10 wood) · lantern (10 wood) ·
  feeder (10 wood + 5 berries). `woodpile` is pre-built at (90°, r=2.6).
  `buildStructure(state, id)` spends the cost, sets `built = true`, emits `built`; returns false for
  unknown / already built / unaffordable.
- **Garden**: while built, +1 berry every **30000 ms** (`gardenMs` in the state); each yield emits a
  `garden` event (the audio layer plays it as a soft pluck).
- **World gen**: trees/bushes scatter from **r = 7.5** outward (was 6) to keep the village ring clear.
- Structure targets resolve by kind (`woodpile`, `pot`) through the same `targetNodeId` field as nodes.

### Villager roster (fixed, used by T1 stub and T2 generation)

Names: Maple, Birch, Fern, Pip, Hazel, Juniper, Moss, Clover.
Hat colors: `#c96f4a #7fa653 #b0577a #6f8fb0 #d9a441 #8a6fae #4e8f76 #b0724b` (in order).

### Testability hook (all layers)

`main.ts` exposes `globalThis.__cozy = { getState: () => state, projectVillager: (id) => render.projectVillager(id) }` for automated validation.
The render layer additionally exposes `globalThis.__cozyRender = { info: () => ({ calls, triangles,
geometries, textures }) }` from `initRender` for performance checks.

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
  rock: '#a49b8a', tuftA: '#86b25f', tuftB: '#79a555',
  flowerWhite: '#f4efe2', flowerPink: '#d9a3b8',
  fire: '#e08a3c', accent: '#e08a3c', disc: '#ece0c3',
  bird: '#8d7d6b', mote: '#f6e7c6', skin: '#e2b58d', tunic: '#b5895f',
} as const;
```

Fonts: Google Fonts link for Nunito (400, 600, 800) in `index.html`, with the fallback stack above.

## 5. File ownership (one writer per file at any time)

| Path | Owner |
|---|---|
| `src/sim/**`, `src/sim/*.test.ts` | T2 |
| `src/render/environment.ts`, `src/render/palette.ts` | T3 |
| `src/render/villagers.ts` | T4 creates; T5 edits (selection) |
| `src/render/index.ts`, `src/main.ts` | T1 creates; T3 edits render/index.ts; T5 modifies |
| `src/ui/**`, `src/styles/**` | T1 creates; T5 refines |
| `src/render/ambient.ts`, `src/audio/**` | T6 |
| `src/persist/**` | B3 (batch 2) |
| `src/render/structures.ts` | B5 (batch 2) |
| README.md, index.html, configs | T1 creates; later tasks only with a ruling |

## 6. Anti-bloat rules (binding)

- Exactly three UI zones: (1) resource HUD, (2) villager panel, (3) task popover.
- No settings menus, modals, tutorials, or new permanent panels unless the user asks.
- New features fold into an existing zone or replace something in it.
- No feature may add a fourth zone; the orchestrator rejects such diffs.
- Batch 2 explicitly allows, *inside* the three zones: a Fuel pill in the HUD (with a mini bar), a 2×3
  task grid in the popover (Chop · Berries · Rest · Tend fire · Cook · Stop), structure cards in the
  same popover (ghost → Build; built → status), and a two-step reset (⟲) in the HUD. Nothing else.

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
