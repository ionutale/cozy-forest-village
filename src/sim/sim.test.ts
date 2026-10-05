import { describe, expect, it } from 'vitest';
import type { GameState, ResourceNode } from './index';
import { assignTask, createInitialState, tick } from './index';
import { workSpot } from './tasks';

/** Ticks the sim forward in fixed steps. */
function run(state: GameState, totalMs: number, stepMs: number): void {
  const steps = Math.round(totalMs / stepMs);
  for (let i = 0; i < steps; i += 1) tick(state, stepMs);
}

/** Ticks until `predicate` holds or the budget is exhausted. */
function runUntil(state: GameState, predicate: () => boolean, maxMs: number, stepMs: number): void {
  const maxSteps = Math.round(maxMs / stepMs);
  for (let i = 0; i < maxSteps; i += 1) {
    tick(state, stepMs);
    if (predicate()) return;
  }
}

/** Recomputes the nearest node id of a kind from a position (test oracle). */
function nearestId(state: GameState, x: number, z: number, kind: ResourceNode['kind']): string | null {
  let bestId: string | null = null;
  let bestDistSq = Infinity;
  for (const n of state.nodes) {
    if (n.kind !== kind) continue;
    const distSq = (n.pos.x - x) ** 2 + (n.pos.z - z) ** 2;
    if (distSq < bestDistSq) {
      bestId = n.id;
      bestDistSq = distSq;
    }
  }
  return bestId;
}

describe('createInitialState', () => {
  it('is deterministic and matches the fixed shape', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).toEqual(b);

    expect(a.tick).toBe(0);
    expect(a.seed).toBe(1);
    expect(a.resources).toEqual({ wood: 0, berries: 0, spices: 0 });
    expect(a.events).toEqual([]);
    expect(a.villagers).toHaveLength(8);
    expect(a.villagers.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8']);
    expect(a.villagers.map((v) => v.name)).toEqual([
      'Maple',
      'Birch',
      'Fern',
      'Pip',
      'Hazel',
      'Juniper',
      'Moss',
      'Clover',
    ]);
    expect(a.villagers.map((v) => v.hatColor)).toEqual([
      '#c96f4a', '#7fa653', '#b0577a', '#6f8fb0',
      '#d9a441', '#8a6fae', '#4e8f76', '#b0724b',
    ]);
    expect(
      a.villagers.every(
        (v) =>
          v.task === null &&
          v.state === 'idle' &&
          v.targetNodeId === null &&
          v.facing === 0 &&
          v.progressMs === 0,
      ),
    ).toBe(true);
    expect(a.nodes).toHaveLength(61);
    expect(a.nodes.filter((n) => n.kind === 'tree')).toHaveLength(40);
    expect(a.nodes.filter((n) => n.kind === 'bush')).toHaveLength(20);
    expect(a.nodes.filter((n) => n.kind === 'campfire')).toHaveLength(1);
  });

  it('gives different seeds different worlds', () => {
    expect(createInitialState(1).nodes).not.toEqual(createInitialState(2).nodes);
  });
});

describe('assignTask', () => {
  it('targets the nearest node of the mapped kind and walks', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'chop');
    expect(v.task).toBe('chop');
    expect(v.state).toBe('walking');
    expect(v.targetNodeId).toBe(nearestId(state, v.pos.x, v.pos.z, 'tree'));

    assignTask(state, v.id, 'berries');
    expect(v.state).toBe('walking');
    expect(v.targetNodeId).toBe(nearestId(state, v.pos.x, v.pos.z, 'bush'));
  });

  it('null stops (idle, target cleared); unknown id is a no-op', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'chop');
    assignTask(state, v.id, null);
    expect(v.task).toBeNull();
    expect(v.state).toBe('idle');
    expect(v.targetNodeId).toBeNull();

    assignTask(state, 'ghost', 'rest');
    expect(state.villagers.every((x) => x.task === null)).toBe(true);
  });
});

describe('walk → work', () => {
  it('chop: reaches the tree, then +1 wood per 1400 ms of work', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'chop');
    runUntil(state, () => v.state === 'working', 10_000, 100);
    expect(v.state).toBe('working');
    expect(state.events).toContainEqual({ type: 'arrived', villagerId: v.id });
    const node = state.nodes.find((n) => n.id === v.targetNodeId);
    if (!node) throw new Error('target node missing');
    const slot = workSpot(node.pos, 0); // v is villagers[0]
    expect(Math.hypot(v.pos.x - slot.x, v.pos.z - slot.z)).toBeLessThanOrEqual(0.45);

    const wood0 = state.resources.wood;
    run(state, 1400, 100);
    expect(state.resources.wood).toBe(wood0 + 1);
    expect(state.events).toContainEqual({ type: 'chop', villagerId: v.id });
    run(state, 1400, 100);
    expect(state.resources.wood).toBe(wood0 + 2);
  });

  it('berries: reaches the bush, then +1 berries per 1400 ms of work', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'berries');
    runUntil(state, () => v.state === 'working', 10_000, 100);
    expect(v.state).toBe('working');
    expect(state.events).toContainEqual({ type: 'arrived', villagerId: v.id });

    const berries0 = state.resources.berries;
    run(state, 1400, 100);
    expect(state.resources.berries).toBe(berries0 + 1);
    expect(state.events).toContainEqual({ type: 'gather', villagerId: v.id });
    run(state, 1400, 100);
    expect(state.resources.berries).toBe(berries0 + 2);
  });
});

describe('rest', () => {
  it('walks to the campfire, rests 4000 ms, then idles with one rest-done', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'rest');
    runUntil(state, () => v.state === 'resting', 10_000, 100);
    expect(v.targetNodeId).toBe('campfire');
    expect(state.events).toContainEqual({ type: 'arrived', villagerId: v.id });

    run(state, 3900, 100);
    expect(v.state).toBe('resting');
    run(state, 100, 100);
    expect(v.state).toBe('idle');
    expect(v.task).toBeNull();
    expect(v.targetNodeId).toBeNull();
    expect(state.events.filter((e) => e.type === 'rest-done')).toHaveLength(1);
    expect(state.events[0]).toEqual({ type: 'rest-done', villagerId: v.id });
  });
});

describe('reassignment', () => {
  it('mid-walk retargets immediately; assignTask(null) stops', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'chop');
    tick(state, 100);
    expect(v.state).toBe('walking');
    const firstTarget = v.targetNodeId;

    assignTask(state, v.id, 'berries');
    expect(v.state).toBe('walking');
    expect(v.targetNodeId).not.toBe(firstTarget);
    expect(v.targetNodeId).toBe(nearestId(state, v.pos.x, v.pos.z, 'bush'));

    assignTask(state, v.id, null);
    expect(v.state).toBe('idle');
    expect(v.task).toBeNull();
    expect(v.targetNodeId).toBeNull();
  });
});

describe('tick with dtMs = 0', () => {
  it('is a safe no-op: no movement, no NaN, tick still counts the call', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'chop');
    tick(state, 100);
    const pos = { ...v.pos };
    const tickBefore = state.tick;

    tick(state, 0);
    expect(state.tick).toBe(tickBefore + 1);
    expect(v.pos).toEqual(pos);
    expect(v.state).toBe('walking');
    expect(Number.isNaN(v.pos.x) || Number.isNaN(v.pos.z)).toBe(false);
  });
});
