import type { GameState, StructureKind, TaskId, Villager } from '../sim';
import { STRUCTURE_COST } from '../sim';

export interface UIActions {
  assignTask(villagerId: string, task: TaskId | null): void;
  /** Fired whenever the UI's own selection changes (card click, Escape, outside click). */
  onSelect(villagerId: string | null): void;
  /** B7: build a ghost structure. */
  build(structureId: string): void;
  /** B7: wipe the save and start a fresh village. */
  resetVillage(): void;
}

export interface UIHandle {
  render(state: GameState): void;
  dispose(): void;
  /** External selection (e.g. clicking a villager in the 3D scene); null clears it. */
  select(villagerId: string | null): void;
  /** B7: external structure selection (ghost or built). */
  selectStructure(structureId: string | null): void;
}

const TASK_ORDER: ReadonlyArray<TaskId> = ['chop', 'berries', 'rest', 'tend', 'cook'];
const TASK_LABELS: Record<TaskId, string> = {
  chop: 'Chop wood',
  berries: 'Gather berries',
  rest: 'Rest',
  // B1: labels for the expanded TaskId union; the task grid itself is a UI task.
  tend: 'Tend fire',
  cook: 'Cook',
};
/** What the card says once they are actually doing it — the gerund reads as progress. */
const WORK_LABELS: Record<TaskId, string> = {
  chop: 'Chop wood',
  berries: 'Gather berries',
  rest: 'Resting',
  tend: 'Tending fire',
  cook: 'Cooking',
};

/** Minimum gap between two yield pulses on the same HUD pill (M11a). */
const PULSE_THROTTLE_MS = 600;
/** How long the reset button stays armed before quietly disarming itself. */
const RESET_ARM_MS = 3000;
const FUEL_ROARING = 66;
const FUEL_STEADY = 33;

const ICONS = {
  wood: `<svg class="pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="8" width="14" height="8" rx="4"/><path d="M17 9v6"/><path d="M7 12h3"/></svg>`,
  berries: `<svg class="pill-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="10" cy="15" r="5.5"/><circle cx="17" cy="16.5" r="4" opacity=".7"/><path d="M11 8c2.6-2.4 5.6-1.6 5.6-1.6s-.4 3.2-2.9 3.9c-2.4.6-2.7-2.3-2.7-2.3Z"/></svg>`,
  fire: `<svg class="pill-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1.6 3.4.4 5.2-1.4 6.9C8.4 11 6.5 12.6 6.5 15.5A5.5 5.5 0 0 0 12 21a5.5 5.5 0 0 0 5.5-5.5c0-2.4-1.3-4.2-2.7-5.6-.6 1-1.4 1.6-2.3 1.8.9-3.6-.3-6.9-.5-9.7Z"/></svg>`,
} as const;

const STRUCTURE_NAMES: Record<StructureKind, string> = {
  woodpile: 'Woodpile',
  pot: 'Cooking pot',
  bench: 'Bench',
  garden: 'Garden',
  lantern: 'Lantern',
  feeder: 'Bird feeder',
};

interface CardParts {
  card: HTMLElement;
  label: HTMLElement;
}

