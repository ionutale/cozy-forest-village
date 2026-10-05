// Pure simulation core (DESIGN.md §3, §3.1, §3.2). No DOM, no three.js, no
// clocks — deterministic functions over GameState only. The only entry other
// layers may import; internal modules are implementation detail.

export type {
  Fire, GameState, Pot, ResourceNode, SimEvent, Structure, StructureKind,
  TaskId, Vec2, Villager, VillagerState,
} from './types';

import type { GameState, StructureKind, TaskId, Vec2, Villager } from './types';
import { mulberry32 } from './rng';
import { makeVillagers } from './villagers';
import { generateWorld } from './world';
import {
  ARRIVAL_DISTANCE, COOK_BERRIES, COOK_CHANNEL_MS, COOK_WOOD, EAT_REST_MS,
  FED_FULL_BELLY_MS, FIRE_DECAY_PER_MS, FIRE_STEADY, FED_MS, FED_WORK_PERIOD_MS,
  GARDEN_PERIOD_MS, LOG_FUEL, MOVE_SPEED, OBSTACLE_ENDGAME_RADIUS,
  STRUCTURE_ARRIVAL_DISTANCE,
  STRUCTURE_COST as STRUCTURE_COST_TABLE,
  STRUCTURE_RING, STRUCTURE_RING_RADIUS, TEND_FETCH_FUEL, TASK_KIND, TASK_STRUCTURE,
  TRUNK_CLEAR_RADIUS, WORK_PERIOD_MS, nearestNode, nearestStructure,
  restDuration, restSpot, structureSpot, workSpot,
} from './tasks';

/** Build costs (DESIGN.md §3.2) — the read-only source of truth other layers import. */
export const STRUCTURE_COST: Readonly<Record<StructureKind, { wood: number; berries: number }>> =
  STRUCTURE_COST_TABLE;

/**
 * Binding numbers from DESIGN.md §3.2 that other layers display rather than re-derive: the
 * garden's berry period, and what one cooked meal costs. Re-exported unchanged from `tasks.ts`
 * (a re-export binds no local name, so it coexists with the internal import above).
 */
export { COOK_BERRIES, COOK_WOOD, GARDEN_PERIOD_MS } from './tasks';

const CAMPFIRE_ID = 'campfire';
const WOODPILE_ID = 'woodpile';
const WOODPILE_ANGLE = Math.PI / 2; // 90°, r = 2.6 (DESIGN.md §3.2)
const WOODPILE_RADIUS = 2.6;

export function createInitialState(seed = 1): GameState {
  const rnd = mulberry32(seed);
  return {
    tick: 0,
    seed,
    resources: { wood: 0, berries: 0 },
    villagers: makeVillagers(rnd),
    nodes: generateWorld(rnd),
    structures: [
      {
        id: WOODPILE_ID,
        kind: 'woodpile',
        pos: {
          x: Math.cos(WOODPILE_ANGLE) * WOODPILE_RADIUS,
          z: Math.sin(WOODPILE_ANGLE) * WOODPILE_RADIUS,
        },
        built: true,
      },
      ...STRUCTURE_RING.map((spot) => ({
        id: spot.id,
        kind: spot.kind,
        pos: {
          x: Math.cos(spot.angle) * STRUCTURE_RING_RADIUS,
          z: Math.sin(spot.angle) * STRUCTURE_RING_RADIUS,
        },
        built: false,
      })),
    ],
    fire: { fuel: 70, max: 100 },
    pot: { meals: 0 },
    gardenMs: 0,
    events: [],
    pendingEvents: [],
  };
}

