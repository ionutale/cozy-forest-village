// Public simulation types. Binding shapes from DESIGN.md §3 — other layers import
// these from `src/sim/index.ts` and nothing else from the sim.

export type TaskId = 'chop' | 'berries' | 'rest';

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
  state: 'idle' | 'walking' | 'working' | 'resting';
  pos: Vec2;
  targetNodeId: string | null;
}

export interface GameState {
  tick: number;
  seed: number;
  resources: { wood: number; berries: number };
  villagers: Villager[];
  nodes: ResourceNode[];
}