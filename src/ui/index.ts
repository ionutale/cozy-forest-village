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
import { appendCards, buildCards, cancelHeartPulse, syncCards, type CardParts } from './cards';
import {
  DEFAULT_HINT, STRUCTURE_NAMES, THANK_YOU_MS, favorPopoverLine, fireState,
  firstFavorDoneVillagerId, hintRecomputeDue, tradeDisabled, villageLine,
} from './derive';
import { bindRefs, uiMarkup } from './markup';
import { createStructureCard } from './structure-card';
import type { TradeKind } from './derive';

export interface UIActions {
  assignTask(villagerId: string, task: TaskId | null): void;
  /** Fired whenever the UI's own selection changes (card click, Escape, outside click). */
  onSelect(villagerId: string | null): void;
  /** B7: build a ghost structure. */
  build(structureId: string): void;
  /** B7: wipe the save and start a fresh village. */
  resetVillage(): void;
  /** T3: buy from the visiting trader. `'berries'` sells 5 wood, `'spice'` sells 6 berries. */
  trade(kind: TradeKind): void;
}

export interface UIHandle {
  render(state: GameState): void;
  dispose(): void;
  /** External selection (e.g. clicking a villager in the 3D scene); null clears it. */
  select(villagerId: string | null): void;
  /** B7: external structure selection (ghost or built). */
  selectStructure(structureId: string | null): void;
  /**
   * T3: show the popover's trader face — the third face, same zone 3. Silent, like
   * `selectStructure`: main.ts has already told the render layer the trader is selected.
   *
   * DESIGN §3 declares this as `selectTrader(): void`, and a zero-arg call still opens the face.
   * The optional `on` exists because main.ts calls it unconditionally once per click — with only
   * a zero-arg signature, that call would *open* the trader face on every click of a villager or
   * of empty ground during a visit. `on = false` therefore closes just the trader face, leaving
   * any villager or structure face main.ts opened in the same gesture untouched.
   *
   * The mode also closes itself on `select(null)`, when another face opens, and when the visit
   * ends; a `selectTrader()` for a trader who is not visiting is a no-op.
   */
  selectTrader(on?: boolean): void;
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
  /**
   * T3: the popover's third face. Set by `selectTrader()` (a 3D click on the trader) and cleared
   * by every other path that opens the popover — so the three faces are mutually exclusive by
   * construction rather than by three separate hide calls at each site.
   */
  let traderMode = false;
  /** T3: a `selectTrader()` arriving before the first `render()`; applied as soon as state exists. */
  let pendingTrader = false;
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
  /** T3: the hint's trader-slot edge — last frame's phase, so the recompute clock can see it flip. */
  let visitingBefore = false;

  function selectedStructure(state: GameState): Structure | undefined {
    return state.structures.find((s) => s.id === selectedStructureId);
  }

  /** Silent reset of the card + popover. Never notifies, so it is safe to reuse. */
  function clearSelectionVisuals(): void {
    cards.get(selectedId ?? '')?.card.classList.remove('selected');
    selectedId = null;
    selectedStructureId = null;
    // T3: the trader face is one of the three mutually exclusive faces, so this always closes it.
    refs.traderCard.hidden = true;
    traderMode = false;
    popover.dataset.face = 'none';
    popover.hidden = true;
  }

  /** Dismissal as a user action (Escape, outside click): the world layer must follow. */
  function closePopover(): void {
    if (popover.hidden) return;
    clearSelectionVisuals();
    actions.onSelect(null);
  }

  /** Transition-only: `syncActiveButtons` runs every frame while a villager is selected, so an
   *  unconditional `setAttribute` here would be a per-frame DOM write. */
  function setDisabled(btn: HTMLButtonElement, disabled: boolean): void {
    const next = disabled ? 'true' : 'false';
    if (btn.getAttribute('aria-disabled') !== next) btn.setAttribute('aria-disabled', next);
  }