export function assignTask(state: GameState, villagerId: string, task: TaskId | null): void {
  const villager = state.villagers.find((v) => v.id === villagerId);
  if (!villager) return; // unknown id: no-op
  // A carried log settles first: reassigning a keeper away from tend refunds
  // the log to the stockpile (no stranded logs, no permanent carry pose).
  if (villager.carrying && task !== 'tend') {
    villager.carrying = false;
    state.resources.wood += 1;
  }
  if (task === null) {
    if (villager.task === null && villager.state === 'idle') return; // no-op
    villager.task = null;
    villager.progressMs = 0;
    villager.state = 'idle';
    villager.targetNodeId = null;
    return;
  }
  // Structure-targeting tasks resolve against structures; the rest against nodes.
  const structureKind = TASK_STRUCTURE[task];
  let newTargetId: string | null = null;
  if (structureKind) {
    const s = nearestStructure(state.structures, villager.pos, structureKind);
    if (!s || !s.built) {
      // Structure not built: not actionable. Leave the villager idle.
      villager.task = null;
      villager.state = 'idle';
      villager.targetNodeId = null;
      villager.progressMs = 0;
      return;
    }
    newTargetId = s.id;
  } else {
    const kind = TASK_KIND[task];
    if (kind) {
      const node = nearestNode(state.nodes, villager.pos, kind);
      newTargetId = node ? node.id : null;
    }
  }
  // Same task + same resolved target while active: no-op (keeps progress).
  if (task === villager.task && newTargetId === villager.targetNodeId && villager.state !== 'idle') {
    return;
  }
  villager.task = task;
  villager.progressMs = 0;
  villager.targetNodeId = newTargetId;
  villager.state = 'walking';
}

/**
 * Build a structure (DESIGN.md §3.2): spend its cost, set built, emit `built`.
 * Returns false for unknown / already built / unaffordable — never partially spends.
 */
export function buildStructure(state: GameState, structureId: string): boolean {
  const s = state.structures.find((x) => x.id === structureId);
  if (!s || s.built) return false;
  const cost = STRUCTURE_COST[s.kind];
  if (state.resources.wood < cost.wood || state.resources.berries < cost.berries) return false;
  state.resources.wood -= cost.wood;
  state.resources.berries -= cost.berries;
  s.built = true;
  state.pendingEvents.push({ type: 'built', structureId: s.id });
  return true;
}

export function tick(state: GameState, dtMs: number): void {
  state.tick += 1;
  // Out-of-tick producers (e.g. buildStructure) queue into pendingEvents; the
  // next tick seeds events from the queue and empties it — consumers miss nothing.
  state.events = state.pendingEvents.slice();
  state.pendingEvents.length = 0;
  if (!Number.isFinite(dtMs)) dtMs = 0; // NaN / ±Infinity: counters advance, nothing else
  if (!(dtMs > 0)) return; // dtMs = 0 (or was non-finite): no simulation movement
  // Fire decay (DESIGN.md §3.2): 0.22/s, floor 0 — embers, never a failure state.
  state.fire.fuel = Math.max(0, state.fire.fuel - FIRE_DECAY_PER_MS * dtMs);
  // Garden (DESIGN.md §3.2): while built, +1 berry every 30000 ms.
  const garden = state.structures.find((s) => s.kind === 'garden');
  if (garden && garden.built) {
    state.gardenMs += dtMs;
    while (state.gardenMs >= GARDEN_PERIOD_MS) {
      state.gardenMs -= GARDEN_PERIOD_MS;
      state.resources.berries += 1;
      state.events.push({ type: 'garden' }); // one event per yield — the player hears it
    }
  }
  for (let i = 0; i < state.villagers.length; i += 1) {
    const villager = state.villagers[i]!;
    // fedMs decays with dtMs in every state (DESIGN.md §3.2). Runs before the
    // state switch so an eat this tick sets fedMs after the decay.
    if (villager.fedMs > 0) villager.fedMs = Math.max(0, villager.fedMs - dtMs);
    if (villager.task === 'tend') tendKeeper(state, villager, i);
    switch (villager.state) {
      case 'walking':
        walk(state, villager, i, dtMs);
        break;
      case 'working':
        work(state, villager, dtMs);
        break;
      case 'resting':
        rest(state, villager, dtMs);
        break;
      case 'idle':
        break;
    }
  }
}

/** Resolves a target id against nodes OR structures (DESIGN.md §3.2). */
function resolveTargetPos(state: GameState, targetId: string | null): Vec2 | null {
  if (!targetId) return null;
  const node = state.nodes.find((n) => n.id === targetId);
  if (node) return node.pos;
  const structure = state.structures.find((s) => s.id === targetId);
  if (structure) return structure.pos;
  return null;
}

/**
 * Tend-fire keeper loop (DESIGN.md §3.2), re-evaluated every tick: carrying →
 * walk to the campfire and deposit; else fetch a log while wood ≥ 1 && fuel ≤ 75;
 * else stand watch at the fire (task stays, state `working`).
 */
