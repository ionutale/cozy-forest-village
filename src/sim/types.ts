// Public simulation types. Binding shapes from DESIGN.md §3 (contract) and §3.2
// (batch-2 surface) — other layers import these from `src/sim/index.ts` and
// nothing else from the sim.

export type TaskId = 'chop' | 'berries' | 'rest' | 'tend' | 'cook';
export type VillagerState = 'idle' | 'walking' | 'working' | 'resting';

export type StructureKind = 'woodpile' | 'pot' | 'garden' | 'bench' | 'lantern' | 'feeder';

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
  type: 'arrived' | 'chop' | 'gather' | 'rest-done' | 'fuel-add' | 'meal-cooked' | 'eat' | 'built' | 'garden';
  villagerId?: string;
  structureId?: string;
}

export interface GameState {
  tick: number; // increments once per tick() call
  seed: number;
  resources: { wood: number; berries: number };
  villagers: Villager[];
  nodes: ResourceNode[];
  structures: Structure[];
  fire: Fire;
  pot: Pot;
  gardenMs: number; // accumulator for the built garden's +1 berry / 30000 ms
  events: SimEvent[]; // events from the latest tick; seeded from pendingEvents at tick start
  pendingEvents: SimEvent[]; // queued by out-of-tick producers (e.g. buildStructure); flushed into events at tick start
}
