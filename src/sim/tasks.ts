// Task → target mapping, nearest-target lookup, and the binding simulation
// numbers from DESIGN.md §3.1 and §3.2 (batch 2: fire, warmth).

import type { Fire, ResourceNode, Structure, StructureKind, TaskId, Vec2 } from './types';

/** Movement speed in units per second. */
export const MOVE_SPEED = 2.2;
/** Arrival radius: a villager reaches its target at distance ≤ 0.45. */
export const ARRIVAL_DISTANCE = 0.45;
/** One yield per 1400 ms of continuous work. */
export const WORK_PERIOD_MS = 1400;
/** Resting villagers settle on a ring around the campfire, not inside it. */
export const REST_RING_RADIUS = 1.6;
/** Work tasks aim at a per-villager slot around the target node, not the node itself. */
export const WORK_SLOT_RADIUS = 0.75;
/** Golden angle in radians — spreads rest spots evenly and deterministically. */
const GOLDEN_ANGLE = 2.399963;

// ── Batch 2: fire & warmth (DESIGN.md §3.2) ────────────────────────────────

/** Fire decays 0.22 fuel per second (floor 0 — embers, never a failure state). */
export const FIRE_DECAY_PER_MS = 0.22 / 1000;
/** One log = +25 fuel (capped at fire.max). */
export const LOG_FUEL = 25;
/** The keeper fetches a log only while fuel ≤ 75; above that it stands watch. */
export const TEND_FETCH_FUEL = 75;
/** Fire state thresholds: roaring ≥66 · steady ≥33 · dim >0 · embers =0. */
export const FIRE_ROARING = 66;
export const FIRE_STEADY = 33;

/**
 * Rest duration by fire state (DESIGN.md §3.2): a warm fire → a short rest,
 * a dying fire → a long one. Evaluated against the live fire each tick.
 */
export function restDuration(fire: Fire): number {
  if (fire.fuel >= FIRE_STEADY) return 4000;
  if (fire.fuel > 0) return 5500;
  return 7000;
}

/** Node-targeting tasks (DESIGN.md §3.1). */
export const TASK_KIND: Partial<Record<TaskId, ResourceNode['kind']>> = {
  chop: 'tree',
  berries: 'bush',
  rest: 'campfire',
};

/** Structure-targeting tasks (DESIGN.md §3.2): resolved via `targetNodeId`. */
export const TASK_STRUCTURE: Partial<Record<TaskId, StructureKind>> = {
  tend: 'woodpile',
  cook: 'pot',
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
 * Nearest structure of `kind` to `pos` by squared distance; exact ties break
 * by structure id ascending. Returns null when no structure of the kind exists.
 */
export function nearestStructure(
  structures: ReadonlyArray<Structure>,
  pos: Vec2,
  kind: StructureKind,
): Structure | null {
  let best: Structure | null = null;
  let bestDistSq = Infinity;
  for (const s of structures) {
    if (s.kind !== kind) continue;
    const distSq = (s.pos.x - pos.x) ** 2 + (s.pos.z - pos.z) ** 2;
    const closer = distSq < bestDistSq;
    const tieById = best !== null && distSq === bestDistSq && s.id < best.id;
    if (closer || tieById) {
      best = s;
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

/**
 * Deterministic work target for a villager: a point on a small ring around
 * the target node, at angle = villagerIndex × golden angle. Keeps villagers from
 * stacking inside the same trunk/bush while spreading them deterministically.
 */
export function workSpot(nodePos: Vec2, villagerIndex: number): Vec2 {
  const a = villagerIndex * GOLDEN_ANGLE;
  return {
    x: nodePos.x + Math.cos(a) * WORK_SLOT_RADIUS,
    z: nodePos.z + Math.sin(a) * WORK_SLOT_RADIUS,
  };
}