function tendKeeper(state: GameState, villager: Villager, villagerIndex: number): void {
  let targetId: string;
  if (villager.carrying) {
    targetId = CAMPFIRE_ID;
  } else if (state.resources.wood >= 1 && state.fire.fuel <= TEND_FETCH_FUEL) {
    targetId = WOODPILE_ID;
  } else {
    targetId = CAMPFIRE_ID; // stand watch at the fire
  }
  villager.targetNodeId = targetId;
  const pos = resolveTargetPos(state, targetId);
  if (!pos) {
    // Defensive: a missing post must never wedge the FSM.
    villager.state = 'idle';
    villager.task = null;
    villager.targetNodeId = null;
    return;
  }
  // Legs settle at the same points walk() steers to — the ring spot for fire
  // legs, the structure slot for the woodpile — so measure arrival there, not
  // at the raw target. Otherwise a settled keeper would be forced back to
  // 'walking' every tick and re-emit 'arrived' forever (or stall at the pile
  // without ever taking the log).
  const arrival = targetId === CAMPFIRE_ID ? restSpot(pos, villagerIndex) : structureSpot(pos, villagerIndex);
  const dist = Math.hypot(arrival.x - villager.pos.x, arrival.z - villager.pos.z);
  const tol = targetId === CAMPFIRE_ID ? ARRIVAL_DISTANCE : STRUCTURE_ARRIVAL_DISTANCE;
  if (dist > tol) {
    villager.state = 'walking';
  } else if (villager.state !== 'working') {
    villager.state = 'working';
    villager.progressMs = 0;
  }
}

/** Rest approach arc (DESIGN.md §3.1): swing around the fire, never through it. */
const REST_ARC_RADIUS = 2.2;
const REST_ARC_MAX_DANG = 0.25;
/** Any walking leg whose straight chord passes within 1.1 of the fire bends via the arc. */
const FIRE_AVOID_RADIUS = 1.1;

/** Shortest signed angular difference from `from` to `to`, in (−π, π]. */
function signedAngDiff(from: number, to: number): number {
  const tau = Math.PI * 2;
  let d = (to - from) % tau;
  if (d > Math.PI) d -= tau;
  if (d < -Math.PI) d += tau;
  return d;
}

/** Shortest distance from `point` to the segment `from → to` (0 when degenerate). */
function segmentDistance(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(point.x - from.x, point.z - from.z);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / lenSq));
  return Math.hypot(from.x + dx * t - point.x, from.z + dz * t - point.z);
}

/**
 * Obstacle-aware detour: if the straight chord from the villager to its
 * steering target passes within trunk clearance of a non-destination trunk,
 * return a deterministic tangent-offset waypoint around the nearest such trunk;
 * otherwise null (steer direct). Recomputed every tick — no extra state.
 * The destination node's own trunk is never an obstacle (walkers must reach
 * its slots), and inside the endgame radius steering stays direct so slot
 * landings stay exact.
 */
function avoidTrunks(
  state: GameState,
  villager: Villager,
  target: Vec2,
  arrival: Vec2,
): Vec2 | null {
  if (Math.hypot(arrival.x - villager.pos.x, arrival.z - villager.pos.z) <= OBSTACLE_ENDGAME_RADIUS) {
    return null; // endgame: direct (neighbour trunks sit ≥ 1.75 from work slots)
  }
  let bx = 0;
  let bz = 0;
  let bestDist = Infinity;
  for (const node of state.nodes) {
    if (node.kind !== 'tree' || node.id === villager.targetNodeId) continue;
    if (segmentDistance(node.pos, villager.pos, target) >= TRUNK_CLEAR_RADIUS) continue;
    const d = Math.hypot(node.pos.x - villager.pos.x, node.pos.z - villager.pos.z);
    if (d < bestDist) {
      bestDist = d;
      bx = node.pos.x;
      bz = node.pos.z;
    }
  }
  if (bestDist === Infinity) return null;
  // Tangent pursuit: slide around the clearance circle, deterministically taking
  // the tangent point nearer the steering target (exact ties prefer +).
  const px = villager.pos.x - bx;
  const pz = villager.pos.z - bz;
  const d = Math.max(bestDist, 1e-6);
  if (d <= TRUNK_CLEAR_RADIUS) {
    // Inside clearance (unreachable in practice): push radially out.
    const r = TRUNK_CLEAR_RADIUS + 0.3;
    return { x: bx + (px / d) * r, z: bz + (pz / d) * r };
  }
  const base = Math.atan2(pz, px) + Math.PI; // villager → trunk direction
  const beta = Math.asin(Math.min(1, TRUNK_CLEAR_RADIUS / d));
  const len = Math.sqrt(d * d - TRUNK_CLEAR_RADIUS * TRUNK_CLEAR_RADIUS);
  const q1x = villager.pos.x + len * Math.cos(base + beta);
  const q1z = villager.pos.z + len * Math.sin(base + beta);
  const q2x = villager.pos.x + len * Math.cos(base - beta);
  const q2z = villager.pos.z + len * Math.sin(base - beta);
  const d1 = (q1x - target.x) ** 2 + (q1z - target.z) ** 2;
  const d2 = (q2x - target.x) ** 2 + (q2z - target.z) ** 2;
  return d1 <= d2 ? { x: q1x, z: q1z } : { x: q2x, z: q2z };
}

