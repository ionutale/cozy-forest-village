// Unit tests for the pure derivations (WD1). No DOM here on purpose: `derive.ts` imports only
// types, read-only constants, and side-effect-free sim functions from `../sim`, so it loads
// cleanly under vitest's `node` environment — that isolation is the reason these functions live
// in their own module.

import { describe, expect, it } from 'vitest';
import type { FavorProgress, FavorWant, GameState, SimEvent, Villager } from '../sim';
import { GARDEN_PERIOD_MS, favorWantFor } from '../sim';
import {
  DEFAULT_HINT,
  THANK_YOU_MS,
  cardLabel,
  favorLine,
  favorPopoverLine,
  favorProgressText,
  favorText,
  fireState,
  firstById,
  firstFavorDoneVillagerId,
  hintRecomputeDue,
  secondsToBerry,
  villageLine,
} from './derive';

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

/** Batch 4: a `FavorsState` from per-slot overrides; omitted slots read as fresh. */
function favors(entries: Array<Partial<FavorProgress>> = [], nextOfferMs = 0): GameState['favors'] {
  return {
    byVillager: entries.map((entry) => ({ step: 0, active: false, progress: 0, ...entry })),
    nextOfferMs,
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
    favors: favors(),
    ...over,
  };
}

const COOKING = villager('v1', { state: 'working', task: 'cook' });
const FED = villager('v1', { fedMs: 30_000 });

describe('villageLine — priority order', () => {
  it('embers outrank everything else', () => {
    expect(
      villageLine(state({ fire: { fuel: 0, max: 100 }, pot: { meals: 4 }, villagers: [COOKING, FED] }), null),
    ).toBe('Only embers left — someone should tend the fire.');
  });

  it('dimming outranks cooking, food and meals', () => {
    expect(
      villageLine(state({ fire: { fuel: 20, max: 100 }, pot: { meals: 4 }, villagers: [COOKING, FED] }), null),
    ).toBe('The fire is dimming.');
  });

  it('cooking outranks well-fed and meals', () => {
    expect(villageLine(state({ pot: { meals: 4 }, villagers: [FED, COOKING] }), null)).toBe('V1 is cooking.');
  });

  it('well-fed outranks meals', () => {
    expect(villageLine(state({ pot: { meals: 4 }, villagers: [FED] }), null)).toBe('V1 is well-fed.');
  });

  it('meals outrank roaring', () => {
    expect(villageLine(state({ fire: { fuel: 100, max: 100 }, pot: { meals: 1 } }), null)).toBe(
      'Meals are ready for a rest.',
    );
  });

  it('roaring when nothing else applies', () => {
    expect(villageLine(state(), null)).toBe('The fire is warm and bright.');
  });

  it('falls back to the default hint', () => {
    expect(villageLine(state({ fire: { fuel: 50, max: 100 } }), null)).toBe(DEFAULT_HINT);
  });

  it('picks the first matching villager by id, not array order', () => {
    const late = villager('v7', { state: 'working', task: 'cook' });
    const early = villager('v2', { state: 'working', task: 'cook' });
    expect(villageLine(state({ villagers: [late, early] }), null)).toBe('V2 is cooking.');
  });
});

describe('villageLine — favor priority slot', () => {
  it('embers outrank an active favor', () => {
    expect(
      villageLine(
        state({ fire: { fuel: 0, max: 100 }, villagers: [villager('v1')], favors: favors([{ active: true }]) }),
        null,
      ),
    ).toBe('Only embers left — someone should tend the fire.');
  });

  it('an active favor outranks dimming, cooking, food, meals and roaring', () => {
    const over: Partial<GameState> = {
      fire: { fuel: 20, max: 100 },
      pot: { meals: 4 },
      villagers: [FED, COOKING],
      favors: favors([{ active: false }, { active: true }]),
    };
    expect(villageLine(state(over), null)).toBe('V1 would love a warm meal (0/1).');
  });

  it('no active favor → the old lines are untouched', () => {
    expect(
      villageLine(state({ fire: { fuel: 20, max: 100 }, favors: favors([{ active: false }]) }), null),
    ).toBe('The fire is dimming.');
  });

  it('a favor stuck on a retired step degrades to the next line', () => {
    expect(
      villageLine(state({ fire: { fuel: 20, max: 100 }, villagers: [villager('v1')], favors: favors([{ step: 3, active: true }]) }), null),
    ).toBe('The fire is dimming.');
  });
});

