// The villager list: one button per villager, plus the two things it shows — what they are
// doing right now, and whether they are well-fed. Both writes are transition-guarded.

import type { GameState } from '../sim';
import { cardLabel } from './derive';
import { HEART_ICON, must } from './markup';

export interface CardParts {
  card: HTMLElement;
  label: HTMLElement;
  /** Batch 4: the requester heart, visibility-toggled on transitions below. */
  heart: HTMLElement;
  /** A1: last rendered fed state, so the well-fed class is only touched on a transition. */
  fed: boolean;
  /** Batch 4: last rendered favor state, same transition-only guard. */
  favor: boolean;
}

export function buildCards(
  list: HTMLElement,
  cards: Map<string, CardParts>,
  state: GameState,
): void {
  const html = state.villagers
    .map(
      (v) =>
        `<button class="villager-card lift" type="button" data-villager-id="${v.id}">
            <span class="hat-dot"></span>
            <span class="villager-name">${v.name}<span class="favor-heart" title="Has a favor to ask" style="color:var(--accent);margin-left:5px;vertical-align:-1px" hidden>${HEART_ICON}</span></span>
            <span class="task-label">Idle</span>
          </button>`,
    )
    .join('');
  list.innerHTML = html;
  state.villagers.forEach((v, i) => {
    const card = list.children[i];
    if (!(card instanceof HTMLElement)) return;
    cards.set(v.id, {
      card,
      label: must<HTMLElement>(card, '.task-label'),
      heart: must<HTMLElement>(card, '.favor-heart'),
      fed: false,
      favor: false,
    });
    must<HTMLElement>(card, '.hat-dot').style.background = v.hatColor;
  });
}

/** Per-frame card sync. Both writes compare first, so an idle frame touches no DOM. */
export function syncCards(cards: Map<string, CardParts>, state: GameState): void {
  state.villagers.forEach((villager, i) => {
    const parts = cards.get(villager.id);
    if (!parts) return;
    const label = cardLabel(villager);
    if (parts.label.textContent !== label) parts.label.textContent = label;
    // A1 well-fed tint: `fedMs` decays every frame, so the boolean is compared against the
    // last render and the class is only written when it actually flips.
    const fed = villager.fedMs > 0;
    if (parts.fed !== fed) {
      parts.fed = fed;
      parts.label.classList.toggle('well-fed', fed);
    }
    // Batch 4 requester heart: `active` is sim state, but the DOM write is transition-only,
    // exactly like the well-fed tint — an idle frame with no favor never touches the heart.
    const favor = state.favors?.byVillager?.[i]?.active === true;
    if (parts.favor !== favor) {
      parts.favor = favor;
      parts.heart.hidden = !favor;
    }
  });
}