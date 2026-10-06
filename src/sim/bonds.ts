// Bonds (batch 9): villager friendships that grow from pure proximity — four
// levels, never decaying, with a gentle work synergy between close friends.
// Binding rules: DESIGN.md §3 ("Bonds") and
// docs/superpowers/specs/2026-10-06-bonds-design.md Parts 1 + 5.
// Pure and deterministic: no Math.random, no Date, no wall-clocks — only the
// tick's dtMs. Internal module; the public surface is re-exported from
// `src/sim/index.ts`.

import type { BondLevel, GameState, Villager } from './types';
import { VILLAGE_CAP } from './tasks';

/** Pairs within this distance accrue score (and the perk's nearness radius). */
export const BOND_RADIUS = 3.0;
/** Score per second of closeness (flat inside the radius). */
export const BOND_RATE_PER_S = 1;
/** Apart longer than this, then near → one `bond-reunion`. */
export const BOND_REUNION_GAP_MS = 90_000;
/** Validation bound for stored scores (schema v6). */
export const BOND_SCORE_MAX = 100_000;
/** Close or better enables the work perk. */
export const FRIEND_PERK_LEVEL = 2;
/** Work period multiplier near a close friend (never reaches zero). */
export const FRIEND_PERK_SCALE = 0.9;

/** Level thresholds (binding, DESIGN.md §3.2): warming / close / best. */
const LEVEL_WARMING = 120;
const LEVEL_CLOSE = 300;
const LEVEL_BEST = 720;

/**
 * Pair table index from two roster indices, order-independent (DESIGN.md §3):
 * sorts `(min, max)` and returns `min × 12 + max`. Both directions of a pair
 * read the same cell. The 12×12 table has 144 slots.
 */
export function pairIndex(a: number, b: number): number {
  return a < b ? a * VILLAGE_CAP + b : b * VILLAGE_CAP + a;
}

/** Pure score → level mapping; the thresholds are `>=` on the score. */
function levelOfScore(score: number): BondLevel {
  if (!Number.isFinite(score)) return 0;
  if (score >= LEVEL_BEST) return 3;
  if (score >= LEVEL_CLOSE) return 2;
  if (score >= LEVEL_WARMING) return 1;
  return 0;
}

/** Bond level between two roster indices (private primitive; see `bondLevelFor`). */
function bondLevelAtIndex(state: GameState, a: number, b: number): BondLevel {
  if (a === b || a < 0 || b < 0) return 0;
  const score = state.bonds.scores[pairIndex(a, b)];
  if (score === undefined) return 0;
  return levelOfScore(score);
}

/**
 * Bond level between two villagers, by id (pure; the public surface — DESIGN.md
 * §3 "Bonds"). Either id unknown, the same id twice, or a non-finite score
 * reads as 0. Resolution is a ≤12 linear scan; the sim's `stepBonds` keeps the
 * index-based primitive above.
 */
export function bondLevelFor(state: GameState, a: string, b: string): BondLevel {
  const indexA = indexOf(state, a);
  const indexB = indexOf(state, b);
  if (indexA < 0 || indexB < 0) return 0;
  return bondLevelAtIndex(state, indexA, indexB);
}

/** Roster index of `villagerId`, or −1 when unknown. */
function indexOf(state: GameState, villagerId: string): number {
  return state.villagers.findIndex((v) => v.id === villagerId);
}

/** The strongest bond level `villagerId` holds with anyone (0 when none). */
export function strongestBondLevel(state: GameState, villagerId: string): BondLevel {
  const index = indexOf(state, villagerId);
  if (index < 0) return 0;
  let strongest: BondLevel = 0;
  for (let j = 0; j < state.villagers.length; j += 1) {
    if (j === index) continue;
    const level = bondLevelAtIndex(state, index, j);
    if (level > strongest) strongest = level;
  }
  return strongest;
}

/**
 * Every villager with a level ≥ 1 bond to `villagerId` (pure), strongest
 * first: level desc, then score desc, then roster index asc (spec Part 1.2).
 * A self-pair never appears; all-zero bonds yield an empty list.
 */