export function initUI(root: HTMLElement, actions: UIActions): UIHandle {
  const costIcon = (kind: 'wood' | 'berries'): string => ICONS[kind].replace('pill-icon', 'cost-icon');

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
      <div class="pill fuel-pill" data-res="fuel" data-state="steady">
        ${ICONS.fire}
        <span class="fuel-stack">
          <span class="fuel-head">
            <span class="pill-label">Fire</span>
            <span class="pill-value">0</span>
          </span>
          <span class="fuel-bar"><span class="fuel-fill"></span></span>
        </span>
      </div>
      <button class="reset-btn" type="button" data-armed="false" aria-label="Start a fresh village">⟲</button>
    </div>
    <aside id="villager-panel" class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Villagers</h2>
        <p class="panel-hint">Pick someone, then give them a task.</p>
      </div>
      <div id="villager-list"></div>
      <div id="task-popover" hidden>
        <p class="popover-title"></p>
        <div class="task-grid">
          ${TASK_ORDER.map(
            (task) =>
              `<button class="task-btn lift" type="button" data-task="${task}"${
                task === 'cook' ? ' aria-disabled="true"' : ''
              }>${TASK_LABELS[task]}</button>`,
          ).join('')}
          <button class="task-btn stop-btn" type="button" data-task="stop" aria-disabled="true">Stop</button>
        </div>
        <div id="structure-card" hidden>
          <p class="structure-cost"></p>
          <button class="build-btn" type="button" data-build aria-disabled="true">Build</button>
          <p class="structure-short"></p>
          <p class="structure-status"></p>
        </div>
      </div>
    </aside>
  `;

  const list = must<HTMLElement>(root, '#villager-list');
  const popover = must<HTMLElement>(root, '#task-popover');
  const popoverTitle = must<HTMLElement>(popover, '.popover-title');
  const taskGrid = must<HTMLElement>(popover, '.task-grid');
  const stopBtn = must<HTMLButtonElement>(popover, '.stop-btn');
  const cookBtn = must<HTMLButtonElement>(popover, '[data-task="cook"]');
  const structureCard = must<HTMLElement>(popover, '#structure-card');
  const structureCost = must<HTMLElement>(structureCard, '.structure-cost');
  const structureShort = must<HTMLElement>(structureCard, '.structure-short');
  const structureStatus = must<HTMLElement>(structureCard, '.structure-status');
  const buildBtn = must<HTMLButtonElement>(structureCard, '[data-build]');
  const fuelPill = must<HTMLElement>(root, '#hud [data-res="fuel"]');
  const fuelValueNode = must<HTMLElement>(fuelPill, '.pill-value');
  const fuelFill = must<HTMLElement>(fuelPill, '.fuel-fill');
  const resetBtn = must<HTMLButtonElement>(root, '.reset-btn');
  const cards = new Map<string, CardParts>();
  let selectedId: string | null = null;
  let selectedStructureId: string | null = null;
  // A select()/selectStructure() before the first render() has nothing to read from yet, so
  // park the request and apply it as soon as cards exist.
  let pendingSelection: string | null | undefined;
  let pendingStructure: string | null | undefined;
  // Yield pulses are re-armed at most this often per pill, so a busy forest whispers
  // instead of throbbing (M11a). Counters are never throttled.
  const lastPulseAt = new Map<string, number>();
  // Pills are static markup: resolve them once instead of per frame (M1).
  const woodPill = must<HTMLElement>(root, '#hud [data-res="wood"]');
  const woodValue = must<HTMLElement>(woodPill, '.pill-value');
  const berriesPill = must<HTMLElement>(root, '#hud [data-res="berries"]');
  const berriesValue = must<HTMLElement>(berriesPill, '.pill-value');
  /** Last structure-card signature rendered; '' means "nothing rendered yet" (M1). */
  let lastStructureSignature = '';
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  /** Silent reset of the card + popover. Never notifies, so it is safe to reuse. */
  function clearSelectionVisuals(): void {
    cards.get(selectedId ?? '')?.card.classList.remove('selected');
    selectedId = null;
    selectedStructureId = null;
    popover.hidden = true;
  }

  /** Dismissal as a user action (Escape, outside click): the world layer must follow. */
  function closePopover(): void {
    if (popover.hidden) return;
    clearSelectionVisuals();
    actions.onSelect(null);
  }

  function setDisabled(btn: HTMLButtonElement, disabled: boolean): void {
    btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  function syncActiveButtons(state: GameState): void {
    const task = state.villagers.find((v) => v.id === selectedId)?.task ?? null;
    for (const btn of taskGrid.querySelectorAll<HTMLButtonElement>('.task-btn')) {
      btn.classList.toggle('active', btn.dataset.task === task);
    }
    // Stop is the inverse of a task: nothing to stop while the villager already has none.
    setDisabled(stopBtn, task === null);
    // Cooking needs something to cook in.
    setDisabled(cookBtn, !state.structures.some((s) => s.kind === 'pot' && s.built));
  }

  /** B7: the structure card — name in the popover title, then cost + Build or a status line.
   *  Signature-guarded (M1): the cost line is an innerHTML rewrite with inline SVGs, so it must
   *  not run on a frame where nothing it displays has changed. */
  function syncStructureCard(state: GameState): void {
    const structure = state.structures.find((s) => s.id === selectedStructureId);
    // The popover shows one thing at a time: the task grid for a villager, the card for a structure.
    taskGrid.hidden = structure !== undefined;
    structureCard.hidden = structure === undefined;
    if (!structure) return;

    const signature = `${structure.kind}|${structure.built}|${state.resources.wood}|${state.resources.berries}|${state.pot.meals}`;
    if (signature === lastStructureSignature) return;
    lastStructureSignature = signature;

    const cost = STRUCTURE_COST[structure.kind];
    const affordable =
      state.resources.wood >= cost.wood && state.resources.berries >= cost.berries;

    if (structure.built) {
      structureCost.textContent = '';
      structureShort.textContent = '';
      setDisabled(buildBtn, true);
      buildBtn.hidden = true;
      if (structure.kind === 'pot') structureStatus.textContent = `Meals: ${state.pot.meals}`;
      else if (structure.kind === 'garden') structureStatus.textContent = 'Growing…';
      else structureStatus.textContent = 'Built';
      return;
    }

    structureStatus.textContent = '';
    buildBtn.hidden = false;
    setDisabled(buildBtn, !affordable);
    const parts: string[] = [];
    if (cost.wood > 0) parts.push(`<span class="cost-item">${costIcon('wood')}<b>${cost.wood}</b></span>`);
    if (cost.berries > 0) parts.push(`<span class="cost-item">${costIcon('berries')}<b>${cost.berries}</b></span>`);
    structureCost.innerHTML = parts.join('');

    // Name what is missing rather than just greying the button out.
    const short: string[] = [];
    if (cost.wood > state.resources.wood) short.push(`${cost.wood - state.resources.wood} more wood`);
    if (cost.berries > state.resources.berries) short.push(`${cost.berries - state.resources.berries} more berries`);
    structureShort.textContent = affordable ? '' : `Need ${short.join(' and ')}`;
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
    syncStructureCard(state);
    // External selection already told the render layer, so only panel-driven picks notify.
    if (notify) actions.onSelect(villager.id);
  }

  /** T05: selection driven from outside the UI (3D click). Same visuals as a card click,
   *  but silent — the caller has already told the render layer. */
  function applySelection(villagerId: string | null, state: GameState): void {
    if (villagerId === null) {
      clearSelectionVisuals();
      return;
    }
    const parts = cards.get(villagerId);
    if (parts) openPopover(parts, state, false);
  }

  /** B7: a structure selected from the 3D world. Silent — main.ts already synced the world. */
  function applyStructureSelection(structureId: string | null, state: GameState): void {
    // C1: `null` means "no structure under this click", not "clear everything". main.ts calls
    // `ui.select(villagerId)` first, so clearing the villager selection here would undo a
    // world click on a villager in the same gesture. Drop the structure half only.
    if (structureId === null) {
      selectedStructureId = null;
      return;
    }
    clearSelectionVisuals();
    const structure = state.structures.find((s) => s.id === structureId);
    if (!structure) return;
    selectedStructureId = structure.id;
    popoverTitle.textContent = STRUCTURE_NAMES[structure.kind];
    popover.hidden = false;
    syncActiveButtons(state);
    lastStructureSignature = ''; // force the card to render for the newly selected structure
    syncStructureCard(state);
  }

  const onListClick = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target.closest('.villager-card') : null;
    if (!(target instanceof HTMLElement) || !lastState) return;
    const parts = cards.get(target.dataset.villagerId ?? '');
    if (parts) openPopover(parts, lastState, true);
  };

  const onPopoverClick = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target.closest('button') : null;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset.build !== undefined) {
      if (target.getAttribute('aria-disabled') === 'true' || !selectedStructureId) return;
      actions.build(selectedStructureId);
      return;
    }
    if (!selectedId) return;
    if (target.dataset.task === 'stop') {
      // aria-disabled is enforced in CSS too, but the guard keeps keyboard activation honest.
      if (target.getAttribute('aria-disabled') === 'true') return;
      actions.assignTask(selectedId, null);
      return;
    }
    const task = target.dataset.task as TaskId | undefined;
    if (!task || target.getAttribute('aria-disabled') === 'true') return;
    actions.assignTask(selectedId, task);
    target.classList.add('active');
  };

  const onResetClick = (): void => {
    if (resetBtn.dataset.armed === 'true') {
      actions.resetVillage();
      return;
    }
    resetBtn.dataset.armed = 'true';
    resetBtn.textContent = 'Sure?';
    resetBtn.setAttribute('aria-label', 'Click again to wipe the village');
    if (resetTimer !== null) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      resetBtn.dataset.armed = 'false';
      resetBtn.textContent = '⟲';
      resetBtn.setAttribute('aria-label', 'Start a fresh village');
      resetTimer = null;
    }, RESET_ARM_MS);
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
  resetBtn.addEventListener('click', onResetClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);

  /** Card label: what the villager is doing *now*, not what they were told to do (M11b). */
  function cardLabel(villager: Villager): string {
    if (villager.state === 'walking') return 'Walking…';
    if (villager.state === 'resting') return 'Resting';
    if (villager.state === 'working' && villager.task) return WORK_LABELS[villager.task];
    return 'Idle';
  }

  function fireState(fuel: number, max: number): string {
    const ratio = max > 0 ? fuel / max : 0;
    if (ratio * 100 >= FUEL_ROARING) return 'roaring';
    if (ratio * 100 >= FUEL_STEADY) return 'steady';
    return ratio > 0 ? 'dim' : 'embers';
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
      if (pendingStructure !== undefined) {
        const requested = pendingStructure;
        pendingStructure = undefined;
        applyStructureSelection(requested, state);
      }
      for (const res of ['wood', 'berries'] as const) {
        // M1: pill + value nodes are hoisted out of the frame; only the numbers change here.
        const pill = res === 'wood' ? woodPill : berriesPill;
        const text = res === 'wood' ? woodValue : berriesValue;
        const value = String(state.resources[res]);
        if (pill.dataset.value !== value) {
          pill.dataset.value = value;
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
      // Fuel: number + bar + a data-state class. The bar is a fixed-width track so a shrinking
      // fill cannot reflow the pill.
      const fuel = String(Math.round(state.fire.fuel));
      if (fuelPill.dataset.value !== fuel) {
        fuelPill.dataset.value = fuel;
        fuelValueNode.textContent = fuel;
        fuelFill.style.width = `${(state.fire.max > 0 ? (state.fire.fuel / state.fire.max) * 100 : 0).toFixed(1)}%`;
      }
      const fire = fireState(state.fire.fuel, state.fire.max);
      if (fuelPill.dataset.state !== fire) fuelPill.dataset.state = fire;

      for (const villager of state.villagers) {
        const parts = cards.get(villager.id);
        if (!parts) continue;
        const label = cardLabel(villager);
        if (parts.label.textContent !== label) parts.label.textContent = label;
      }
      if (selectedId) syncActiveButtons(state);
      if (selectedStructureId) syncStructureCard(state);
    },
    select(villagerId: string | null): void {
      if (!lastState) {
        pendingSelection = villagerId;
        return;
      }
      applySelection(villagerId, lastState);
    },
    selectStructure(structureId: string | null): void {
      if (!lastState) {
        pendingStructure = structureId;
        return;
      }
      applyStructureSelection(structureId, lastState);
    },
    dispose(): void {
      list.removeEventListener('click', onListClick);
      popover.removeEventListener('click', onPopoverClick);
      resetBtn.removeEventListener('click', onResetClick);
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
      if (resetTimer !== null) clearTimeout(resetTimer);
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