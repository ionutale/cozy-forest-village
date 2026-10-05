// F1 tests: villager favor chains — initial shape, chain content, offering
// cadence / cap / determinism, and event-driven completion (DESIGN.md §3.2;
// spec Parts 1–2). Completion is driven through the exported `tickFavors` with
// crafted `state.events` (and `dtMs` for the fire favor).

import { describe, expect, it } from 'vitest';
import type { GameState, SimEvent } from './index';
import {
  CHAIN_LENGTH,
  FIRST_OFFER_MS,
  MAX_ACTIVE_FAVORS,
  NEXT_OFFER_GAP_MS,
  assignTask,
  createFavors,
  createInitialState,
  tick,
} from './index';
import { favorWantFor, tickFavors } from './favors';
import { FIRE_STEADY } from './tasks';

/** Ticks the sim forward in fixed steps, collecting every event seen. */
function runCollect(state: GameState, totalMs: number, stepMs: number): SimEvent[] {
  const collected: SimEvent[] = [];
  const steps = Math.round(totalMs / stepMs);
  for (let i = 0; i < steps; i += 1) {
    tick(state, stepMs);
    collected.push(...state.events);
  }
  return collected;
}

function startIds(events: SimEvent[]): Array<string | undefined> {
  return events.filter((e) => e.type === 'favor-start').map((e) => e.villagerId);
}

function activeCount(state: GameState): number {
  return state.favors.byVillager.filter((p) => p.active).length;
}

/** Opens `step` for villager `index` directly, bypassing the offer cadence. */
function openFavor(state: GameState, index: number, step: number): void {
  state.favors.byVillager[index] = { step, active: true, progress: 0 };
}

function eatEvents(state: GameState, count: number, villagerIndex: number): SimEvent[] {
  return Array.from(
    { length: count },
    (): SimEvent => ({ type: 'eat', villagerId: state.villagers[villagerIndex]!.id }),
  );
}

describe('favor state & chain content', () => {
  it('createFavors starts every villager fresh with the first offer 120 s out', () => {
    const favors = createFavors(8);
    expect(favors.byVillager).toHaveLength(8);
    for (const p of favors.byVillager) {
      expect(p).toEqual({ step: 0, active: false, progress: 0 });
    }
    expect(favors.nextOfferMs).toBe(FIRST_OFFER_MS);
    expect(FIRST_OFFER_MS).toBe(120_000);
    expect(NEXT_OFFER_GAP_MS).toBe(90_000);
    expect(MAX_ACTIVE_FAVORS).toBe(2);
    expect(CHAIN_LENGTH).toBe(3);
  });

  it('createInitialState seeds favors from the roster length', () => {
    const state = createInitialState();
    expect(state.favors.byVillager).toHaveLength(state.villagers.length);
    expect(state.favors.nextOfferMs).toBe(FIRST_OFFER_MS);
    expect(activeCount(state)).toBe(0);
  });

  it('maps chain steps to wants per the spec table', () => {
    expect(favorWantFor(0, 0)).toEqual({ kind: 'eat', who: 'self', count: 1 });
    expect(favorWantFor(0, 1)).toEqual({ kind: 'gather', count: 6 });
    expect(favorWantFor(1, 1)).toEqual({ kind: 'chop', count: 4 });
    expect(favorWantFor(0, 2)).toEqual({ kind: 'eat', who: 'any', count: 3 });
    expect(favorWantFor(3, 2)).toEqual({ kind: 'eat', who: 'any', count: 3 });
    expect(favorWantFor(1, 2)).toEqual({ kind: 'build', count: 1 });
    expect(favorWantFor(4, 2)).toEqual({ kind: 'build', count: 1 });
    expect(favorWantFor(2, 2)).toEqual({ kind: 'fire', ms: 120_000 });
    expect(favorWantFor(5, 2)).toEqual({ kind: 'fire', ms: 120_000 });
    expect(favorWantFor(0, 3)).toBeNull();
    expect(favorWantFor(0, -1)).toBeNull();
  });
});

