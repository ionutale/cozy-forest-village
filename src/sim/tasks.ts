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
/** Structure targets (pot, woodpile) use a wider per-villager slot (DESIGN.md §3.2). */
export const STRUCTURE_SLOT_RADIUS = 0.9;
/** Arrival at a structure slot needs ≤ 0.02 (DESIGN.md §3.2): the clamped final
 * step lands essentially exactly on the slot, so settled cooks/keepers sit at
 * ≈ full slot spacing instead of arrival-slop luck. */
export const STRUCTURE_ARRIVAL_DISTANCE = 0.02;
/** Max visual trunk footprint radius — render trunkGeo bottom 0.36 × per-trunk
 * scale ≤ 1.15 (≈ 0.414), rounded up. Sim nodes carry no radius (source:
 * `src/render/environment.ts` trunkGeo + scale range). */
export const TRUNK_RADIUS = 0.42;
/** Trunk-avoidance steering clearance around non-destination trunk centres. */
export const TRUNK_CLEAR_RADIUS = TRUNK_RADIUS + 0.2; // 0.62
/** Within this distance of the arrival point, steer direct (exact slot landings). */
export const OBSTACLE_ENDGAME_RADIUS = 1.0;
/** Golden angle in radians — spreads rest spots (and batch-8 warm seats) evenly and deterministically. */
export const GOLDEN_ANGLE = 2.399963;

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
 * a dying fire → a long one. Evaluated once, at rest start, and committed to
 * the villager's restMs.
 */
export function restDuration(fire: Fire): number {
  if (fire.fuel >= FIRE_STEADY) return 4000;
  if (fire.fuel > 0) return 5500;
  return 7000;
}

// ── Batch 2: food & growth (DESIGN.md §3.2) ─────────────────────────────

/** Cook channel: 3000 ms per meal. */
export const COOK_CHANNEL_MS = 3000;
/** Each meal costs 3 berries + 1 wood. */
export const COOK_BERRIES = 3;
export const COOK_WOOD = 1;
/** Eating sets fedMs to 60000 (well-fed for 60 s). */
export const FED_MS = 60000;
/** A belly at fedMs ≥ 30000 eats no meal on rest arrival (DESIGN.md §3.2). */
export const FED_FULL_BELLY_MS = 30000;
/** Well-fed work period: 1190 ms per yield (15 % faster). */
export const FED_WORK_PERIOD_MS = 1190;
/** An eating villager rests 5500 ms. */
export const EAT_REST_MS = 5500;
/** Garden yields +1 berry every 30000 ms while built. */
export const GARDEN_PERIOD_MS = 30000;

/** Build cost per structure kind (DESIGN.md §3.2). */
export const STRUCTURE_COST: Record<StructureKind, { wood: number; berries: number }> = {
  woodpile: { wood: 0, berries: 0 }, // pre-built; never purchased
  pot: { wood: 20, berries: 0 },
  bench: { wood: 15, berries: 0 },
  garden: { wood: 25, berries: 0 },
  lantern: { wood: 10, berries: 0 },
  feeder: { wood: 10, berries: 5 },
  hut: { wood: 30, berries: 10 },
};

/** The six build spots on the village ring (r = 5.2, angles 30°–330°). */
export const STRUCTURE_RING_RADIUS = 5.2;
export const STRUCTURE_RING: ReadonlyArray<{ id: string; kind: StructureKind; angle: number }> = [
  { id: 'pot', kind: 'pot', angle: Math.PI / 6 }, // 30°
  { id: 'bench', kind: 'bench', angle: Math.PI / 2 }, // 90°
  { id: 'garden', kind: 'garden', angle: (5 * Math.PI) / 6 }, // 150°
  { id: 'lantern-a', kind: 'lantern', angle: (7 * Math.PI) / 6 }, // 210°
  { id: 'lantern-b', kind: 'lantern', angle: (3 * Math.PI) / 2 }, // 270°
  { id: 'feeder', kind: 'feeder', angle: (11 * Math.PI) / 6 }, // 330°
];

