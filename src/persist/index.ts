// Persistence (DESIGN.md §3, B3; schema v3 = favors + hut plots + arrivals): localStorage
// save / load / autosave.
// The GameState is plain JSON-safe data (no Maps / class instances) — that is a
// guarantee of the sim, so JSON.stringify/parse round-trips it losslessly.
// Every entry point is defensive: persist must never throw into the frame loop.

import { CHAIN_LENGTH, HUT_PLOTS, VILLAGE_CAP, createFavors } from '../sim';
import type { FavorsState, GameState } from '../sim';

export const STORAGE_KEY = 'cozy-forest-village.save';
/** v3 = v2 + the four hut plots + arrivals; migrations chain v1 → v2 → v3 (DESIGN §3). */
export const VERSION = 3;
const AUTOSAVE_INTERVAL_MS = 3000;
/** Roster floor (spec Part 2): the fixed eight of DESIGN §3's roster. */
const MIN_VILLAGERS = 8;
/** `castIndex` ceiling (spec Part 2): one row per hut plot — four newcomer cast entries. */
const MAX_CAST_INDEX = 3;

/** Pre-favors schema (v1): everything in GameState except the favors block and arrivals. */
type V1GameState = Omit<GameState, 'favors' | 'arrivals'>;
/** Pre-arrivals schema (v2): v1 + the favors block; no hut plots, no arrivals. */
type V2GameState = Omit<GameState, 'arrivals'>;

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
 * villager with a boolean `active`, an integer `step` within `[0,
 * CHAIN_LENGTH]`, a non-negative finite `progress`, plus a finite
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
    const step = progress.step;
    if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step > CHAIN_LENGTH) {
      return false;
    }
    const count = progress.progress;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return false;
  }
  return true;
}

/** v2 state = plausible v1 shape + a plausible favors block (still no arrivals). */
function isPlausibleV2State(value: unknown): value is V2GameState {
  if (!isPlausibleV1State(value)) return false;
  const favors = (value as V1GameState & { favors?: unknown }).favors;
  return isPlausibleFavors(favors, value.villagers.length);
}

/**
 * Arrivals-shape check (schema v3, spec Part 2): an array of records with a string
 * `structureId`, a finite `inMs ≥ 0` and an integer `castIndex` in `[0, 3]` (one row per
 * newcomer cast slot). Wrong shape → the save is rejected → fresh game.
 */
function isPlausibleArrivals(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const arrival of value) {
    if (!isRecord(arrival)) return false;
    if (typeof arrival.structureId !== 'string') return false;
    const inMs = arrival.inMs;
    if (typeof inMs !== 'number' || !Number.isFinite(inMs) || inMs < 0) return false;
    const castIndex = arrival.castIndex;
    if (
      typeof castIndex !== 'number' ||
      !Number.isInteger(castIndex) ||
      castIndex < 0 ||
      castIndex > MAX_CAST_INDEX
    ) {
      return false;
    }
  }
  return true;
}

/** v3 state = v2 checks + the arrivals shape + the `[8, 12]` roster bound (spec Part 2). */
function isPlausibleState(value: unknown): value is GameState {
  if (!isPlausibleV2State(value)) return false;
  const arrivals = (value as V2GameState & { arrivals?: unknown }).arrivals;
  if (!isPlausibleArrivals(arrivals)) return false;
  const roster = value.villagers.length;
  return roster >= MIN_VILLAGERS && roster <= VILLAGE_CAP;
}

/**
 * Additive migration v2 → v3 (DESIGN §3 persist; spec Part 2): append the four `hut-1…hut-4`
 * plots from HUT_PLOTS — only those the save does not already have — and start with an empty
 * arrivals queue. The roster and every existing structure are untouched, so an existing
 * village simply gains four empty plots.
 */
function migrateV2toV3(state: V2GameState): GameState {
  const have = new Set(state.structures.map((s) => s.id));
  const huts = HUT_PLOTS.filter((plot) => !have.has(plot.id)).map((plot) => ({
    id: plot.id,
    kind: 'hut' as const,
    pos: { ...plot.pos },
    built: false,
  }));
  return { ...state, structures: [...state.structures, ...huts], arrivals: [] };
}

/**
 * Load the saved game. Migrations chain additively (DESIGN §3 persist): v1 → v2 (favors) →
 * v3 (hut plots + arrivals). Each older version is validated against *its own* schema, and
 * the **migrated result is then validated as v3 as well** — so a v1/v2 village always
 * survives, and a save whose roster falls outside `[8, 12]` is rejected rather than migrated
 * into one that would drive `castIndex` off the newcomer cast table (review I1). Any failure
 * (missing, bad JSON, unknown version, wrong shape) → null. Never throws.
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
    if (parsed.version === 2) {
      if (!isPlausibleV2State(parsed.state)) return null;
      // I1: validate the migrated result as v3 too. `migrateV2toV3` constructs the arrivals
      // shape itself, but the roster bound sits on a pre-existing field the migration never
      // touches — an out-of-range roster would drive `castIndex` off the newcomer cast table.
      const v3 = migrateV2toV3(parsed.state);
      return isPlausibleState(v3) ? v3 : null;
    }
    if (parsed.version === 1) {
      if (!isPlausibleV1State(parsed.state)) return null;
      // Additive migration v1 → v2: fresh chains — no instant offer, every
      // villager unprompted (createFavors sets nextOfferMs = FIRST_OFFER_MS).
      const v2: V2GameState = {
        ...parsed.state,
        favors: createFavors(parsed.state.villagers.length),
      };
      const v3 = migrateV2toV3(v2);
      return isPlausibleState(v3) ? v3 : null;
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