describe('offering cadence', () => {
  it('first offer lands exactly at 120 000 ms of ticks, not before', () => {
    const state = createInitialState();
    expect(startIds(runCollect(state, FIRST_OFFER_MS - 1000, 1000))).toHaveLength(0);
    tick(state, 1000);
    expect(startIds(state.events)).toHaveLength(1);
    expect(state.favors.nextOfferMs).toBe(NEXT_OFFER_GAP_MS);
  });

  it('picks the same requester from identical states, and a different one across seeds 1 vs 2', () => {
    const a = createInitialState(1);
    const b = createInitialState(1);
    runCollect(a, FIRST_OFFER_MS, 1000);
    runCollect(b, FIRST_OFFER_MS, 1000);
    const idA = startIds(a.events)[0];
    expect(idA).toBeDefined();
    expect(startIds(b.events)[0]).toBe(idA);

    const c = createInitialState(2);
    runCollect(c, FIRST_OFFER_MS, 1000);
    expect(startIds(c.events)[0]).not.toBe(idA);
  });

  it('never exceeds two active favors; the countdown holds at 0 while both are open', () => {
    const state = createInitialState();
    runCollect(state, FIRST_OFFER_MS, 1000); // offer 1
    expect(activeCount(state)).toBe(1);
    const more = runCollect(state, NEXT_OFFER_GAP_MS, 1000); // offer 2
    expect(startIds(more)).toHaveLength(1);
    expect(activeCount(state)).toBe(2);

    // Three more gaps: nothing pending is offered while the cap is reached.
    const parked = runCollect(state, NEXT_OFFER_GAP_MS * 3, 1000);
    expect(startIds(parked)).toHaveLength(0);
    expect(activeCount(state)).toBe(2);
    expect(state.favors.nextOfferMs).toBe(0);
  });

  it('only ever offers to an eligible (inactive, unretired) villager', () => {
    const state = createInitialState();
    for (let i = 0; i < state.favors.byVillager.length; i += 1) {
      state.favors.byVillager[i] =
        i === 1 ? { step: 1, active: false, progress: 0 } : { step: CHAIN_LENGTH, active: false, progress: 0 };
    }
    state.favors.nextOfferMs = 0;
    state.events = [];
    tickFavors(state, 16);
    const starts = state.events.filter((e) => e.type === 'favor-start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.villagerId).toBe(state.villagers[1]!.id);
  });

  it('skips the requester of an already-active favor', () => {
    const state = createInitialState();
    for (let i = 0; i < state.favors.byVillager.length; i += 1) {
      state.favors.byVillager[i] = { step: CHAIN_LENGTH, active: false, progress: 0 };
    }
    openFavor(state, 0, 0); // one open favor, v1 the only one left to ask
    state.favors.byVillager[1] = { step: 0, active: false, progress: 0 };
    state.favors.nextOfferMs = 0;
    state.events = [];
    tickFavors(state, 16);
    const starts = state.events.filter((e) => e.type === 'favor-start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.villagerId).toBe(state.villagers[1]!.id);
    expect(state.favors.byVillager[0]!.active).toBe(true); // the open one was not re-picked
  });

  it('after a completion the next offer waits at least 90 000 ms', () => {
    const state = createInitialState();
    const requester = state.villagers[0]!;
    openFavor(state, 0, 0);
    state.favors.nextOfferMs = 1000;
    state.events = [{ type: 'eat', villagerId: requester.id }];
    tickFavors(state, 16);
    expect(state.favors.byVillager[0]!.step).toBe(1);
    expect(state.favors.nextOfferMs).toBe(NEXT_OFFER_GAP_MS);

    // 89 s of play: still nothing offered…
    expect(startIds(runCollect(state, NEXT_OFFER_GAP_MS - 1000, 1000))).toHaveLength(0);
    // …exactly at 90 s the cadence resumes.
    tick(state, 1000);
    expect(startIds(state.events)).toHaveLength(1);
  });
});

describe('completion', () => {
  it('eat/self counts only the requester eating; emits exactly one favor-done', () => {
    const state = createInitialState();
    const requester = state.villagers[0]!;
    openFavor(state, 0, 0);

    // Another villager's eat does not count.
    state.events = [{ type: 'eat', villagerId: state.villagers[1]!.id }];
    tickFavors(state, 16);
    expect(state.favors.byVillager[0]).toEqual({ step: 0, active: true, progress: 0 });
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(0);

    // The requester's own eat does.
    state.events = [{ type: 'eat', villagerId: requester.id }];
    tickFavors(state, 16);
    const done = state.events.filter((e) => e.type === 'favor-done');
    expect(done).toHaveLength(1);
    expect(done[0]!.villagerId).toBe(requester.id);
    expect(state.favors.byVillager[0]).toEqual({ step: 1, active: false, progress: 0 });

    // A second pass must not re-emit (no double-completion).
    state.events = [];
    tickFavors(state, 16);
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(0);
  });

  it('eat/any counts any villager eating, three times', () => {
    const state = createInitialState();
    openFavor(state, 0, 2); // v0 → { eat, any, 3 }
    state.events = [{ type: 'eat', villagerId: state.villagers[5]!.id }];
    tickFavors(state, 16);
    expect(state.favors.byVillager[0]!.progress).toBe(1);
    state.events = eatEvents(state, 2, 6);
    tickFavors(state, 16);
    expect(state.favors.byVillager[0]).toEqual({ step: 3, active: false, progress: 0 });
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(1);
  });

  it('gather ×6 and chop ×4 complete their favors', () => {
    const g = createInitialState();
    openFavor(g, 0, 1); // v0 (even) → gather 6
    g.events = Array.from(
      { length: 5 },
      (): SimEvent => ({ type: 'gather', villagerId: g.villagers[2]!.id }),
    );
    tickFavors(g, 16);
    expect(g.favors.byVillager[0]).toEqual({ step: 1, active: true, progress: 5 });
    g.events = [{ type: 'gather', villagerId: g.villagers[2]!.id }];
    tickFavors(g, 16);
    expect(g.favors.byVillager[0]).toEqual({ step: 2, active: false, progress: 0 });
    expect(g.events.filter((e) => e.type === 'favor-done')).toHaveLength(1);

    const c = createInitialState();
    openFavor(c, 1, 1); // v1 (odd) → chop 4
    c.events = Array.from(
      { length: 4 },
      (): SimEvent => ({ type: 'chop', villagerId: c.villagers[0]!.id }),
    );
    tickFavors(c, 16);
    expect(c.favors.byVillager[1]).toEqual({ step: 2, active: false, progress: 0 });
    expect(c.events.filter((e) => e.type === 'favor-done')).toHaveLength(1);
  });

  it('build ×1 completes on a single built event', () => {
    const state = createInitialState();
    openFavor(state, 1, 2); // v1 → { build, 1 }
    state.events = [{ type: 'built', structureId: 'pot' }];
    tickFavors(state, 16);
    expect(state.favors.byVillager[1]).toEqual({ step: 3, active: false, progress: 0 });
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(1);
  });

  it('fire accumulates only while fuel ≥ 33; a pause holds progress and never double-fires', () => {
    const state = createInitialState();
    openFavor(state, 2, 2); // v2 → { fire, 120000 }
    state.fire.fuel = FIRE_STEADY; // exactly 33: warm enough
    tickFavors(state, 60_000);
    expect(state.favors.byVillager[2]!.progress).toBe(60_000);

    // Below the threshold: no accumulation, progress is kept (not lost).
    state.fire.fuel = FIRE_STEADY - 0.001;
    tickFavors(state, 10_000);
    expect(state.favors.byVillager[2]!.progress).toBe(60_000);

    // Warm again: the second half completes it exactly once…
    state.fire.fuel = 100;
    tickFavors(state, 60_000);
    const done = state.events.filter((e) => e.type === 'favor-done');
    expect(done).toHaveLength(1);
    expect(done[0]!.villagerId).toBe(state.villagers[2]!.id);
    expect(state.favors.byVillager[2]).toEqual({ step: 3, active: false, progress: 0 });

    // …and warm time after completion cannot fire again.
    state.events = [];
    tickFavors(state, 60_000);
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(0);
  });

  it('one event advances two sharing eat/any favors once each, never twice', () => {
    const state = createInitialState();
    openFavor(state, 0, 2); // v0 → { eat, any, 3 }
    openFavor(state, 3, 2); // v3 → { eat, any, 3 }
    state.events = [{ type: 'eat', villagerId: state.villagers[7]!.id }];
    tickFavors(state, 16);
    expect(state.favors.byVillager[0]!.progress).toBe(1);
    expect(state.favors.byVillager[3]!.progress).toBe(1);

    state.events = eatEvents(state, 2, 7);
    tickFavors(state, 16);
    expect(state.favors.byVillager[0]).toEqual({ step: 3, active: false, progress: 0 });
    expect(state.favors.byVillager[3]).toEqual({ step: 3, active: false, progress: 0 });
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(2);
  });

  it('completing step 3 retires the villager: no further offers, no progress', () => {
    const state = createInitialState();
    for (let i = 1; i < state.favors.byVillager.length; i += 1) {
      state.favors.byVillager[i] = { step: CHAIN_LENGTH, active: false, progress: 0 };
    }
    openFavor(state, 0, 2); // v0 → { eat, any, 3 }
    state.events = eatEvents(state, 3, 1);
    tickFavors(state, 16);
    expect(state.favors.byVillager[0]).toEqual({ step: 3, active: false, progress: 0 });
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(1);

    // With nobody eligible, the countdown holds at 0 and never offers again.
    state.favors.nextOfferMs = 0;
    state.events = [];
    tickFavors(state, 1000);
    tickFavors(state, 1000);
    expect(state.events.filter((e) => e.type === 'favor-start')).toHaveLength(0);
    expect(activeCount(state)).toBe(0);
  });

  it('a real rest-eat through tick() completes the requester’s eat favor', () => {
    const state = createInitialState();
    const requester = state.villagers[0]!;
    openFavor(state, 0, 0);
    state.pot.meals = 1;
    assignTask(state, requester.id, 'rest');

    let done = false;
    const steps = Math.round(120_000 / 50);
    for (let i = 0; i < steps && !done; i += 1) {
      tick(state, 50);
      done = state.events.some((e) => e.type === 'favor-done');
    }
    expect(done).toBe(true);
    expect(state.favors.byVillager[0]).toEqual({ step: 1, active: false, progress: 0 });
  });
});
