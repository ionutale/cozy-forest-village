// K1 tests (batch 9, bonds): proximity growth, level thresholds, reunions, the
// work perk, and the fiction (evening seats). Binding numbers from DESIGN.md §3.2
// "Bonds"; spec docs/superpowers/specs/2026-10-06-bonds-design.md Parts 1 + 5.

import { describe, expect, it } from 'vitest';
import type { GameState } from './index';
import {
  BOND_RADIUS,
  BOND_RATE_PER_S,
  BOND_REUNION_GAP_MS,
  BOND_SCORE_MAX,
  DAY_MS,
  FRIEND_PERK_LEVEL,
  FRIEND_PERK_SCALE,
  bondLevelFor,
  bondPartners,
  createFavors,
  createInitialState,
  strongestBondLevel,
  tick,
} from './index';
import { pairIndex, stepBonds } from './bonds';
import { FED_WORK_PERIOD_MS } from './tasks';
import { tickFavors } from './favors';

/** Ticks the sim forward in fixed steps. */
function run(state: GameState, totalMs: number, stepMs: number): void {
  const steps = Math.round(totalMs / stepMs);
  for (let i = 0; i < steps; i += 1) tick(state, stepMs);
}

/** A fresh pair table (both arrays length 144, all zero). */
function zeroBonds(): GameState['bonds'] {
  return {
    scores: new Array<number>(144).fill(0),
    gapMs: new Array<number>(144).fill(0),
  };
}

/**
 * A controlled village: exactly the given number of villagers, placed at
 * `positions` (x, z), all idle, the clock parked mid-morning so the evening
 * drift is inert. No unrelated pair exists to muddy a measurement.
 */
function placed(positions: Array<[number, number]>): GameState {
  const state = createInitialState();
  state.villagers = state.villagers.slice(0, positions.length);
  state.favors.byVillager = state.favors.byVillager.slice(0, positions.length);
  state.bonds = zeroBonds();
  state.clock.dayMs = DAY_MS * 0.25;
  state.fire.fuel = 70;
  positions.forEach(([x, z], i) => {
    const v = state.villagers[i]!;
    v.pos = { x, z };
    v.state = 'idle';
    v.task = null;
    v.targetNodeId = null;
    v.progressMs = 0;
  });
  return state;
}

describe('bonds — growth', () => {
  it('accrues exactly BOND_RATE_PER_S inside the radius and zero outside', () => {
    const near = placed([
      [0, 0],
      [2.9, 0],
    ]);
    run(near, 10_000, 50);
    expect(near.bonds.scores[pairIndex(0, 1)]).toBeCloseTo(10, 9);
    expect(near.bonds.gapMs[pairIndex(0, 1)]).toBe(0);

    const far = placed([
      [0, 0],
      [3.1, 0],
    ]);
    run(far, 10_000, 50);
    expect(far.bonds.scores[pairIndex(0, 1)]).toBe(0);
    expect(far.bonds.gapMs[pairIndex(0, 1)]).toBeCloseTo(10_000, 9);
  });

  it('the radial boundary is inclusive at 3.0: 2.999 / 3.0 accrue, 3.001 does not', () => {
    const inside = placed([
      [0, 0],
      [2.999, 0],
    ]);
    tick(inside, 1000);
    expect(inside.bonds.scores[pairIndex(0, 1)]).toBeCloseTo(1, 9);

    // Exactly 3.0 is the boundary: `dx*dx + dz*dz <= reachSq` is inclusive.
    const boundary = placed([
      [0, 0],
      [3.0, 0],
    ]);
    tick(boundary, 1000);
    expect(boundary.bonds.scores[pairIndex(0, 1)]).toBeCloseTo(1, 9);

    const outside = placed([
      [0, 0],
      [3.001, 0],
    ]);
    tick(outside, 1000);
    expect(outside.bonds.scores[pairIndex(0, 1)]).toBe(0);
    expect(BOND_RADIUS).toBe(3.0);
    expect(BOND_RATE_PER_S).toBe(1);
  });

  it('caps a giant tick at BOND_SCORE_MAX instead of corrupting the table', () => {
    const state = placed([
      [0, 0],
      [2, 0],
    ]);
    // 200 000 s of closeness would be 200 000 score — the cap holds it at 100 000.
    tick(state, 200_000_000);
    expect(state.bonds.scores[pairIndex(0, 1)]).toBe(BOND_SCORE_MAX);
    expect(bondLevelFor(state, 'v1', 'v2')).toBe(3);
    // Exactly one level-up event even though the giant tick crossed all three.
    expect(state.events.filter((e) => e.type === 'bond-up')).toEqual([
      { type: 'bond-up', villagerId: 'v1', otherId: 'v2', bondLevel: 3 },
    ]);
  });
});

