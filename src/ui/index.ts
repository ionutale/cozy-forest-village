import type { GameState, TaskId } from '../sim';

export interface UIActions {
  assignTask(villagerId: string, task: TaskId | null): void;
}

export interface UIHandle {
  render(state: GameState): void;
  dispose(): void;
}

const TASK_ORDER: ReadonlyArray<TaskId> = ['chop', 'berries', 'rest'];
const TASK_LABELS: Record<TaskId, string> = {
  chop: 'Chop wood',
  berries: 'Gather berries',
  rest: 'Rest',
};

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
      </div>
    </aside>
  `;

  const list = must<HTMLElement>(root, '#villager-list');
  const popover = must<HTMLElement>(root, '#task-popover');
  const popoverTitle = must<HTMLElement>(popover, '.popover-title');
  const cards = new Map<string, CardParts>();
  let selectedId: string | null = null;

  function closePopover(): void {
    cards.get(selectedId ?? '')?.card.classList.remove('selected');
    selectedId = null;
    popover.hidden = true;
  }

  function syncActiveButtons(state: GameState): void {
    const task = state.villagers.find((v) => v.id === selectedId)?.task ?? null;
    for (const btn of popover.querySelectorAll<HTMLButtonElement>('.task-btn')) {
      btn.classList.toggle('active', btn.dataset.task === task);
    }
  }

  function openPopover(card: CardParts, state: GameState): void {
    closePopover();
    const villager = state.villagers.find((v) => v.id === card.card.dataset.villagerId);
    if (!villager) return;
    selectedId = villager.id;
    card.card.classList.add('selected');
    popoverTitle.textContent = villager.name;
    // The popover is a footer below the list, so every card stays visible and clickable.
    popover.hidden = false;
    syncActiveButtons(state);
  }

  const onListClick = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target.closest('.villager-card') : null;
    if (!(target instanceof HTMLElement) || !lastState) return;
    const parts = cards.get(target.dataset.villagerId ?? '');
    if (parts) openPopover(parts, lastState);
  };

  const onPopoverClick = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target.closest('.task-btn') : null;
    if (!(target instanceof HTMLButtonElement) || !selectedId) return;
    const task = target.dataset.task as TaskId | undefined;
    if (!task) return;
    actions.assignTask(selectedId, task);
    target.classList.add('active');
  };

  const onDocumentClick = (ev: MouseEvent): void => {
    if (!popover.hidden && ev.target instanceof Node) {
      if (!popover.contains(ev.target) && !list.contains(ev.target)) closePopover();
    }
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

  return {
    render(state: GameState): void {
      if (!cardsBuilt) {
        buildCards(state);
        cardsBuilt = true;
      }
      lastState = state;
      for (const res of ['wood', 'berries'] as const) {
        const pill = must<HTMLElement>(root, `#hud [data-res="${res}"]`);
        const value = String(state.resources[res]);
        if (pill.dataset.value !== value) {
          pill.dataset.value = value;
          const text = must<HTMLElement>(pill, '.pill-value');
          text.textContent = value;
        }
      }
      for (const villager of state.villagers) {
        const parts = cards.get(villager.id);
        if (!parts) continue;
        const label = villager.task ? TASK_LABELS[villager.task] : 'Idle';
        if (parts.label.textContent !== label) parts.label.textContent = label;
      }
      if (selectedId) syncActiveButtons(state);
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