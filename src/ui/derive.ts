// Pure derivations: GameState in, something displayable out. No DOM, no timers, no mutation —
// so every function here is directly unit-testable under vitest's node environment
// (see ./derive.test.ts). The UI layer owns when to call them and what to do with the result.

import type { FavorWant, GameState, StructureKind, TaskId, Villager } from '../sim';
import { GARDEN_PERIOD_MS, favorWantFor } from '../sim';

/** Batch 4: UI-side "delighted!" window after a `favor-done` event (DESIGN §3.2; no sim state). */
export const THANK_YOU_MS = 6000;

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
 *
 * Batch 4 priority: `embers > favor > dimming > cooking > well-fed > meals > roaring > default`.
 * `thanks` (a villager name from the UI's 6 s post-`favor-done` window) *replaces* the favor line
 * rather than stacking with it — the two can never render together.
 */
export function villageLine(state: GameState, thanks: string | null): string {
  // `<= 0` rather than `=== 0` so a bad save cannot slip past the most urgent line. A NaN fuel
  // fails every comparison and falls through to the default hint rather than throwing.
  if (state.fire.fuel <= 0) return 'Only embers left — someone should tend the fire.';
  if (thanks !== null) return `${thanks} is delighted!`;
  const favor = favorLine(state);
  if (favor !== null) return favor;
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

/**
 * Batch 4: UI-owned flavor copy for a favor want (the DESIGN §3.2 "Favor chains" table's last
 * column), like `STRUCTURE_NAMES` — the sim owns chain content, the words are presentation.
 */
export function favorText(want: FavorWant): string {
  switch (want.kind) {
    case 'eat':
      return want.who === 'any' ? 'a feast for the village' : 'a warm meal';
    case 'gather':
      return 'berries for the village';
    case 'chop':
      return 'firewood for the village';
    case 'build':
      return 'something new built';
    case 'fire':
      return 'the fire kept warm for two minutes';
  }
}

/** Floor seconds as `m:ss`: `72000 → "1:12"`. Nonsense input reads as zero, never "NaN:NaN". */
function mmss(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const total = Math.floor(safe / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A finite, integer, non-negative count/window for display. */
function whole(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Batch 4: the progress tail after a want — `(3/6)` for countable wants, `(1:12/2:00)` (m:ss)
 * for the fire favor. Clamped to the want's target, so a stale or over-counted save can never
 * read "7/6"; nonsense degrades to zero.
 */
export function favorProgressText(want: FavorWant, progress: number): string {
  if (want.kind === 'fire') {
    const total = whole(want.ms);
    return `(${mmss(Math.min(whole(progress), total))}/${mmss(total)})`;
  }
  const total = whole(want.count);
  return `(${Math.min(whole(progress), total)}/${total})`;
}

/** The active want + its raw progress for one villager slot, or null when none is usable. */
function activeFavor(
  state: GameState,
  villagerIndex: number,
): { want: FavorWant; progress: number } | null {
  const progress = state.favors?.byVillager?.[villagerIndex];
  if (!progress || progress.active !== true) return null;
  // Chain content lives in the sim (`src/sim/favors.ts`, re-exported at the public surface);
  // its step is 0-based, exactly the value the sim's completion pass reads.
  const want = favorWantFor(villagerIndex, progress.step);
  if (!want) return null;
  return { want, progress: progress.progress };
}

/**
 * Batch 4: `"{Name} would love {want} {progress}."` for one villager, or null when that villager
 * has no active favor. Pure; the caller decides which villager (the hint picks by id, the
 * popover picks the current selection).
 */
export function favorLineFor(state: GameState, villagerIndex: number): string | null {
  const active = activeFavor(state, villagerIndex);
  const name = state.villagers[villagerIndex]?.name;
  if (!active || !name) return null;
  return `${name} would love ${favorText(active.want)} ${favorProgressText(active.want, active.progress)}.`;
}

/**
 * Batch 4: the hint's favor slot — the first *usable* active favor by villager id (the same
 * id-stable rule as `firstById`), never array order. Null when nobody is asking.
 */
export function favorLine(state: GameState): string | null {
  let bestId: string | null = null;
  let bestLine: string | null = null;
  for (let i = 0; i < state.villagers.length; i += 1) {
    const villager = state.villagers[i]!;
    if (state.favors?.byVillager?.[i]?.active !== true) continue;
    if (bestId !== null && villager.id >= bestId) continue;
    const line = favorLineFor(state, i);
    if (line === null) continue;
    bestId = villager.id;
    bestLine = line;
  }
  return bestLine;
}

/** Batch 4: the popover's `Favor: {want} {progress}` line, or null when no active favor. */
export function favorPopoverLine(state: GameState, villagerIndex: number): string | null {
  const active = activeFavor(state, villagerIndex);
  if (!active) return null;
  return `Favor: ${favorText(active.want)} ${favorProgressText(active.want, active.progress)}`;
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
