import { describe, expect, it } from 'vitest';
import type { GameState } from './index';
import { assignTask, createInitialState, tick } from './index';
import { restSpot } from './tasks';

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

describe('events lifecycle', () => {
  it('clears events at the start of each tick before appending', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'chop');
    runUntil(state, () => v.state === 'working', 10_000, 100);
    run(state, 1400, 100); // last tick yields exactly one chop event
    expect(state.events).toEqual([{ type: 'chop', villagerId: v.id }]);
    tick(state, 100); // a tick with no yield starts cleared
    expect(state.events).toEqual([]);
  });
});

describe('facing', () => {
  it('is atan2(dx, dz) of the pre-move delta while walking; 0 when idle', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    expect(v.facing).toBe(0);
    assignTask(state, v.id, 'rest'); // campfire sits at the origin
    const before = { ...v.pos };
    tick(state, 100);
    const spot = restSpot({ x: 0, z: 0 }, 0); // v1 is villagers[0]
    expect(v.facing).toBeCloseTo(Math.atan2(spot.x - before.x, spot.z - before.z), 12);
  });
});

describe('rest ring', () => {
  it('settles on the ring around the campfire, not inside it', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'rest');
    runUntil(state, () => v.state === 'resting', 10_000, 100);
    expect(v.state).toBe('resting');
    expect(v.targetNodeId).toBe('campfire');
    const d = Math.hypot(v.pos.x, v.pos.z); // campfire is at the origin
    expect(d).toBeGreaterThanOrEqual(1.15);
    expect(d).toBeLessThanOrEqual(2.05);
  });

  it('spreads multiple villagers around the fire', () => {
    const state = createInitialState();
    const a = state.villagers[0]!;
    const b = state.villagers[1]!;
    assignTask(state, a.id, 'rest');
    assignTask(state, b.id, 'rest');
    runUntil(state, () => a.state === 'resting' && b.state === 'resting', 10_000, 100);
    expect(a.state).toBe('resting');
    expect(b.state).toBe('resting');
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    expect(d).toBeGreaterThan(1.0);
  });
});

describe('arrival boundary', () => {
  it('arrives when the remaining distance drops to ≤ 0.45', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    const tree = state.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree in world');
    // 0.68 away: one 100 ms step (0.22) leaves 0.46 > 0.45, a second leaves 0.24.
    v.pos.x = tree.pos.x + 0.68;
    v.pos.z = tree.pos.z;
    assignTask(state, v.id, 'chop');
    expect(v.targetNodeId).toBe(tree.id);
    tick(state, 100);
    expect(v.state).toBe('walking');
    tick(state, 100);
    expect(v.state).toBe('working');
    expect(state.events).toContainEqual({ type: 'arrived', villagerId: v.id });
  });
});

describe('serializability', () => {
  it('survives a JSON round-trip mid-work and stays in lockstep', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'chop');
    runUntil(state, () => v.state === 'working', 10_000, 100);
    run(state, 700, 100); // mid-work: progressMs = 700, no yield yet

    const copy = JSON.parse(JSON.stringify(state)) as GameState;
    const cv = copy.villagers[0]!;
    expect(cv.progressMs).toBe(700);

    run(state, 2800, 100); // two full yield periods
    run(copy, 2800, 100);

    expect(copy.resources.wood).toBe(2);
    expect(copy.resources.wood).toBe(state.resources.wood);
    expect(copy.events).toEqual(state.events);
    expect(cv.progressMs).toBe(v.progressMs);
  });
});

describe('determinism', () => {
  it('identical seed + identical call sequence → deep-equal state', () => {
    const a = createInitialState(7);
    const b = createInitialState(7);
    const script = (s: GameState): void => {
      assignTask(s, 'v1', 'chop');
      assignTask(s, 'v2', 'berries');
      assignTask(s, 'v3', 'rest');
      run(s, 5000, 100);
      assignTask(s, 'v1', 'rest');
      assignTask(s, 'v2', null);
      run(s, 3000, 100);
      assignTask(s, 'v3', 'chop');
      run(s, 2000, 100);
    };
    script(a);
    script(b);
    expect(a).toEqual(b);
  });
});