describe('villageLine — the favor line', () => {
  it('step 1 reads a warm meal, with its count progress', () => {
    expect(
      villageLine(state({ villagers: [villager('v1')], favors: favors([{ active: true, progress: 0 }]) }), null),
    ).toBe('V1 would love a warm meal (0/1).');
  });

  it('step 2 follows the villager index: even gathers', () => {
    expect(
      villageLine(
        state({ villagers: [villager('v1')], favors: favors([{ step: 1, active: true, progress: 3 }]) }),
        null,
      ),
    ).toBe('V1 would love berries for the village (3/6).');
  });

  it('step 2 follows the villager index: odd chops', () => {
    expect(
      villageLine(
        state({
          villagers: [villager('v1'), villager('v2')],
          favors: favors([{ active: false }, { step: 1, active: true, progress: 2 }]),
        }),
        null,
      ),
    ).toBe('V2 would love firewood for the village (2/4).');
  });

  it('step 3 variant 0 is a feast for the village', () => {
    expect(
      villageLine(
        state({ villagers: [villager('v1')], favors: favors([{ step: 2, active: true, progress: 1 }]) }),
        null,
      ),
    ).toBe('V1 would love a feast for the village (1/3).');
  });

  it('step 3 variant 1 is something new built', () => {
    expect(
      villageLine(
        state({
          villagers: [villager('v1'), villager('v2')],
          favors: favors([{}, { step: 2, active: true, progress: 0 }]),
        }),
        null,
      ),
    ).toBe('V2 would love something new built (0/1).');
  });

  it('step 3 variant 2 is the fire, timed in m:ss', () => {
    expect(
      villageLine(
        state({
          villagers: [villager('v1'), villager('v2'), villager('v3')],
          favors: favors([{}, {}, { step: 2, active: true, progress: 72_000 }]),
        }),
        null,
      ),
    ).toBe('V3 would love the fire kept warm for two minutes (1:12/2:00).');
  });

  it('with two active favors the line follows villager id, not array order', () => {
    expect(
      villageLine(
        state({
          villagers: [villager('v7'), villager('v2')],
          favors: favors([{ active: true }, { active: true }]),
        }),
        null,
      ),
    ).toBe('V2 would love a warm meal (0/1).');
  });

  it('favorLine is null with nobody asking or no favor data at all', () => {
    expect(favorLine(state({ villagers: [villager('v1')], favors: favors([{ active: false }]) }))).toBeNull();
    expect(favorLine(state({ villagers: [villager('v1')] }))).toBeNull();
    expect(favorLine(state())).toBeNull();
  });

  it('favorPopoverLine renders the Favor: line, null for anyone else', () => {
    const s = state({ villagers: [villager('v1')], favors: favors([{ step: 1, active: true, progress: 3 }]) });
    expect(favorPopoverLine(s, 0)).toBe('Favor: berries for the village (3/6)');
    expect(favorPopoverLine(s, 1)).toBeNull();
    expect(favorPopoverLine(state(), 0)).toBeNull();
  });
});

