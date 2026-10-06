// Persistence (DESIGN.md §3, B3; schema v6 = v5 + the bonds scores table):
// localStorage save / load / autosave.
// The GameState is plain JSON-safe data (no Maps / class instances) — that is a
// guarantee of the sim, so JSON.stringify/parse round-trips it losslessly.
// Every entry point is defensive: persist must never throw into the frame loop.

import {
  BOND_SCORE_MAX, CHAIN_LENGTH, DAY_MS, FIRST_VISIT_MS, FRESH_START_T, HUT_PLOTS,
  TRADES_PER_VISIT, VILLAGE_CAP, createFavors,
} from '../sim';
import type { Clock, FavorsState, GameState } from '../sim';

export const STORAGE_KEY = 'cozy-forest-village.save';
/**
 * v6 = v5 + the bonds `scores` table (batch 9); migrations chain
 * v1 → v2 → v3 → v4 → v5 → v6 (DESIGN §3 persist).
 */
export const VERSION = 6;
const AUTOSAVE_INTERVAL_MS = 3000;
/** Roster floor (spec Part 2): the fixed eight of DESIGN §3's roster. */
const MIN_VILLAGERS = 8;
/** `castIndex` ceiling (spec Part 2): one row per hut plot — four newcomer cast entries. */
const MAX_CAST_INDEX = 3;
/**
 * The bonds table size (spec Part 4): one score per ordered pair of the 12-slot roster,
 * row-major 12 × 12 = 144. Derived from `VILLAGE_CAP` so the validation can never drift.
 */
const BOND_SLOTS = VILLAGE_CAP * VILLAGE_CAP;

/**
 * Every pre-v4 schema shares this much: the pantry has no `spices` key and there is no trader
 * yet — both arrive with schema v4 (batch 7).
 */
type PreVisitor = { resources: Omit<GameState['resources'], 'spices'> };
/**
 * Every pre-v6 schema shares this much: no `bonds` block yet — it arrives with schema v6
 * (batch 9). Purely additive over v5.
 */
type PreBonds = Omit<GameState, 'bonds'>;
/** The v5 shape (batch 8): the full v6 state minus the bonds table. */
type V5GameState = PreBonds;
/**
 * Every pre-v5 schema shares this much: no day/night `clock` yet — it arrives with schema v5
 * (batch 8). Purely additive over v4.
 */
type PreClock = Omit<PreBonds, 'clock'>;
/** The v4 shape (batch 7): the full v5 state minus the clock. */
type V4GameState = PreClock;
/** Pre-favors schema (v1): everything in GameState except the favors block, arrivals and v4/v5 fields. */
type V1GameState = Omit<PreClock, 'favors' | 'arrivals' | 'visitor' | 'resources'> & PreVisitor;
/** Pre-arrivals schema (v2): v1 + the favors block; no hut plots, no arrivals, no v4/v5 fields. */
type V2GameState = Omit<PreClock, 'arrivals' | 'visitor' | 'resources'> & PreVisitor;
/** Pre-visitor schema (v3): v2 + the four hut plots + arrivals; no spices, no visitor, no clock yet. */
type V3GameState = Omit<PreClock, 'visitor' | 'resources'> & PreVisitor;

/**
 * The state as written to storage: the live `GameState` but with `bonds` narrowed to the
 * scores-only shape — `gapMs` is never saved (spec Part 4). Load reconstructs it zeroed.
 */
type SavedGameState = Omit<GameState, 'bonds'> & { bonds: { scores: number[] } };

interface SaveFile {
  version: number;
  state: SavedGameState;
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
function isPlausibleV3State(value: unknown): value is V3GameState {
  if (!isPlausibleV2State(value)) return false;
  const arrivals = (value as V2GameState & { arrivals?: unknown }).arrivals;
  if (!isPlausibleArrivals(arrivals)) return false;
  const roster = value.villagers.length;
  return roster >= MIN_VILLAGERS && roster <= VILLAGE_CAP;
}

/**
 * Visitor-shape check (schema v4, spec Part 2): a record with an `'away' | 'visiting'` phase,
 * a finite `inMs ≥ 0` (away: until arrival · visiting: until departure), a finite
 * `visitMs ≥ 0` (elapsed in the current visit) and an integer `tradesLeft` in
 * `[0, TRADES_PER_VISIT]`. Wrong shape → the save is rejected → fresh game.
 */
function isPlausibleVisitor(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.phase !== 'away' && value.phase !== 'visiting') return false;
  const inMs = value.inMs;
  if (typeof inMs !== 'number' || !Number.isFinite(inMs) || inMs < 0) return false;
  const visitMs = value.visitMs;
  if (typeof visitMs !== 'number' || !Number.isFinite(visitMs) || visitMs < 0) return false;
  const tradesLeft = value.tradesLeft;
  if (
    typeof tradesLeft !== 'number' ||
    !Number.isInteger(tradesLeft) ||
    tradesLeft < 0 ||
    tradesLeft > TRADES_PER_VISIT
  ) {
    return false;
  }
  return true;
}

