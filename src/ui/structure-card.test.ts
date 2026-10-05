// The M1 signature guarantee, made permanent (G1, WD1 report concern 3).
//
// `structure-card.ts` derives the change-detection signature from the view's own enumerable
// keys instead of a hand-written field list. These tests pin that mechanism:
//
//   a) every field the card currently renders is represented in the signature;
//   b) a field that did NOT exist when `viewSignature` was written still changes the signature
//      — this is the actual guarantee, and it holds for any future displayed field;
//   c) identical views produce identical signatures (no per-frame churn);
//   d) the DOM output comes from the same view the signature signs, field for field.
//
// The environment is `node` (vite.config.ts), so the card's DOM nodes are minimal fakes. Only
// the refs `applyStructureCard` writes and the two toggles `createStructureCard` owns are faked;
// a future writer touching another ref fails here loudly, which is the point.

import { describe, expect, it } from 'vitest';
import type { GameState, Structure } from '../sim';
import type { UiRefs } from './markup';
import type { StructureCardView } from './structure-card';
import { applyStructureCard, createStructureCard, structureCardView, viewSignature } from './structure-card';

/** The five observable outputs of a card render — one per written ref/attribute. */
interface RenderedCard {
  costHtml: string;
  shortfall: string;
  status: string;
  buildHidden: boolean;
  ariaDisabled: string | undefined;
}

interface FakeCardRefs {
  structureCost: { innerHTML: string };
  structureShort: { textContent: string };
  structureStatus: { textContent: string };
  buildBtn: { hidden: boolean; attributes: Record<string, string>; setAttribute(name: string, value: string): void };
  taskGrid: { hidden: boolean };
  structureCard: { hidden: boolean };
}

function fakeRefs(): FakeCardRefs {
  const attributes: Record<string, string> = {};
  return {
    structureCost: { innerHTML: '' },
    structureShort: { textContent: '' },
    structureStatus: { textContent: '' },
    buildBtn: {
      hidden: false,
      attributes,
      setAttribute(name, value) {
        attributes[name] = value;
      },
    },
    taskGrid: { hidden: false },
    structureCard: { hidden: true },
  };
}

/** The fake refs are structurally a subset of `UiRefs`; the cast is the test seam. */
function asUiRefs(refs: FakeCardRefs): UiRefs {
  return refs as unknown as UiRefs;
}

/** Reads every observable output back off the fake refs. */
function renderedFrom(refs: FakeCardRefs): RenderedCard {
  return {
    costHtml: refs.structureCost.innerHTML,
    shortfall: refs.structureShort.textContent,
    status: refs.structureStatus.textContent,
    buildHidden: refs.buildBtn.hidden,
    ariaDisabled: refs.buildBtn.attributes['aria-disabled'],
  };
}

/** Renders a view through the real writer and reads back every output. */
function render(view: StructureCardView): RenderedCard {
  const refs = fakeRefs();
  applyStructureCard(asUiRefs(refs), view);
  return renderedFrom(refs);
}

const BASE: StructureCardView = {
  costHtml: '<span class="cost-item">wood 15</span>',
  shortfall: 'Need 15 more wood',
  status: '',
  buildHidden: false,
  buildDisabled: true,
};

/**
 * One entry per currently-rendered field: the view with just that field changed, and the
 * rendered output it drives. The coverage test below fails whenever the view grows a field that
 * is missing here, so this table cannot silently go stale.
 */
interface FieldVariant {
  field: keyof StructureCardView;
  output: keyof RenderedCard;
  view: StructureCardView;
}

const VARIANTS: FieldVariant[] = [
  { field: 'costHtml', output: 'costHtml', view: { ...BASE, costHtml: '<span class="cost-item">wood 20</span>' } },
  { field: 'shortfall', output: 'shortfall', view: { ...BASE, shortfall: 'Need 20 more wood' } },
  { field: 'status', output: 'status', view: { ...BASE, status: 'Built' } },
  { field: 'buildHidden', output: 'buildHidden', view: { ...BASE, buildHidden: true } },
  { field: 'buildDisabled', output: 'ariaDisabled', view: { ...BASE, buildDisabled: false } },
];

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
    favors: { byVillager: [], nextOfferMs: 0 },
    ...over,
  };
}

function structure(kind: Structure['kind'], built = false): Structure {
  return { id: kind, kind, pos: { x: 0, z: 0 }, built };
}

describe('viewSignature — the whole view, by construction', () => {
  it('names every key of the view in the signature', () => {
    const signature = viewSignature(BASE);
    for (const key of Object.keys(BASE)) {
      expect(signature).toContain(`${key}=`);
    }
  });

  it('covers every currently-rendered field (the VARIANTS table cannot go stale)', () => {
    expect(VARIANTS.map((variant) => variant.field).sort()).toEqual(Object.keys(BASE).sort());
  });

  it.each(VARIANTS)('changing $field changes the signature', ({ field, view }) => {
    expect(Object.keys(view)).toEqual(Object.keys(BASE)); // only that field differs
    expect(view[field]).not.toEqual(BASE[field]);
    expect(viewSignature(view)).not.toBe(viewSignature(BASE));
  });

  it('identical views produce identical signatures', () => {
    const copy = { ...BASE };
    expect(copy).not.toBe(BASE); // distinct objects, same field values
    expect(viewSignature(copy)).toBe(viewSignature(BASE));
  });

  it('is deterministic across repeated calls on the same view', () => {
    expect(viewSignature(BASE)).toBe(viewSignature(BASE));
  });

  it('picks up a field that did not exist when viewSignature was written', () => {
    // The actual guarantee: the signature enumerates the view's own keys, so a field added to
    // `StructureCardView` — and populated by `structureCardView` — is signed without a second
    // edit. A hard-coded field list or template literal cannot pass this test.
    type ExtendedView = StructureCardView & { hatchProgress: number; emissive: string };
    const extended: ExtendedView = { ...BASE, hatchProgress: 3, emissive: '#ff8800' };
    const signature = viewSignature(extended);
    expect(signature).not.toBe(viewSignature(BASE));
    expect(signature).toContain('hatchProgress=3');
    expect(signature).toContain('emissive=#ff8800');
  });
});

