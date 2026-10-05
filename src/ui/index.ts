// Cozy UI — orchestration and the public surface (DESIGN §3). Three zones, unchanged: the
// resource HUD, the villager panel, and the task popover nested inside the panel.
//
// Everything with a job to do lives in a sibling module:
//   derive.ts         pure GameState → displayable value (unit-tested, no DOM)
//   markup.ts         the static template, icons, and the once-only node lookups
//   cards.ts          the villager list
//   structure-card.ts the card view object + its M1 signature guard
// This file owns selection state, event wiring, and the per-frame pump.

import type { GameState, Structure, TaskId } from '../sim';
import { buildCards, syncCards, type CardParts } from './cards';
import {
  DEFAULT_HINT, STRUCTURE_NAMES, THANK_YOU_MS, favorPopoverLine, fireState, villageLine,
} from './derive';
import { bindRefs, uiMarkup } from './markup';
import { createStructureCard } from './structure-card';

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

/** Minimum gap between two yield pulses on the same HUD pill (M11a). */
const PULSE_THROTTLE_MS = 600;
/** How long the reset button stays armed before quietly disarming itself. */
const RESET_ARM_MS = 3000;
/** B1: how often the panel hint may be recomputed. Long enough to read, short enough to notice. */
const HINT_INTERVAL_MS = 10000;

export function initUI(root: HTMLElement, actions: UIActions): UIHandle {
  root.innerHTML = uiMarkup();
  const refs = bindRefs(root);
  const { list, popover, popoverTitle, panelHint, taskGrid, stopBtn, cookBtn, resetBtn, fuelPill, favorLine } = refs;
  const card = createStructureCard(refs);

  const cards = new Map<string, CardParts>();
  let selectedId: string | null = null;
  let selectedStructureId: string | null = null;
  // A select()/selectStructure() before the first render() has nothing to read from yet, so
  // park the request and apply it as soon as cards exist.
  let pendingSelection: string | null | undefined;
  let pendingStructure: string | null | undefined;
  // Yield pulses are re-armed at most this often per pill, so a busy forest whispers instead of
  // throbbing (M11a). Counters are never throttled.
  const lastPulseAt = new Map<string, number>();
  /** B1: the hint's own change-guard + recompute clock. Same pattern as the M1 signature. */
  let lastHint = DEFAULT_HINT;
  let hintDueAt = 0;
  /** Batch 4: the "delighted!" name and the wall-clock end of its window (UI-side only). */
  let thanksName: string | null = null;
  let thanksUntil = 0;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  function selectedStructure(state: GameState): Structure | undefined {
    return state.structures.find((s) => s.id === selectedStructureId);
  }

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

  function openPopover(cardParts: CardParts, state: GameState, notify: boolean): void {
    clearSelectionVisuals();
    const villager = state.villagers.find((v) => v.id === cardParts.card.dataset.villagerId);
    if (!villager) return;
    selectedId = villager.id;
    cardParts.card.classList.add('selected');
    popoverTitle.textContent = villager.name;
    // The popover is a footer below the list, so every card stays visible and clickable.
    popover.hidden = false;
    syncActiveButtons(state);
    card.sync(state, undefined);
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
    card.reset(); // force a repaint for the newly selected structure
    card.sync(state, structure);
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

  let lastState: GameState | null = null;
  let cardsBuilt = false;

  list.addEventListener('click', onListClick);
  popover.addEventListener('click', onPopoverClick);
  resetBtn.addEventListener('click', onResetClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);

  return {
    render(state: GameState): void {
      if (!cardsBuilt) {
        buildCards(list, cards, state);
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
        const pill = res === 'wood' ? refs.woodPill : refs.berriesPill;
        const text = res === 'wood' ? refs.woodValue : refs.berriesValue;
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
      // A1: a log deposit (fuel-add) pulses the fire pill, same mechanism as the yields. One log
      // is +25 fuel, so this fires on real progress rather than on the 0.22/s decay.
      if (state.events.some((ev) => ev.type === 'fuel-add')) {
        const now = performance.now();
        if (now - (lastPulseAt.get('fuel') ?? -Infinity) >= PULSE_THROTTLE_MS) {
          lastPulseAt.set('fuel', now);
          fuelPill.classList.remove('yield-pulse');
          void fuelPill.offsetWidth; // force reflow so the same class re-triggers
          fuelPill.classList.add('yield-pulse');
        }
      }
      // Fuel: number + bar + a data-state class. The bar is a fixed-width track so a shrinking
      // fill cannot reflow the pill.
      const fuel = String(Math.round(state.fire.fuel));
      if (fuelPill.dataset.value !== fuel) {
        fuelPill.dataset.value = fuel;
        refs.fuelValue.textContent = fuel;
        refs.fuelFill.style.width = `${(state.fire.max > 0 ? (state.fire.fuel / state.fire.max) * 100 : 0).toFixed(1)}%`;
      }
      const fire = fireState(state.fire.fuel, state.fire.max);
      if (fuelPill.dataset.state !== fire) fuelPill.dataset.state = fire;

      syncCards(cards, state);
      if (selectedId) syncActiveButtons(state);
      if (selectedStructureId) card.sync(state, selectedStructure(state));

      // Batch 4: the popover's `Favor:` line for the selected villager. `visibility` (not the
      // `hidden` attribute) keeps the reserved slot in the layout — the markup reserves two
      // lines, so a favor appearing or clearing never jumps the task grid below it.
      const selectedIndex = selectedId ? state.villagers.findIndex((v) => v.id === selectedId) : -1;
      const popoverFavor = selectedIndex >= 0 ? favorPopoverLine(state, selectedIndex) : null;
      if (favorLine.textContent !== (popoverFavor ?? '')) favorLine.textContent = popoverFavor ?? '';
      const favorVisibility = popoverFavor !== null ? 'visible' : 'hidden';
      if (favorLine.style.visibility !== favorVisibility) favorLine.style.visibility = favorVisibility;

      const now = performance.now();
      // Batch 4 thank-you window: a `favor-done` opens THANK_YOU_MS of "is delighted!" in the
      // hint. The hint is made due on the window's open and close edges so the moment is never
      // missed between the existing 10 s recomputes — the recompute cadence itself is unchanged.
      for (const ev of state.events) {
        if (ev.type !== 'favor-done') continue;
        const done = ev.villagerId ? state.villagers.find((v) => v.id === ev.villagerId) : undefined;
        if (!done) continue;
        thanksName = done.name;
        thanksUntil = now + THANK_YOU_MS;
        hintDueAt = 0;
      }
      if (thanksName !== null && now >= thanksUntil) {
        thanksName = null;
        hintDueAt = 0;
      }

      // B1 rotating hint: recompute on a slow clock, then write only on a real change — two
      // guards, so the line cannot flicker and the DOM is untouched on every other frame.
      // The clock is wall time because UIHandle.render(state) carries no dtMs (DESIGN §3).
      if (now >= hintDueAt) {
        hintDueAt = now + HINT_INTERVAL_MS;
        const line = villageLine(state, thanksName);
        if (line !== lastHint) {
          lastHint = line;
          panelHint.textContent = line;
        }
      }
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