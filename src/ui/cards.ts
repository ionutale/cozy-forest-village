// The villager list: one button per villager, plus the two things it shows — what they are
// doing right now, and whether they are well-fed. All writes are transition-guarded; the
// heart's goodbye pulse (G3) is transition-started and timer-ended, never per-frame.

import type { GameState } from '../sim';
import { cardLabel } from './derive';
import { HEART_ICON, must } from './markup';

/** G3: the goodbye pulse's length; `.favor-heart.heart-pulse` in ui.css runs 2 × 300 ms. */
const HEART_PULSE_MS = 600;

export interface CardParts {
  card: HTMLElement;
  label: HTMLElement;
  /** Batch 4: the requester heart, visibility-toggled on transitions below. */
  heart: HTMLElement;
  /** A1: last rendered fed state, so the well-fed class is only touched on a transition. */
  fed: boolean;
  /** Batch 4: last rendered favor state, same transition-only guard. */
  favor: boolean;
  /** G3: pending hide for the goodbye pulse; null when no pulse is in flight. */
  heartPulseTimer: ReturnType<typeof setTimeout> | null;
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
      heartPulseTimer: null,
    });
    must<HTMLElement>(card, '.hat-dot').style.background = v.hatColor;
  });
}

/**
 * G3: the heart's goodbye. The class starts the CSS pulse; the timer ends it and hides the
 * heart, so visibility still changes exactly once per transition. Reduced motion skips the
 * animation (the stylesheet kills it anyway) and hides immediately.
 */
function startHeartPulse(parts: CardParts): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    parts.heart.hidden = true;
    return;
  }
  parts.heart.classList.add('heart-pulse');
  parts.heartPulseTimer = setTimeout(() => {
    parts.heartPulseTimer = null;
    parts.heart.classList.remove('heart-pulse');
    parts.heart.hidden = true;
  }, HEART_PULSE_MS);
}

/** G3: a re-offer mid-pulse wins — the pending hide is dropped and the heart stays up. */
export function cancelHeartPulse(parts: CardParts): void {
  if (parts.heartPulseTimer === null) return;
  clearTimeout(parts.heartPulseTimer);
  parts.heartPulseTimer = null;
  parts.heart.classList.remove('heart-pulse');
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
    // G3: the true→false edge pulses the heart before hiding it, and a false→true edge before
    // the pulse ends cancels that goodbye cleanly.
    const favor = state.favors?.byVillager?.[i]?.active === true;
    if (parts.favor !== favor) {
      parts.favor = favor;
      if (favor) {
        cancelHeartPulse(parts);
        parts.heart.hidden = false;
      } else {
        startHeartPulse(parts);
      }
    }
  });
}