function walk(state: GameState, villager: Villager, villagerIndex: number, dtMs: number): void {
  const center = resolveTargetPos(state, villager.targetNodeId);
  if (!center) {
    // Defensive: a missing target must never wedge the FSM.
    villager.state = 'idle';
    villager.task = null;
    villager.targetNodeId = null;
    return;
  }
  // `arrival` completes the walk; `target` is this tick's steering point (they
  // differ only on the rest approach arc). `arrivedTol` is the arrival radius:
  // 0.45 everywhere except structure slots (0.02 — settlers land on the slot).
  let arrival: Vec2;
  let target: Vec2;
  let arrivedTol = ARRIVAL_DISTANCE;
  if (villager.targetNodeId === CAMPFIRE_ID) {
    // Any destination at the campfire — rest AND the tend keeper's deposit and
    // stand-watch legs — settles on the villager's ring spot around the fire:
    // while the angular gap to the spot exceeds 0.25 rad, swing via the
    // bisector point on the r = 2.2 ring; otherwise head straight to the spot.
    // No distance gate — the arc stays engaged at any radius, so the chord can
    // never cut close to the fire (this also saves keeper woodpile→spot legs
    // whose straight chord would pass through the centre).
    arrival = restSpot(center, villagerIndex);
    const angCur = Math.atan2(villager.pos.z - center.z, villager.pos.x - center.x);
    const angSpot = Math.atan2(arrival.z - center.z, arrival.x - center.x);
    const dAng = signedAngDiff(angCur, angSpot);
    if (Math.abs(dAng) > REST_ARC_MAX_DANG) {
      const a = angCur + dAng / 2;
      target = {
        x: center.x + Math.cos(a) * REST_ARC_RADIUS,
        z: center.z + Math.sin(a) * REST_ARC_RADIUS,
      };
    } else {
      target = arrival;
    }
  } else if (villager.task === 'chop' || villager.task === 'berries') {
    // Work tasks aim at a per-villager slot around the node, not the node itself.
    arrival = workSpot(center, villagerIndex);
    target = arrival;
  } else {
    // Structure targets (pot, woodpile): the per-villager golden-angle slot on
    // the wider structure ring (r = 0.9), with a tight 0.02 arrival tolerance
    // so cooks and keepers settle essentially on their slots, side by side.
    const structure = state.structures.find((s) => s.id === villager.targetNodeId);
    arrival = structure ? structureSpot(center, villagerIndex) : center;
    target = arrival;
    if (structure) arrivedTol = STRUCTURE_ARRIVAL_DISTANCE;
  }
  // Universal flame-avoiding arc (DESIGN.md §3.2): any non-campfire leg whose
  // straight chord passes within 1.1 of the campfire bends via the bisector
  // point on the r = 2.2 ring first. Recomputed every tick, no extra state.
  if (villager.targetNodeId !== CAMPFIRE_ID) {
    const fire = resolveTargetPos(state, CAMPFIRE_ID);
    if (fire && segmentDistance(fire, villager.pos, target) < FIRE_AVOID_RADIUS) {
      const angCur = Math.atan2(villager.pos.z - fire.z, villager.pos.x - fire.x);
      const angGoal = Math.atan2(target.z - fire.z, target.x - fire.x);
      const a = angCur + signedAngDiff(angCur, angGoal) / 2;
      target = { x: fire.x + Math.cos(a) * REST_ARC_RADIUS, z: fire.z + Math.sin(a) * REST_ARC_RADIUS };
    }
  }
  // Obstacle-aware walking (DESIGN.md §3.2 WD3): bend around non-destination
  // trunks via a tangent waypoint. Village legs never trigger it (their chords
  // stay within r ≈ 4.5 of the fire while trunks grow at r ≥ 7.5), so rest arcs
  // and the fire ring are untouched; forest→fire legs detour only out where
  // trunks actually stand (r ≥ 7.5), far from the flames.
  {
    const detour = avoidTrunks(state, villager, target, arrival);
    if (detour) target = detour;
  }
  const dx = target.x - villager.pos.x;
  const dz = target.z - villager.pos.z;
  const dist = Math.hypot(dx, dz);
  villager.facing = Math.atan2(dx, dz);
  const move = Math.min((MOVE_SPEED * dtMs) / 1000, dist);
  if (move > 0) {
    villager.pos.x += (dx / dist) * move;
    villager.pos.z += (dz / dist) * move;
  }
  if (Math.hypot(arrival.x - villager.pos.x, arrival.z - villager.pos.z) <= arrivedTol) {
    if (villager.task === 'rest') {
      // Eat on arrival when the fire is warm, meals are available, and the
      // belly isn't already full (DESIGN.md §3.2): consume 1 meal, rest
      // 5500 ms, become well-fed. Otherwise rest by fire state, untouched.
      if (state.fire.fuel >= FIRE_STEADY && state.pot.meals > 0 && villager.fedMs < FED_FULL_BELLY_MS) {
        state.pot.meals -= 1;
        villager.fedMs = FED_MS;
        villager.restMs = EAT_REST_MS;
        state.events.push({ type: 'eat', villagerId: villager.id });
      } else {
        villager.restMs = restDuration(state.fire);
      }
      villager.state = 'resting';
    } else if (villager.task === 'tend') {
      // Keeper arrival: deposit a carried log, or take one from the woodpile.
      if (villager.targetNodeId === CAMPFIRE_ID && villager.carrying) {
        state.fire.fuel = Math.min(state.fire.max, state.fire.fuel + LOG_FUEL);
        villager.carrying = false;
        state.events.push({ type: 'fuel-add', villagerId: villager.id });
      } else if (villager.targetNodeId === WOODPILE_ID && !villager.carrying) {
        state.resources.wood -= 1;
        villager.carrying = true;
      }
      villager.state = 'working';
    } else {
      villager.state = 'working';
    }
    villager.progressMs = 0;
    state.events.push({ type: 'arrived', villagerId: villager.id });
  }
}

