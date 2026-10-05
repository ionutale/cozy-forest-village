// Pure derivations: GameState in, something displayable out. No DOM, no timers, no mutation —
// so every function here is directly unit-testable under vitest's node environment
// (see ./derive.test.ts). The UI layer owns when to call them and what to do with the result.

import type { GameState, StructureKind, TaskId, Villager } from '../sim';
import { GARDEN_PERIOD_MS } from '../sim';

/** B1: the resting panel hint, and the first line in the markup — a fresh village writes nothing. */
export const DEFAULT_HINT = 'Pick someone, then give them a task.';
/** DESIGN §3.2 fire bands, as percentages of `fire.max`. */
export const FUEL_ROARING = 66;
export const FUEL_STEADY = 33;
/** What a task button says. */
export const TASK_LABELS: Record<TaskId, string> = {
  chop: 'Chop wood',
  berries: 'Gather berries',
  rest: 'Rest',
  tend: 'Tend fire',
  cook: 'Cook',
};
/** What the card says once they are actually doing it — the gerund reads as progress. */
export const WORK_LABELS: Record<TaskId, string> = {
  chop: 'Chop wood',
  berries: 'Gather berries',
  rest: 'Resting',
  tend: 'Tending fire',
  cook: 'Cooking',
};

/** Card label: what the villager is doing *now*, not what they were told to do (M11b). */
export function cardLabel(villager: Villager): string {
  if (villager.state === 'walking') return 'Walking…';
  if (villager.state === 'resting') return 'Resting';
  if (villager.state === 'working' && villager.task) return WORK_LABELS[villager.task];
  return 'Idle';
}

/**
 * A1: whole seconds until the garden's next berry. `gardenMs` is a modulo accumulator in
 * [0, GARDEN_PERIOD_MS), so the remainder is the time left. Rounded *up*, because floor would
 * read "0s" for the last half-second while a berry is still on its way.
 */
export function secondsToBerry(gardenMs: number): number {
  const periodSeconds = GARDEN_PERIOD_MS / 1000;
  const remaining = GARDEN_PERIOD_MS - gardenMs;
  // NaN-safe, and clamped at BOTH ends: a bad save, a negative accumulator or an out-of-range
  // value falls back to the full period, rather than claiming "31s" on a 30s cycle or "0s"
  // when no berry is due. Both ends are compared in *seconds*, the unit returned.
  if (!(remaining > 0)) return periodSeconds;
  return Math.min(periodSeconds, Math.ceil(remaining / 1000));
}

/**
 * B1: first match by *id*, not array order, so the line stays stable if the roster is ever
 * reordered or reloaded from a hand-edited save. No Math.random anywhere.
 */
export function firstById(
  villagers: readonly Villager[],
  match: (v: Villager) => boolean,
): Villager | undefined {
  let best: Villager | undefined;
  for (const v of villagers) {
    if (!match(v)) continue;
    if (!best || v.id < best.id) best = v;
  }
  return best;
}

/**
 * B1: the rotating village line, highest priority first. A pure function of state, so the UI
 * recomputes it on a slow clock and writes only when the answer actually changes.
 */
export function villageLine(state: GameState): string {
  // `<= 0` rather than `=== 0` so a bad save cannot slip past the most urgent line. A NaN fuel
  // fails every comparison and falls through to the default hint rather than throwing.
  if (state.fire.fuel <= 0) return 'Only embers left — someone should tend the fire.';
  const ratio = state.fire.max > 0 ? state.fire.fuel / state.fire.max : 0;
  if (ratio < FUEL_STEADY / 100) return 'The fire is dimming.';
  const cooking = firstById(state.villagers, (v) => v.state === 'working' && v.task === 'cook');
  if (cooking) return `${cooking.name} is cooking.`;
  const fed = firstById(state.villagers, (v) => v.fedMs > 0);
  if (fed) return `${fed.name} is well-fed.`;
  if (state.pot.meals > 0) return 'Meals are ready for a rest.';
  if (ratio >= FUEL_ROARING / 100) return 'The fire is warm and bright.';
  return DEFAULT_HINT;
}

/** Popover title for a structure card. Both lanterns share a name; their ids stay distinct. */
export const STRUCTURE_NAMES: Record<StructureKind, string> = {
  woodpile: 'Woodpile',
  pot: 'Cooking pot',
  bench: 'Bench',
  garden: 'Garden',
  lantern: 'Lantern',
  feeder: 'Bird feeder',
};

/** The fire band name the HUD pill's `data-state` and the hint both read, so they never disagree. */
export function fireState(fuel: number, max: number): string {
  const ratio = max > 0 ? fuel / max : 0;
  if (ratio * 100 >= FUEL_ROARING) return 'roaring';
  if (ratio * 100 >= FUEL_STEADY) return 'steady';
  return ratio > 0 ? 'dim' : 'embers';
}
