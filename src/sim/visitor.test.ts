// T1 tests: trader-visit schedule, trades, hearty eats. Binding numbers from
// DESIGN.md §3.2 (batch 7: "Trader visits", "Hearty meals").

import { describe, expect, it } from 'vitest';
import type { GameState } from './index';
import {
  FIRST_VISIT_MS,
  HEARTY_FED_MS,
  NEXT_VISIT_GAP_MS,
  TRADES_PER_VISIT,
  VISIT_STAY_MS,
  assignTask,
  createInitialState,
  tick,
  trade,
} from './index';

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

/** Fresh state with the visitor already arrived (inMs fast-forward). */
function visitingState(): GameState {
  const state = createInitialState();
  state.visitor.inMs = 0;
  tick(state, 50);
  expect(state.visitor.phase).toBe('visiting');
  return state;
}

describe('visitor schedule', () => {
  it('starts away with the first visit 240 s out and no spices', () => {
    const state = createInitialState();
    expect(state.visitor).toEqual({ phase: 'away', inMs: FIRST_VISIT_MS, visitMs: 0, tradesLeft: 0 });
    expect(FIRST_VISIT_MS).toBe(240_000);
    expect(state.resources.spices).toBe(0);
  });

  it('first visit arrives at exactly 240 000 ms of play', () => {
    const state = createInitialState();
    run(state, 239_000, 1000);
    expect(state.visitor.phase).toBe('away');
    expect(state.visitor.inMs).toBe(1000);
    tick(state, 1000);
    expect(state.visitor.phase).toBe('visiting');
    expect(state.visitor.inMs).toBe(VISIT_STAY_MS);
    expect(state.visitor.visitMs).toBe(0);
    expect(state.visitor.tradesLeft).toBe(TRADES_PER_VISIT);
    expect(state.events).toContainEqual({ type: 'visitor-arrive' });
  });

  it('a visit lasts 120 000 ms, then leaves with a fresh 360 000 ms away timer', () => {
    const state = createInitialState();
    run(state, 240_000, 1000);
    expect(state.visitor.phase).toBe('visiting');
    run(state, 119_000, 1000);
    expect(state.visitor.phase).toBe('visiting');
    tick(state, 1000);
    expect(state.visitor.phase).toBe('away');
    expect(state.visitor.inMs).toBe(NEXT_VISIT_GAP_MS);
    expect(state.visitor.visitMs).toBe(0);
    expect(state.events).toContainEqual({ type: 'visitor-leave' });
  });

  it('tradesLeft resets to 3 on every visit', () => {
    const state = createInitialState();
    state.resources.wood = 100;
    run(state, 240_000, 1000); // first visit
    expect(trade(state, 'berries')).toBe(true);
    expect(trade(state, 'berries')).toBe(true);
    expect(trade(state, 'berries')).toBe(true);
    expect(state.visitor.tradesLeft).toBe(0);
    run(state, 120_000 + 360_000, 1000); // leave + away gap
    expect(state.visitor.phase).toBe('visiting');
    expect(state.visitor.tradesLeft).toBe(TRADES_PER_VISIT);
  });
});