export function bondPartners(
  state: GameState,
  villagerId: string,
): { id: string; name: string; level: 1 | 2 | 3 }[] {
  const index = indexOf(state, villagerId);
  if (index < 0) return [];
  const ranked: { id: string; name: string; level: 1 | 2 | 3; score: number; index: number }[] = [];
  for (let j = 0; j < state.villagers.length; j += 1) {
    if (j === index) continue;
    const level = bondLevelAtIndex(state, index, j);
    if (level === 0) continue;
    const other = state.villagers[j];
    if (!other) continue;
    ranked.push({
      id: other.id,
      name: other.name,
      level,
      score: state.bonds.scores[pairIndex(index, j)] ?? 0,
      index: j,
    });
  }
  ranked.sort(
    (p, q) => q.level - p.level || q.score - p.score || p.index - q.index,
  );
  return ranked.map(({ id, name, level }) => ({ id, name, level }));
}

/**
 * True when `villager` has at least one `FRIEND_PERK_LEVEL`-or-better partner
 * physically within `BOND_RADIUS` right now. The work-yield path's only query
 * (spec Part 1.4); never mutates anything.
 */
export function hasCloseFriendNear(state: GameState, villager: Villager): boolean {
  const index = state.villagers.indexOf(villager);
  if (index < 0) return false;
  const reachSq = BOND_RADIUS * BOND_RADIUS;
  for (let j = 0; j < state.villagers.length; j += 1) {
    if (j === index) continue;
    if (bondLevelAtIndex(state, index, j) < FRIEND_PERK_LEVEL) continue;
    const other = state.villagers[j];
    if (!other) continue;
    const dx = villager.pos.x - other.pos.x;
    const dz = villager.pos.z - other.pos.z;
    if (dx * dx + dz * dz <= reachSq) return true;
  }
  return false;
}

/**
 * Advance every pair by one tick (spec Part 1.3), called from `tick` in the
 * `dtMs > 0` region after the villager loop so positions are final:
 * - **Growth:** a pair within `BOND_RADIUS` gains
 *   `(dtMs / 1000) × BOND_RATE_PER_S` (capped at `BOND_SCORE_MAX`) and its
 *   gap resets to 0; otherwise the gap accrues `dtMs`. Scores never decay.
 * - **Levels:** a crossing bumps the level, pushing one `bond-up` event with
 *   the reached level (so a giant dt emits exactly one, never a burst).
 * - **Reunions:** first contact with `gapMs > BOND_REUNION_GAP_MS` pushes one
 *   `bond-reunion`; resetting the gap to 0 makes the cooldown fall out
 *   naturally. A fresh pair (gap 0) never fires a phantom reunion.
 * Allocation-free over `i < j`; deterministic, no RNG.
 */
export function stepBonds(state: GameState, dtMs: number): void {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return;
  const bonds = state.bonds;
  const villagers = state.villagers;
  const gain = (dtMs / 1000) * BOND_RATE_PER_S;
  const reachSq = BOND_RADIUS * BOND_RADIUS;
  for (let i = 0; i < villagers.length; i += 1) {
    const a = villagers[i];
    if (!a) continue;
    for (let j = i + 1; j < villagers.length; j += 1) {
      const b = villagers[j];
      if (!b) continue;
      const idx = pairIndex(i, j);
      const dx = a.pos.x - b.pos.x;
      const dz = a.pos.z - b.pos.z;
      if (dx * dx + dz * dz <= reachSq) {
        const before = levelOfScore(bonds.scores[idx] ?? 0);
        let score = (bonds.scores[idx] ?? 0) + gain;
        if (score > BOND_SCORE_MAX) score = BOND_SCORE_MAX;
        bonds.scores[idx] = score;
        const after = levelOfScore(score);
        if (after > before) {
          state.events.push({ type: 'bond-up', villagerId: a.id, otherId: b.id, bondLevel: after });
        }
        if ((bonds.gapMs[idx] ?? 0) > BOND_REUNION_GAP_MS) {
          state.events.push({ type: 'bond-reunion', villagerId: a.id, otherId: b.id });
        }
        bonds.gapMs[idx] = 0;
      } else {
        bonds.gapMs[idx] = (bonds.gapMs[idx] ?? 0) + dtMs;
      }
    }
  }
}
