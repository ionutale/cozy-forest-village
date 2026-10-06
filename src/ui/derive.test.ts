// Unit tests for the pure derivations (WD1). No DOM here on purpose: `derive.ts` imports only
// types, read-only constants, and side-effect-free sim functions from `../sim`, so it loads
// cleanly under vitest's `node` environment — that isolation is the reason these functions live
// in their own module.

import { describe, expect, it } from 'vitest';
import type { FavorProgress, FavorWant, GameState, SimEvent, Villager } from '../sim';
import { GARDEN_PERIOD_MS, DAY_MS, FRESH_START_T, favorWantFor } from '../sim';
import {
  DEFAULT_HINT,
  STRUCTURE_NAMES,
  THANK_YOU_MS,
  TRADE_LABELS,
  TRADER_HINT,
  bondsLine,
  cardLabel,
  delightText,
  favorLine,
  favorPopoverLine,
  favorProgressText,
  favorText,
  fireState,
  firstById,
  firstFavorDoneVillagerId,
  hintRecomputeDue,
  potHeartySuffix,
  secondsToBerry,
  tradeDisabled,
  traderHintLine,
  villageLine,
  villagersNeedingCards,
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

/**
 * Batch 9 (bonds): a `BondsState` from sparse `[a, b, score]` pair overrides. The pair table is
 * row-major 12×12 with only the `i < j` cell written (spec §1.1), so a pair `(a, b)` maps to
 * `min(a,b) * 12 + max(a,b)`. Both arrays default to zeroed, matching `createInitialState`.
 */
function bonds(entries: Array<[number, number, number]> = []): GameState['bonds'] {
  const scores = new Array<number>(144).fill(0);
  for (const [a, b, score] of entries) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    scores[lo * 12 + hi] = score;
  }
  return { scores, gapMs: new Array<number>(144).fill(0) };
}

function state(over: Partial<GameState> = {}): GameState {
  return {
    tick: 0,
    seed: 1,
    resources: { wood: 0, berries: 0, spices: 0 },
    villagers: [],
    nodes: [],
    structures: [],
    fire: { fuel: 70, max: 100 },
    pot: { meals: 0 },
    gardenMs: 0,
    events: [],
    pendingEvents: [],
    favors: favors(),
    // H1 added `arrivals` to GameState (batch 6 walk-ins); the fixtures default it empty.
    arrivals: [],
    // T1 added `visitor` (batch 7 trader's visit schedule); absent or away until a test says so.
    visitor: AWAY,
    // N1 added `clock` (batch 8 day/night cycle); the fixture defaults to a fresh mid-morning,
    // matching createInitialState. No derivation reads it yet, so no expectation changes.
    clock: { dayMs: DAY_MS * FRESH_START_T },
    // Bonds (batch 9): the pair table K1 adds to GameState; zeroed by default, like a fresh
    // village, so every existing fixture reads "no bonds" and no expectation moves.
    bonds: bonds(),
    ...over,
  };
}

/** T1's `Visitor`, away — the state a fresh village (and every pre-trader save) starts in. */
const AWAY: GameState['visitor'] = { phase: 'away', inMs: 0, visitMs: 0, tradesLeft: 0 };

/** T1's `Visitor`, mid-visit with `tradesLeft` trades still on the table. */
function visiting(tradesLeft = 3): GameState['visitor'] {
  return { phase: 'visiting', inMs: 0, visitMs: 45_000, tradesLeft };
}

/** A pot that is built, so the pot status line is the one being read. */
const POT_BUILT = [{ id: 'pot-1', kind: 'pot' as const, pos: { x: 0, z: 0 }, built: true }];

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
    ).toBe('V3 would love the fire tended for two minutes (1:12/2:00).');
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
  it('maps every want kind (and eat requester) to its DESIGN §3.2 phrase in the slot-0 voice', () => {
    expect(favorText({ kind: 'eat', who: 'self', count: 1 }, 'V1')).toBe('a warm meal');
    expect(favorText({ kind: 'eat', who: 'any', count: 3 }, 'V1')).toBe('a feast for the village');
    expect(favorText({ kind: 'gather', count: 6 }, 'V1')).toBe('berries for the village');
    expect(favorText({ kind: 'chop', count: 4 }, 'V1')).toBe('firewood for the village');
    expect(favorText({ kind: 'build', count: 1 }, 'V1')).toBe('something new built');
    expect(favorText({ kind: 'fire', ms: 120_000 }, 'V1')).toBe('the fire kept warm for two minutes');
  });
});