describe('trade', () => {
  it('applies exact deltas and queues the kind for the next tick', () => {
    const state = visitingState();
    state.resources.wood = 5;
    expect(trade(state, 'berries')).toBe(true);
    expect(state.resources.wood).toBe(0);
    expect(state.resources.berries).toBe(4);
    expect(state.visitor.tradesLeft).toBe(2);
    // Out-of-tick action (same register as buildStructure): queued now, visible next tick.
    expect(state.pendingEvents).toContainEqual({ type: 'trade', tradeKind: 'berries' });
    tick(state, 0);
    expect(state.events).toContainEqual({ type: 'trade', tradeKind: 'berries' });

    state.resources.berries = 6;
    expect(trade(state, 'spice')).toBe(true);
    expect(state.resources.berries).toBe(0);
    expect(state.resources.spices).toBe(1);
    expect(state.visitor.tradesLeft).toBe(1);
    expect(state.pendingEvents).toContainEqual({ type: 'trade', tradeKind: 'spice' });
  });

  it('refuses while away, out of stock, or unaffordable — changing nothing', () => {
    const away = createInitialState();
    away.resources.wood = 100;
    expect(trade(away, 'berries')).toBe(false);
    expect(away.resources.wood).toBe(100);
    expect(away.visitor.tradesLeft).toBe(0);
    expect(away.events.some((e) => e.type === 'trade')).toBe(false);

    const poor = visitingState();
    poor.resources.wood = 4; // one short of the 5-wood price
    expect(trade(poor, 'berries')).toBe(false);
    expect(poor.resources.wood).toBe(4);
    expect(poor.visitor.tradesLeft).toBe(TRADES_PER_VISIT);
    poor.resources.berries = 5; // one short of the 6-berry price
    expect(trade(poor, 'spice')).toBe(false);
    expect(poor.resources.berries).toBe(5);
    expect(poor.resources.spices).toBe(0);

    const dry = visitingState();
    dry.resources.wood = 100;
    expect(trade(dry, 'berries')).toBe(true);
    expect(trade(dry, 'berries')).toBe(true);
    expect(trade(dry, 'berries')).toBe(true);
    expect(trade(dry, 'berries')).toBe(false); // stock out
    expect(dry.resources.wood).toBe(85);
    expect(dry.resources.berries).toBe(12);
  });
});

describe('big-dt schedule steps', () => {
  it('one giant tick fires a single arrival, never a double', () => {
    const state = createInitialState();
    state.visitor.inMs = 100;
    tick(state, 10_000_000);
    expect(state.visitor.phase).toBe('visiting');
    expect(state.visitor.inMs).toBe(VISIT_STAY_MS);
    expect(state.visitor.visitMs).toBe(0);
    expect(state.visitor.tradesLeft).toBe(TRADES_PER_VISIT);
    expect(state.events.filter((e) => e.type === 'visitor-arrive')).toHaveLength(1);
  });

  it('one giant tick fires a single departure, never a double', () => {
    const state = visitingState();
    state.visitor.inMs = 100;
    tick(state, 10_000_000);
    expect(state.visitor.phase).toBe('away');
    expect(state.visitor.inMs).toBe(NEXT_VISIT_GAP_MS);
    expect(state.visitor.visitMs).toBe(0);
    expect(state.events.filter((e) => e.type === 'visitor-leave')).toHaveLength(1);
  });
});

describe('hearty meals', () => {
  it('eating with spices consumes one, sets fedMs 90 000, marks hearty', () => {
    const state = createInitialState();
    state.pot.meals = 1;
    state.fire.fuel = 70;
    state.resources.spices = 2;
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'rest');
    runUntil(state, () => v.state === 'resting', 10_000, 50);
    expect(state.resources.spices).toBe(1); // exactly one spice per arrival
    expect(v.fedMs).toBe(HEARTY_FED_MS);
    expect(HEARTY_FED_MS).toBe(90_000);
    expect(v.restMs).toBe(5500); // rest duration unchanged
    expect(state.pot.meals).toBe(0);
    const eats = state.events.filter((e) => e.type === 'eat');
    expect(eats).toHaveLength(1);
    expect(eats[0]).toEqual({ type: 'eat', villagerId: v.id, hearty: true });
  });

  it('no-spice eats are unchanged (fedMs 60 000, no hearty flag)', () => {
    const state = createInitialState();
    state.pot.meals = 1;
    state.fire.fuel = 70;
    state.resources.spices = 0;
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'rest');
    runUntil(state, () => v.state === 'resting', 10_000, 50);
    expect(v.fedMs).toBe(60000);
    const eats = state.events.filter((e) => e.type === 'eat');
    expect(eats).toHaveLength(1);
    expect(eats[0]).toEqual({ type: 'eat', villagerId: v.id });
  });

  it('favor counting treats a hearty eat like any other eat', () => {
    const state = createInitialState();
    state.pot.meals = 1;
    state.fire.fuel = 70;
    state.resources.spices = 1;
    state.favors.byVillager[0] = { step: 0, active: true, progress: 0 }; // eat-self favor
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'rest');
    runUntil(state, () => v.state === 'resting', 10_000, 50);
    // Step-0 wants a single self eat: the hearty arrival completes it.
    expect(state.favors.byVillager[0]).toEqual({ step: 1, active: false, progress: 0 });
  });
});
