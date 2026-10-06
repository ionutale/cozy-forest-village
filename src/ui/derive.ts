// Pure derivations: GameState in, something displayable out. No DOM, no timers, no mutation —
// so every function here is directly unit-testable under vitest's node environment
// (see ./derive.test.ts). The UI layer owns when to call them and what to do with the result.

import type { FavorWant, GameState, SimEvent, StructureKind, TaskId, Villager } from '../sim';
import {
  GARDEN_PERIOD_MS,
  TRADE_BERRY_COST,
  TRADE_WOOD_COST,
  TRADE_WOOD_YIELD,
  bondPartners,
  favorWantFor,
  strongestBondLevel,
} from '../sim';

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

/**
 * T3 (batch 7): which exchange a trade button offers. Named for the sim's own vocabulary —
 * `'berries'` sells wood for berries, `'spice'` sells berries for a spice — so the button, the
 * `UIActions.trade(kind)` call, and the sim's `SimEvent.tradeKind` never disagree.
 */
export type TradeKind = 'berries' | 'spice';

/**
 * T3: what each trade offers, as the sim's `trade(state, kind)` prices them (DESIGN §3.2, batch 7).
 * The two amounts the UI *spends* are the sim's own sanctioned constants (T3c), so the number on
 * the button and the number the gate enforces cannot drift apart. The spice trade's 1-for-1 yield
 * has no sanctioned constant, so that side stays a literal — pinned by the `TRADE_LABELS` test.
 */
export const TRADE_LABELS: Record<TradeKind, string> = {
  berries: `${TRADE_WOOD_COST} wood → ${TRADE_WOOD_YIELD} berries`,
  spice: `${TRADE_BERRY_COST} berries → 1 spice`,
};

/** T3: the hint's trader slot. A constant so the pure test and the DOM cannot drift apart. */
export const TRADER_HINT = 'A trader is visiting!';

/** Card label: what the villager is doing *now*, not what they were told to do (M11b). */
export function cardLabel(villager: Villager): string {
  // H3: a walk-in has no task and cannot be given one, so "Arriving…" outranks everything.
  if (villager.state === 'arriving') return 'Arriving…';
  if (villager.state === 'walking') return 'Walking…';
  if (villager.state === 'resting') return 'Resting';
  if (villager.state === 'working' && villager.task) return WORK_LABELS[villager.task];
  return 'Idle';
}

/**
 * H3: which villager indices still need a card. The roster only ever grows (cap 12, batch 6
 * newcomers append), so this is a tail range — but the guards matter: a shrinking or corrupt
 * count must return nothing rather than a negative-index loop.
 */
