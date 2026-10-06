// Public simulation types. Binding shapes from DESIGN.md §3 (contract) and §3.2
// (batch-2 surface) — other layers import these from `src/sim/index.ts` and
// nothing else from the sim.

export type TaskId = 'chop' | 'berries' | 'rest' | 'tend' | 'cook';
export type VillagerState = 'idle' | 'walking' | 'working' | 'resting' | 'arriving';

export type StructureKind = 'woodpile' | 'pot' | 'garden' | 'bench' | 'lantern' | 'feeder' | 'hut';

export interface Vec2 {
  x: number;
  z: number;
}

export interface ResourceNode {
  id: string;
  kind: 'tree' | 'bush' | 'campfire';
  pos: Vec2;
}

export interface Structure {
  id: string;
  kind: StructureKind;
  pos: Vec2;
  built: boolean;
}

export interface Fire {
  fuel: number;
  max: number;
}

export interface Pot {
  meals: number;
}

export interface Villager {
  id: string;
  name: string;
  hatColor: string;
  task: TaskId | null;
  state: VillagerState;
  pos: Vec2;
  facing: number; // radians, updated while walking (render reads it)
  targetNodeId: string | null; // resolves against nodes OR structures
  progressMs: number; // ms accumulated in the current activity (work yield / rest timer); 0 while idle or walking
  fedMs: number; // >0 → well-fed: work period 1190 ms; decays with time in every state
  carrying: boolean; // keeper carrying a log (render shows the carry pose)
  restMs: number; // committed rest duration for the current rest; 0 when not resting
}

export interface SimEvent {
  // B9-wave-B garden cadence (one-line additive change; see B4-report.md): 'garden'
  // fires per berry yield so the player hears it. Matches no existing consumer.
  // Batch 4: 'favor-start' / 'favor-done' carry the requester's villagerId.
  // Batch 7: 'visitor-arrive' / 'visitor-leave' mark trader visits; 'trade'
  // carries tradeKind; 'eat' may carry hearty: true.
  type: 'arrived' | 'chop' | 'gather' | 'rest-done' | 'fuel-add' | 'meal-cooked' | 'eat' | 'built' | 'garden' | 'favor-start' | 'favor-done' | 'visitor-arrive' | 'visitor-leave' | 'trade';
  villagerId?: string;
  structureId?: string;
  tradeKind?: 'berries' | 'spice';
  hearty?: boolean;
}

// Batch 4: villager favor chains (DESIGN.md §3.2 “Favor chains”; spec
// docs/superpowers/specs/2026-10-05-villager-favors-design.md Part 1).

export type FavorWant =
  | { kind: 'eat'; who: 'self' | 'any'; count: number } // eat events (requester or anyone)
  | { kind: 'gather'; count: number }
  | { kind: 'chop'; count: number }
  | { kind: 'build'; count: number }
  | { kind: 'fire'; ms: number }; // ms accumulated while fuel ≥ 33

export interface FavorProgress {
  step: number; // 0..CHAIN_LENGTH; completing the last step wraps back to 0 (no retirement)
  active: boolean; // this villager currently has an open favor
  progress: number; // counts consumed / ms accumulated for the current step
}

export interface FavorsState {
  byVillager: FavorProgress[]; // same length and order as `villagers`
  nextOfferMs: number; // countdown until the next offer attempt
}

// Batch 6: pending newcomer walk-ins (DESIGN.md §3.2 “Huts”; spec
// docs/superpowers/specs/2026-10-05-huts-newcomers-design.md Part 1).

export interface Arrival {
  structureId: string; // the hut that was completed
  inMs: number; // countdown to the walk-in (starts at HUT_SETTLE_MS)
  castIndex: number; // 0..3, frozen at schedule time
}

// Batch 7: trader visits (DESIGN.md §3.2 “Trader visits”; spec
// docs/superpowers/specs/2026-10-05-traders-spices-design.md Part 1).

export interface Visitor {
  phase: 'away' | 'visiting'; // one visitor at a time; the sim never tracks position
  inMs: number; // away: until arrival · visiting: until departure
  visitMs: number; // elapsed in the current visit (0 while away)
  tradesLeft: number; // remaining stock this visit (0 while away)
}

// Batch 8: the day/night clock (DESIGN.md §3, §3.2 "Day/night cycle"; spec
// docs/superpowers/specs/2026-10-06-day-night-cycle-design.md Part 1).

export interface Clock {
  dayMs: number; // time since midnight; advances with tick(), wraps at DAY_MS
}

export interface GameState {
  tick: number; // increments once per tick() call
  seed: number;
  resources: { wood: number; berries: number; spices: number };
  villagers: Villager[];
  nodes: ResourceNode[];
  structures: Structure[];
  fire: Fire;
  pot: Pot;
  gardenMs: number; // accumulator for the built garden's +1 berry / 30000 ms
  events: SimEvent[]; // events from the latest tick; seeded from pendingEvents at tick start
  pendingEvents: SimEvent[]; // queued by out-of-tick producers (e.g. buildStructure); flushed into events at tick start
  favors: FavorsState; // batch 4: per-villager favor chains (binding rules in DESIGN.md §3.2)
  arrivals: Arrival[]; // batch 6: pending newcomer walk-ins (binding rules in DESIGN.md §3.2)
  visitor: Visitor; // batch 7: the trader-visit schedule (binding rules in DESIGN.md §3.2)
  clock: Clock; // batch 8: time of day (binding rules in DESIGN.md §3.2)
}