  function syncActiveButtons(state: GameState): void {
    const villager = state.villagers.find((v) => v.id === selectedId);
    const task = villager?.task ?? null;
    // H3: a walk-in cannot be given a task (the sim refuses), so the grid does not pretend
    // otherwise. Every task button — Stop included — is disabled until they finish walking in.
    const arriving = villager?.state === 'arriving';
    for (const btn of taskGrid.querySelectorAll<HTMLButtonElement>('.task-btn')) {
      btn.classList.toggle('active', btn.dataset.task === task);
      // The loop owns the whole transition (review C1): it must clear the lock too, or chop /
      // berries / rest / tend keep the `true` written during the walk-in forever — a newcomer
      // who was clicked mid-arrival would never be assignable again. Stop and Cook refine their
      // own gate on the two lines below.
      setDisabled(btn, arriving);
    }
    if (arriving) return; // cook/stop gating is moot while the whole grid is disabled
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
    popover.dataset.face = 'villager';
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
    // T3d: recorded, but no CSS keys off it — the structure face keeps showing the task grid,
    // which is pre-existing behaviour this wave must not change. It is set anyway so the
    // attribute always names the face actually on screen.
    popover.dataset.face = 'structure';
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

  /**
   * T3: the trader face's live state. Both buttons read `tradeDisabled`, which mirrors the sim's
   * own refusals (no visit, no trades left, not enough stock), and the "Trades left" line reads
   * the counter — so a spent visit greys both buttons instead of letting a click bounce off the
   * sim. Every write is transition-guarded, because this runs every frame the face is open.
   */
  function syncTrader(state: GameState): void {
    // T3d: the label, not a bare counter — the live capture showed a lonely "0". Same string the
    // spec names, composed here so the countdown logic is untouched and the guard still compares
    // against the whole line (a change in either the count or the wording repaints once).
    const tradesLeft = `Trades left: ${state.visitor.tradesLeft}`;
    if (refs.tradesLeft.textContent !== tradesLeft) refs.tradesLeft.textContent = tradesLeft;
    for (const btn of refs.tradeBtns) {
      setDisabled(btn, tradeDisabled(state, btn.dataset.trade as TradeKind));
    }
  }

  /** T3: show the third face. Silent — main.ts has already told the render layer. */
  function applyTraderSelection(state: GameState): void {
    // Nothing to trade with if nobody is here, so the mode simply does not open.
    if (state.visitor.phase !== 'visiting') return;
    clearSelectionVisuals();
    traderMode = true;
    refs.traderCard.hidden = false;
    popoverTitle.textContent = 'Trader';
    // T3d: the face switch. One attribute, written once per gesture, hides the shared villager
    // chrome for this face only (see ui.css). `card.sync(state, undefined)` retires any structure
    // card a previous selection left rendered — without it the trader face could show a stale
    // cost/Build line, because `clearSelectionVisuals` does not touch the card and the pump only
    // syncs it while a structure is selected.
    popover.dataset.face = 'trader';
    card.sync(state, undefined);
    popover.hidden = false;
    syncTrader(state);
  }

  /**
   * T3: close only the trader face. Deliberately narrower than `clearSelectionVisuals`, because
   * `selectTrader(false)` arrives *after* main.ts has opened a villager or structure face in the
   * same gesture — closing everything there would dismiss the selection the player just made.
   */
  function closeTraderFace(): void {
    if (!traderMode) return;
    traderMode = false;
    refs.traderCard.hidden = true;
    // Nothing else is selected, so the popover itself has no reason to stay open.
    if (selectedId === null && selectedStructureId === null) popover.hidden = true;
    // Review M1: closing the face is not enough — the world's selection ring has to hear about it.
    // Without this the visit-end auto-close left `traderSelected` true in the render layer, so the
    // next visit re-lit the ring under a popover that was no longer open, for the whole visit,
    // until the player happened to click the canvas. Every other face opens through
    // `clearSelectionVisuals`, so `traderMode` implies no villager and no structure is selected —
    // which is what makes the other halves of `onSelect(null)` no-ops here rather than a bug.
    actions.onSelect(null);
  }

  const onPopoverClick = (ev: Event): void => {
    const target = ev.target instanceof Element ? ev.target.closest('button') : null;
    if (!(target instanceof HTMLButtonElement)) return;
    // T3: a trade button wins before every other branch — it is the only face that can carry one.
    const trade = target.dataset.trade as TradeKind | undefined;
    if (trade !== undefined) {
      if (!traderMode || !lastState) return;
      // aria-disabled is enforced in CSS too, but the guard keeps keyboard activation honest.
      if (tradeDisabled(lastState, trade)) return;
      actions.trade(trade);
      // The sim moved the stock and the trade counter; repaint from the truth, not from a guess.
      syncTrader(lastState);
      return;
    }
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
      if (pendingTrader) {
        pendingTrader = false;
        applyTraderSelection(state);
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
      // T3: the spices pill. Hoisted out of the frame like the other two and guarded the same
      // way — spices only ever change on a trade (up) or a hearty eat (down), so this settles to
      // a single integer comparison per frame and writes only on a real change. No yield pulse:
      // there is no gather event for a trade.
      const spices = String(state.resources.spices);
      if (refs.spicesPill.dataset.value !== spices) {
        refs.spicesPill.dataset.value = spices;
        refs.spicesValue.textContent = spices;
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

      // H3: a newcomer's arrival grows the roster; append just their card. Existing cards are
      // never rewritten, so their transition state (fed tint, favor heart, pulse) survives.
      // Keyed on `list.children.length`, not `cards.size` (review M2): `cards` is keyed by villager
      // id, so a save carrying two villagers sharing an id would keep `cards.size` below
      // `villagers.length` forever and append one card per frame, without bound.
      if (list.children.length !== state.villagers.length) appendCards(list, cards, state);
      syncCards(cards, state);
      if (selectedId) syncActiveButtons(state);
      if (selectedStructureId) card.sync(state, selectedStructure(state));
      // T3: the trader face closes itself when the visit ends, so a trader who walks away never
      // leaves two live trade buttons in the popover. `tradesLeft` reaching 0 is not a close —
      // the trader is still standing there, and the buttons simply go grey — so only the sim's
      // own phase ends the mode.
      if (traderMode) {
        if (state.visitor.phase === 'visiting') syncTrader(state);
        else closeTraderFace();
      }

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
      // hint. M1: when two completions land in one batch the *first* event wins, so the window
      // belongs to one requester deterministically instead of the last overwriting the other.
      const thanksBefore = thanksName;
      const doneId = firstFavorDoneVillagerId(state.events);
      if (doneId !== null) {
        const done = state.villagers.find((v) => v.id === doneId);
        if (done) {
          thanksName = done.name;
          thanksUntil = now + THANK_YOU_MS;
        }
      }
      if (thanksName !== null && now >= thanksUntil) thanksName = null;

      // T3: the trader slot is an edge too, for the same reason the thanks window is — a visit is
      // time-boxed, so a 10 s cadence could announce a trader who has already left, or leave
      // "A trader is visiting!" up long after they walked off.
      const visitingNow = state.visitor.phase === 'visiting';

      // B1 rotating hint: recompute on a slow clock, then write only on a real change — two
      // guards, so the line cannot flicker and the DOM is untouched on every other frame.
      // M6: the thanks window's open and close edges also force an immediate recompute — the
      // window is shorter than the cadence, so waiting could miss "delighted!" entirely. The
      // clock is wall time because UIHandle.render(state) carries no dtMs (DESIGN §3).
      if (hintRecomputeDue(now, hintDueAt, thanksBefore, thanksName, visitingBefore, visitingNow)) {
        hintDueAt = now + HINT_INTERVAL_MS;
        visitingBefore = visitingNow;
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
    selectTrader(on = true): void {
      if (on === false) {
        // Nothing to read from yet, but the request is still remembered — a close that arrives
        // before the first render must not be answered by a later stale open.
        pendingTrader = false;
        if (lastState) closeTraderFace();
        return;
      }
      if (!lastState) {
        pendingTrader = true;
        return;
      }
      applyTraderSelection(lastState);
    },
    dispose(): void {
      list.removeEventListener('click', onListClick);
      popover.removeEventListener('click', onPopoverClick);
      resetBtn.removeEventListener('click', onResetClick);
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
      if (resetTimer !== null) clearTimeout(resetTimer);
      // G3: drop pending heart-pulse hides so no timer writes to a detached card.
      for (const parts of cards.values()) cancelHeartPulse(parts);
      cards.clear();
      root.innerHTML = '';
    },
  };
}