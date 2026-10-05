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

/**
 * Completes the open favor of `villagerId` with crafted input matching its
 * want, so tests can drive offer → complete → offer cycles deterministically.
 */
function completeActiveFavor(state: GameState, villagerId: string | undefined): void {
  if (!villagerId) throw new Error('favor-start without a requester id');
  const index = state.villagers.findIndex((v) => v.id === villagerId);
  const want = favorWantFor(index, state.favors.byVillager[index]!.step);
  if (!want) throw new Error('open favor has no chain content');
  state.events = [];
  if (want.kind === 'fire') {
    state.fire.fuel = FIRE_STEADY;
    tickFavors(state, want.ms);
  } else {
    if (want.kind === 'build') {
      state.events = [{ type: 'built', structureId: 'pot' }];
    } else if (want.kind === 'eat') {
      // eat/self (step 0) counts only the requester; eat/any counts anyone.
      const eater = want.who === 'self' ? index : (index + 1) % state.villagers.length;
      const eaterId = state.villagers[eater]!.id;
      state.events = Array.from(
        { length: want.count },
        (): SimEvent => ({ type: 'eat', villagerId: eaterId }),
      );
    } else {
      const kind = want.kind; // 'gather' | 'chop'
      state.events = Array.from(
        { length: want.count },
        (): SimEvent => ({ type: kind, villagerId }),
      );
    }
    tickFavors(state, 0);
  }
  if (state.favors.byVillager[index]!.active) throw new Error('favor did not complete');
}

/**
 * Drives offer → complete → offer cycles from a fresh state and returns each
 * offer's requester id, in order. Cadence runs through real `tick()` calls;
 * every open favor is then completed deterministically with crafted input.
 */
function requesterSequence(seed: number, offers: number): Array<string | undefined> {
  const state = createInitialState(seed);
  const sequence: Array<string | undefined> = [];
  for (let n = 0; n < offers; n += 1) {
    let start: SimEvent | undefined;
    for (let i = 0; i < 1000 && !start; i += 1) {
      tick(state, 1000);
      start = state.events.find((e) => e.type === 'favor-start');
    }
    if (!start) throw new Error(`no favor offered within 1000 ticks (offer ${n + 1})`);
    sequence.push(start.villagerId);
    completeActiveFavor(state, start.villagerId);
  }
  return sequence;
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

  it('pins the requester sequence across several offers from identically seeded states', () => {
    const a = requesterSequence(1, 3);
    const b = requesterSequence(1, 3);
    expect(a).toHaveLength(3);
    for (const id of a) expect(id).toBeDefined();
    // Same seed, same offer → complete → offer history: identical requesters,
    // including the tie between completedSteps and activeCount in `worth`.
    expect(a).toEqual(b);
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

  it('heals batch-4 retired records (step 3) to step 0 before the eligibility scan', () => {
    // A fully-retired batch-4 board: every villager parked at CHAIN_LENGTH.
    const state = createInitialState();
    for (let i = 0; i < state.favors.byVillager.length; i += 1) {
      state.favors.byVillager[i] = { step: CHAIN_LENGTH, active: false, progress: 0 };
    }
    state.favors.nextOfferMs = 0;
    state.events = [];
    tickFavors(state, 16);
    // Everyone heals (v0 included, as a batch-4 save would carry it)…
    for (const p of state.favors.byVillager) expect(p.step).toBe(0);
    // …so the offer pass can open a favor that could never have opened before.
    expect(activeCount(state)).toBe(1);
    expect(startIds(state.events)).toHaveLength(1);

    // Not behind the max-2 check: a retired record heals even while two favors
    // hold the board full and no offer can open.
    const capped = createInitialState();
    openFavor(capped, 1, 0);
    openFavor(capped, 2, 0);
    capped.favors.byVillager[0] = { step: CHAIN_LENGTH, active: false, progress: 0 };
    capped.favors.nextOfferMs = 0;
    capped.events = [];
    tickFavors(capped, 16);
    expect(capped.favors.byVillager[0]).toEqual({ step: 0, active: false, progress: 0 });
    expect(activeCount(capped)).toBe(MAX_ACTIVE_FAVORS);
    expect(startIds(capped.events)).toHaveLength(0); // full board: healed, no offer
  });

  it('skips the requester of an already-active favor', () => {
    const state = createInitialState();
    // Batch-4 retired records heal in the same pass, but the open favor's
    // requester is still never re-picked.
    for (let i = 0; i < state.favors.byVillager.length; i += 1) {
      state.favors.byVillager[i] = { step: CHAIN_LENGTH, active: false, progress: 0 };
    }
    openFavor(state, 0, 0); // one open favor
    state.favors.nextOfferMs = 0;
    state.events = [];
    tickFavors(state, 16);
    const starts = state.events.filter((e) => e.type === 'favor-start');
    expect(starts).toHaveLength(1);
    expect(starts[0]!.villagerId).not.toBe(state.villagers[0]!.id);
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
    expect(state.favors.byVillager[0]).toEqual({ step: 0, active: false, progress: 0 });
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
    expect(state.favors.byVillager[1]).toEqual({ step: 0, active: false, progress: 0 });
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(1);
  });

  it('a zero-dt tick still hands its queued events to the favor consumer (M2)', () => {
    const state = createInitialState();
    openFavor(state, 1, 2); // v1 → { build, 1 }
    state.pendingEvents.push({ type: 'built', structureId: 'pot' });
    tick(state, 0); // no movement, but the queued `built` must still count
    expect(state.favors.byVillager[1]).toEqual({ step: 0, active: false, progress: 0 });
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
    expect(state.favors.byVillager[2]).toEqual({ step: 0, active: false, progress: 0 });

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
    expect(state.favors.byVillager[0]).toEqual({ step: 0, active: false, progress: 0 });
    expect(state.favors.byVillager[3]).toEqual({ step: 0, active: false, progress: 0 });
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(2);
  });

  it('completing step 3 loops the chain to step 0: eligible again, offer waits the full gap', () => {
    const state = createInitialState();
    openFavor(state, 0, 2); // v0 → { eat, any, 3 }
    openFavor(state, 2, 0); // second active holds the cap, so no offer slips in
    state.favors.nextOfferMs = 0; // due, but the cap blocks the offer pass
    state.events = eatEvents(state, 3, 1);
    tickFavors(state, 16);
    expect(state.favors.byVillager[0]).toEqual({ step: 0, active: false, progress: 0 });
    expect(state.events.filter((e) => e.type === 'favor-done')).toHaveLength(1);
    // Completion re-enforces the gap even from a due countdown.
    expect(state.favors.nextOfferMs).toBe(NEXT_OFFER_GAP_MS);
    expect(state.favors.byVillager[2]!.active).toBe(true);

    // Wrapped and eligible again — but no offer before the re-paced gap…
    expect(startIds(runCollect(state, NEXT_OFFER_GAP_MS - 1000, 1000))).toHaveLength(0);
    // …exactly at 90 s the loop resumes with a fresh offer.
    state.events = [];
    tick(state, 1000);
    expect(startIds(state.events)).toHaveLength(1);
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
