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
  type: 'arrived' | 'chop' | 'gather' | 'rest-done' | 'fuel-add' | 'meal-cooked' | 'eat' | 'built' | 'garden' | 'favor-start' | 'favor-done' | 'visitor-arrive' | 'visitor-leave' | 'trade';
  villagerId?: string;
  structureId?: string;
  tradeKind?: 'berries' | 'spice'; // batch 7: which trade fired
  hearty?: boolean;                // batch 7: the eat was a hearty (spiced) meal
}
export type FavorWant =
  | { kind: 'eat'; who: 'self' | 'any'; count: number } // eat events (requester or anyone)
  | { kind: 'gather'; count: number }
  | { kind: 'chop'; count: number }
  | { kind: 'build'; count: number }
  | { kind: 'fire'; ms: number };                       // ms accumulated with fuel ≥ 33
export interface FavorProgress { step: number; active: boolean; progress: number }
export interface FavorsState { byVillager: FavorProgress[]; nextOfferMs: number }
export interface Arrival { structureId: string; inMs: number; castIndex: number } // batch 6: pending walk-ins
export interface Visitor { phase: 'away' | 'visiting'; inMs: number; visitMs: number; tradesLeft: number } // batch 7

export interface GameState {
  tick: number;              // increments once per tick() call
  seed: number;
  resources: { wood: number; berries: number; spices: number };
  villagers: Villager[];
  nodes: ResourceNode[];
  structures: Structure[];
  fire: Fire;
  pot: Pot;
  gardenMs: number;          // accumulator for the built garden's +1 berry / 30000 ms
  events: SimEvent[];        // events from the latest tick; cleared at the start of each tick
  pendingEvents: SimEvent[]; // queued by out-of-tick producers (e.g. buildStructure); flushed into events at tick start
  favors: FavorsState;       // batch 4: per-villager favor chains (binding rules in §3.2)
  arrivals: Arrival[];       // batch 6: pending newcomer walk-ins (binding rules in §3.2)
  visitor: Visitor;           // batch 7: the trader's visit schedule (binding rules in §3.2)
}
export function createInitialState(seed?: number): GameState;
export function assignTask(state: GameState, villagerId: string, task: TaskId | null): void;
export function buildStructure(state: GameState, structureId: string): boolean;
export const STRUCTURE_COST: Readonly<Record<StructureKind, { wood: number; berries: number }>>;
export const GARDEN_PERIOD_MS: number;
export const COOK_BERRIES: number;
export const COOK_WOOD: number;
export const FIRST_OFFER_MS: number;
export const NEXT_OFFER_GAP_MS: number;
export const MAX_ACTIVE_FAVORS: number;
export const CHAIN_LENGTH: number;
export function createFavors(villagerCount: number): FavorsState;
export function favorWantFor(villagerIndex: number, step: number): FavorWant | null;
export const HUT_SETTLE_MS: number;
export const VILLAGE_CAP: number;
export const HUT_PLOTS: readonly { id: string; pos: Vec2 }[];
export const NEWCOMER_CAST: readonly { name: string; hatColor: string }[];
export const FIRST_VISIT_MS: number;
export const VISIT_STAY_MS: number;
export const NEXT_VISIT_GAP_MS: number;
export const TRADER_WALK_MS: number;
export const TRADES_PER_VISIT: number;
export const HEARTY_FED_MS: number;
export const TRADE_WOOD_COST: number;
export const TRADE_WOOD_YIELD: number;
export const TRADE_BERRY_COST: number;
export function trade(state: GameState, kind: 'berries' | 'spice'): boolean;
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
  /** G5: gently ease the camera target toward a villager; null cancels any running ease. */
  focusVillager(villagerId: string | null): void;
  /** T4 (batch 7): screen-space hit test for the trader while visiting. */
  pickTrader(clientX: number, clientY: number): boolean;
  /** T4 (batch 7): the trader's selection ring on/off. */
  setTraderSelected(on: boolean): void;
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
  /** T3 (batch 7): buy from the visiting trader; refused while away/deficient or out of trades. */
  trade(kind: 'berries' | 'spice'): void;
}
export interface UIHandle {
  render(state: GameState): void;
  dispose(): void;
  /** T5: external selection (e.g. clicking a villager in the 3D scene). */
  select(villagerId: string | null): void;
  /** B7: external structure selection (ghost or built). */
  selectStructure(structureId: string | null): void;
  /** T3 (batch 7): trader face on (default) / off — `false` closes only the trader face. */
  selectTrader(on?: boolean): void;
}
export function initUI(root: HTMLElement, actions: UIActions): UIHandle;
```

Contract rules: other layers import **types**, the read-only data constants
(`STRUCTURE_COST`, `GARDEN_PERIOD_MS`, `COOK_BERRIES`, `COOK_WOOD`, `FIRST_OFFER_MS`,
`NEXT_OFFER_GAP_MS`, `MAX_ACTIVE_FAVORS`, `CHAIN_LENGTH`, `HUT_PLOTS`, `HUT_SETTLE_MS`,
`VILLAGE_CAP`, `NEWCOMER_CAST`, `FIRST_VISIT_MS`, `VISIT_STAY_MS`, `NEXT_VISIT_GAP_MS`,
`TRADER_WALK_MS`, `TRADES_PER_VISIT`, `HEARTY_FED_MS`, `TRADE_WOOD_COST`, `TRADE_WOOD_YIELD`,
`TRADE_BERRY_COST`) and the `createFavors`/`favorWantFor`/`trade`
factories from
`../sim`, and **nothing else** from it. Internal sim modules (`rng.ts`, `villagers.ts`, `tasks.ts`,
`world.ts`, `favors.ts`) are implementation detail.

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
- **Favor chains** (batch 4; full spec `docs/superpowers/specs/2026-10-05-villager-favors-design.md`):
  each villager has a **3-step** chain; at most **2** favors active at once; the first offer arrives
  after **120000 ms** of play and offers are separated by ≥ **90000 ms** (re-armed per offer,
  re-enforced after each completion). Completion is event-driven (`eat`/`gather`/`chop`/`build`) or
  accumulated `fuel ≥ 33` time (**120000 ms** for the fire favor); a completion advances the chain,
  emits `favor-done` and enforces the 90000 ms gap. Favors never expire; completing step 3 **loops the chain back to step 0** (villagers never
  permanently retire — the same gap re-paces each loop; batch-4 saves with a stored
  `step === CHAIN_LENGTH` normalize to 0 on the next offer pass). Offering and requester
  selection are deterministic pure derives from `seed` (no stored RNG state). Chain content: step 1
  `{eat, self, 1}`; step 2 even index `{gather, 6}` / odd `{chop, 4}`; step 3 `index % 3` →
  `{eat, any, 3}` / `{build, 1}` / `{fire, 120000}`. The "delighted!" hint window after a completion
  is UI-side only: **`THANK_YOU_MS = 6000`**.
- **Huts** (batch 6): four plots `hut-1…hut-4` (new kind `'hut'`) on ring **r = 7.6** at
  45°/135°/225°/315°, cost **30 wood + 10 berries**. Completing a hut schedules one arrival
  (`castIndex = (villagers.length − 8) + arrivals.length`) with a **90000 ms** settle; at 0 the
  newcomer appends at `EDGE_SPAWN (0, −12)` in state `'arriving'` (assignments refused), walks the
  existing steering to the hut, then idles. Cast in completion order: Lily `#e3b7c4` · Rowan
  `#b03a3a` · Sage `#a8bd86` · Wren `#7d6a52`. Roster cap **12**; a newcomer's favor record appends
  in the same tick (arrays never desync).
