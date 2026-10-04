// B2 tests: buildStructure, cook, eat/fed, garden, and the batch-2 structure ring.
// Binding numbers from DESIGN.md §3.2.

import { describe, expect, it } from 'vitest';
import type { GameState } from './index';
import { assignTask, buildStructure, createInitialState, tick } from './index';

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

describe('structure ring & initial shape', () => {
  it('has the woodpile plus six unbuilt ring spots and stays deterministic', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).toEqual(b);
    expect(a.structures).toHaveLength(7);
    const byId = new Map(a.structures.map((s) => [s.id, s]));
    expect(byId.get('woodpile')?.built).toBe(true);
    for (const id of ['pot', 'bench', 'garden', 'lantern-a', 'lantern-b', 'feeder']) {
      expect(byId.get(id)?.built, id).toBe(false);
    }
    // Ring spots sit at r = 5.2.
    for (const s of a.structures) {
      if (s.id === 'woodpile') continue;
      expect(Math.hypot(s.pos.x, s.pos.z)).toBeCloseTo(5.2, 10);
    }
  });
});

describe('buildStructure', () => {
  it('spends the cost exactly once, sets built, emits built', () => {
    const state = createInitialState();
    state.resources.wood = 100;
    state.resources.berries = 100;
    expect(buildStructure(state, 'pot')).toBe(true);
    expect(state.resources.wood).toBe(80); // 20 for the pot
    expect(state.structures.find((s) => s.id === 'pot')?.built).toBe(true);
    expect(state.events).toContainEqual({ type: 'built', structureId: 'pot' });
  });

  it('returns false on repeat / unknown / unaffordable and spends nothing then', () => {
    const state = createInitialState();
    state.resources.wood = 100;
    state.resources.berries = 100;
    expect(buildStructure(state, 'pot')).toBe(true);
    const woodAfterBuild = state.resources.wood;

    // Already built.
    expect(buildStructure(state, 'pot')).toBe(false);
    // Unknown id.
    expect(buildStructure(state, 'ghost')).toBe(false);
    // Unaffordable: bench costs 15 wood but only 10 remain.
    state.resources.wood = 10;
    expect(buildStructure(state, 'bench')).toBe(false);
    expect(state.resources.wood).toBe(10); // never partially spent
    expect(state.structures.find((s) => s.id === 'bench')?.built).toBe(false);
    expect(state.resources.wood).toBe(woodAfterBuild - 70); // unchanged by the failed calls
  });
});

describe('cook', () => {
  it('channels 3000 ms per meal, costs 3 berries + 1 wood, loops, then idles', () => {
    const state = createInitialState();
    state.resources.wood = 25; // 20 for the pot + 5 for cooking
    state.resources.berries = 10;
    expect(buildStructure(state, 'pot')).toBe(true);
    state.resources.wood = 5; // the 5 left for cooking
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'cook');
    expect(v.targetNodeId).toBe('pot');

    runUntil(state, () => state.pot.meals === 1, 30_000, 50);
    expect(state.resources.berries).toBe(7);
    expect(state.resources.wood).toBe(4);
    expect(state.events.filter((e) => e.type === 'meal-cooked')).toHaveLength(1);

    runUntil(state, () => state.pot.meals === 2, 30_000, 50);
    expect(state.resources.berries).toBe(4);
    expect(state.resources.wood).toBe(3);

    runUntil(state, () => state.pot.meals === 3, 30_000, 50);
    expect(state.resources.berries).toBe(1);
    expect(state.resources.wood).toBe(2);

    // Berries < 3 → idle, task cleared.
    runUntil(state, () => v.state === 'idle', 30_000, 50);
    expect(v.state).toBe('idle');
    expect(v.task).toBeNull();
  });

  it('with no pot the cook assignment is not actionable (idle)', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'cook');
    expect(v.state).toBe('idle');
    expect(v.task).toBeNull();
  });
});

describe('eat + fed', () => {
  it('on rest at fuel ≥ 33 with a meal: consumes it, fedMs = 60000, rests 5500 ms, emits eat', () => {
    const state = createInitialState();
    state.pot.meals = 1;
    state.fire.fuel = 70;
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'rest');
    runUntil(state, () => v.state === 'resting', 10_000, 50);
    expect(state.pot.meals).toBe(0);
    expect(v.fedMs).toBe(60000);
    expect(state.events.filter((e) => e.type === 'eat')).toHaveLength(1);

    // Rest lasts 5500 ms (committed at arrival).
    run(state, 5450, 50); // 109 steps × 50 ms = 5450 ms < 5500
    expect(v.state).toBe('resting');
    run(state, 50, 50); // +50 ms → 5500 ms
    expect(v.state).toBe('idle');
  });

  it('with fuel 10 (dim) no meal is consumed', () => {
    const state = createInitialState();
    state.pot.meals = 1;
    state.fire.fuel = 10;
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'rest');
    runUntil(state, () => v.state === 'resting', 10_000, 50);
    expect(state.pot.meals).toBe(1);
    expect(v.fedMs).toBe(0);
    expect(state.events.filter((e) => e.type === 'eat')).toHaveLength(0);
  });

  it('while fedMs > 0 a chop yield lands at 1190 ms; after decay, at 1400 ms', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    v.fedMs = 60000;
    assignTask(state, v.id, 'chop');
    runUntil(state, () => v.state === 'working', 10_000, 50);
    expect(v.fedMs).toBeGreaterThan(0);

    // Fed: yield at the 1190 ms boundary.
    const wood0 = state.resources.wood;
    run(state, 1190, 50);
    expect(state.resources.wood).toBe(wood0 + 1);

    // Let fedMs decay to 0.
    runUntil(state, () => v.fedMs === 0, 70_000, 50);
    expect(v.fedMs).toBe(0);

    // Not fed: yield at the 1400 ms boundary.
    v.progressMs = 0; // clean measurement
    const wood1 = state.resources.wood;
    run(state, 1400, 50);
    expect(state.resources.wood).toBe(wood1 + 1);
  });
});

describe('garden', () => {
  it('yields +1 berry per 30000 ms while built; nothing when unbuilt', () => {
    const state = createInitialState();
    // Unbuilt: nothing.
    run(state, 30_000, 100);
    expect(state.resources.berries).toBe(0);
    expect(state.gardenMs).toBe(0);

    // Built: +1 berry per 30000 ms.
    state.resources.wood = 25;
    expect(buildStructure(state, 'garden')).toBe(true);
    run(state, 30_000, 100);
    expect(state.resources.berries).toBe(1);
    run(state, 30_000, 100);
    expect(state.resources.berries).toBe(2);
  });
});
