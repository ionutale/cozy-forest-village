// H1 tests: hut plots, arrival scheduling/firing, the newcomer cast, and the
// 'arriving' walker. Binding numbers from DESIGN.md §3.2 (batch 6).

import { describe, expect, it } from 'vitest';
import type { GameState } from './index';
import {
  HUT_PLOTS,
  HUT_SETTLE_MS,
  NEWCOMER_CAST,
  VILLAGE_CAP,
  assignTask,
  buildStructure,
  createInitialState,
  tick,
} from './index';
import { EDGE_SPAWN, TRUNK_RADIUS, structureSpot } from './tasks';

/** Ticks the sim forward in fixed steps. */
function run(state: GameState, totalMs: number, stepMs: number): void {
  const steps = Math.round(totalMs / stepMs);
  for (let i = 0; i < steps; i += 1) tick(state, stepMs);
}

/** A state with enough resources to build any hut (30 wood + 10 berries). */
function richState(): GameState {
  const state = createInitialState();
  state.resources.wood = 100;
  state.resources.berries = 100;
  return state;
}

describe('hut plots & initial shape', () => {
  it('starts with four unbuilt hut plots and an empty arrivals queue', () => {
    const state = createInitialState();
    expect(state.arrivals).toEqual([]);
    const huts = state.structures.filter((s) => s.kind === 'hut');
    expect(huts.map((s) => s.id)).toEqual(['hut-1', 'hut-2', 'hut-3', 'hut-4']);
    expect(huts.every((s) => !s.built)).toBe(true);
    for (const h of huts) {
      expect(Math.hypot(h.pos.x, h.pos.z)).toBeCloseTo(7.6, 10);
    }
    expect(HUT_PLOTS.map((p) => p.id)).toEqual(['hut-1', 'hut-2', 'hut-3', 'hut-4']);
    expect(HUT_SETTLE_MS).toBe(90_000);
    expect(VILLAGE_CAP).toBe(12);
    expect(NEWCOMER_CAST.map((c) => c.name)).toEqual(['Lily', 'Rowan', 'Sage', 'Wren']);
  });
});

describe('arrival scheduling', () => {
  it('a built hut schedules one arrival with frozen castIndex and a 90 s settle', () => {
    const state = richState();
    expect(buildStructure(state, 'hut-1')).toBe(true);
    expect(state.arrivals).toEqual([{ structureId: 'hut-1', inMs: 90_000, castIndex: 0 }]);
  });

  it('two huts completed in one tick get indexes 0 and 1 in completion order', () => {
    const state = richState();
    expect(buildStructure(state, 'hut-2')).toBe(true);
    expect(buildStructure(state, 'hut-1')).toBe(true);
    expect(state.arrivals.map((a) => [a.structureId, a.castIndex])).toEqual([
      ['hut-2', 0],
      ['hut-1', 1],
    ]);
  });
});

describe('arrival firing', () => {
  it('the countdown floors at 0; at 0 the newcomer appends with cast row + favor record', () => {
    const state = richState();
    expect(buildStructure(state, 'hut-1')).toBe(true);
    // Shrink the countdown, then a small tick floors it and fires exactly once —
    // too small a step to walk anywhere, so the newcomer is still at the edge.
    state.arrivals[0]!.inMs = 100;
    tick(state, 100);
    expect(state.arrivals).toEqual([]);
    expect(state.villagers).toHaveLength(9);

    const v = state.villagers[8]!;
    expect(v.id).toBe('v9');
    expect(v.name).toBe('Lily');
    expect(v.hatColor).toBe('#e3b7c4');
    expect(v.state).toBe('arriving');
    expect(v.task).toBeNull();
    // Appended at the edge, then walked a single 0.22 step toward the hut.
    expect(Math.hypot(v.pos.x - EDGE_SPAWN.x, v.pos.z - EDGE_SPAWN.z)).toBeLessThanOrEqual(0.25);
    expect(v.targetNodeId).toBe('hut-1');
    // Array lockstep: the favor record appends in the same tick.
    expect(state.favors.byVillager).toHaveLength(9);
    expect(state.favors.byVillager[8]).toEqual({ step: 0, active: false, progress: 0 });
  });

  it('a 90 s tick stream fires at the end, not before', () => {
    const state = richState();
    expect(buildStructure(state, 'hut-3')).toBe(true);
    run(state, 89_000, 1000);
    expect(state.villagers).toHaveLength(8);
    expect(state.arrivals).toHaveLength(1);
    run(state, 1000, 1000);
    expect(state.villagers).toHaveLength(9);
    expect(state.arrivals).toEqual([]);
  });
});

