// Persistence (DESIGN.md §3, B3; schema v2 favors): localStorage save / load / autosave.
// The GameState is plain JSON-safe data (no Maps / class instances) — that is a
// guarantee of the sim, so JSON.stringify/parse round-trips it losslessly.
// Every entry point is defensive: persist must never throw into the frame loop.

import { createFavors } from '../sim';
import type { FavorsState, GameState } from '../sim';

export const STORAGE_KEY = 'cozy-forest-village.save';
export const VERSION = 2; // v2 = v1 + favors (additive migration in loadGame)
const AUTOSAVE_INTERVAL_MS = 3000;

/** Pre-favors schema (v1): everything in GameState except the favors block. */
type V1GameState = Omit<GameState, 'favors'>;

interface SaveFile {
  version: number;
  state: GameState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Plausible-shape check for a v1 state (pre-favors, B3): arrays / objects with
 * the right containers, numeric fire + garden fields, a pendingEvents queue,
 * and per-villager activity fields (a save missing those would NaN the fuel or
 * rest forever). Deliberately shallow — enough to reject corrupt saves without
 * over-rejecting.
 */
function isPlausibleV1State(value: unknown): value is V1GameState {
  if (!isRecord(value)) return false;
  if (
    !Array.isArray(value.villagers) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.structures) ||
    !Array.isArray(value.pendingEvents)
  ) {
    return false;
  }
  const fire = value.fire;
  if (!isRecord(fire)) return false;
  if (typeof fire.fuel !== 'number' || typeof fire.max !== 'number') return false;
  if (!isRecord(value.pot)) return false;
  if (typeof value.gardenMs !== 'number') return false;
  for (const v of value.villagers) {
    if (!isRecord(v)) return false;
    if (typeof v.restMs !== 'number' || typeof v.fedMs !== 'number') return false;
    if (typeof v.carrying !== 'boolean') return false;
    if (typeof v.task !== 'string' && v.task !== null) return false;
    if (typeof v.state !== 'string') return false;
  }
  return true;
}

/**
 * Favor-shape check (schema v2, DESIGN §3 persist): one progress record per
 * villager with a boolean `active` and finite numbers, plus a finite
 * `nextOfferMs`. Wrong shape → the save is rejected → fresh game.
 */
function isPlausibleFavors(value: unknown, villagerCount: number): value is FavorsState {
  if (!isRecord(value)) return false;
  const byVillager = value.byVillager;
  if (!Array.isArray(byVillager) || byVillager.length !== villagerCount) return false;
  if (!Number.isFinite(value.nextOfferMs)) return false;
  for (const progress of byVillager) {
    if (!isRecord(progress)) return false;
    if (typeof progress.active !== 'boolean') return false;
    if (!Number.isFinite(progress.step) || !Number.isFinite(progress.progress)) return false;
  }
  return true;
}

/** v2 state = plausible v1 shape + a plausible favors block. */
function isPlausibleState(value: unknown): value is GameState {
  if (!isPlausibleV1State(value)) return false;
  const favors = (value as V1GameState & { favors?: unknown }).favors;
  return isPlausibleFavors(favors, value.villagers.length);
}

/**
 * Load the saved game. v2 (current) needs the full shape; v1 migrates
 * additively (DESIGN §3 persist): the village survives untouched and favor
 * chains start fresh. Any failure (missing, bad JSON, unknown version, wrong
 * shape) → null. Never throws.
 */
export function loadGame(storage: Storage = localStorage): GameState | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (!isRecord(parsed.state)) return null;
    if (parsed.version === VERSION) {
      if (!isPlausibleState(parsed.state)) return null;
      return parsed.state;
    }
    if (parsed.version === 1) {
      if (!isPlausibleV1State(parsed.state)) return null;
      // Additive migration v1 → v2: fresh chains — no instant offer, every
      // villager unprompted (createFavors sets nextOfferMs = FIRST_OFFER_MS).
      return { ...parsed.state, favors: createFavors(parsed.state.villagers.length) };
    }
    return null;
  } catch {
    return null;
  }
}

/** Write {version, state}; swallows quota / serialization errors. */
export function saveGame(state: GameState, storage: Storage = localStorage): void {
  try {
    const file: SaveFile = { version: VERSION, state };
    storage.setItem(STORAGE_KEY, JSON.stringify(file));
  } catch {
    // Persist must never throw into the frame loop.
  }
}

export function clearSave(storage: Storage = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * Autosave every 3000 ms, but only when state.tick changed since the last save
 * (so a paused / idle game does not rewrite the same bytes). Returns a stop fn.
 */
export function startAutosave(
  getState: () => GameState,
  storage: Storage = localStorage,
): () => void {
  let lastTick = getState().tick;
  const timer = setInterval(() => {
    const state = getState();
    if (state.tick !== lastTick) {
      lastTick = state.tick;
      saveGame(state, storage);
    }
  }, AUTOSAVE_INTERVAL_MS);
  return () => clearInterval(timer);
}
