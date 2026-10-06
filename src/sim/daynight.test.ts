// N1 tests (batch 8, day/night cycle): the deterministic clock, its three pure
// derivations, the evening gathering drift, and the evening rest stretch.
// Binding numbers: DESIGN.md §3.2 "Day/night cycle"; spec
// docs/superpowers/specs/2026-10-06-day-night-cycle-design.md Part 1.

import { describe, expect, it } from 'vitest';
import type { GameState } from './index';
import {
  DAY_MS,
  FRESH_START_T,
  assignTask,
  createInitialState,
  dayFactor,
  dayPhase,
  dayT,
  tick,
} from './index';

/** Ticks until `predicate` holds or the budget is exhausted. */
function runUntil(state: GameState, predicate: () => boolean, maxMs: number, stepMs: number): void {
  const maxSteps = Math.round(maxMs / stepMs);
  for (let i = 0; i < maxSteps; i += 1) {
    tick(state, stepMs);
    if (predicate()) return;
  }
}

describe('clock advance & the fresh start', () => {
  it('advances with dt and wraps exactly once under a giant dt', () => {
    const st = createInitialState();
    st.clock.dayMs = DAY_MS - 100;
    tick(st, 100);
    expect(st.clock.dayMs).toBe(0);
    st.clock.dayMs = DAY_MS * FRESH_START_T;
    tick(st, DAY_MS * 17);
    expect(st.clock.dayMs).toBe(DAY_MS * FRESH_START_T); // same spot, one modulo
  });

  it('fresh games start mid-morning', () => {
    expect(createInitialState().clock.dayMs).toBe(DAY_MS * FRESH_START_T);
  });
});

describe('dayT / dayPhase / dayFactor', () => {
  it('dayT is the clock position in [0, 1)', () => {
    const st = createInitialState();
    st.clock.dayMs = 0;
    expect(dayT(st)).toBe(0);
    st.clock.dayMs = DAY_MS * FRESH_START_T;
    expect(dayT(st)).toBe(FRESH_START_T);
    st.clock.dayMs = DAY_MS - 1;
    expect(dayT(st)).toBe((DAY_MS - 1) / DAY_MS);
  });

  it('phase boundaries sit exactly at the pinned ms', () => {
    const st = createInitialState();
    const at = (ms: number) => {
      st.clock.dayMs = ms;
      return dayPhase(st);
    };
    expect(at(0)).toBe('night');
    expect(at(43_199)).toBe('night');
    expect(at(43_200)).toBe('dawn');
    expect(at(105_599)).toBe('dawn');
    expect(at(105_600)).toBe('day');
    expect(at(374_399)).toBe('day');
    expect(at(374_400)).toBe('dusk');
    expect(at(436_799)).toBe('dusk');
    expect(at(436_800)).toBe('night');
  });

  it('dayFactor is 1 by day, 0 by night, ½ at ramp midpoints', () => {
    const st = createInitialState();
    const at = (ms: number) => {
      st.clock.dayMs = ms;
      return dayFactor(st);
    };
    expect(at(105_600)).toBe(1);
    expect(at(240_000)).toBe(1);
    expect(at(374_400)).toBe(1);
    expect(at(0)).toBe(0);
    expect(at(436_800)).toBe(0);
    expect(at((43_200 + 105_600) / 2)).toBeCloseTo(0.5, 6); // dawn midpoint
    expect(at((374_400 + 436_800) / 2)).toBeCloseTo(0.5, 6); // dusk midpoint
  });
});

describe('gathering drift', () => {
  it('idle villagers stroll to their warm seat after dark and idle there', () => {
    const st = createInitialState();
    st.clock.dayMs = 0; // deep night
    const v = st.villagers[0]!;
    v.pos = { x: 8, z: 8 };
    v.state = 'idle';
    v.task = null;
    runUntil(st, () => v.state === 'idle' && Math.hypot(v.pos.x, v.pos.z) < 3.0, 30_000, 50);
    const r = Math.hypot(v.pos.x, v.pos.z);
    expect(r).toBeGreaterThan(2.0);
    expect(r).toBeLessThan(3.0); // WARMING_RADIUS ± jitter
  });

  it('seats never overlap (distinct angles)', () => {
    const st = createInitialState();
    st.clock.dayMs = 0; // deep night
    const a = st.villagers[0]!;
    const b = st.villagers[1]!;
    a.pos = { x: 8, z: 8 };
    a.state = 'idle';
    a.task = null;
    b.pos = { x: -8, z: -8 };
    b.state = 'idle';
    b.task = null;
    runUntil(
      st,
      () =>
        a.state === 'idle' &&
        b.state === 'idle' &&
        Math.hypot(a.pos.x, a.pos.z) < 2.8 &&
        Math.hypot(b.pos.x, b.pos.z) < 2.8,
      40_000,
      50,
    );
    expect(a.state).toBe('idle');
    expect(b.state).toBe('idle');
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThan(0.5);
  });

  it('never drifts by day', () => {
    const st = createInitialState();
    st.clock.dayMs = 240_000; // noon
    const v = st.villagers[0]!;
    v.pos = { x: 8, z: 8 };
    v.state = 'idle';
    v.task = null;
    runUntil(st, () => false, 30_000, 50); // 30 s sim
    expect(Math.hypot(v.pos.x - 8, v.pos.z - 8)).toBeLessThan(0.001);
  });

  it('an assignment mid-drift retargets in the same call', () => {
    const st = createInitialState();
    st.clock.dayMs = 0;
    const v = st.villagers[0]!;
    v.pos = { x: 8, z: 8 };
    v.state = 'idle';
    v.task = null;
    runUntil(st, () => v.state === 'walking', 5_000, 50); // drift started
    expect(v.task).toBeNull(); // a drifter has no task
    assignTask(st, v.id, 'chop');
    expect(v.task).toBe('chop'); // target switched immediately; walk continues to the tree
    expect(v.state).toBe('walking');
    expect(v.targetNodeId).not.toBeNull();
  });
});

describe('evening rest stretch', () => {
  it('rests committed at night run 1.5×; by day they are byte-identical', () => {
    // Plain fire rest, night: 4000 → 6000.
    const night = createInitialState();
    night.clock.dayMs = 0;
    const nv = night.villagers[0]!;
    assignTask(night, nv.id, 'rest');
    runUntil(night, () => nv.state === 'resting', 10_000, 50);
    expect(nv.restMs).toBe(6000);

    // Meal rest, night: 5500 → 8250.
    const nightMeal = createInitialState();
    nightMeal.clock.dayMs = 0;
    nightMeal.pot.meals = 1;
    nightMeal.fire.fuel = 70;
    const nm = nightMeal.villagers[0]!;
    assignTask(nightMeal, nm.id, 'rest');
    runUntil(nightMeal, () => nm.state === 'resting', 10_000, 50);
    expect(nm.restMs).toBe(8250);

    // Plain fire rest, noon: untouched.
    const day = createInitialState();
    day.clock.dayMs = 240_000;
    const dv = day.villagers[0]!;
    assignTask(day, dv.id, 'rest');
    runUntil(day, () => dv.state === 'resting', 10_000, 50);
    expect(dv.restMs).toBe(4000);

    // Meal rest, noon: untouched.
    const dayMeal = createInitialState();
    dayMeal.clock.dayMs = 240_000;
    dayMeal.pot.meals = 1;
    dayMeal.fire.fuel = 70;
    const dm = dayMeal.villagers[0]!;
    assignTask(dayMeal, dm.id, 'rest');
    runUntil(dayMeal, () => dm.state === 'resting', 10_000, 50);
    expect(dm.restMs).toBe(5500);
  });
});
