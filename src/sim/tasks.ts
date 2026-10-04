// Task → node-kind mapping, nearest-node lookup, and the binding simulation
// numbers from DESIGN.md §3.1.

import type { ResourceNode, TaskId, Vec2 } from './types';

/** Movement speed in units per second. */
export const MOVE_SPEED = 2.2;
/** Arrival radius: a villager reaches its node at distance ≤ 0.45. */
export const ARRIVAL_DISTANCE = 0.45;
/** One yield per 1400 ms of continuous work. */
export const WORK_PERIOD_MS = 1400;
/** Rest lasts 4000 ms, then the villager becomes idle. */
export const REST_DURATION_MS = 4000;
/** Resting villagers settle on a ring around the campfire, not inside it. */
export const REST_RING_RADIUS = 1.6;
/** Golden angle in radians — spreads rest spots evenly and deterministically. */
const GOLDEN_ANGLE = 2.399963;

export const TASK_KIND: Record<TaskId, ResourceNode['kind']> = {
  chop: 'tree',
  berries: 'bush',
  rest: 'campfire',
};

/**
 * Nearest node of `kind` to `pos` by squared distance; exact ties break by
 * node id ascending. Returns null when no node of the kind exists.
 */
export function nearestNode(
  nodes: ReadonlyArray<ResourceNode>,
  pos: Vec2,
  kind: ResourceNode['kind'],
): ResourceNode | null {
  let best: ResourceNode | null = null;
  let bestDistSq = Infinity;
  for (const node of nodes) {
    if (node.kind !== kind) continue;
    const distSq = (node.pos.x - pos.x) ** 2 + (node.pos.z - pos.z) ** 2;
    const closer = distSq < bestDistSq;
    const tieById = best !== null && distSq === bestDistSq && node.id < best.id;
    if (closer || tieById) {
      best = node;
      bestDistSq = distSq;
    }
  }
  return best;
}

/**
 * Deterministic rest target for a villager: a point on the rest ring around
 * the campfire, at angle = villagerIndex × golden angle. Keeps villagers from
 * standing inside the fire while spreading them evenly around it.
 */
export function restSpot(campfirePos: Vec2, villagerIndex: number): Vec2 {
  const a = villagerIndex * GOLDEN_ANGLE;
  return {
    x: campfirePos.x + Math.cos(a) * REST_RING_RADIUS,
    z: campfirePos.z + Math.sin(a) * REST_RING_RADIUS,
  };
}
