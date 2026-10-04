// Persistence (DESIGN.md §3, B3): localStorage save / load / autosave.
// The GameState is plain JSON-safe data (no Maps / class instances) — that is a
// guarantee of the sim, so JSON.stringify/parse round-trips it losslessly.
// Every entry point is defensive: persist must never throw into the frame loop.

import type { GameState } from '../sim';

export const STORAGE_KEY = 'cozy-forest-village.save';
export const VERSION = 1;
const AUTOSAVE_INTERVAL_MS = 3000;

interface SaveFile {
  version: number;
  state: GameState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Plausible-shape check (B3 spec): villagers / nodes / structures are arrays and
 * fire / pot are objects. Deliberately shallow — enough to reject corrupt saves
 * without over-rejecting a valid one.
 */
function isPlausibleState(value: unknown): value is GameState {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.villagers) &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.structures) &&
    isRecord(value.fire) &&
    isRecord(value.pot)
  );
}

/**
 * Load the saved game. Accepts only version === 1 with a plausible shape; any
 * failure (missing, bad JSON, wrong version, wrong shape) → null. Never throws.
 */
export function loadGame(storage: Storage = localStorage): GameState | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== VERSION) return null;
    if (!isRecord(parsed.state)) return null;
    if (!isPlausibleState(parsed.state)) return null;
    return parsed.state;
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