function work(state: GameState, villager: Villager, dtMs: number): void {
  if (villager.task === 'cook') {
    // Cook (DESIGN.md §3.2): channel 3000 ms per meal; costs 3 berries + 1 wood.
    // Affordability is re-checked before every deduction, so a large dt can
    // never drive the ledger negative; when dry → idle, task cleared.
    villager.progressMs += dtMs;
    while (villager.progressMs >= COOK_CHANNEL_MS) {
      if (state.resources.berries < COOK_BERRIES || state.resources.wood < COOK_WOOD) {
        villager.state = 'idle';
        villager.task = null;
        villager.targetNodeId = null;
        villager.progressMs = 0;
        return;
      }
      villager.progressMs -= COOK_CHANNEL_MS;
      state.resources.berries -= COOK_BERRIES;
      state.resources.wood -= COOK_WOOD;
      state.pot.meals += 1;
      state.events.push({ type: 'meal-cooked', villagerId: villager.id });
    }
    return;
  }
  // chop / berries: well-fed villagers work 15 % faster (DESIGN.md §3.2).
  const period = villager.fedMs > 0 ? FED_WORK_PERIOD_MS : WORK_PERIOD_MS;
  villager.progressMs += dtMs;
  while (villager.progressMs >= period) {
    villager.progressMs -= period;
    if (villager.task === 'chop') {
      state.resources.wood += 1;
      state.events.push({ type: 'chop', villagerId: villager.id });
    } else if (villager.task === 'berries') {
      state.resources.berries += 1;
      state.events.push({ type: 'gather', villagerId: villager.id });
    }
  }
}

function rest(state: GameState, villager: Villager, dtMs: number): void {
  villager.progressMs += dtMs;
  // Rest duration is committed at arrival (DESIGN.md §3.2): 5500 ms when eating,
  // else restDuration(fire) at the moment of arrival.
  if (villager.progressMs >= villager.restMs) {
    villager.state = 'idle';
    villager.task = null;
    villager.targetNodeId = null;
    villager.progressMs = 0;
    villager.restMs = 0;
    state.events.push({ type: 'rest-done', villagerId: villager.id });
  }
}
