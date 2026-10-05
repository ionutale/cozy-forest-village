// Unit tests for the pure derivations (WD1). No DOM here on purpose: `derive.ts` imports only
// types and read-only constants from `../sim`, so it loads cleanly under vitest's `node`
// environment — that isolation is the reason these functions live in their own module.

import { describe, expect, it } from 'vitest';
import type { GameState, Villager } from '../sim';
import { GARDEN_PERIOD_MS } from '../sim';
import { DEFAULT_HINT, cardLabel, fireState, firstById, secondsToBerry, villageLine } from './derive';

function villager(id: string, over: Partial<Villager> = {}): Villager {
  return {
    id,
    name: id.toUpperCase(),
    hatColor: '#000000',
    task: null,
    state: 'idle',
    pos: { x: 0, z: 0 },
    facing: 0,
    progressMs: 0,
    restMs: 0,
    fedMs: 0,
    carrying: false,
    targetNodeId: null,
    ...over,
  };
}

function state(over: Partial<GameState> = {}): GameState {
  return {
    tick: 0,
    seed: 1,
    resources: { wood: 0, berries: 0 },
    villagers: [],
    nodes: [],
    structures: [],
    fire: { fuel: 70, max: 100 },
    pot: { meals: 0 },
    gardenMs: 0,
    events: [],
    pendingEvents: [],
    ...over,
  };
}

const COOKING = villager('v1', { state: 'working', task: 'cook' });
const FED = villager('v1', { fedMs: 30_000 });

describe('villageLine — priority order', () => {
  it('embers outranks everything else', () => {
    expect(
      villageLine(state({ fire: { fuel: 0, max: 100 }, pot: { meals: 4 }, villagers: [COOKING, FED] })),
    ).toBe('Only embers left — someone should tend the fire.');
  });

  it('dimming outranks cooking, food and meals', () => {
    expect(
      villageLine(state({ fire: { fuel: 20, max: 100 }, pot: { meals: 4 }, villagers: [COOKING, FED] })),
    ).toBe('The fire is dimming.');
  });

  it('cooking outranks well-fed and meals', () => {
    expect(villageLine(state({ pot: { meals: 4 }, villagers: [FED, COOKING] }))).toBe('V1 is cooking.');
  });

  it('well-fed outranks meals', () => {
    expect(villageLine(state({ pot: { meals: 4 }, villagers: [FED] }))).toBe('V1 is well-fed.');
  });

  it('meals outrank roaring', () => {
    expect(villageLine(state({ fire: { fuel: 100, max: 100 }, pot: { meals: 1 } }))).toBe(
      'Meals are ready for a rest.',
    );
  });

  it('roaring when nothing else applies', () => {
    expect(villageLine(state())).toBe('The fire is warm and bright.');
  });

  it('falls back to the default hint', () => {
    expect(villageLine(state({ fire: { fuel: 50, max: 100 } }))).toBe(DEFAULT_HINT);
  });

  it('picks the first matching villager by id, not array order', () => {
    const late = villager('v7', { state: 'working', task: 'cook' });
    const early = villager('v2', { state: 'working', task: 'cook' });
    expect(villageLine(state({ villagers: [late, early] }))).toBe('V2 is cooking.');
  });
});

describe('villageLine — fuel band boundaries', () => {
  it('33 is steady, not dimming', () => {
    expect(villageLine(state({ fire: { fuel: 33, max: 100 } }))).toBe(DEFAULT_HINT);
  });

  it('just under 33 is dimming', () => {
    expect(villageLine(state({ fire: { fuel: 32.9, max: 100 } }))).toBe('The fire is dimming.');
  });

  it('66 is roaring', () => {
    expect(villageLine(state({ fire: { fuel: 66, max: 100 } }))).toBe('The fire is warm and bright.');
  });

  it('honours a non-100 max', () => {
    // 32 of 80 is 40% — steady band, so not dimming and not roaring.
    expect(villageLine(state({ fire: { fuel: 32, max: 80 } }))).toBe(DEFAULT_HINT);
    expect(villageLine(state({ fire: { fuel: 8, max: 80 } }))).toBe('The fire is dimming.');
  });
});

