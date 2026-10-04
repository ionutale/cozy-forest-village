import { describe, expect, it } from 'vitest';
import type { GameState } from './index';
import { assignTask, createInitialState, tick } from './index';
import { restSpot, workSpot } from './tasks';

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
    // Expected steering target under the rest approach arc (DESIGN §3.1):
    // arc whenever the angular gap exceeds 0.25 rad, at any radius.
    const spot = restSpot({ x: 0, z: 0 }, 0); // v1 is villagers[0]
    const angCur = Math.atan2(before.z, before.x);
    const angSpot = Math.atan2(spot.z, spot.x);
    let dAng = (angSpot - angCur) % (Math.PI * 2);
    if (dAng > Math.PI) dAng -= Math.PI * 2;
    if (dAng < -Math.PI) dAng += Math.PI * 2;
    const aimed =
      Math.abs(dAng) > 0.25
        ? { x: Math.cos(angCur + dAng / 2) * 2.2, z: Math.sin(angCur + dAng / 2) * 2.2 }
        : spot;
    expect(v.facing).toBeCloseTo(Math.atan2(aimed.x - before.x, aimed.z - before.z), 12);
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
    // Park 0.68 from v1's work slot (not the node): one 100 ms step (0.22)
    // leaves 0.46 > 0.45, a second leaves 0.24. Pick a tree whose slot keeps
    // it the nearest tree from the parking spot.
    const trees = state.nodes.filter((n) => n.kind === 'tree');
    let parked = false;
    for (const tree of trees) {
      const slot = workSpot(tree.pos, 0); // v is villagers[0]
      const cx = slot.x + 0.68;
      const cz = slot.z;
      let bestId: string | null = null;
      let bestDistSq = Infinity;
      for (const n of trees) {
        const distSq = (n.pos.x - cx) ** 2 + (n.pos.z - cz) ** 2;
        if (distSq < bestDistSq) {
          bestId = n.id;
          bestDistSq = distSq;
        }
      }
      if (bestId === tree.id) {
        v.pos.x = cx;
        v.pos.z = cz;
        parked = true;
        break;
      }
    }
    if (!parked) throw new Error('no suitable tree for the arrival-boundary setup');
    assignTask(state, v.id, 'chop');
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

describe('work slots', () => {
  it('all 8 villagers on chop settle without stacking (pairwise ≥ 0.45)', () => {
    const state = createInitialState();
    for (const v of state.villagers) assignTask(state, v.id, 'chop');
    runUntil(
      state,
      () => state.villagers.every((v) => v.state === 'working'),
      60_000,
      100,
    );
    expect(state.villagers.every((v) => v.state === 'working')).toBe(true);
    // Villager bodies are ~0.34 u wide, so pairwise > 0.45 means no visual
    // clipping even in the geometric worst case (slot ring r = 0.75 combined
    // with up to 0.45 of arrival slop around each slot).
    for (let i = 0; i < state.villagers.length; i += 1) {
      for (let j = i + 1; j < state.villagers.length; j += 1) {
        const a = state.villagers[i]!;
        const b = state.villagers[j]!;
        expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThanOrEqual(0.45);
      }
    }
  });
});

describe('rest approach arc', () => {
  it('each villager walks to rest without crossing the flames (min > 1.0)', () => {
    for (let i = 0; i < 8; i += 1) {
      const state = createInitialState();
      const v = state.villagers[i]!;
      assignTask(state, v.id, 'rest');
      let minDist = Math.hypot(v.pos.x, v.pos.z); // campfire is at the origin
      const maxSteps = Math.round(60_000 / 50);
      for (let s = 0; s < maxSteps; s += 1) {
        tick(state, 50);
        const d = Math.hypot(v.pos.x, v.pos.z);
        if (d < minDist) minDist = d;
        if (v.state === 'resting') break;
      }
      expect(v.state).toBe('resting');
      expect(minDist).toBeGreaterThan(1.0);
    }
  });
});

describe('tick robustness', () => {
  it('tick(state, Infinity) returns promptly, advances the counter, changes nothing else', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'chop');
    run(state, 2000, 100);
    const before = JSON.parse(JSON.stringify(state)) as GameState;
    tick(state, Infinity);
    expect(state.tick).toBe(before.tick + 1);
    expect(state.events).toEqual([]); // cleared at the start of the tick
    expect(state.seed).toBe(before.seed);
    expect(state.resources).toEqual(before.resources);
    expect(state.nodes).toEqual(before.nodes);
    expect(state.villagers).toEqual(before.villagers);
    for (const u of state.villagers) {
      expect(Number.isFinite(u.pos.x)).toBe(true);
      expect(Number.isFinite(u.pos.z)).toBe(true);
      expect(Number.isFinite(u.facing)).toBe(true);
      expect(Number.isFinite(u.progressMs)).toBe(true);
    }
  });
});

describe('same-task reassignment', () => {
  it('is a no-op while working: keeps progressMs, emits no arrived event', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    assignTask(state, v.id, 'chop');
    runUntil(state, () => v.state === 'working', 10_000, 100);
    run(state, 700, 100); // mid-work: progressMs = 700, no yield yet
    expect(v.progressMs).toBe(700);
    assignTask(state, v.id, 'chop'); // same task, same target → no-op
    expect(v.progressMs).toBe(700);
    expect(v.state).toBe('working');
    tick(state, 100);
    expect(state.events).not.toContainEqual({ type: 'arrived', villagerId: v.id });
    expect(v.progressMs).toBe(800);
  });

  it('null on an idle villager is a no-op', () => {
    const state = createInitialState();
    const v = state.villagers[0]!;
    const before = JSON.parse(JSON.stringify(state)) as GameState;
    assignTask(state, v.id, null);
    expect(state).toEqual(before);
  });
});