describe('bonds — levels', () => {
  it('maps the 119/120, 299/300, 719/720 thresholds exactly', () => {
    const state = placed([
      [0, 0],
      [10, 0], // far: no growth while probing
    ]);
    const idx = pairIndex(0, 1);
    const cases: Array<[number, number]> = [
      [0, 0],
      [119, 0],
      [120, 1],
      [299, 1],
      [300, 2],
      [719, 2],
      [720, 3],
      [721, 3],
    ];
    for (const [score, level] of cases) {
      state.bonds.scores[idx] = score;
      expect(bondLevelFor(state, 'v1', 'v2'), `score ${score}`).toBe(level);
    }
    // A self-pair and unknown ids are 0, never a false bond.
    expect(bondLevelFor(state, 'v1', 'v1')).toBe(0);
    expect(bondLevelFor(state, 'v1', 'ghost')).toBe(0);
  });

  it('never decays: a separated pair keeps its score forever', () => {
    const state = placed([
      [0, 0],
      [50, 0],
    ]);
    const idx = pairIndex(0, 1);
    state.bonds.scores[idx] = 500;
    run(state, 200_000, 1000);
    expect(state.bonds.scores[idx]).toBe(500);
    expect(bondLevelFor(state, 'v1', 'v2')).toBe(2);
  });

  it('bond-up fires exactly once per crossing, never while a level holds', () => {
    const state = placed([
      [0, 0],
      [2.0, 0],
    ]);
    const idx = pairIndex(0, 1);
    state.bonds.scores[idx] = 119;
    tick(state, 1000); // 119 → 120
    expect(state.events.filter((e) => e.type === 'bond-up')).toEqual([
      { type: 'bond-up', villagerId: 'v1', otherId: 'v2', bondLevel: 1 },
    ]);
    // Still near and still growing: no second event for the same level.
    tick(state, 1000);
    expect(state.events.filter((e) => e.type === 'bond-up')).toHaveLength(0);
    // Crossing 300 → exactly one level-2 event.
    state.bonds.scores[idx] = 299;
    tick(state, 1000);
    expect(state.events.filter((e) => e.type === 'bond-up')).toEqual([
      { type: 'bond-up', villagerId: 'v1', otherId: 'v2', bondLevel: 2 },
    ]);
  });
});

describe('bonds — reunions', () => {
  it('fires once after the gap, with the natural cooldown, and never on fresh contact', () => {
    const state = placed([
      [0, 0],
      [2.0, 0],
    ]);
    const idx = pairIndex(0, 1);
    // Fresh state: gap 0 → no phantom reunion on first contact.
    tick(state, 1000);
    expect(state.events.filter((e) => e.type === 'bond-reunion')).toHaveLength(0);

    // Apart for longer than the reunion gap.
    state.villagers[1]!.pos = { x: 50, z: 0 };
    run(state, BOND_REUNION_GAP_MS + 1000, 1000);
    expect(state.bonds.gapMs[idx]).toBeGreaterThan(BOND_REUNION_GAP_MS);

    // First contact → exactly one reunion, gap reset.
    state.villagers[1]!.pos = { x: 2.0, z: 0 };
    tick(state, 1000);
    expect(state.events.filter((e) => e.type === 'bond-reunion')).toEqual([
      { type: 'bond-reunion', villagerId: 'v1', otherId: 'v2' },
    ]);
    expect(state.bonds.gapMs[idx]).toBe(0);

    // Staying near never re-fires.
    tick(state, 1000);
    expect(state.events.filter((e) => e.type === 'bond-reunion')).toHaveLength(0);

    // Apart again past the gap, then near → one more.
    state.villagers[1]!.pos = { x: 50, z: 0 };
    run(state, BOND_REUNION_GAP_MS + 1000, 1000);
    state.villagers[1]!.pos = { x: 2.0, z: 0 };
    tick(state, 1000);
    expect(state.events.filter((e) => e.type === 'bond-reunion')).toHaveLength(1);
    expect(BOND_REUNION_GAP_MS).toBe(90_000);
  });

  it('a single giant tick emits exactly one reunion, never a burst', () => {
    const state = placed([
      [0, 0],
      [2.0, 0],
    ]);
    const idx = pairIndex(0, 1);
    // Apart long enough to arm the reunion.
    state.villagers[1]!.pos = { x: 50, z: 0 };
    run(state, BOND_REUNION_GAP_MS + 1000, 1000);
    expect(state.bonds.gapMs[idx]).toBeGreaterThan(BOND_REUNION_GAP_MS);

    // One enormous tick while near: the near branch runs once, so exactly one.
    state.villagers[1]!.pos = { x: 2.0, z: 0 };
    state.clock.dayMs = DAY_MS * 0.25; // keep the drift inert / the position final
    tick(state, 200_000);
    expect(state.events.filter((e) => e.type === 'bond-reunion')).toEqual([
      { type: 'bond-reunion', villagerId: 'v1', otherId: 'v2' },
    ]);
    expect(state.bonds.gapMs[idx]).toBe(0);

    // Another near tick → none.
    tick(state, 1000);
    expect(state.events.filter((e) => e.type === 'bond-reunion')).toHaveLength(0);
  });
});