describe('arriving walker', () => {
  /** Builds hut-3 and fast-forwards to the walk-in (v9 Lily, target hut-3). */
  function walkIn(): GameState {
    const state = richState();
    expect(buildStructure(state, 'hut-3')).toBe(true);
    state.arrivals[0]!.inMs = 0;
    tick(state, 50);
    expect(state.villagers).toHaveLength(9);
    return state;
  }

  it('assignTask is a no-op while arriving (every task, including null)', () => {
    const state = walkIn();
    const v = state.villagers[8]!;
    expect(v.state).toBe('arriving');
    for (const task of ['chop', 'berries', 'rest', 'tend', 'cook', null] as const) {
      assignTask(state, v.id, task);
      expect(v.task, String(task)).toBeNull();
      expect(v.state, String(task)).toBe('arriving');
      expect(v.targetNodeId, String(task)).toBe('hut-3');
    }
  });

  it('reaches the hut slot and idles; trunks avoided and the fire arc holds', () => {
    const state = walkIn();
    const v = state.villagers[8]!;
    let minTrunk = Infinity;
    let minFire = Infinity;
    const maxSteps = Math.round(120_000 / 50);
    for (let s = 0; s < maxSteps; s += 1) {
      tick(state, 50);
      for (const n of state.nodes) {
        if (n.kind !== 'tree') continue; // every trunk is non-target (target is a hut)
        const d = Math.hypot(n.pos.x - v.pos.x, n.pos.z - v.pos.z);
        if (d < minTrunk) minTrunk = d;
      }
      const f = Math.hypot(v.pos.x, v.pos.z); // campfire is at the origin
      if (f < minFire) minFire = f;
      if (v.state === 'idle') break;
    }
    expect(v.state).toBe('idle');
    expect(v.task).toBeNull();
    const hut = state.structures.find((x) => x.id === 'hut-3')!;
    const slot = structureSpot(hut.pos, 8); // v9 is villagers[8]
    expect(Math.hypot(v.pos.x - slot.x, v.pos.z - slot.z)).toBeLessThanOrEqual(0.02);
    expect(minTrunk).toBeGreaterThanOrEqual(TRUNK_RADIUS + 0.15);
    expect(minFire).toBeGreaterThan(1.0);
  });
});

describe('second hut & defensive cap', () => {
  it('a second hut schedules independently; Rowan walks to hut-2', () => {
    const state = richState();
    expect(buildStructure(state, 'hut-1')).toBe(true);
    state.arrivals[0]!.inMs = 0;
    tick(state, 50);
    expect(state.villagers[8]!.name).toBe('Lily');

    expect(buildStructure(state, 'hut-2')).toBe(true);
    // castIndex = (villagers.length − 8) + arrivals.length = 1 + 0.
    expect(state.arrivals).toEqual([{ structureId: 'hut-2', inMs: 90_000, castIndex: 1 }]);
    state.arrivals[0]!.inMs = 0;
    tick(state, 50);
    const w = state.villagers[9]!;
    expect(w.id).toBe('v10');
    expect(w.name).toBe('Rowan');
    expect(w.hatColor).toBe('#b03a3a');
    expect(w.state).toBe('arriving');
    expect(w.targetNodeId).toBe('hut-2');
    expect(state.favors.byVillager).toHaveLength(10);
  });

  it('a pending arrival drops safely at the 12-villager cap', () => {
    const state = richState();
    const template = state.villagers[0]!;
    while (state.villagers.length < 12) {
      const i = state.villagers.length;
      state.villagers.push({ ...template, id: `v${i + 1}`, pos: { ...template.pos } });
    }
    state.arrivals.push({ structureId: 'hut-1', inMs: 0, castIndex: 3 });
    tick(state, 50);
    expect(state.arrivals).toEqual([]);
    expect(state.villagers).toHaveLength(12); // no v13, no crash, favor board untouched
    expect(state.favors.byVillager).toHaveLength(8);
  });
});
