// Batch 8: the deterministic day/night clock — binding constants and three pure
// derivations. No DOM, no three.js, no wall-clocks (DESIGN.md §3.2 "Day/night cycle",
// spec docs/superpowers/specs/2026-10-06-day-night-cycle-design.md Part 1).
// `clock.dayMs` (see types.ts) advances in `tick()` only; everything here reads it.

import type { GameState } from './types';

/** One full day/night cycle: 8 minutes. */
export const DAY_MS = 480_000;
/** A fresh game starts mid-morning (dayT 0.25): the trader's first call lands before dusk. */
export const FRESH_START_T = 0.25;

// Phase boundaries as integer milliseconds, derived so there is no float edge to straddle
// (dayT 0.09 / 0.22 / 0.78 / 0.91). night→dawn · dawn→day · day→dusk · dusk→night.
export const DAWN_START_MS = (DAY_MS * 9) / 100; // 43_200
export const DAY_START_MS = (DAY_MS * 22) / 100; // 105_600
export const DUSK_START_MS = (DAY_MS * 78) / 100; // 374_400
export const NIGHT_START_MS = (DAY_MS * 91) / 100; // 436_800

/** A rest committed at dusk/night lasts ×1.5 (4000 → 6000; 5500 → 8250). */
export const EVENING_REST_SCALE = 1.5;
/** The gathering ring radius around the fire; each seat jitters ±0.2 by `hash01`. */
export const WARMING_RADIUS = 2.4;

/** Clock position in [0, 1): `dayMs / DAY_MS`. */
export function dayT(state: GameState): number {
  return state.clock.dayMs / DAY_MS;
}

/**
 * Phase by the integer boundaries: night `0–0.09`, dawn `0.09–0.22`, day `0.22–0.78`,
 * dusk `0.78–0.91`, night `0.91–1`. Lower-inclusive: ms exactly on a boundary opens it.
 */
export function dayPhase(state: GameState): 'night' | 'dawn' | 'day' | 'dusk' {
  const ms = state.clock.dayMs;
  if (ms < DAWN_START_MS) return 'night';
  if (ms < DAY_START_MS) return 'dawn';
  if (ms < DUSK_START_MS) return 'day';
  if (ms < NIGHT_START_MS) return 'dusk';
  return 'night';
}

/** Classic smoothstep `t²(3 − 2t)` (exactly 0.5 at t = 0.5). */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Daylight strength: `1` through day, `0` through night, smoothstep ramps up through dawn
 * (0.09–0.22) and down through dusk (0.78–0.91). Exact 1/0 at both ends of each ramp, so it is
 * continuous with the flat stretches.
 */
export function dayFactor(state: GameState): number {
  const ms = state.clock.dayMs;
  if (ms < DAWN_START_MS) return 0;
  if (ms < DAY_START_MS) {
    return smoothstep((ms - DAWN_START_MS) / (DAY_START_MS - DAWN_START_MS));
  }
  if (ms < DUSK_START_MS) return 1;
  if (ms < NIGHT_START_MS) {
    return 1 - smoothstep((ms - DUSK_START_MS) / (NIGHT_START_MS - DUSK_START_MS));
  }
  return 0;
}
