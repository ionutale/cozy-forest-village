// WD3 tests: obstacle-aware walking around tree trunks (DESIGN.md §3.2).
// Trunks are the only obstacles; bushes stay walkable-adjacent. Binding bar:
// a walker never comes within TRUNK_RADIUS + 0.15 of a non-target trunk centre.

import { describe, expect, it } from 'vitest';
import type { GameState } from './index';
import { assignTask, createInitialState, tick } from './index';
import { TRUNK_RADIUS, workSpot } from './tasks';

/** Keep-out bar: trunk surface (0.42) + 0.15 margin. */
const KEEP_OUT = TRUNK_RADIUS + 0.15; // 0.57

/** Shortest distance from `point` to the segment `from → to` (test oracle). */
function segDist(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

interface Crossing {
  targetId: string;
  start: { x: number; z: number };
}

/**
 * Deterministic head-on setups on the default seed: a target tree T, a
 * blocker trunk U dead on the chord, and a start P four units past U — so the
 * straight walk would pass through U's trunk and only the detour keeps it out.
 */
function findCrossings(count: number): Crossing[] {
  const probe = createInitialState(1);
  const trees = probe.nodes.filter((n) => n.kind === 'tree');
  const out: Crossing[] = [];
  for (const T of trees) {
    const slot = workSpot(T.pos, 0); // villagers[0]
    for (const U of trees) {
      if (U.id === T.id) continue;
      const dx = U.pos.x - T.pos.x;
      const dz = U.pos.z - T.pos.z;
      const len = Math.hypot(dx, dz);
      const px = U.pos.x + (dx / len) * 4;
      const pz = U.pos.z + (dz / len) * 4;
      if (Math.hypot(px, pz) > 26) continue; // keep the start inside the world
      let clear = true;
      for (const V of trees) {
        if (V.id === T.id || V.id === U.id) continue;
        if (Math.hypot(V.pos.x - px, V.pos.z - pz) < 1.5) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      if (segDist(U.pos.x, U.pos.z, px, pz, slot.x, slot.z) >= 0.2) continue;
      out.push({ targetId: T.id, start: { x: px, z: pz } });
      if (out.length >= count) return out;
    }
  }
  return out;
}

/** Walks villagers[0] from `start` to `targetId`, returning the trace + closest approach. */
function walkTrace(state: GameState, start: { x: number; z: number }, targetId: string): {
  trace: Array<{ x: number; z: number }>;
  minNonTarget: number;
  arrived: boolean;
} {
  const v = state.villagers[0]!;
  v.pos.x = start.x;
  v.pos.z = start.z;
  v.task = 'chop';
  v.targetNodeId = targetId;
  v.state = 'walking';
  v.progressMs = 0;
  const trace: Array<{ x: number; z: number }> = [{ x: v.pos.x, z: v.pos.z }];
  let minNonTarget = Infinity;
  for (let k = 0; k < 2000; k += 1) {
    tick(state, 50);
    trace.push({ x: v.pos.x, z: v.pos.z });
    for (const n of state.nodes) {
      if (n.kind !== 'tree' || n.id === targetId) continue;
      const d = Math.hypot(n.pos.x - v.pos.x, n.pos.z - v.pos.z);
      if (d < minNonTarget) minNonTarget = d;
    }
    if (state.villagers[0]!.state === 'working') break;
  }
  return { trace, minNonTarget, arrived: state.villagers[0]!.state === 'working' };
}

describe('trunk avoidance', () => {
  it('forest crossings never come within trunkR + 0.15 of a non-target trunk', () => {
    const crossings = findCrossings(4);
    // The suite must actually exercise the detour — fail loudly if the world
    // stops yielding head-on geometry (rather than passing vacuously).
    expect(crossings.length).toBe(4);
    for (const c of crossings) {
      const { minNonTarget, arrived } = walkTrace(createInitialState(1), c.start, c.targetId);
      expect(arrived).toBe(true);
      expect(minNonTarget).toBeGreaterThanOrEqual(KEEP_OUT);
    }
  });

  it('detour walks are deterministic: same seed → identical position traces', () => {
    const crossings = findCrossings(1);
    expect(crossings.length).toBe(1);
    const first = crossings[0]!;
    const a = walkTrace(createInitialState(1), first.start, first.targetId);
    const b = walkTrace(createInitialState(1), first.start, first.targetId);
    expect(a.arrived).toBe(true);
    expect(a.trace).toEqual(b.trace);
  });
});

describe('walk determinism', () => {
  it('same seed → identical positions over N ticks, run twice', () => {
    const script = (s: GameState): Array<Array<{ x: number; z: number }>> => {
      assignTask(s, 'v1', 'chop');
      assignTask(s, 'v2', 'berries');
      assignTask(s, 'v3', 'rest');
      assignTask(s, 'v4', 'tend');
      const snaps: Array<Array<{ x: number; z: number }>> = [];
      for (let k = 0; k < 200; k += 1) {
        tick(s, 50);
        snaps.push(s.villagers.map((v) => ({ x: v.pos.x, z: v.pos.z })));
      }
      return snaps;
    };
    expect(script(createInitialState(3))).toEqual(script(createInitialState(3)));
  });
});