describe('structureCardView — signatures track what the card displays', () => {
  it('every key the builder produces is named in the signature, on every branch', () => {
    const cases: GameState[] = [
      state(),
      state({ resources: { wood: 15, berries: 0 } }), // unbuilt, affordable
      state({ resources: { wood: 0, berries: 5 } }), // unbuilt, short both ways
      state({ pot: { meals: 3 } }), // built branches read more state
      state({ gardenMs: 7000 }),
    ];
    for (const s of cases) {
      for (const kind of ['bench', 'pot', 'garden'] as const) {
        for (const built of [false, true]) {
          const view = structureCardView(s, structure(kind, built));
          const signature = viewSignature(view);
          for (const key of Object.keys(view)) {
            expect(signature).toContain(`${key}=`);
          }
        }
      }
    }
  });

  it('a built garden countdown changes the signature as it ticks', () => {
    const garden = structure('garden', true);
    const early = structureCardView(state({ gardenMs: 0 }), garden);
    const late = structureCardView(state({ gardenMs: 1000 }), garden);
    expect(late.status).not.toBe(early.status);
    expect(viewSignature(late)).not.toBe(viewSignature(early));
  });

  it('a built pot meal count is signed too', () => {
    const pot = structure('pot', true);
    const one = structureCardView(state({ pot: { meals: 1 } }), pot);
    const two = structureCardView(state({ pot: { meals: 2 } }), pot);
    expect(viewSignature(two)).not.toBe(viewSignature(one));
  });

  it('state the card never shows does not change the signature (no churn)', () => {
    const bench = structure('bench');
    const quiet = viewSignature(structureCardView(state(), bench));
    const noisy = viewSignature(
      structureCardView(state({ tick: 999, seed: 42, gardenMs: 12_345 }), bench),
    );
    expect(noisy).toBe(quiet);
  });
});

describe('applyStructureCard — the DOM output derives from the view', () => {
  it('writes each view field to its node', () => {
    expect(render(BASE)).toEqual({
      costHtml: BASE.costHtml,
      shortfall: BASE.shortfall,
      status: BASE.status,
      buildHidden: BASE.buildHidden,
      ariaDisabled: 'true', // buildDisabled: true
    });
  });

  it.each(VARIANTS)('the $field change that moves the signature moves exactly the $output output', ({ output, view }) => {
    const before = render(BASE);
    const after = render(view);
    const changed = (Object.keys(before) as Array<keyof RenderedCard>).filter((key) => before[key] !== after[key]);
    expect(changed).toEqual([output]);
  });
});

describe('createStructureCard — one view feeds both the guard and the renderer', () => {
  it('renders the view it signs, skips an unchanged view, and repaints when a displayed value changes', () => {
    const refs = fakeRefs();
    const card = createStructureCard(asUiRefs(refs));
    const bench = structure('bench');

    card.sync(state(), bench);
    expect(renderedFrom(refs)).toEqual(render(structureCardView(state(), bench)));
    expect(refs.structureShort.textContent).toBe('Need 15 more wood');

    // The guard compares signatures, so an unchanged view is not repainted — a tampered node
    // stays tampered, which is how "no write" is observed without instrumenting the fake.
    refs.structureShort.textContent = 'tampered';
    card.sync(state(), bench);
    expect(refs.structureShort.textContent).toBe('tampered');

    // A displayed change repaints, and the paint is still exactly the builder's view.
    const rich = state({ resources: { wood: 15, berries: 0 } });
    card.sync(rich, bench);
    expect(renderedFrom(refs)).toEqual(render(structureCardView(rich, bench)));
    expect(refs.structureShort.textContent).toBe('');
    expect(refs.buildBtn.attributes['aria-disabled']).toBe('false');
  });

  it('reset() forces the next sync to repaint even when the view is identical', () => {
    const refs = fakeRefs();
    const card = createStructureCard(asUiRefs(refs));
    const bench = structure('bench');

    card.sync(state(), bench);
    refs.structureShort.textContent = 'tampered';
    card.reset();
    card.sync(state(), bench);
    expect(refs.structureShort.textContent).toBe('Need 15 more wood');
  });

  it('selection visibility tracks which structure is selected, not the view', () => {
    const refs = fakeRefs();
    const card = createStructureCard(asUiRefs(refs));

    card.sync(state(), undefined);
    expect(refs.taskGrid.hidden).toBe(false);
    expect(refs.structureCard.hidden).toBe(true);

    card.sync(state(), structure('bench'));
    expect(refs.taskGrid.hidden).toBe(true);
    expect(refs.structureCard.hidden).toBe(false);
  });
});