// ── Batch 6: huts → newcomers (DESIGN.md §3.2) ────────────────────────────

/** Hut plots sit on a second ring (r = 7.6, angles 45°/135°/225°/315°). */
export const HUT_RING_RADIUS = 7.6;
/** The four hut plots, in plot order (completion order picks the cast row). */
export const HUT_PLOTS: readonly { id: string; pos: Vec2 }[] = [
  { id: 'hut-1', pos: { x: Math.cos(Math.PI / 4) * HUT_RING_RADIUS, z: Math.sin(Math.PI / 4) * HUT_RING_RADIUS } }, // 45°
  { id: 'hut-2', pos: { x: Math.cos((3 * Math.PI) / 4) * HUT_RING_RADIUS, z: Math.sin((3 * Math.PI) / 4) * HUT_RING_RADIUS } }, // 135°
  { id: 'hut-3', pos: { x: Math.cos((5 * Math.PI) / 4) * HUT_RING_RADIUS, z: Math.sin((5 * Math.PI) / 4) * HUT_RING_RADIUS } }, // 225°
  { id: 'hut-4', pos: { x: Math.cos((7 * Math.PI) / 4) * HUT_RING_RADIUS, z: Math.sin((7 * Math.PI) / 4) * HUT_RING_RADIUS } }, // 315°
];
/** Delay from hut completion to the newcomer's walk-in. */
export const HUT_SETTLE_MS = 90_000;
/** Hard roster cap: the starting 8 plus one newcomer per hut. */
export const VILLAGE_CAP = 12;
/** South forest edge — every newcomer enters the world here. */
export const EDGE_SPAWN: Vec2 = { x: 0, z: -12 };
/** The fixed newcomer cast, in hut-completion order. */
export const NEWCOMER_CAST: readonly { name: string; hatColor: string }[] = [
  { name: 'Lily', hatColor: '#e3b7c4' },
  { name: 'Rowan', hatColor: '#b03a3a' },
  { name: 'Sage', hatColor: '#a8bd86' },
  { name: 'Wren', hatColor: '#7d6a52' },
];

// ── Batch 7: trader visits (DESIGN.md §3.2) ───────────────────────────────

/** First trader arrival, ~4 min into play. */
export const FIRST_VISIT_MS = 240_000;
/** How long each visit lasts. */
export const VISIT_STAY_MS = 120_000;
/** Away time between visits. */
export const NEXT_VISIT_GAP_MS = 360_000;
/** Trader walk in/out window (shared with the render layer). */
export const TRADER_WALK_MS = 6_000;
/** Trade stock per visit. */
export const TRADES_PER_VISIT = 3;
/** Fed window after a hearty (spiced) meal; normal meals give 60 000. */
export const HEARTY_FED_MS = 90_000;
/** Trade rates: 5 wood → 4 berries (`'berries'`), 6 berries → 1 spice (`'spice'`). */
export const TRADE_WOOD_COST = 5;
export const TRADE_WOOD_YIELD = 4;
export const TRADE_BERRY_COST = 6;

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

/**
 * Deterministic arrival slot for structure targets (DESIGN.md §3.2): same
 * golden-angle idiom as workSpot, on a wider ring (r = 0.9) so eight cooks or
 * keepers sharing one structure still clear the 0.45 separation bar
 * (8-point golden-angle floor ≈ 0.503, tightened to ≈ 0.46 by the 0.02 arrival
 * tolerance).
 */
export function structureSpot(structurePos: Vec2, villagerIndex: number): Vec2 {
  const a = villagerIndex * GOLDEN_ANGLE;
  return {
    x: structurePos.x + Math.cos(a) * STRUCTURE_SLOT_RADIUS,
    z: structurePos.z + Math.sin(a) * STRUCTURE_SLOT_RADIUS,
  };
}
