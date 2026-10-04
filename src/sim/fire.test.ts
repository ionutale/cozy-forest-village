// B1 tests: fire decay, Tend-fire keeper loop, rest duration by fire,
// world-gen inner radius, and the batch-2 initial-state shape.
// Binding numbers from DESIGN.md §3.2.

import { describe, expect, it } from 'vitest';
import type { GameState } from './index';
import { assignTask, createInitialState, tick } from './index';
import { restDuration } from './tasks';

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

describe('fire decay', () => {
  it('decays at 0.22/s and floors at 0 (never negative)', () => {
    const state = createInitialState();
    expect(state.fire).toEqual({ fuel: 70, max: 100 });
    tick(state, 1000);
    expect(state.fire.fuel).toBeCloseTo(69.78, 10);
    // 70 / 0.22 ≈ 318.2 s to burn out; tick well past it.
    run(state, 400_000, 1000);
    expect(state.fire.fuel).toBe(0);
    tick(state, 1000);
    expect(state.fire.fuel).toBe(0); // floored, never negative
  });
});

describe('rest duration by fire', () => {
  it('is 4000 / 5500 / 7000 ms by fuel state', () => {
    expect(restDuration({ fuel: 70, max: 100 })).toBe(4000);
    expect(restDuration({ fuel: 33, max: 100 })).toBe(4000); // boundary: ≥33
    expect(restDuration({ fuel: 32, max: 100 })).toBe(5500);
    expect(restDuration({ fuel: 10, max: 100 })).toBe(5500);
    expect(restDuration({ fuel: 1, max: 100 })).toBe(5500);
    expect(restDuration({ fuel: 0, max: 100 })).toBe(7000);
  });
});

describe('tend fire keeper loop', () => {
  it('fetches a log (wood −1, carrying) then deposits (+25 fuel, fuel-add)', () => {
    const state = createInitialState();
    state.resources.wood = 5;
    state.fire.fuel = 30;
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'tend');
    expect(v.targetNodeId).toBe('woodpile');

    // First fetch: wood drops by 1, carrying toggles on.
    runUntil(state, () => v.carrying, 30_000, 50);
    expect(v.carrying).toBe(true);
    expect(state.resources.wood).toBe(4);

    // First deposit: fuel rises by 25 (net of decay), carrying off, event emitted.
    const fuelBefore = state.fire.fuel;
    runUntil(state, () => !v.carrying, 30_000, 50);
    expect(v.carrying).toBe(false);
    expect(state.fire.fuel).toBeGreaterThan(fuelBefore);
    expect(state.fire.fuel).toBeLessThanOrEqual(fuelBefore + 25);
    expect(state.events.filter((e) => e.type === 'fuel-add')).toHaveLength(1);
  });

  it('caps fuel at fire.max on deposit', () => {
    const state = createInitialState();
    state.resources.wood = 5;
    state.fire.fuel = 90; // > 75: the keeper would not fetch, so carry by hand
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'tend');
    v.carrying = true; // simulate a log already in hand
    runUntil(state, () => !v.carrying, 30_000, 50);
    expect(state.fire.fuel).toBe(100); // 90 + 25 = 115 → capped
    expect(state.events.filter((e) => e.type === 'fuel-add')).toHaveLength(1);
  });

  it('with wood 0 the keeper fetches nothing and stands watch (working)', () => {
    const state = createInitialState();
    state.resources.wood = 0;
    state.fire.fuel = 50;
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'tend');
    runUntil(state, () => v.state === 'working', 30_000, 50);
    expect(v.state).toBe('working');
    expect(v.task).toBe('tend');
    expect(v.carrying).toBe(false);
    expect(state.resources.wood).toBe(0);
    expect(state.events.filter((e) => e.type === 'fuel-add')).toHaveLength(0);
  });

  it('with fuel > 75 the keeper stands watch and wood is untouched', () => {
    const state = createInitialState();
    state.resources.wood = 5;
    state.fire.fuel = 80;
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'tend');
    runUntil(state, () => v.state === 'working', 30_000, 50);
    expect(v.state).toBe('working');
    expect(v.task).toBe('tend');
    expect(state.resources.wood).toBe(5);
    expect(state.events.filter((e) => e.type === 'fuel-add')).toHaveLength(0);
  });
});

describe('world gen & initial shape (batch 2)', () => {
  it('scatters every tree/bush at radius ≥ 7.3 and places the woodpile at r ≈ 2.6', () => {
    const state = createInitialState();
    const scatter = state.nodes.filter((n) => n.kind !== 'campfire');
    expect(scatter.length).toBe(60);
    for (const n of scatter) {
      expect(Math.hypot(n.pos.x, n.pos.z)).toBeGreaterThanOrEqual(7.3);
    }
    const woodpile = state.structures.find((s) => s.id === 'woodpile');
    expect(woodpile).toBeDefined();
    expect(woodpile!.built).toBe(true);
    expect(Math.hypot(woodpile!.pos.x, woodpile!.pos.z)).toBeCloseTo(2.6, 10);
  });

  it('fills every batch-2 field and stays deterministic', () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).toEqual(b);
    expect(a.fire).toEqual({ fuel: 70, max: 100 });
    expect(a.pot).toEqual({ meals: 0 });
    expect(a.gardenMs).toBe(0);
    expect(a.structures).toHaveLength(1);
    expect(a.villagers.every((v) => v.fedMs === 0 && v.carrying === false)).toBe(true);
  });
});
