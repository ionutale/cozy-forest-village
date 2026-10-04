import type { GameState, TaskId, Villager } from '../sim';

export interface UIActions {
  assignTask(villagerId: string, task: TaskId | null): void;
  /** Fired whenever the UI's own selection changes (card click, Escape, outside click). */
  onSelect(villagerId: string | null): void;
}

export interface UIHandle {
  render(state: GameState): void;
  dispose(): void;
  /** External selection (e.g. clicking a villager in the 3D scene); null clears it. */
  select(villagerId: string | null): void;
}

const TASK_ORDER: ReadonlyArray<TaskId> = ['chop', 'berries', 'rest'];
const TASK_LABELS: Record<TaskId, string> = {
  chop: 'Chop wood',
  berries: 'Gather berries',
  rest: 'Rest',
  // B1: labels for the expanded TaskId union; the task grid itself is a UI task.
  tend: 'Tend fire',
  cook: 'Cook',
};

/** Minimum gap between two yield pulses on the same HUD pill (M11a). */
const PULSE_THROTTLE_MS = 600;

const ICONS = {
  wood: `<svg class="pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="8" width="14" height="8" rx="4"/><path d="M17 9v6"/><path d="M7 12h3"/></svg>`,
  berries: `<svg class="pill-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="10" cy="15" r="5.5"/><circle cx="17" cy="16.5" r="4" opacity=".7"/><path d="M11 8c2.6-2.4 5.6-1.6 5.6-1.6s-.4 3.2-2.9 3.9c-2.4.6-2.7-2.3-2.7-2.3Z"/></svg>`,
} as const;

interface CardParts {
  card: HTMLElement;
  label: HTMLElement;
}

