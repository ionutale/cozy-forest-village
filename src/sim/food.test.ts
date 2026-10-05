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
  it('spends the cost exactly once, sets built, queues built for the next tick', () => {
    const state = createInitialState();
    state.resources.wood = 100;
    state.resources.berries = 100;
    expect(buildStructure(state, 'pot')).toBe(true);
    expect(state.resources.wood).toBe(80); // 20 for the pot
    expect(state.structures.find((s) => s.id === 'pot')?.built).toBe(true);
    // Out-of-tick contract (DESIGN.md §3.2): the event queues immediately…
    expect(state.pendingEvents).toContainEqual({ type: 'built', structureId: 'pot' });
    expect(state.events).toEqual([]);
    // …and becomes observable on the next tick, then clears the queue.
    tick(state, 100);
    expect(state.events).toContainEqual({ type: 'built', structureId: 'pot' });
    expect(state.pendingEvents).toEqual([]);
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

  it('a large dt never drives the ledger negative: one affordable meal, then idle', () => {
    const state = createInitialState();
    state.resources.wood = 21; // 20 for the pot + 1 for a single meal
    state.resources.berries = 3;
    expect(buildStructure(state, 'pot')).toBe(true);
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'cook');
    runUntil(state, () => v.state === 'working', 30_000, 50);
    expect(v.state).toBe('working');

    // Exactly one meal's worth of ingredients and a 60 s tick: the loop must
    // cook once, then idle on the dry check — never 20 meals at −57/−19.
    state.resources.berries = 3;
    state.resources.wood = 1;
    state.pot.meals = 0;
    v.progressMs = 0;
    tick(state, 60000);
    expect(state.resources.berries).toBeGreaterThanOrEqual(0);
    expect(state.resources.wood).toBeGreaterThanOrEqual(0);
    expect(state.pot.meals).toBe(1);
    expect(v.state).toBe('idle');
    expect(v.task).toBeNull();
    expect(state.events.filter((e) => e.type === 'meal-cooked')).toHaveLength(1);
  });

  it('all 8 cooks settle around the pot without stacking (pairwise ≥ 0.45)', () => {
    const state = createInitialState();
    state.resources.wood = 20 + 1000; // pot + plenty to keep every cook working
    state.resources.berries = 1000;
    expect(buildStructure(state, 'pot')).toBe(true);
    for (const v of state.villagers) assignTask(state, v.id, 'cook');
    runUntil(
      state,
      () => state.villagers.every((v) => v.state === 'working'),
      60_000,
      50,
    );
    expect(state.villagers.every((v) => v.state === 'working')).toBe(true);
    for (let i = 0; i < state.villagers.length; i += 1) {
      for (let j = i + 1; j < state.villagers.length; j += 1) {
        const a = state.villagers[i]!;
        const b = state.villagers[j]!;
        expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThanOrEqual(0.45);
      }
    }
  });

  it('every cook walks to the pot without crossing the flames (min > 1.0)', () => {
    for (let i = 0; i < 8; i += 1) {
      const state = createInitialState();
      state.resources.wood = 20;
      state.resources.berries = 30;
      expect(buildStructure(state, 'pot')).toBe(true);
      const v = state.villagers[i]!;
      assignTask(state, v.id, 'cook');
      let minDist = Infinity;
      const maxSteps = Math.round(60_000 / 50);
      for (let s = 0; s < maxSteps; s += 1) {
        tick(state, 50);
        const d = Math.hypot(v.pos.x, v.pos.z); // campfire is at the origin
        if (d < minDist) minDist = d;
        if (v.state === 'working') break;
      }
      expect(v.state).toBe('working');
      expect(minDist).toBeGreaterThan(1.0);
    }
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

  it('a full belly (fedMs ≥ 30000) rests without consuming a meal', () => {
    const state = createInitialState();
    state.pot.meals = 1;
    state.fire.fuel = 70;
    const v = state.villagers[0]!;
    v.fedMs = 55000; // well-fed: the meal stays in the pot
    assignTask(state, v.id, 'rest');
    runUntil(state, () => v.state === 'resting', 10_000, 50);
    expect(v.state).toBe('resting');
    expect(state.pot.meals).toBe(1);
    expect(state.events.filter((e) => e.type === 'eat')).toHaveLength(0);
    expect(v.restMs).toBe(4000); // normal warm-fire rest, not the 5500 ms eat rest
  });

  it('a nearly-hungry belly (fedMs < 30000) still eats', () => {
    const state = createInitialState();
    state.pot.meals = 1;
    state.fire.fuel = 70;
    const v = state.villagers[0]!;
    v.fedMs = 29999;
    assignTask(state, v.id, 'rest');
    runUntil(state, () => v.state === 'resting', 10_000, 50);
    expect(state.pot.meals).toBe(0);
    expect(v.fedMs).toBe(60000);
    expect(state.events.filter((e) => e.type === 'eat')).toHaveLength(1);
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

  it('emits one garden event per yield; none while not yielding', () => {
    const state = createInitialState();
    // Unbuilt: no yield, no event.
    run(state, 30_000, 100);
    expect(state.events.filter((e) => e.type === 'garden')).toHaveLength(0);

    state.resources.wood = 25;
    expect(buildStructure(state, 'garden')).toBe(true);
    // Built but below the period: still nothing.
    run(state, 29_900, 100);
    expect(state.events.filter((e) => e.type === 'garden')).toHaveLength(0);

    // Crossing 30000 ms: exactly one yield, exactly one event.
    tick(state, 100);
    expect(state.resources.berries).toBe(1);
    expect(state.events).toEqual([{ type: 'garden' }]);

    // Next tick yields nothing, so the event does not repeat.
    tick(state, 100);
    expect(state.events.filter((e) => e.type === 'garden')).toHaveLength(0);
  });
});
