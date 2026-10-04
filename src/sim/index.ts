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

import type { GameState, TaskId, Villager } from './types';
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
  villager.task = task;
  villager.progressMs = 0;
  if (task === null) {
    villager.state = 'idle';
    villager.targetNodeId = null;
    return;
  }
  const target = nearestNode(state.nodes, villager.pos, TASK_KIND[task]);
  villager.targetNodeId = target ? target.id : null;
  villager.state = 'walking';
}

export function tick(state: GameState, dtMs: number): void {
  state.tick += 1;
  state.events = [];
  if (!(dtMs > 0)) return; // dtMs = 0 (or NaN): counters advance, nothing else
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

function walk(state: GameState, villager: Villager, villagerIndex: number, dtMs: number): void {
  const node = state.nodes.find((n) => n.id === villager.targetNodeId);
  if (!node) {
    // Defensive: a missing target must never wedge the FSM.
    villager.state = 'idle';
    villager.task = null;
    villager.targetNodeId = null;
    return;
  }
  // Resting villagers settle on a ring around the campfire, not inside it.
  const target = villager.task === 'rest' ? restSpot(node.pos, villagerIndex) : node.pos;
  const dx = target.x - villager.pos.x;
  const dz = target.z - villager.pos.z;
  const dist = Math.hypot(dx, dz);
  villager.facing = Math.atan2(dx, dz);
  const move = Math.min((MOVE_SPEED * dtMs) / 1000, dist);
  if (move > 0) {
    villager.pos.x += (dx / dist) * move;
    villager.pos.z += (dz / dist) * move;
  }
  if (dist - move <= ARRIVAL_DISTANCE) {
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
