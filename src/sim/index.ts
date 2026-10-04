// Pure simulation core (DESIGN.md §3, §3.1). No DOM, no three.js, no clocks —
// deterministic functions over GameState only. This module is the only entry
// other layers may import; internal modules are implementation detail.

export type {
  GameState,
  ResourceNode,
  SimEvent,
  TaskId,
  Vec2,
  Villager,
  VillagerState,
} from './types';

import type { GameState, TaskId, Vec2, Villager } from './types';
import { mulberry32 } from './rng';
import { makeVillagers } from './villagers';
import { generateWorld } from './world';
import {
  ARRIVAL_DISTANCE,
  MOVE_SPEED,
  REST_DURATION_MS,
  TASK_KIND,
  WORK_PERIOD_MS,
  nearestNode,
  restSpot,
  workSpot,
} from './tasks';

export function createInitialState(seed = 1): GameState {
  const rnd = mulberry32(seed);
  return {
    tick: 0,
    seed,
    resources: { wood: 0, berries: 0 },
    villagers: makeVillagers(rnd),
    nodes: generateWorld(rnd),
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
  const target = nearestNode(state.nodes, villager.pos, TASK_KIND[task]);
  const newTargetId = target ? target.id : null;
  // Same task + same resolved target while active: no-op (keeps progress).
  if (task === villager.task && newTargetId === villager.targetNodeId && villager.state !== 'idle') {
    return;
  }
  villager.task = task;
  villager.progressMs = 0;
  villager.targetNodeId = newTargetId;
  villager.state = 'walking';
}

export function tick(state: GameState, dtMs: number): void {
  state.tick += 1;
  state.events = [];
  if (!Number.isFinite(dtMs)) dtMs = 0; // NaN / ±Infinity: counters advance, nothing else
  if (!(dtMs > 0)) return; // dtMs = 0 (or was non-finite): no simulation movement
  for (let i = 0; i < state.villagers.length; i += 1) {
    const villager = state.villagers[i]!;
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
  const node = state.nodes.find((n) => n.id === villager.targetNodeId);
  if (!node) {
    // Defensive: a missing target must never wedge the FSM.
    villager.state = 'idle';
    villager.task = null;
    villager.targetNodeId = null;
    return;
  }
  // `arrival` is the point that completes the walk; `target` is this tick's
  // steering point (they differ only on the rest approach arc).
  let arrival: Vec2;
  let target: Vec2;
  if (villager.task === 'rest') {
    // Resting villagers settle on a ring around the campfire, not inside it:
    // whenever the angular gap to the spot exceeds 0.25 rad, swing around the
    // flames via the bisector point on the r = 2.2 ring; otherwise head straight
    // to the spot. No distance gate — the arc stays engaged at any radius, so
    // the remaining chord can never cut close to the fire centre.
    arrival = restSpot(node.pos, villagerIndex);
    const angCur = Math.atan2(villager.pos.z - node.pos.z, villager.pos.x - node.pos.x);
    const angSpot = Math.atan2(arrival.z - node.pos.z, arrival.x - node.pos.x);
    const dAng = signedAngDiff(angCur, angSpot);
    if (Math.abs(dAng) > REST_ARC_MAX_DANG) {
      const a = angCur + dAng / 2;
      target = {
        x: node.pos.x + Math.cos(a) * REST_ARC_RADIUS,
        z: node.pos.z + Math.sin(a) * REST_ARC_RADIUS,
      };
    } else {
      target = arrival;
    }
  } else if (villager.task === 'chop' || villager.task === 'berries') {
    // Work tasks aim at a per-villager slot around the node, not the node itself.
    arrival = workSpot(node.pos, villagerIndex);
    target = arrival;
  } else {
    arrival = node.pos;
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
    villager.state = villager.task === 'rest' ? 'resting' : 'working';
    villager.progressMs = 0;
    state.events.push({ type: 'arrived', villagerId: villager.id });
  }
}

function work(state: GameState, villager: Villager, dtMs: number): void {
  villager.progressMs += dtMs;
  while (villager.progressMs >= WORK_PERIOD_MS) {
    villager.progressMs -= WORK_PERIOD_MS;
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
  if (villager.progressMs >= REST_DURATION_MS) {
    villager.state = 'idle';
    villager.task = null;
    villager.targetNodeId = null;
    villager.progressMs = 0;
    state.events.push({ type: 'rest-done', villagerId: villager.id });
  }
}