describe('villageLine — thank-you window', () => {
  it('renders "{name} is delighted!" in the favor slot', () => {
    expect(villageLine(state(), 'Fern')).toBe('Fern is delighted!');
  });

  it('replaces the favor line — thanks and would-love never render together', () => {
    const line = villageLine(
      state({ villagers: [villager('v1', { name: 'Fern' })], favors: favors([{ active: true }]) }),
      'Fern',
    );
    expect(line).toBe('Fern is delighted!');
    expect(line).not.toContain('would love');
  });

  it('sits at the same priority: above dimming, below embers', () => {
    expect(villageLine(state({ fire: { fuel: 20, max: 100 } }), 'Fern')).toBe('Fern is delighted!');
    expect(villageLine(state({ fire: { fuel: 0, max: 100 } }), 'Fern')).toBe(
      'Only embers left — someone should tend the fire.',
    );
  });

  it('two favors active: thanks wins for the completion, the other line returns after', () => {
    const s = state({
      villagers: [villager('v1'), villager('v7')],
      favors: favors([{ active: true }, { active: true }]),
    });
    expect(villageLine(s, 'V7')).toBe('V7 is delighted!');
    expect(villageLine(s, null)).toBe('V1 would love a warm meal (0/1).');
  });

  it('THANK_YOU_MS is the binding 6 s window', () => {
    expect(THANK_YOU_MS).toBe(6000);
  });
});

describe('firstFavorDoneVillagerId — first completion wins (M1)', () => {
  const done = (villagerId?: string): SimEvent =>
    villagerId === undefined ? { type: 'favor-done' } : { type: 'favor-done', villagerId };

  it('two favor-done events in one batch → the first id, by array order', () => {
    expect(firstFavorDoneVillagerId([done('v1'), done('v7')])).toBe('v1');
    expect(firstFavorDoneVillagerId([done('v7'), done('v1')])).toBe('v7');
  });

  it('no favor-done event → null, other event types are skipped', () => {
    expect(firstFavorDoneVillagerId([])).toBeNull();
    expect(firstFavorDoneVillagerId([{ type: 'eat', villagerId: 'v1' }, { type: 'chop' }])).toBeNull();
  });

  it('skips an id-less favor-done rather than dropping the window entirely', () => {
    expect(firstFavorDoneVillagerId([done(), done('v3')])).toBe('v3');
  });
});

describe('hintRecomputeDue — cadence + thanks-window edges (M6)', () => {
  it('recomputes immediately when the thanks window opens', () => {
    expect(hintRecomputeDue(1000, 9000, null, 'Fern')).toBe(true);
  });

  it('recomputes immediately when the thanks window closes', () => {
    expect(hintRecomputeDue(7000, 9000, 'Fern', null)).toBe(true);
  });

  it('recomputes immediately on a same-frame window swap', () => {
    expect(hintRecomputeDue(1000, 9000, 'Fern', 'Juniper')).toBe(true);
  });

  it('with no edge, waits for the cadence: false early, true once due', () => {
    expect(hintRecomputeDue(1000, 9000, null, null)).toBe(false);
    expect(hintRecomputeDue(8999, 9000, 'Fern', 'Fern')).toBe(false);
    expect(hintRecomputeDue(9000, 9000, null, null)).toBe(true);
  });
});

describe('favorText — UI-owned flavor copy', () => {
  it('maps every want kind (and eat requester) to its DESIGN §3.2 phrase', () => {
    expect(favorText({ kind: 'eat', who: 'self', count: 1 })).toBe('a warm meal');
    expect(favorText({ kind: 'eat', who: 'any', count: 3 })).toBe('a feast for the village');
    expect(favorText({ kind: 'gather', count: 6 })).toBe('berries for the village');
    expect(favorText({ kind: 'chop', count: 4 })).toBe('firewood for the village');
    expect(favorText({ kind: 'build', count: 1 })).toBe('something new built');
    expect(favorText({ kind: 'fire', ms: 120_000 })).toBe('the fire kept warm for two minutes');
  });
});

