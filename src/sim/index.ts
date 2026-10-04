// Pure simulation core (DESIGN.md §3, §3.1, §3.2). No DOM, no three.js, no
// clocks — deterministic functions over GameState only. The only entry other
// layers may import; internal modules are implementation detail.

export type {
  Fire, GameState, Pot, ResourceNode, SimEvent, Structure, StructureKind,
  TaskId, Vec2, Villager, VillagerState,
} from './types';

import type { GameState, TaskId, Vec2, Villager } from './types';
import { mulberry32 } from './rng';
import { makeVillagers } from './villagers';
import { generateWorld } from './world';
import {
  ARRIVAL_DISTANCE, COOK_BERRIES, COOK_CHANNEL_MS, COOK_WOOD, EAT_REST_MS,
  FIRE_DECAY_PER_MS, FIRE_STEADY, FED_MS, FED_WORK_PERIOD_MS, GARDEN_PERIOD_MS,
  LOG_FUEL, MOVE_SPEED, STRUCTURE_COST, STRUCTURE_RING, STRUCTURE_RING_RADIUS,
  TEND_FETCH_FUEL, TASK_KIND, TASK_STRUCTURE, WORK_PERIOD_MS, nearestNode,
  nearestStructure, restDuration, restSpot, workSpot,
} from './tasks';

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
  };
}

export function assignTask(state: GameState, villagerId: string, task: TaskId | null): void {
  const villager = state.villagers.find((v) => v.id === villagerId);
  if (!villager) return; // unknown id: no-op
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
  state.events.push({ type: 'built', structureId: s.id });
  return true;
}

export function tick(state: GameState, dtMs: number): void {
  state.tick += 1;
  state.events = [];
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
    }
  }
  for (let i = 0; i < state.villagers.length; i += 1) {
    const villager = state.villagers[i]!;
    // fedMs decays with dtMs in every state (DESIGN.md §3.2). Runs before the
    // state switch so an eat this tick sets fedMs after the decay.
    if (villager.fedMs > 0) villager.fedMs = Math.max(0, villager.fedMs - dtMs);
    if (villager.task === 'tend') tendKeeper(state, villager);
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
function tendKeeper(state: GameState, villager: Villager): void {
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
  const dist = Math.hypot(pos.x - villager.pos.x, pos.z - villager.pos.z);
  if (dist > ARRIVAL_DISTANCE) {
    villager.state = 'walking';
  } else if (villager.state !== 'working') {
    villager.state = 'working';
    villager.progressMs = 0;
  }
}

/** Rest approach arc (DESIGN.md §3.1): swing around the fire, never through it. */
const REST_ARC_RADIUS = 2.2;
const REST_ARC_MAX_DANG = 0.25;

/** Shortest signed angular difference from `from` to `to`, in (−π, π]. */
function signedAngDiff(from: number, to: number): number {
  const tau = Math.PI * 2;
  let d = (to - from) % tau;
  if (d > Math.PI) d -= tau;
  if (d < -Math.PI) d += tau;
  return d;
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
  // differ only on the rest approach arc).
  let arrival: Vec2;
  let target: Vec2;
  if (villager.task === 'rest') {
    // Settle on a ring around the campfire: while the angular gap to the spot
    // exceeds 0.25 rad, swing via the bisector point on the r = 2.2 ring;
    // otherwise head straight to the spot. No distance gate — the arc stays
    // engaged at any radius, so the chord can never cut close to the fire.
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
    // tend / cook (and any future task): straight to the target position.
    arrival = center;
    target = arrival;
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
  if (Math.hypot(arrival.x - villager.pos.x, arrival.z - villager.pos.z) <= ARRIVAL_DISTANCE) {
    if (villager.task === 'rest') {
      // Eat on arrival if the fire is warm and meals are available (DESIGN.md §3.2):
      // consume 1 meal, rest 5500 ms, become well-fed. Otherwise rest by fire state.
      if (state.fire.fuel >= FIRE_STEADY && state.pot.meals > 0) {
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
    // Loop while ingredients last; when they run out → idle, task cleared.
    if (state.resources.berries < COOK_BERRIES || state.resources.wood < COOK_WOOD) {
      villager.state = 'idle';
      villager.task = null;
      villager.targetNodeId = null;
      villager.progressMs = 0;
      return;
    }
    villager.progressMs += dtMs;
    while (villager.progressMs >= COOK_CHANNEL_MS) {
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
