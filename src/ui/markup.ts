// The UI's static markup: one template, the inline SVG icons, and the DOM lookups. Everything
// here runs once per initUI() — nothing in this file is on the per-frame path (WD1).

import { DEFAULT_HINT, TASK_LABELS } from './derive';
import type { TaskId } from '../sim';

/** Task button order in the 2×3 popover grid. */
export const TASK_ORDER: ReadonlyArray<TaskId> = ['chop', 'berries', 'rest', 'tend', 'cook'];

export const ICONS = {
  wood: `<svg class="pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="8" width="14" height="8" rx="4"/><path d="M17 9v6"/><path d="M7 12h3"/></svg>`,
  berries: `<svg class="pill-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="10" cy="15" r="5.5"/><circle cx="17" cy="16.5" r="4" opacity=".7"/><path d="M11 8c2.6-2.4 5.6-1.6 5.6-1.6s-.4 3.2-2.9 3.9c-2.4.6-2.7-2.3-2.7-2.3Z"/></svg>`,
  fire: `<svg class="pill-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c1.6 3.4.4 5.2-1.4 6.9C8.4 11 6.5 12.6 6.5 15.5A5.5 5.5 0 0 0 12 21a5.5 5.5 0 0 0 5.5-5.5c0-2.4-1.3-4.2-2.7-5.6-.6 1-1.4 1.6-2.3 1.8.9-3.6-.3-6.9-.5-9.7Z"/></svg>`,
} as const;

/** Batch 4: the small heart on a requester's card (tinted `--accent` at the use site). */
export const HEART_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.6c-4.9-3.3-8.1-6.2-8.1-9.5C3.9 8.3 5.9 6.7 8 6.7c1.6 0 3 .9 4 2.3 1-1.4 2.4-2.3 4-2.3 2.1 0 4.1 1.6 4.1 4.4 0 3.3-3.2 6.2-8.1 9.5Z"/></svg>`;

/** The HUD's smaller icon, for a structure's cost line. */
export function costIcon(kind: 'wood' | 'berries'): string {
  return ICONS[kind].replace('pill-icon', 'cost-icon');
}

/** Three zones, per DESIGN §6: HUD, villager panel, and the task popover nested in the panel. */
export function uiMarkup(): string {
  return `
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
        <p class="panel-hint">${DEFAULT_HINT}</p>
      </div>
      <div id="villager-list"></div>
      <div id="task-popover" hidden>
        <p class="popover-title"></p>
        <p class="favor-line" style="margin:0; min-height:2.4em; color:var(--ink-soft); font-size:12.5px; font-weight:600; visibility:hidden"></p>
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
}

/** Every node the UI touches after init. Resolved once — the M1 lesson, applied at init. */
export interface UiRefs {
  list: HTMLElement;
  popover: HTMLElement;
  popoverTitle: HTMLElement;
  /** Batch 4: the popover's reserved favor line (visibility-toggled, never display-toggled). */
  favorLine: HTMLElement;
  panelHint: HTMLElement;
  taskGrid: HTMLElement;
  stopBtn: HTMLButtonElement;
  cookBtn: HTMLButtonElement;
  structureCard: HTMLElement;
  structureCost: HTMLElement;
  structureShort: HTMLElement;
  structureStatus: HTMLElement;
  buildBtn: HTMLButtonElement;
  fuelPill: HTMLElement;
  fuelValue: HTMLElement;
  fuelFill: HTMLElement;
  resetBtn: HTMLButtonElement;
  woodPill: HTMLElement;
  woodValue: HTMLElement;
  berriesPill: HTMLElement;
  berriesValue: HTMLElement;
}

export function bindRefs(root: HTMLElement): UiRefs {
  const structureCard = must<HTMLElement>(root, '#structure-card');
  const fuelPill = must<HTMLElement>(root, '#hud [data-res="fuel"]');
  const woodPill = must<HTMLElement>(root, '#hud [data-res="wood"]');
  const berriesPill = must<HTMLElement>(root, '#hud [data-res="berries"]');
  return {
    list: must<HTMLElement>(root, '#villager-list'),
    popover: must<HTMLElement>(root, '#task-popover'),
    popoverTitle: must<HTMLElement>(root, '.popover-title'),
    favorLine: must<HTMLElement>(root, '.favor-line'),
    panelHint: must<HTMLElement>(root, '.panel-hint'),
    taskGrid: must<HTMLElement>(root, '.task-grid'),
    stopBtn: must<HTMLButtonElement>(root, '.stop-btn'),
    cookBtn: must<HTMLButtonElement>(root, '[data-task="cook"]'),
    structureCard,
    structureCost: must<HTMLElement>(structureCard, '.structure-cost'),
    structureShort: must<HTMLElement>(structureCard, '.structure-short'),
    structureStatus: must<HTMLElement>(structureCard, '.structure-status'),
    buildBtn: must<HTMLButtonElement>(structureCard, '[data-build]'),
    fuelPill,
    fuelValue: must<HTMLElement>(fuelPill, '.pill-value'),
    fuelFill: must<HTMLElement>(fuelPill, '.fuel-fill'),
    resetBtn: must<HTMLButtonElement>(root, '.reset-btn'),
    woodPill,
    woodValue: must<HTMLElement>(woodPill, '.pill-value'),
    berriesPill,
    berriesValue: must<HTMLElement>(berriesPill, '.pill-value'),
  };
}

export function must<T extends HTMLElement>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`UI element missing: ${selector}`);
  return el;
}