describe('bonds — the work perk', () => {
  /** A working, well-fed chopper next to an idle partner at `dist`, pair score seeded. */
  function workingPair(partnerScore: number, partnerDist: number): GameState {
    const state = placed([
      [0, 0],
      [partnerDist, 0],
    ]);
    const v = state.villagers[0]!;
    v.state = 'working';
    v.task = 'chop';
    v.progressMs = 0;
    v.fedMs = 60_000;
    state.bonds.scores[pairIndex(0, 1)] = partnerScore;
    return state;
  }

  it('multiplies the well-fed period by ×0.9 (1190 → 1071) near a close friend', () => {
    const state = workingPair(FRIEND_PERK_LEVEL * 150, 2.0); // level 2, in radius
    expect(FRIEND_PERK_SCALE).toBe(0.9);
    const wood0 = state.resources.wood;
    tick(state, 1070);
    expect(state.resources.wood).toBe(wood0); // one ms short: no yield
    tick(state, 1);
    expect(state.resources.wood).toBe(wood0 + 1); // exactly at 1071
  });

  it('multiplies the base period too (1400 → 1260) when not well-fed', () => {
    const state = workingPair(300, 2.0);
    state.villagers[0]!.fedMs = 0;
    const wood0 = state.resources.wood;
    tick(state, 1259);
    expect(state.resources.wood).toBe(wood0);
    tick(state, 1);
    expect(state.resources.wood).toBe(wood0 + 1);
  });

  it('is unchanged when the partner is far, warming-only, or the worker is idle', () => {
    // Full strength but outside the radius: the base 1190 ms period stands.
    const far = workingPair(300, 3.5);
    const far0 = far.resources.wood;
    tick(far, 1189);
    expect(far.resources.wood).toBe(far0);
    tick(far, 1);
    expect(far.resources.wood).toBe(far0 + 1);

    // In radius but only warming (level 1): the perk needs level 2+.
    const warming = workingPair(120, 2.0);
    const warm0 = warming.resources.wood;
    tick(warming, 1189);
    expect(warming.resources.wood).toBe(warm0);
    tick(warming, 1);
    expect(warming.resources.wood).toBe(warm0 + 1);

    // Idle: the perk never applies to a non-worker.
    const idle = workingPair(300, 2.0);
    const idleV = idle.villagers[0]!;
    idleV.state = 'idle';
    idleV.task = null;
    idleV.progressMs = 0;
    tick(idle, 5000);
    expect(idle.resources.wood).toBe(0);
    expect(idleV.progressMs).toBe(0);
  });

  /**
   * I1: an *active* perk must leave every other timer alone. One village runs a
   * working close pair alongside a cook and a rester on live fire/clock; the
   * friend's distance is the only knob (1.5 u → perk on, 50 u → perk off).
   * Same seed, same ticks, everything but the perk's own outputs must match.
   */
  function perkScenario(friendDist: number): GameState {
    const state = placed([
      [0, 0], // v1 — the perk worker (chop)
      [friendDist, 0], // v2 — the close friend (idle)
      [-4, 0], // v3 — the cook
      [-6, 0], // v4 — the rester
    ]);
    state.resources.wood = 100;
    state.resources.berries = 100;
    const worker = state.villagers[0]!;
    const friend = state.villagers[1]!;
    const cook = state.villagers[2]!;
    const rester = state.villagers[3]!;
    worker.state = 'working';
    worker.task = 'chop';
    worker.progressMs = 0;
    friend.state = 'idle';
    friend.task = null;
    cook.state = 'working';
    cook.task = 'cook';
    cook.progressMs = 0;
    rester.state = 'resting';
    rester.task = 'rest';
    rester.progressMs = 0;
    rester.restMs = 100_000;
    // fedMs decay is on every villager; keep every belly well-fed for the run.
    worker.fedMs = 60_000;
    cook.fedMs = 60_000;
    rester.fedMs = 60_000;
    // v1 ⇄ v2 is the only bond: seeded at "close" (level 2).
    state.bonds.scores[pairIndex(0, 1)] = 300;
    return state;
  }

  /** Neutralize the perk's own outputs so the rest of the state must match. */
  function normalizedForPerk(state: GameState): unknown {
    const clone = JSON.parse(JSON.stringify(state)) as GameState;
    // The perk changes only the worker's accumulator and the wood its extra
    // chop yields bank.
    clone.villagers[0]!.progressMs = 0;
    clone.resources.wood = 0;
    // The friend's position is the control knob (it drives only the bonds
    // table, the mechanism under test — never a timer).
    clone.villagers[1]!.pos = { x: 0, z: 0 };
    clone.bonds = { scores: [], gapMs: [] };
    // Worker yields and bond transitions are the expected event-level deltas.
    clone.events = clone.events.filter(
      (e) =>
        !(
          (e.type === 'chop' && e.villagerId === 'v1') ||
          e.type === 'bond-up' ||
          e.type === 'bond-reunion'
        ),
    );
    return clone;
  }

  it('leaves every other timer byte-identical while the perk is active', () => {
    const on = perkScenario(1.5); // perk on
    const off = perkScenario(50); // perk off: the same friend, far away
    run(on, 9000, 50);
    run(off, 9000, 50);

    // The timers the review names, pinned explicitly.
    expect(on.clock.dayMs).toBe(off.clock.dayMs);
    expect(on.fire.fuel).toBe(off.fire.fuel);
    for (let i = 0; i < on.villagers.length; i += 1) {
      expect(on.villagers[i]!.fedMs, `fedMs ${i}`).toBe(off.villagers[i]!.fedMs);
    }
    // Cook channel + meal ledger.
    expect(on.villagers[2]!.progressMs).toBe(off.villagers[2]!.progressMs);
    expect(on.pot.meals).toBe(off.pot.meals);
    // Rest duration + rest accumulator.
    expect(on.villagers[3]!.restMs).toBe(off.villagers[3]!.restMs);
    expect(on.villagers[3]!.progressMs).toBe(off.villagers[3]!.progressMs);

    // Everything else — every villager field, every other timer — in one deep
    // compare; only the perk's own two outputs and the control knob differ.
    expect(normalizedForPerk(on)).toEqual(normalizedForPerk(off));

    // The perk's whole accounting delta: the worker landed exactly the extra
    // chops its shorter period allows, and banked exactly that much wood.
    const expectedSurplus =
      Math.floor(9000 / (FED_WORK_PERIOD_MS * FRIEND_PERK_SCALE)) -
      Math.floor(9000 / FED_WORK_PERIOD_MS);
    expect(expectedSurplus).toBeGreaterThan(0);
    expect(on.resources.wood - off.resources.wood).toBe(expectedSurplus);
  });
});