- **Trader visits** (batch 7): one visitor at a time. First visit after **240000 ms** of play; a visit
  lasts **120000 ms** (walk in/out over **6000 ms** from the south edge); away **360000 ms** between
  visits. `trade(state, kind)` sells `5 wood → 4 berries` or `6 berries → 1 spice`, max **3 trades
  per visit**, refused while away or deficient. The `visitor` block drives it; the render derives
  the trader's body position from `(phase, visitMs)` — the sim never tracks the trader's position.
- **Hearty meals** (batch 7): eating with `spices > 0` consumes **1 spice**, sets
  fedMs = **90000** (instead of 60000) and emits `eat` with `hearty: true`; all other eat rules
  unchanged.
- **World gen**: trees/bushes scatter from **r = 7.5** outward (was 6) to keep the village ring clear.
- Structure targets resolve by kind (`woodpile`, `pot`) through the same `targetNodeId` field as nodes.

### Villager roster (fixed, used by T1 stub and T2 generation)

Names: Maple, Birch, Fern, Pip, Hazel, Juniper, Moss, Clover.
Hat colors: `#c96f4a #7fa653 #b0577a #6f8fb0 #d9a441 #8a6fae #4e8f76 #b0724b` (in order).

### Persistence (save schema)

`VERSION = 4` (batch 7; v3 was batch 6). **Migrations chain: v1 → v2 → v3 → v4.** v3 → v4 adds
`resources.spices = 0` and an away `visitor` (next visit `FIRST_VISIT_MS`); v2 → v3 appends the four
`hut-*` structures (unbuilt) and `arrivals: []`. The village is untouched on load; unknown versions
or implausible shapes → fresh game (`loadGame` returns null; never throws).

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
  same popover (ghost → Build; built → status), and a two-step reset (⟲) in the HUD.
- Batch 4 explicitly allows, *inside* the three zones: a requester heart glyph on the villager card
  (zone 2), favor/delight text in the panel hint (zone 2), and a reserved `Favor:` line above the task
  grid in the popover (zone 3).
- Batch 6 explicitly allows, *inside* the three zones: four hut plots and the dynamic villager-card
  reconcile + panel list scroll (zone 2), and the "Arriving…" state on cards.
- Batch 7 explicitly allows, *inside* the three zones: a Spices pill in the HUD (zone 1) and a third
  popover face — the trader's two trade buttons with a "Trades left" line (zone 3). Nothing else.

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