describe('favorText / delightText — per-villager voice (G2)', () => {
  // The shipped roster (src/sim/villagers.ts), so the spread checks reflect the real village.
  const ROSTER = ['Maple', 'Birch', 'Fern', 'Pip', 'Hazel', 'Juniper', 'Moss', 'Clover'];
  const WANTS: readonly FavorWant[] = [
    { kind: 'eat', who: 'self', count: 1 },
    { kind: 'eat', who: 'any', count: 3 },
    { kind: 'gather', count: 6 },
    { kind: 'chop', count: 4 },
    { kind: 'build', count: 1 },
    { kind: 'fire', ms: 120_000 },
  ];

  it('every (villager, want) maps to one stable string across repeated calls', () => {
    for (const name of ROSTER) {
      for (const want of WANTS) {
        const first = favorText(want, name);
        for (let call = 0; call < 5; call += 1) {
          expect(favorText(want, name)).toBe(first);
        }
      }
    }
  });

  it('at least two distinct variants appear across the eight villagers for every want', () => {
    for (const want of WANTS) {
      const variants = new Set(ROSTER.map((name) => favorText(want, name)));
      expect(variants.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps every want phrase short, warm and free of undefined/NaN', () => {
    for (const name of ROSTER) {
      for (const want of WANTS) {
        const phrase = favorText(want, name);
        expect(phrase.length).toBeGreaterThan(0);
        expect(phrase.length).toBeLessThanOrEqual(45);
        expect(phrase).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it('pins a few shipped voices — a hash change is a content change', () => {
    expect(favorText({ kind: 'eat', who: 'self', count: 1 }, 'Fern')).toBe('a warm meal');
    expect(favorText({ kind: 'chop', count: 4 }, 'Pip')).toBe('fresh logs for the fire');
    expect(delightText('Moss')).toBe('Moss looks so happy!');
  });

  it('delight variants are stable per villager, named and spread across the roster', () => {
    const lines = ROSTER.map((name) => delightText(name));
    for (const [i, name] of ROSTER.entries()) {
      const line = lines[i]!;
      expect(delightText(name)).toBe(line);
      expect(line.startsWith(`${name} `)).toBe(true);
      expect(line.length).toBeLessThanOrEqual(45);
      expect(line).not.toMatch(/undefined|NaN/);
    }
    expect(new Set(lines).size).toBeGreaterThanOrEqual(2);
  });

  it("villageLine renders each villager's delight phrasing in the thanks slot", () => {
    for (const name of ROSTER) {
      expect(villageLine(state(), name)).toBe(delightText(name));
    }
  });

  it('hint and popover agree on the phrase for a villager; the other slot stays hidden', () => {
    const names = ['Fern', 'Pip', 'Juniper'];
    for (let i = 0; i < names.length; i += 1) {
      for (let step = 0; step <= 2; step += 1) {
        const s = state({
          villagers: names.map((name, j) => villager(`v${j + 1}`, { name })),
          favors: favors(names.map((_, j) => ({ step, active: j === i, progress: 0 }))),
        });
        const want = favorWantFor(i, step);
        if (want === null) continue; // unreachable for steps 0–2; keeps the type honest
        const name = names[i]!;
        const phrase = favorText(want, name);
        const tail = favorProgressText(want, 0);
        expect(villageLine(s, null)).toBe(`${name} would love ${phrase} ${tail}.`);
        expect(favorPopoverLine(s, i)).toBe(`Favor: ${phrase} ${tail}`);
        expect(favorPopoverLine(s, (i + 1) % names.length)).toBeNull();
      }
    }
  });

  it('a malformed save with no villager data still yields a full phrase, never undefined', () => {
    const s = state({ villagers: [], favors: favors([{ active: true, progress: 0 }]) });
    const line = favorPopoverLine(s, 0);
    expect(line).not.toBeNull();
    expect(line).toMatch(/^Favor: .+ \(0\/1\)$/);
    expect(line).not.toMatch(/undefined|NaN/);
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

  it('H3: an arriving newcomer reads Arriving\u2026', () => {
    expect(cardLabel(villager('v9', { state: 'arriving' }))).toBe('Arriving\u2026');
  });

  it('H3: Arriving\u2026 wins over any task, because a walk-in has none yet', () => {
    expect(cardLabel(villager('v9', { state: 'arriving', task: null }))).toBe('Arriving\u2026');
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

describe('villagersNeedingCards (H3 card reconcile)', () => {
  it('returns nothing when the rendered count already matches', () => {
    expect(villagersNeedingCards(8, 8)).toEqual([]);
    expect(villagersNeedingCards(12, 12)).toEqual([]);
    expect(villagersNeedingCards(0, 0)).toEqual([]);
  });

  it('returns the whole range when the roster grows from empty', () => {
    expect(villagersNeedingCards(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('returns only the new tail indices', () => {
    expect(villagersNeedingCards(8, 9)).toEqual([8]);
    expect(villagersNeedingCards(8, 12)).toEqual([8, 9, 10, 11]);
  });

  it('never returns anything when the roster shrinks (villagers are never removed)', () => {
    expect(villagersNeedingCards(12, 8)).toEqual([]);
  });

  it('tolerates nonsense counts instead of looping forever', () => {
    expect(villagersNeedingCards(-3, 2)).toEqual([0, 1]);
    expect(villagersNeedingCards(4, Number.NaN)).toEqual([]);
    expect(villagersNeedingCards(4, Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe('STRUCTURE_NAMES (H3 huts)', () => {
  it('names a hut', () => {
    expect(STRUCTURE_NAMES.hut).toBe('Hut');
  });

  it('still names the batch-2 kinds', () => {
    expect(STRUCTURE_NAMES.woodpile).toBe('Woodpile');
    expect(STRUCTURE_NAMES.pot).toBe('Cooking pot');
    expect(STRUCTURE_NAMES.bench).toBe('Bench');
    expect(STRUCTURE_NAMES.garden).toBe('Garden');
    expect(STRUCTURE_NAMES.lantern).toBe('Lantern');
    expect(STRUCTURE_NAMES.feeder).toBe('Bird feeder');
  });
});

// M3 (review pin): the plan's index-8+ pin — "index 8+ flows through variants/voice/hearts
// without special cases (H1 + H3-tests)". The H1 half is pinned in src/sim/huts.test.ts; this is
// the H3 half. Every phrasing fixture above hard-codes the eight founders, and favorWantFor was
// only ever called with indices 0, 1, 2 and 5 — so index 8–11 resolving a want line, a delight
// suffix and a heart through the normal path was an inspection result, not a test result.
describe('index 8+ — newcomers resolve through the normal path (M3)', () => {
  // The eight founders plus the batch-6 newcomers in completion order (DESIGN §3.2): Lily · Rowan
  // · Sage · Wren. Lily is index 8, the first walk-in.
  const ROSTER12 = ['Maple', 'Birch', 'Fern', 'Pip', 'Hazel', 'Juniper', 'Moss', 'Clover', 'Lily', 'Rowan', 'Sage', 'Wren'];
  const HAT = ['#e3b7c4', '#b03a3a', '#a8bd86', '#7d6a52'];

  /** A full 12-villager village with an active favor on exactly the newcomer at `activeAt`. */
  function village12(activeAt: number): GameState {
    return state({
      villagers: ROSTER12.map((name, i) => villager(`v${i + 1}`, { name, hatColor: HAT[i % HAT.length] ?? '#000000' })),
      favors: favors(
        ROSTER12.map((_, i) => (i === activeAt ? { step: 1, active: true, progress: 2 } : { step: 0, active: false, progress: 0 })),
      ),
    });
  }

  it('resolves the popover Favor: line at index 8, with no undefined or NaN leaking through', () => {
    const line = favorPopoverLine(village12(8), 8);
    expect(line).not.toBeNull();
    expect(line).not.toBe('');
    expect(line).toMatch(/^Favor: /);
    // The failure mode this pins: a name or count read past the end of a shorter fixture array
    // interpolating "undefined", or an uninitialised progress rendering as "NaN".
    expect(line).not.toMatch(/undefined|NaN/);
  });

  it('voices index 8 through the name read from that slot, and gives her a delight suffix', () => {
    // The name does not appear in the line — it selects the variant (`favorText` → `voiceIndex`),
    // so the honest pin is the whole composed chain: want → voice-by-name-at-8 → progress. A
    // broken `state.villagers[8].name` lookup would voice with `''` and this would not match.
    expect(favorPopoverLine(village12(8), 8)).toBe(
      `Favor: ${favorText({ kind: 'gather', count: 6 }, 'Lily')} (2/6)`,
    );
    expect(typeof delightText('Lily')).toBe('string');
    expect(delightText('Lily')).toMatch(/^Lily /);
    expect(delightText('Lily')).not.toMatch(/undefined|NaN/);
  });

  it('resolves the chain content at index 8 with no special case: step 1 is gather, because 8 is even', () => {
    // favorWantFor branches on villagerIndex % 2, so index 8 must land on the even arm — the same
    // arm index 0 takes. If a newcomer ever got a special case, this is where it would show.
    expect(favorWantFor(8, 1)).toEqual({ kind: 'gather', count: 6 });
    expect(favorWantFor(8, 1)).toEqual(favorWantFor(0, 1));
  });

  it('resolves every newcomer index 8–11, not just Lily', () => {
    for (let i = 8; i < ROSTER12.length; i += 1) {
      const name = ROSTER12[i] ?? '';
      const want = favorWantFor(i, 1);
      expect(want).toEqual(i % 2 === 0 ? { kind: 'gather', count: 6 } : { kind: 'chop', count: 4 });
      expect(favorPopoverLine(village12(i), i)).toBe(
        `Favor: ${favorText(want ?? { kind: 'gather', count: 6 }, name)} ${favorProgressText(want ?? { kind: 'gather', count: 6 }, 2)}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// T3 (batch 7, traders → spices): the hint slot, the trade gate, the pot suffix.
// ---------------------------------------------------------------------------

describe('traderHintLine — the hint slot (T3)', () => {
  it('reads "A trader is visiting!" only while the visit is on', () => {
    expect(traderHintLine(state({ visitor: visiting() }))).toBe('A trader is visiting!');
    expect(traderHintLine(state())).toBeNull();
    expect(traderHintLine(state({ visitor: AWAY }))).toBeNull();
  });

  it('the copy is the binding string, so the UI and the test cannot drift apart', () => {
    expect(TRADER_HINT).toBe('A trader is visiting!');
  });

  it('a visiting trader with trades spent still reads visiting — the slot is phase-driven', () => {
    expect(traderHintLine(state({ visitor: visiting(0) }))).toBe('A trader is visiting!');
  });

  it('priority: embers > (thanks | favor) > trader > dimming > …', () => {
    const visitingState = state({ visitor: visiting() });
    // 1. embers outranks everything, including the trader.
    expect(villageLine(state({ visitor: visiting(), fire: { fuel: 0, max: 100 } }), null)).toBe(
      'Only embers left — someone should tend the fire.',
    );
    // 2. thanks outranks the trader.
    expect(villageLine(visitingState, 'Fern')).toBe('Fern is delighted!');
    // 3. favor outranks the trader.
    expect(
      villageLine(
        state({ visitor: visiting(), villagers: [villager('v1')], favors: favors([{ active: true }]) }),
        null,
      ),
    ).toBe('V1 would love a warm meal (0/1).');
    // 4. the trader outranks dimming.
    expect(villageLine(state({ visitor: visiting(), fire: { fuel: 20, max: 100 } }), null)).toBe(TRADER_HINT);
    // 5. and outranks the ordinary slots below dimming too.
    expect(villageLine(state({ visitor: visiting(), pot: { meals: 2 } }), null)).toBe(TRADER_HINT);
    expect(villageLine(state({ visitor: visiting(), fire: { fuel: 90, max: 100 } }), null)).toBe(TRADER_HINT);
  });

  // Review M3: the pairwise cases above are transitive, but Review Focus 4 asks for the three
  // signals *simultaneously*, and only this shape exercises the chain in the order it actually
  // runs rather than one edge at a time.
  it('all at once: a visiting trader, an active favor AND a thanks name', () => {
    const both = state({
      visitor: visiting(),
      villagers: [villager('v1')],
      favors: favors([{ active: true }]),
    });
    // thanks wins, and the trader is never consulted.
    expect(villageLine(both, 'Fern')).toBe('Fern is delighted!');
    // one edge down the same state: the favor, still never the trader.
    expect(villageLine(both, null)).toBe('V1 would love a warm meal (0/1).');
    // and one more: with the favor gone, the trader is finally what shows.
    const noFavor = state({ visitor: visiting(), villagers: [villager('v1')] });
    expect(villageLine(noFavor, null)).toBe(TRADER_HINT);
    // embers still outranks all three together, so the top of the chain is pinned in one state too.
    expect(villageLine({ ...both, fire: { fuel: 0, max: 100 } }, 'Fern')).toBe(
      'Only embers left — someone should tend the fire.',
    );
  });

  it('returns to the next slot the moment the visit ends (the "yields … returning after" half)', () => {
    const away = state({ visitor: AWAY, fire: { fuel: 20, max: 100 } });
    expect(villageLine(away, null)).toBe('The fire is dimming.');
    expect(villageLine(state({ visitor: AWAY, pot: { meals: 2 } }), null)).toBe('Meals are ready for a rest.');
    // 50 % is steady: past dimming, short of roaring, and nothing else to say.
    expect(villageLine(state({ visitor: AWAY, fire: { fuel: 50, max: 100 } }), null)).toBe(DEFAULT_HINT);
  });
});

describe('hintRecomputeDue — the trader edges are edges too (T3)', () => {
  it('recomputes immediately when the trader arrives', () => {
    expect(hintRecomputeDue(1000, 9000, null, null, false, true)).toBe(true);
  });

  it('recomputes immediately when the visit ends, so the slot does not linger 10 s', () => {
    expect(hintRecomputeDue(1000, 9000, null, null, true, false)).toBe(true);
  });

  it('the existing thanks/cadence behaviour is unchanged when the trader is steady', () => {
    expect(hintRecomputeDue(1000, 9000, null, null, true, true)).toBe(false);
    expect(hintRecomputeDue(9000, 9000, null, null, false, false)).toBe(true);
    expect(hintRecomputeDue(1000, 9000, null, 'Fern')).toBe(true);
  });
});

describe('tradeDisabled — the two trade buttons (T3)', () => {
  const rich = state({ visitor: visiting(3), resources: { wood: 99, berries: 99, spices: 0 } });

  it('is enabled while the trader is here with the stock to back it', () => {
    expect(tradeDisabled(rich, 'berries')).toBe(false);
    expect(tradeDisabled(rich, 'spice')).toBe(false);
  });

  it('is disabled once the visit is over, for both kinds', () => {
    const away = state({ visitor: AWAY, resources: { wood: 99, berries: 99, spices: 0 } });
    expect(tradeDisabled(away, 'berries')).toBe(true);
    expect(tradeDisabled(away, 'spice')).toBe(true);
  });

  it('is disabled when the trader has no trades left', () => {
    const spent = state({ visitor: visiting(0), resources: { wood: 99, berries: 99, spices: 0 } });
    expect(tradeDisabled(spent, 'berries')).toBe(true);
    expect(tradeDisabled(spent, 'spice')).toBe(true);
  });

  it('berries trades 5 wood for 4 berries: disabled below 5 wood, enabled at exactly 5', () => {
    expect(tradeDisabled(state({ visitor: visiting(), resources: { wood: 4, berries: 99, spices: 0 } }), 'berries')).toBe(true);
    expect(tradeDisabled(state({ visitor: visiting(), resources: { wood: 5, berries: 0, spices: 0 } }), 'berries')).toBe(false);
  });

  it('spice trades 6 berries for 1 spice: disabled below 6 berries, enabled at exactly 6', () => {
    expect(tradeDisabled(state({ visitor: visiting(), resources: { wood: 99, berries: 5, spices: 0 } }), 'spice')).toBe(true);
    expect(tradeDisabled(state({ visitor: visiting(), resources: { wood: 0, berries: 6, spices: 0 } }), 'spice')).toBe(false);
  });

  it('each kind is gated only on its own price — plentiful wood does not unlock spice', () => {
    const noBerries = state({ visitor: visiting(), resources: { wood: 99, berries: 0, spices: 3 } });
    expect(tradeDisabled(noBerries, 'berries')).toBe(false);
    expect(tradeDisabled(noBerries, 'spice')).toBe(true);
  });

  it('having spices already never blocks buying more', () => {
    expect(tradeDisabled(state({ visitor: visiting(), resources: { wood: 9, berries: 9, spices: 9 } }), 'spice')).toBe(false);
  });
});

describe('TRADE_LABELS — the two button captions (T3)', () => {
  it('states both exchanges the way the spec words them', () => {
    expect(TRADE_LABELS.berries).toBe('5 wood → 4 berries');
    expect(TRADE_LABELS.spice).toBe('6 berries → 1 spice');
  });
});

describe('potHeartySuffix — the pot line suffix (T3)', () => {
  const pot = state({ structures: POT_BUILT, resources: { wood: 0, berries: 0, spices: 0 } });

  it('is present only when the pot is built and spices remain', () => {
    expect(potHeartySuffix(state({ structures: POT_BUILT, resources: { wood: 0, berries: 0, spices: 1 } }))).toBe(
      ' · hearty while spices last',
    );
  });

  it('is absent with no spices, even though the pot is built', () => {
    expect(potHeartySuffix(pot)).toBe('');
    expect(potHeartySuffix(state({ structures: POT_BUILT, resources: { wood: 0, berries: 0, spices: 0 } }))).toBe('');
  });

  it('mirrors the sim\'s own > 0 test, so a fractional count from a bad save still reads hearty', () => {
    expect(potHeartySuffix(state({ structures: POT_BUILT, resources: { wood: 0, berries: 0, spices: 0.4 } }))).toBe(
      ' · hearty while spices last',
    );
  });

  it('is absent when the pot is not built, however many spices are in store', () => {
    const ghost = state({ structures: [], resources: { wood: 0, berries: 0, spices: 5 } });
    expect(potHeartySuffix(ghost)).toBe('');
  });

  it('starts with the separator the pot status line already ends in, so appending is safe', () => {
    expect(potHeartySuffix(state({ structures: POT_BUILT, resources: { wood: 0, berries: 0, spices: 2 } }))).toMatch(
      /^ · /,
    );
  });
});

// ---------------------------------------------------------------------------
// Batch 9 (bonds): the popover's Bonds line.
// ---------------------------------------------------------------------------

describe('bondsLine — the popover Bonds line (batch 9)', () => {
  const NAMES = ['Maple', 'Birch', 'Fern', 'Pip', 'Hazel'];

  /** The subject is always roster index 0 (`v1`); the pairs below are its bonds. */
  function village(entries: Array<[number, number, number]>): GameState {
    return state({
      villagers: NAMES.map((name, i) => villager(`v${i + 1}`, { name })),
      bonds: bonds(entries),
    });
  }

  it('orders the top two by level, then score, then roster index', () => {
    // Level outranks score: the level-3 partner (index 1, 720) is first even though index 2
    // carries the next-highest score. Then score desc, then index asc for the rest.
    const ordered = village([
      [0, 3, 300],
      [0, 4, 300],
      [0, 2, 400],
      [0, 1, 720],
    ]);
    expect(bondsLine(ordered, 'v1')).toBe('Best with Birch · Close with Fern');

    // Equal level and equal score → roster index ascending breaks the tie.
    const tied = village([[0, 4, 300], [0, 3, 300]]);
    expect(bondsLine(tied, 'v1')).toBe('Close with Pip · Close with Hazel');

    // Equal level, differing score → the higher score comes first, whatever the index.
    const scored = village([[0, 3, 300], [0, 2, 400]]);
    expect(bondsLine(scored, 'v1')).toBe('Close with Fern · Close with Pip');
  });

  it('words each level: Warming to / Close with / Best with', () => {
    expect(bondsLine(village([[0, 1, 120]]), 'v1')).toBe('Warming to Birch');
    expect(bondsLine(village([[0, 1, 300]]), 'v1')).toBe('Close with Birch');
    expect(bondsLine(village([[0, 1, 720]]), 'v1')).toBe('Best with Birch');
  });

  it('hides below level 1, and shows a warming-only bond', () => {
    expect(bondsLine(village([]), 'v1')).toBeNull();
    // 119 is one point short of the warming threshold (120) — still no bond.
    expect(bondsLine(village([[0, 1, 119]]), 'v1')).toBeNull();
    expect(bondsLine(village([[0, 1, 120]]), 'v1')).toBe('Warming to Birch');
  });
});
