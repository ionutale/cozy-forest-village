// The structure card, and the M1 signature guard that keeps it off the per-frame path.
//
// WD1 hardening: the card is rendered from ONE view object derived from state, and the
// change-detection signature is derived from that same view. The renderer cannot read `state`,
// and the signature cannot miss a displayed field, because both consume the view — so a field
// added to the view is picked up by construction rather than by remembering a second list.

import type { GameState, Structure } from '../sim';
import { COOK_BERRIES, COOK_WOOD, STRUCTURE_COST } from '../sim';
import { costIcon, type UiRefs } from './markup';
import { secondsToBerry } from './derive';

/** Everything the card displays, resolved. Nothing else reaches the DOM. */
export interface StructureCardView {
  /** InnerHTML for the cost line (inline SVG, so it stays a single write). */
  costHtml: string;
  /** "Need 8 more wood" — empty when affordable. */
  shortfall: string;
  /** Status line once built; empty while a ghost. */
  status: string;
  buildHidden: boolean;
  buildDisabled: boolean;
}

const EMPTY: StructureCardView = {
  costHtml: '',
  shortfall: '',
  status: '',
  buildHidden: true,
  buildDisabled: true,
};

export function structureCardView(state: GameState, structure: Structure | undefined): StructureCardView {
  if (!structure) return EMPTY;
  const cost = STRUCTURE_COST[structure.kind];
  const affordable = state.resources.wood >= cost.wood && state.resources.berries >= cost.berries;

  if (structure.built) {
    let status = 'Built';
    if (structure.kind === 'pot') {
      // A1: name the recipe, so the meal count has a "what does it cost me" next to it.
      status = `Meals: ${state.pot.meals} · ${COOK_BERRIES} berries + ${COOK_WOOD} wood each`;
    } else if (structure.kind === 'garden') {
      status = `Growing… ${secondsToBerry(state.gardenMs)}s`;
    }
    return { costHtml: '', shortfall: '', status, buildHidden: true, buildDisabled: true };
  }

  const parts: string[] = [];
  if (cost.wood > 0) parts.push(`<span class="cost-item">${costIcon('wood')}<b>${cost.wood}</b></span>`);
  if (cost.berries > 0) parts.push(`<span class="cost-item">${costIcon('berries')}<b>${cost.berries}</b></span>`);

  // Name what is missing rather than just greying the button out.
  const short: string[] = [];
  if (cost.wood > state.resources.wood) short.push(`${cost.wood - state.resources.wood} more wood`);
  if (cost.berries > state.resources.berries) {
    short.push(`${cost.berries - state.resources.berries} more berries`);
  }
  return {
    costHtml: parts.join(''),
    shortfall: affordable ? '' : `Need ${short.join(' and ')}`,
    status: '',
    buildHidden: false,
    buildDisabled: !affordable,
  };
}

/**
 * The change-detection signature (M1). Derived from the view's own fields rather than from
 * state, which is the whole point: `state` carries plenty that the card never shows (tick,
 * villager positions, gardenMs to the millisecond), and a state-derived signature used to have
 * to be maintained by hand alongside the renderer. Enumerating the view cannot drift from it.
 *
 * Cost is one entries array + one join, and only while a card is open — the path already
 * allocates a `find` closure and two string arrays per frame, so this is not a new class of
 * garbage. When no card is open the caller skips both entirely.
 */
export function viewSignature(view: StructureCardView): string {
  let out = '';
  for (const key of Object.keys(view) as Array<keyof StructureCardView>) {
    out += `${key}=${String(view[key])}|`;
  }
  return out;
}

/** Applies a view to the DOM. The only writer of the card's contents. */
export function applyStructureCard(refs: UiRefs, view: StructureCardView): void {
  refs.structureCost.innerHTML = view.costHtml;
  refs.structureShort.textContent = view.shortfall;
  refs.structureStatus.textContent = view.status;
  refs.buildBtn.hidden = view.buildHidden;
  refs.buildBtn.setAttribute('aria-disabled', view.buildDisabled ? 'true' : 'false');
}

/**
 * Owns the card's visibility, the view, and the signature cache. `reset()` forces the next
 * sync to render — used when the *selection* changes, so two structures with identical views
 * (both unbuilt benches, say) still repaint.
 */
export interface StructureCardController {
  sync(state: GameState, structure: Structure | undefined): void;
  reset(): void;
}

export function createStructureCard(refs: UiRefs): StructureCardController {
  let lastSignature = '';
  return {
    sync(state: GameState, structure: Structure | undefined): void {
      // Visibility tracks *which* structure is selected, not what it shows, so it stays outside
      // the signature guard.
      refs.taskGrid.hidden = structure !== undefined;
      refs.structureCard.hidden = structure === undefined;
      if (!structure) return;
      const view = structureCardView(state, structure);
      const signature = viewSignature(view);
      if (signature === lastSignature) return;
      lastSignature = signature;
      applyStructureCard(refs, view);
    },
    reset(): void {
      lastSignature = '';
    },
  };
}