export function initUI(root: HTMLElement, actions: UIActions): UIHandle {
  root.innerHTML = `
    <div id="hud" class="panel">
      <div class="pill" data-res="wood" data-value="0">
        ${ICONS.wood}
        <span class="pill-label">Wood</span>
        <span class="pill-value">0</span>
      </div>
      <div class="pill" data-res="berries" data-value="0">
        ${ICONS.berries}
        <span class="pill-label">Berries</span>
        <span class="pill-value">0</span>
      </div>
    </div>
    <aside id="villager-panel" class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Villagers</h2>
        <p class="panel-hint">Pick someone, then give them a task.</p>
      </div>
      <div id="villager-list"></div>
      <div id="task-popover" hidden>
        <p class="popover-title"></p>
        ${TASK_ORDER.map(
          (task) =>
            `<button class="task-btn lift" type="button" data-task="${task}">${TASK_LABELS[task]}</button>`,
        ).join('')}
        <button class="task-btn stop-btn" type="button" data-task="stop" aria-disabled="true">Stop</button>
      </div>
    </aside>
  `;

  const list = must<HTMLElement>(root, '#villager-list');
  const popover = must<HTMLElement>(root, '#task-popover');
  const popoverTitle = must<HTMLElement>(popover, '.popover-title');
  const stopBtn = must<HTMLButtonElement>(popover, '.stop-btn');
  const cards = new Map<string, CardParts>();
  let selectedId: string | null = null;
  // A select() before the first render() has nothing to read the villager from yet, so
  // park the id and apply it as soon as cards exist.
  let pendingSelection: string | null | undefined;
  // Yield pulses are re-armed at most this often per pill, so a busy forest whispers
  // instead of throbbing (M11a). Counters are never throttled.
  const lastPulseAt = new Map<string, number>();

  /** Silent reset of the card + popover. Never notifies, so it is safe to reuse. */
  function clearSelectionVisuals(): void {
    cards.get(selectedId ?? '')?.card.classList.remove('selected');
    selectedId = null;
    popover.hidden = true;
  }

  /** Dismissal as a user action (Escape, outside click): the world layer must follow. */
  function closePopover(): void {
    if (popover.hidden) return;
    clearSelectionVisuals();
    actions.onSelect(null);
  }

  function syncActiveButtons(state: GameState): void {
    const task = state.villagers.find((v) => v.id === selectedId)?.task ?? null;
    for (const btn of popover.querySelectorAll<HTMLButtonElement>('.task-btn')) {
      btn.classList.toggle('active', btn.dataset.task === task);
    }
    // Stop is the inverse of a task: nothing to stop while the villager already has none.
    stopBtn.setAttribute('aria-disabled', task === null ? 'true' : 'false');
  }

  function openPopover(card: CardParts, state: GameState, notify: boolean): void {
    clearSelectionVisuals();
    const villager = state.villagers.find((v) => v.id === card.card.dataset.villagerId);
    if (!villager) return;
    selectedId = villager.id;
    card.card.classList.add('selected');
    popoverTitle.textContent = villager.name;
    // The popover is a footer below the list, so every card stays visible and clickable.
    popover.hidden = false;
    syncActiveButtons(state);
    // External selection already told the render layer, so only panel-driven picks notify.
    if (notify) actions.onSelect(villager.id);
  }

  /** T05: selection driven from outside the UI (3D click). Same visuals as a card click,
   but silent — the caller has already told the render layer. */
  function applySelection(villagerId: string | null, state: GameState): void {
    if (villagerId === null) {
      clearSelectionVisuals();
      return;
    }
    const parts = cards.get(villagerId);
    if (parts) openPopover(parts, state, false);
  }

  const onListClick = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target.closest('.villager-card') : null;
    if (!(target instanceof HTMLElement) || !lastState) return;
    const parts = cards.get(target.dataset.villagerId ?? '');
    if (parts) openPopover(parts, lastState, true);
  };

  const onPopoverClick = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target.closest('.task-btn') : null;
    if (!(target instanceof HTMLButtonElement) || !selectedId) return;
    if (target.dataset.task === 'stop') {
      // aria-disabled is enforced in CSS too, but the guard keeps keyboard activation honest.
      if (target.getAttribute('aria-disabled') === 'true') return;
      actions.assignTask(selectedId, null);
      return;
    }
    const task = target.dataset.task as TaskId | undefined;
    if (!task) return;
    actions.assignTask(selectedId, task);
    target.classList.add('active');
  };

  const onDocumentClick = (ev: MouseEvent): void => {
    if (popover.hidden || !(ev.target instanceof Node)) return;
    // Only clicks inside the UI dismiss the popover. A world click is T05 selection-driven,
    // and dismissing here would undo the selection main.ts just made in the same gesture.
    if (!root.contains(ev.target)) return;
    if (!popover.contains(ev.target) && !list.contains(ev.target)) closePopover();
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && !popover.hidden) closePopover();
  };

  function buildCards(state: GameState): void {
    const html = state.villagers
      .map(
        (v) =>
          `<button class="villager-card lift" type="button" data-villager-id="${v.id}">
            <span class="hat-dot"></span>
            <span class="villager-name">${v.name}</span>
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
      });
      const dot = must<HTMLElement>(card, '.hat-dot');
      dot.style.background = v.hatColor;
    });
  }

  let lastState: GameState | null = null;
  let cardsBuilt = false;

  list.addEventListener('click', onListClick);
  popover.addEventListener('click', onPopoverClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);

  /** Card label: what the villager is doing *now*, not what they were told to do (M11b). */
  function cardLabel(villager: Villager): string {
    if (villager.state === 'walking') return 'Walking…';
    if (villager.state === 'resting') return 'Resting';
    if (villager.state === 'working' && villager.task) return TASK_LABELS[villager.task];
    return 'Idle';
  }

  return {
    render(state: GameState): void {
      if (!cardsBuilt) {
        buildCards(state);
        cardsBuilt = true;
      }
      lastState = state;
      if (pendingSelection !== undefined) {
        const requested = pendingSelection;
        pendingSelection = undefined;
        applySelection(requested, state);
      }
      for (const res of ['wood', 'berries'] as const) {
        const pill = must<HTMLElement>(root, `#hud [data-res="${res}"]`);
        const value = String(state.resources[res]);
        if (pill.dataset.value !== value) {
          pill.dataset.value = value;
          const text = must<HTMLElement>(pill, '.pill-value');
          text.textContent = value;
        }
        if (state.events.some((ev) => (res === 'wood' ? ev.type === 'chop' : ev.type === 'gather'))) {
          // Yield pulse, throttled per pill: with a few choppers yielding every 1400 ms the
          // events arrive several times a second, which made the pill throb permanently.
          const now = performance.now();
          if (now - (lastPulseAt.get(res) ?? -Infinity) >= PULSE_THROTTLE_MS) {
            lastPulseAt.set(res, now);
            // Re-adding the class restarts the animation, and transform cannot shift layout.
            pill.classList.remove('yield-pulse');
            void pill.offsetWidth; // force reflow so the same class re-triggers
            pill.classList.add('yield-pulse');
          }
        }
      }
      for (const villager of state.villagers) {
        const parts = cards.get(villager.id);
        if (!parts) continue;
        const label = cardLabel(villager);
        if (parts.label.textContent !== label) parts.label.textContent = label;
      }
      if (selectedId) syncActiveButtons(state);
    },
    select(villagerId: string | null): void {
      if (!lastState) {
        pendingSelection = villagerId;
        return;
      }
      applySelection(villagerId, lastState);
    },
    dispose(): void {
      list.removeEventListener('click', onListClick);
      popover.removeEventListener('click', onPopoverClick);
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
      cards.clear();
      root.innerHTML = '';
    },
  };
}

function must<T extends HTMLElement>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`UI element missing: ${selector}`);
  return el;
}