/**
 * Clock-shape check (schema v5, spec Part 2): an object whose `dayMs` is finite and within the
 * cycle — `0 ≤ dayMs < DAY_MS`. Wrong shape → the save is rejected → fresh game.
 */
function isPlausibleClock(value: unknown): value is Clock {
  if (!isRecord(value)) return false;
  const dayMs = value.dayMs;
  return typeof dayMs === 'number' && Number.isFinite(dayMs) && dayMs >= 0 && dayMs < DAY_MS;
}

/**
 * v4 state = the v3 checks + the two batch-7 fields: a finite `spices ≥ 0` in the pantry and a
 * visitor of the right shape (spec Part 2). The v4 fields are read off the raw record first so
 * the guard narrows to `V4GameState` only once every rule has passed.
 */
function isPlausibleV4State(value: unknown): value is V4GameState {
  if (!isRecord(value)) return false;
  const resources = value.resources;
  if (!isRecord(resources)) return false;
  const spices = resources.spices;
  if (typeof spices !== 'number' || !Number.isFinite(spices) || spices < 0) return false;
  if (!isPlausibleVisitor(value.visitor)) return false;
  return isPlausibleV3State(value);
}

/**
 * Bonds-shape check (schema v6, spec Part 4): an object whose `scores` is an array of exactly
 * `BOND_SLOTS` (144) entries, every entry a finite number within `[0, BOND_SCORE_MAX]`. The
 * `gapMs` table is never saved, so it is not inspected here. Wrong shape → fresh game.
 */
function isPlausibleBonds(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const scores = value.scores;
  if (!Array.isArray(scores) || scores.length !== BOND_SLOTS) return false;
  for (const score of scores) {
    if (
      typeof score !== 'number' ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > BOND_SCORE_MAX
    ) {
      return false;
    }
  }
  return true;
}

/**
 * v5 state = the v4 checks + the day/night clock (spec Part 2). The clock is read off the raw
 * record first so the guard narrows to `V5GameState` only once every rule has passed.
 */
function isPlausibleV5State(value: unknown): value is V5GameState {
  if (!isPlausibleV4State(value)) return false;
  const clock = (value as V4GameState & { clock?: unknown }).clock;
  return isPlausibleClock(clock);
}

/**
 * v6 state = the v5 checks + the bonds scores table (spec Part 4). The bonds are read off the
 * raw record first so the guard narrows to `GameState` only once every rule has passed.
 */
function isPlausibleState(value: unknown): value is GameState {
  if (!isPlausibleV5State(value)) return false;
  const bonds = (value as V5GameState & { bonds?: unknown }).bonds;
  return isPlausibleBonds(bonds);
}

/**
 * Additive migration v2 → v3 (DESIGN §3 persist; spec Part 2): append the four `hut-1…hut-4`
 * plots from HUT_PLOTS — only those the save does not already have — and start with an empty
 * arrivals queue. The roster and every existing structure are untouched, so an existing
 * village simply gains four empty plots. Returns the v3 shape: the chain continues with
 * `migrateV3toV4`.
 */
