// Public simulation types. Binding shapes from DESIGN.md §3 — other layers import
// these from `src/sim/index.ts` and nothing else from the sim.

export type TaskId = 'chop' | 'berries' | 'rest';
export type VillagerState = 'idle' | 'walking' | 'working' | 'resting';

export interface Vec2 {
  x: number;
  z: number;
}

export interface ResourceNode {
  id: string;
  kind: 'tree' | 'bush' | 'campfire';
  pos: Vec2;
}

export interface Villager {
  id: string;
  name: string;
  hatColor: string;
  task: TaskId | null;
  state: VillagerState;
  pos: Vec2;
  facing: number; // radians, updated while walking (render reads it)
  targetNodeId: string | null;
  progressMs: number; // ms accumulated in the current activity (work yield / rest timer); 0 while idle or walking
}

export interface SimEvent {
  type: 'arrived' | 'chop' | 'gather' | 'rest-done';
  villagerId: string;
}

export interface GameState {
  tick: number; // increments once per tick() call
  seed: number;
  resources: { wood: number; berries: number };
  villagers: Villager[];
  nodes: ResourceNode[];
  events: SimEvent[]; // events from the latest tick; cleared at the start of each tick
}