describe('villageLine — bad input degrades, never throws', () => {
  it('NaN fuel falls through to the default hint', () => {
    expect(villageLine(state({ fire: { fuel: Number.NaN, max: 100 } }))).toBe(DEFAULT_HINT);
  });

  it('a zero max does not divide by zero — it reads as dimming', () => {
    // fuel 50 against a capacity of 0 is no fuel at all relative to the max, so the dimming
    // band is the honest answer. The point is that it is finite, not NaN.
    expect(villageLine(state({ fire: { fuel: 50, max: 0 } }))).toBe('The fire is dimming.');
  });

  it('negative fuel still reads as embers', () => {
    expect(villageLine(state({ fire: { fuel: -5, max: 100 } }))).toBe(
      'Only embers left — someone should tend the fire.',
    );
  });
});

describe('secondsToBerry', () => {
  it('reports the full period at zero', () => {
    expect(secondsToBerry(0)).toBe(GARDEN_PERIOD_MS / 1000);
  });

  it('rounds UP a sub-second remainder (ceil, not floor)', () => {
    expect(secondsToBerry(GARDEN_PERIOD_MS - 100)).toBe(1); // floor would say 0
    expect(secondsToBerry(GARDEN_PERIOD_MS - 1)).toBe(1);
    expect(secondsToBerry(GARDEN_PERIOD_MS - 999)).toBe(1);
  });

  it('rounds up at every whole-second boundary', () => {
    expect(secondsToBerry(0)).toBe(30);
    expect(secondsToBerry(999)).toBe(30);
    expect(secondsToBerry(1000)).toBe(29);
    expect(secondsToBerry(29_000)).toBe(1);
    expect(secondsToBerry(29_999)).toBe(1);
  });

  it('decreases monotonically across one period, then wraps', () => {
    // The sim's own accumulator wraps gardenMs at GARDEN_PERIOD_MS after each harvest, so the
    // countdown restarts. Walk a full period in 250 ms steps: never an increase, one wrap.
    let gardenMs = 0;
    let previous = secondsToBerry(gardenMs);
    let wraps = 0;
    for (let step = 0; step < GARDEN_PERIOD_MS / 250; step += 1) {
      gardenMs += 250;
      if (gardenMs >= GARDEN_PERIOD_MS) gardenMs -= GARDEN_PERIOD_MS; // the sim's wrap
      const now = secondsToBerry(gardenMs);
      if (now > previous) wraps += 1;
      expect(now).toBeLessThanOrEqual(GARDEN_PERIOD_MS / 1000);
      previous = now;
    }
    expect(wraps).toBe(1); // exactly one restart over the period
  });

  it('degrades to the full period on nonsense input, never beyond it', () => {
    // gardenMs is a modulo accumulator, so these are all outside its domain. They must not
    // read "31s" on a 30s cycle, nor "0s" when no berry is due.
    expect(secondsToBerry(-1000)).toBe(30);
    expect(secondsToBerry(GARDEN_PERIOD_MS + 5000)).toBe(30);
    expect(secondsToBerry(GARDEN_PERIOD_MS)).toBe(30);
    expect(secondsToBerry(Number.NaN)).toBe(30);
  });
});

describe('cardLabel', () => {
  it('reads the present, not the assignment', () => {
    expect(cardLabel(villager('v1', { state: 'walking', task: 'chop' }))).toBe('Walking…');
    expect(cardLabel(villager('v1', { state: 'resting', task: 'rest' }))).toBe('Resting');
    expect(cardLabel(villager('v1', { state: 'working', task: 'cook' }))).toBe('Cooking');
    expect(cardLabel(villager('v1', { state: 'working', task: 'tend' }))).toBe('Tending fire');
    expect(cardLabel(villager('v1'))).toBe('Idle');
  });

  it('a working villager with no task reads Idle, not undefined', () => {
    expect(cardLabel(villager('v1', { state: 'working', task: null }))).toBe('Idle');
  });
});

describe('fireState', () => {
  it('bands the same way villageLine does', () => {
    expect(fireState(0, 100)).toBe('embers');
    expect(fireState(1, 100)).toBe('dim');
    expect(fireState(33, 100)).toBe('steady');
    expect(fireState(66, 100)).toBe('roaring');
    expect(fireState(100, 100)).toBe('roaring');
  });
});

describe('firstById', () => {
  it('returns undefined with no match', () => {
    expect(firstById([villager('v1')], () => false)).toBeUndefined();
  });

  it('ignores array order', () => {
    const a = villager('v9');
    const b = villager('v3');
    expect(firstById([a, b], () => true)?.id).toBe('v3');
  });
});