function migrateV2toV3(state: V2GameState): V3GameState {
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
 * Additive migration v3 → v4 (DESIGN §3 persist; spec Part 2): the pantry gains `spices = 0`
 * and the village gains an away visitor whose first visit lands at `FIRST_VISIT_MS`. Roster,
 * resources, structures, favors and arrivals are untouched — an existing v3 village simply
 * gains the trader's schedule. Returns the v4 shape: the chain continues with `migrateV4toV5`.
 */
function migrateV3toV4(state: V3GameState): V4GameState {
  return {
    ...state,
    resources: { ...state.resources, spices: 0 },
    visitor: { phase: 'away', inMs: FIRST_VISIT_MS, visitMs: 0, tradesLeft: 0 },
  };
}

/**
 * Additive migration v4 → v5 (DESIGN §3 persist; spec Part 2): the village gains a day/night
 * clock parked on a fresh mid-morning, `DAY_MS × FRESH_START_T` — an ancient save wakes at the
 * same point of the day a new game does. Every v4 field is untouched. Returns the v5 shape: the
 * chain continues with `migrateV5toV6`.
 */
function migrateV4toV5(state: V4GameState): V5GameState {
  return { ...state, clock: { dayMs: DAY_MS * FRESH_START_T } };
}

/**
 * Additive migration v5 → v6 (DESIGN §3 persist; spec Part 4): the village gains a bonds table
 * with both arrays zeroed — no friendship has been recorded yet, and `gapMs` starts at 0 so a
 * fresh load can never fire a phantom reunion. Every v5 field is untouched.
 */
function migrateV5toV6(state: V5GameState): GameState {
  return {
    ...state,
    bonds: { scores: new Array<number>(BOND_SLOTS).fill(0), gapMs: new Array<number>(BOND_SLOTS).fill(0) },
  };
}

/**
 * Rehydrate the non-persisted half of the bonds table (spec Part 4): a saved blob carries
 * `scores` only, so a load rebuilds `gapMs` as zeros — a fresh load can never fire a phantom
 * reunion. Mutates the freshly parsed state in place and returns it.
 */
function hydrateGapMs(state: GameState): GameState {
  state.bonds.gapMs = new Array<number>(BOND_SLOTS).fill(0);
  return state;
}

/**
 * Load the saved game. Migrations chain additively (DESIGN §3 persist): v1 → v2 (favors) →
 * v3 (hut plots + arrivals) → v4 (spices + visitor) → v5 (day/night clock) → v6 (bonds scores).
 * Each older version is validated against *its own* schema, and the **migrated result is then
 * validated as the current schema as well** — so a v1…v5 village always survives, while a save
 * with an out-of-range roster, a missing `spices`, a broken visitor, an implausible clock or an
 * invalid bonds table is rejected rather than migrated into one the sim cannot run (the batch-6
 * review made post-migration validation a rule: I1). Any failure (missing, bad JSON, unknown
 * version, wrong shape) → null. Never throws.
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
      return hydrateGapMs(parsed.state);
    }
    if (parsed.version === 5) {
      if (!isPlausibleV5State(parsed.state)) return null;
      // Post-migration re-validation (batch-6 review I1): the migration constructs the bonds
      // itself, but the roster/spices/visitor/clock rules sit on fields it never touches.
      const v6 = migrateV5toV6(parsed.state);
      return isPlausibleState(v6) ? v6 : null;
    }
    if (parsed.version === 4) {
      if (!isPlausibleV4State(parsed.state)) return null;
      // v4 → v5 → v6, then the same post-migration v6 validation.
      const v6 = migrateV5toV6(migrateV4toV5(parsed.state));
      return isPlausibleState(v6) ? v6 : null;
    }
    if (parsed.version === 3) {
      if (!isPlausibleV3State(parsed.state)) return null;
      // v3 → v4 → v5 → v6, then the same post-migration v6 validation.
      const v6 = migrateV5toV6(migrateV4toV5(migrateV3toV4(parsed.state)));
      return isPlausibleState(v6) ? v6 : null;
    }
    if (parsed.version === 2) {
      if (!isPlausibleV2State(parsed.state)) return null;
      // v2 → v3 → v4 → v5 → v6, then the same post-migration v6 validation.
      const v6 = migrateV5toV6(migrateV4toV5(migrateV3toV4(migrateV2toV3(parsed.state))));
      return isPlausibleState(v6) ? v6 : null;
    }
    if (parsed.version === 1) {
      if (!isPlausibleV1State(parsed.state)) return null;
      // Additive migration v1 → v2: fresh chains — no instant offer, every
      // villager unprompted (createFavors sets nextOfferMs = FIRST_OFFER_MS).
      const v2: V2GameState = {
        ...parsed.state,
        favors: createFavors(parsed.state.villagers.length),
      };
      const v6 = migrateV5toV6(migrateV4toV5(migrateV3toV4(migrateV2toV3(v2))));
      return isPlausibleState(v6) ? v6 : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write {version, state}; swallows quota / serialization errors. The bonds table is serialized
 * as its `scores` only — `gapMs` is recomputed on load (spec Part 4), never persisted.
 */
export function saveGame(state: GameState, storage: Storage = localStorage): void {
  try {
    const file: SaveFile = {
      version: VERSION,
      state: { ...state, bonds: { scores: state.bonds.scores } },
    };
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