describe('bonds — determinism, newcomers, favor counting', () => {
  it('two identical runs are deep-equal (fixed dusk scenario)', () => {
    const scenario = (): GameState => {
      const state = placed([
        [0, 0],
        [2.0, 0],
        [-4, 2],
        [5, 3],
      ]);
      state.clock.dayMs = DAY_MS * 0.8; // dusk: the gathering drift runs
      run(state, 150_000, 250);
      return state;
    };
    expect(scenario()).toEqual(scenario());
  });

  it('newcomers start at zero with everyone and join in immediately', () => {
    const state = placed([
      [0, 0],
      [2.0, 0],
    ]);
    // Simulate a walk-in appended at index 2, seated between the founders.
    state.villagers.push({ ...state.villagers[0]!, id: 'v9', name: 'Lily', pos: { x: 1, z: 0 } });
    expect(state.bonds.scores[pairIndex(2, 0)]).toBe(0);
    expect(state.bonds.scores[pairIndex(2, 1)]).toBe(0);
    expect(bondLevelFor(state, 'v9', 'v1')).toBe(0);
    // Physically present → accrues from the first near tick.
    run(state, 1000, 1000);
    expect(state.bonds.scores[pairIndex(2, 0)]).toBeCloseTo(1, 9);
  });

  it('favor counting ignores the new bond events', () => {
    const state = placed([
      [0, 0],
      [2.0, 0],
    ]);
    state.favors = createFavors(2);
    state.favors.byVillager[0] = { step: 1, active: true, progress: 0 }; // gather 6
    state.events = [
      { type: 'bond-up', villagerId: 'v1', otherId: 'v2', bondLevel: 1 },
      { type: 'bond-reunion', villagerId: 'v1', otherId: 'v2' },
    ];
    tickFavors(state, 0);
    expect(state.favors.byVillager[0]).toEqual({ step: 1, active: true, progress: 0 });
  });

  it('helpers rank partners level desc, score desc, roster index asc', () => {
    const state = placed([
      [0, 0],
      [1, 0],
      [2, 0],
      [10, 0],
    ]);
    // v1: level 2 with v2, level 1 with v3, none with v4.
    state.bonds.scores[pairIndex(0, 1)] = 400;
    state.bonds.scores[pairIndex(0, 2)] = 150;
    expect(strongestBondLevel(state, 'v1')).toBe(2);
    expect(bondPartners(state, 'v1')).toEqual([
      { id: 'v2', name: 'Birch', level: 2 },
      { id: 'v3', name: 'Fern', level: 1 },
    ]);
    // Tie on level: score desc, then roster index asc.
    const tie = placed([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    tie.bonds.scores[pairIndex(0, 1)] = 200; // same level, lower score
    tie.bonds.scores[pairIndex(0, 2)] = 250; // same level, higher score
    expect(bondPartners(tie, 'v1').map((p) => p.id)).toEqual(['v3', 'v2']);
    // All-zero bonds yield nothing, and an unknown id is safe.
    expect(bondPartners(placed([[0, 0]]), 'v1')).toEqual([]);
    expect(strongestBondLevel(state, 'ghost')).toBe(0);
  });
});

describe('bonds — the fiction (evening seats)', () => {
  it('fast-forwarded evenings warm the neighbours gathered at the fire', () => {
    const state = createInitialState();
    state.clock.dayMs = DAY_MS * 0.8; // dusk: the gathering drift starts seating everyone
    run(state, 900_000, 1000);

    // At least one pair physically seated together is warming, and the strongest
    // bond in the village is at least "close" (level 2).
    let seatedPairs = 0;
    for (let i = 0; i < state.villagers.length; i += 1) {
      for (let j = i + 1; j < state.villagers.length; j += 1) {
        const a = state.villagers[i]!;
        const b = state.villagers[j]!;
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
        if (d <= BOND_RADIUS) {
          seatedPairs += 1;
          expect(
            bondLevelFor(state, a.id, b.id),
            `seated pair ${a.id}-${b.id}`,
          ).toBeGreaterThanOrEqual(1);
        }
      }
    }
    expect(seatedPairs).toBeGreaterThanOrEqual(1);

    const strongest = state.villagers.reduce(
      (max, v) => Math.max(max, strongestBondLevel(state, v.id)),
      0,
    );
    expect(strongest).toBeGreaterThanOrEqual(FRIEND_PERK_LEVEL);

    // The bonded villagers are the ones who gathered at the fire, not distant ones.
    const ring = state.villagers.filter((v) => strongestBondLevel(state, v.id) >= 1);
    expect(ring.length).toBeGreaterThanOrEqual(2);
    for (const v of ring) {
      expect(Math.hypot(v.pos.x, v.pos.z)).toBeLessThan(4);
    }
  });
});

// `stepBonds` is the sim's internal spender; a direct call must be a safe no-op
// outside the `dtMs > 0` region (tick guards it the same way).
describe('stepBonds guards', () => {
  it('ignores zero and non-finite dt', () => {
    const state = placed([
      [0, 0],
      [1, 0],
    ]);
    stepBonds(state, 0);
    stepBonds(state, Number.NaN);
    stepBonds(state, -1000);
    expect(state.bonds.scores[pairIndex(0, 1)]).toBe(0);
    expect(state.events).toHaveLength(0);
  });
});