describe('favorProgressText', () => {
  const gather: FavorWant = { kind: 'gather', count: 6 };
  const fire: FavorWant = { kind: 'fire', ms: 120_000 };

  it('formats counts as consumed/total', () => {
    expect(favorProgressText(gather, 3)).toBe('(3/6)');
    expect(favorProgressText({ kind: 'eat', who: 'self', count: 1 }, 0)).toBe('(0/1)');
  });

  it('formats fire as m:ss/m:ss', () => {
    expect(favorProgressText(fire, 0)).toBe('(0:00/2:00)');
    expect(favorProgressText(fire, 72_000)).toBe('(1:12/2:00)');
    expect(favorProgressText(fire, 119_999)).toBe('(1:59/2:00)');
  });

  it('clamps and floors nonsense, never NaN or over-target', () => {
    expect(favorProgressText(gather, 10)).toBe('(6/6)');
    expect(favorProgressText(gather, -3)).toBe('(0/6)');
    expect(favorProgressText(gather, Number.NaN)).toBe('(0/6)');
    expect(favorProgressText(fire, Number.NaN)).toBe('(0:00/2:00)');
    expect(favorProgressText(fire, 999_999)).toBe('(2:00/2:00)');
  });
});

describe('favorWantFor — the sim chain content, imported from the public surface', () => {
  it('returns the DESIGN §3.2 content for steps 0–2 (0-based, the sim contract)', () => {
    expect(favorWantFor(0, 0)).toEqual({ kind: 'eat', who: 'self', count: 1 });
    expect(favorWantFor(1, 0)).toEqual({ kind: 'eat', who: 'self', count: 1 });
    expect(favorWantFor(0, 1)).toEqual({ kind: 'gather', count: 6 });
    expect(favorWantFor(1, 1)).toEqual({ kind: 'chop', count: 4 });
    expect(favorWantFor(0, 2)).toEqual({ kind: 'eat', who: 'any', count: 3 });
    expect(favorWantFor(1, 2)).toEqual({ kind: 'build', count: 1 });
    expect(favorWantFor(2, 2)).toEqual({ kind: 'fire', ms: 120_000 });
    expect(favorWantFor(5, 2)).toEqual({ kind: 'fire', ms: 120_000 });
  });

  it('is null beyond the chain on either end (retired, or nonsense input)', () => {
    expect(favorWantFor(0, -1)).toBeNull();
    expect(favorWantFor(0, 3)).toBeNull();
    expect(favorWantFor(0, 4)).toBeNull();
  });
});

describe('villageLine — fuel band boundaries', () => {
  it('33 is steady, not dimming', () => {
    expect(villageLine(state({ fire: { fuel: 33, max: 100 } }), null)).toBe(DEFAULT_HINT);
  });

  it('just under 33 is dimming', () => {
    expect(villageLine(state({ fire: { fuel: 32.9, max: 100 } }), null)).toBe('The fire is dimming.');
  });

  it('66 is roaring', () => {
    expect(villageLine(state({ fire: { fuel: 66, max: 100 } }), null)).toBe('The fire is warm and bright.');
  });

  it('honours a non-100 max', () => {
    // 32 of 80 is 40% — steady band, so not dimming and not roaring.
    expect(villageLine(state({ fire: { fuel: 32, max: 80 } }), null)).toBe(DEFAULT_HINT);
    expect(villageLine(state({ fire: { fuel: 8, max: 80 } }), null)).toBe('The fire is dimming.');
  });
});

describe('villageLine — bad input degrades, never throws', () => {
  it('NaN fuel falls through to the default hint', () => {
    expect(villageLine(state({ fire: { fuel: Number.NaN, max: 100 } }), null)).toBe(DEFAULT_HINT);
  });

  it('a zero max does not divide by zero — it reads as dimming', () => {
    // fuel 50 against a capacity of 0 is no fuel at all relative to the max, so the dimming
    // band is the honest answer. The point is that it is finite, not NaN.
    expect(villageLine(state({ fire: { fuel: 50, max: 0 } }), null)).toBe('The fire is dimming.');
  });

  it('negative fuel still reads as embers', () => {
    expect(villageLine(state({ fire: { fuel: -5, max: 100 } }), null)).toBe(
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