export function villagersNeedingCards(renderedCount: number, total: number): number[] {
  const from = Math.max(0, Math.floor(renderedCount));
  if (!(total > from)) return [];
  if (!Number.isFinite(total)) return [];
  const needed: number[] = [];
  for (let i = from; i < Math.floor(total); i += 1) needed.push(i);
  return needed;
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
 * rather than stacking with it — the two can never render together. Batch 5: the thank-you line
 * uses that villager's personal delight phrasing (`delightText`), chosen by the same name-keyed
 * voice as their want line.
 */
export function villageLine(state: GameState, thanks: string | null): string {
  // `<= 0` rather than `=== 0` so a bad save cannot slip past the most urgent line. A NaN fuel
  // fails every comparison and falls through to the default hint rather than throwing.
  if (state.fire.fuel <= 0) return 'Only embers left — someone should tend the fire.';
  if (thanks !== null) return delightText(thanks);
  const favor = favorLine(state);
  if (favor !== null) return favor;
  // T3: the trader slot. It outranks every ambient slot below (dimming, cooking, fed, meals,
  // roaring) because a visit is time-boxed — miss it and it is gone — while those are steady
  // states the player can read again next tick.
  const trader = traderHintLine(state);
  if (trader !== null) return trader;
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
 * Batch 4: the requester id of the *first* usable `favor-done` in one frame's event batch, or
 * null when no completion carries a villager id. First wins deterministically, so two
 * completions in one tick cannot overwrite each other's "delighted!" window — the
 * lower-array-index requester keeps its moment. Id-less events are skipped, as the pump
 * always did.
 */
export function firstFavorDoneVillagerId(events: readonly SimEvent[]): string | null {
  for (const ev of events) {
    if (ev.type === 'favor-done' && ev.villagerId) return ev.villagerId;
  }
  return null;
}

/**
 * Batch 4: whether this frame recomputes the panel hint. True on the slow routine cadence, and
 * on either edge of the "delighted!" window — `thanksBefore` null → set opens it, set → null
 * closes it (a same-frame name swap counts as an edge too). Recomputing on the edges is what
 * keeps the 6 s window from falling between two 10 s ticks: the open edge writes the line
 * immediately, the close edge restores the prior line immediately.
 *
 * T3: a visit's arrival and end are edges for the same reason, and more so — the visit is
 * time-boxed, so waiting up to `HINT_INTERVAL_MS` would announce a trader who has already left,
 * or hide one standing at the gate. Both default to `false`, which leaves every batch-4 call site
 * and test behaving exactly as before.
 */
export function hintRecomputeDue(
  now: number,
  hintDueAt: number,
  thanksBefore: string | null,
  thanksAfter: string | null,
  visitingBefore = false,
  visitingAfter = false,
): boolean {
  return thanksBefore !== thanksAfter || visitingBefore !== visitingAfter || now >= hintDueAt;
}

/**
 * T3 (batch 7): the hint's trader slot, or null while no one is visiting. Read from `state` only
 * — the UI holds no trader flag, so the line cannot disagree with the sim's own phase.
 */
export function traderHintLine(state: GameState): string | null {
  return state.visitor.phase === 'visiting' ? TRADER_HINT : null;
}

/**
 * T3: whether a trade button must be disabled. The sim refuses the trade in exactly these cases
 * (`trade(state, kind)`), so mirroring them keeps the button honest instead of letting the player
 * click something that will not happen: no visit, no trades left, or not enough stock for that
 * exchange. Pure — the unit test walks the whole truth table, which the popover cannot.
 */
export function tradeDisabled(state: GameState, kind: TradeKind): boolean {
  const visitor = state.visitor;
  if (visitor.phase !== 'visiting' || visitor.tradesLeft <= 0) return true;
  return kind === 'berries'
    ? state.resources.wood < TRADE_WOOD_COST
    : state.resources.berries < TRADE_BERRY_COST;
}

/**
 * T3: the pot line's trailing clause, or `''`. Only meaningful when the pot is built *and* a spice
 * is in store — that is the only state in which a cook eats heartily (DESIGN §3.2, batch 7). The
 * leading ` · ` is part of the return so the append site stays a bare concatenation.
 *
 * `spices > 0` mirrors the sim's own hearty-eat test rather than rounding, so the line says
 * exactly what the cook will do even if a hand-edited save carries a fractional count.
 */
export function potHeartySuffix(state: GameState): string {
  if (!(state.resources.spices > 0)) return '';
  const potBuilt = state.structures.some((s) => s.kind === 'pot' && s.built);
  return potBuilt ? ' · hearty while spices last' : '';
}

/**
 * Batch 5 (G2): a stable 0-based "voice" slot for a villager, from a tiny FNV-1a hash of their
 * name. Same villager, same words — deterministic across calls, frames and reloads, never
 * `Math.random`. The name is the shared key because the thank-you window (`villageLine`'s
 * `thanks`) only ever carries a name, so a villager's want line and delight line pick from the
 * same slot.
 */
function voiceIndex(name: string, variants: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % variants;
}

/**
 * Batch 5 (G2): the warm per-villager variants per want category; slot 0 is the batch-4
 * DESIGN §3.2 phrase in every table. Every variant must read naturally after "would love"
 * (hint) and after "Favor: " (popover), so keep them short, warm and self-contained.
 */
const WANT_VARIANTS: Record<'eatSelf' | 'eatAny' | 'gather' | 'chop' | 'build' | 'fire', readonly string[]> = {
  eatSelf: ['a warm meal', 'a cozy meal by the fire', 'something warm to eat'],
  eatAny: ['a feast for the village', 'a shared feast tonight', 'a village-wide feast'],
  gather: ['berries for the village', 'a basket of berries', 'sweet berries to share'],
  chop: ['firewood for the village', 'a stack of firewood', 'fresh logs for the fire'],
  build: ['something new built', 'a cozy new building', 'something built with care'],
  fire: [
    'the fire kept warm for two minutes',
    'the fire tended for two minutes',
    'the hearth kept glowing for two minutes',
  ],
};

/** Batch 5 (G2): the thank-you variants; slot 0 is the batch-4 line. */
const DELIGHT_SUFFIXES: readonly string[] = ['is delighted!', 'beams with joy!', 'looks so happy!'];

/** The variant table for a want — `eat` splits on who the meal is for, as the copy always did. */
function wantVariants(want: FavorWant): readonly string[] {
  switch (want.kind) {
    case 'eat':
      return want.who === 'any' ? WANT_VARIANTS.eatAny : WANT_VARIANTS.eatSelf;
    case 'gather':
      return WANT_VARIANTS.gather;
    case 'chop':
      return WANT_VARIANTS.chop;
    case 'build':
      return WANT_VARIANTS.build;
    case 'fire':
      return WANT_VARIANTS.fire;
  }
}

/**
 * Batch 4/5: UI-owned flavor copy for a favor want (the DESIGN §3.2 "Favor chains" table's last
 * column), like `STRUCTURE_NAMES` — the sim owns chain content, the words are presentation.
 * Batch 5: `villagerName` selects one of the category's warm variants through the villager's
 * stable personal voice (`voiceIndex`), so the same person always sounds like themselves.
 */
export function favorText(want: FavorWant, villagerName: string): string {
  const variants = wantVariants(want);
  return variants[voiceIndex(villagerName, variants.length)]!;
}

/**
 * Batch 5 (G2): the completion line — `"{Name} is delighted!"` and two warm siblings, chosen
 * per villager by the same stable voice. Pure; `villageLine` owns when it renders.
 */
export function delightText(name: string): string {
  return `${name} ${DELIGHT_SUFFIXES[voiceIndex(name, DELIGHT_SUFFIXES.length)]!}`;
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
 * popover picks the current selection). Batch 5: the want phrase is personalized per name.
 */
function favorLineFor(state: GameState, villagerIndex: number): string | null {
  const active = activeFavor(state, villagerIndex);
  const name = state.villagers[villagerIndex]?.name;
  if (!active || !name) return null;
  return `${name} would love ${favorText(active.want, name)} ${favorProgressText(active.want, active.progress)}.`;
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

/**
 * Batch 4: the popover's `Favor: {want} {progress}` line, or null when no active favor.
 * Batch 5: the want phrase follows the selected villager's voice; a missing name (only possible
 * on a malformed save) falls back to the empty-name voice rather than "undefined".
 */
export function favorPopoverLine(state: GameState, villagerIndex: number): string | null {
  const active = activeFavor(state, villagerIndex);
  if (!active) return null;
  const name = state.villagers[villagerIndex]?.name ?? '';
  return `Favor: ${favorText(active.want, name)} ${favorProgressText(active.want, active.progress)}`;
}

/**
 * Batch 9 (bonds): the words each level reads as, in the popover's Bonds slot. Level 1 is the
 * quietest (still just warming), level 3 the warmest; the phrasing is binding (spec Part 2).
 */
const BOND_WORDS: Record<1 | 2 | 3, string> = {
  1: 'Warming to',
  2: 'Close with',
  3: 'Best with',
};

/**
 * Batch 9 (bonds): the popover's Bonds line — the two strongest partners for one villager,
 * `"Best with Fern · Close with Moss"`, joined by ` · `. `bondPartners` already returns them
 * ordered (level desc, score desc, roster index asc), so the top two are simply the first two.
 * Null when the strongest bond is level 0, which is the same condition the popover uses to hide
 * the line (spec Part 2: "hidden when the strongest bond is 0"). Pure — the unit test walks the
 * ordering and every wording.
 */
export function bondsLine(state: GameState, villagerId: string): string | null {
  if (strongestBondLevel(state, villagerId) === 0) return null;
  const partners = bondPartners(state, villagerId);
  if (partners.length === 0) return null;
  return partners
    .slice(0, 2)
    .map((partner) => `${BOND_WORDS[partner.level]} ${partner.name}`)
    .join(' · ');
}

/** Popover title for a structure card. Both lanterns share a name; their ids stay distinct. */
export const STRUCTURE_NAMES: Record<StructureKind, string> = {
  woodpile: 'Woodpile',
  pot: 'Cooking pot',
  bench: 'Bench',
  garden: 'Garden',
  lantern: 'Lantern',
  feeder: 'Bird feeder',
  hut: 'Hut', // H3: batch 6
};

/** The fire band name the HUD pill's `data-state` and the hint both read, so they never disagree. */
export function fireState(fuel: number, max: number): string {
  const ratio = max > 0 ? fuel / max : 0;
  if (ratio * 100 >= FUEL_ROARING) return 'roaring';
  if (ratio * 100 >= FUEL_STEADY) return 'steady';
  return ratio > 0 ? 'dim' : 'embers';
}
