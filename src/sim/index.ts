export type { GameState, ResourceNode, TaskId, Vec2, Villager } from './types';

import type { GameState, ResourceNode, TaskId, Villager } from './types';

/** Fixed roster (DESIGN.md §3): eight names, hat colors in the same order. */
const ROSTER: ReadonlyArray<{ name: string; hatColor: string }> = [
  { name: 'Maple', hatColor: '#c96f4a' },
  { name: 'Birch', hatColor: '#7fa653' },
  { name: 'Fern', hatColor: '#b0577a' },
  { name: 'Pip', hatColor: '#6f8fb0' },
  { name: 'Hazel', hatColor: '#d9a441' },
  { name: 'Juniper', hatColor: '#8a6fae' },
  { name: 'Moss', hatColor: '#4e8f76' },
  { name: 'Clover', hatColor: '#b0724b' },
];

const TREE_COUNT = 40;
const BUSH_COUNT = 20;
const TAU = Math.PI * 2;
/** Trees and bushes fill an annulus, so scatter radii are sampled over squared radius. */
const INNER_R2 = 6 * 6;
const OUTER_R2 = 28 * 28;
const MIN_GAP_SQ = 1.8 * 1.8;
const MAX_TRIES = 12;

interface Placed {
  x: number;
  z: number;
}

/** Deterministic LCG so world layout never depends on `Math.random`. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function isCrowded(taken: ReadonlyArray<Placed>, p: Placed): boolean {
  return taken.some((o) => (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < MIN_GAP_SQ);
}

function scatter(
  kind: 'tree' | 'bush',
  count: number,
  rnd: () => number,
  taken: Placed[],
): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  for (let i = 0; i < count; i += 1) {
    let spot: Placed = { x: 0, z: 0 };
    for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
      const radius = Math.sqrt(INNER_R2 + rnd() * (OUTER_R2 - INNER_R2));
      const angle = rnd() * TAU;
      const candidate: Placed = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
      spot = candidate;
      if (!isCrowded(taken, candidate)) break;
    }
    taken.push(spot);
    nodes.push({ id: `${kind}-${i + 1}`, kind, pos: { x: spot.x, z: spot.z } });
  }
  return nodes;
}

function makeVillagers(rnd: () => number): Villager[] {
  return ROSTER.map((entry, i) => {
    const angle = (i / ROSTER.length) * TAU + rnd() * 0.4;
    const radius = 2.4 + rnd() * 1.8;
    return {
      id: `v${i + 1}`,
      name: entry.name,
      hatColor: entry.hatColor,
      task: null,
      state: 'idle',
      pos: { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius },
      targetNodeId: null,
    };
  });
}

export function createInitialState(seed = 1): GameState {
  const rnd = lcg(seed);
  const taken: Placed[] = [{ x: 0, z: 0 }];
  return {
    tick: 0,
    seed,
    resources: { wood: 0, berries: 0 },
    villagers: makeVillagers(rnd),
    nodes: [
      { id: 'campfire', kind: 'campfire', pos: { x: 0, z: 0 } },
      ...scatter('tree', TREE_COUNT, rnd, taken),
      ...scatter('bush', BUSH_COUNT, rnd, taken),
    ],
  };
}

/** Sets the assigned task only; walking and working behaviour arrives with the sim core. */
export function assignTask(state: GameState, villagerId: string, task: TaskId | null): void {
  const villager = state.villagers.find((v) => v.id === villagerId);
  if (villager) villager.task = task;
}

export function tick(_state: GameState, _dtMs: number): void {
  // Stub until the simulation core lands.
}