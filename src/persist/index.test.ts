// B3 tests: localStorage save / load / autosave with an in-memory Storage fake.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, VERSION, clearSave, loadGame, saveGame, startAutosave } from './index';
import { createInitialState } from '../sim';

/** Minimal in-memory Storage fake matching the DOM Storage interface. */
function makeStorageFake(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key(index: number) {
      const keys = [...map.keys()];
      return index >= 0 && index < keys.length ? keys[index]! : null;
    },
  };
}

describe('persist', () => {
  describe('round-trip', () => {
    it('saves and loads a deep-equal game', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.resources.wood = 7;
      state.resources.berries = 3;
      state.villagers[0]!.task = 'chop';
      state.structures.find((s) => s.id === 'pot')!.built = true;
      saveGame(state, storage);
      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(state);
    });

    it('returns null when nothing is stored', () => {
      expect(loadGame(makeStorageFake())).toBeNull();
    });
  });

  describe('loadGame validation', () => {
    it('returns null on wrong version', () => {
      const storage = makeStorageFake();
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION + 1, state: createInitialState() }));
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null on corrupt JSON', () => {
      const storage = makeStorageFake();
      storage.setItem(STORAGE_KEY, '{not valid json');
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null when required arrays are missing', () => {
      const storage = makeStorageFake();
      const bad = { ...createInitialState(), nodes: undefined };
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: bad }));
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null when fire/pot are not objects', () => {
      const storage = makeStorageFake();
      const bad = { ...createInitialState(), fire: 42 };
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: bad }));
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null when fire fuel/max or gardenMs are not numbers', () => {
      const storage = makeStorageFake();
      const noFuel = createInitialState();
      (noFuel.fire as unknown as Record<string, unknown>).fuel = undefined;
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: noFuel }));
      expect(loadGame(storage)).toBeNull();

      const badGarden = { ...createInitialState(), gardenMs: 'soon' };
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: badGarden }));
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null when pendingEvents is missing', () => {
      const storage = makeStorageFake();
      const bad = { ...createInitialState(), pendingEvents: undefined };
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: bad }));
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null when a villager misses activity fields', () => {
      const storage = makeStorageFake();
      const noRest = createInitialState();
      delete (noRest.villagers[0] as unknown as Record<string, unknown>).restMs;
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: noRest }));
      expect(loadGame(storage)).toBeNull();

      const badCarry = createInitialState();
      (badCarry.villagers[1] as unknown as Record<string, unknown>).carrying = 'yes';
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: badCarry }));
      expect(loadGame(storage)).toBeNull();

      const nullTask = createInitialState(); // task: null is a valid shape
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: nullTask }));
      expect(loadGame(storage)).not.toBeNull();
    });
  });

  describe('clearSave', () => {
    it('empties the stored save', () => {
      const storage = makeStorageFake();
      saveGame(createInitialState(), storage);
      expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
      clearSave(storage);
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('autosave', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('writes once per tick change and not twice without change', () => {
      const storage = makeStorageFake();
      let state = createInitialState();
      const stop = startAutosave(() => state, storage);

      // No tick change after one interval → no write.
      vi.advanceTimersByTime(3000);
      expect(storage.getItem(STORAGE_KEY)).toBeNull();

      // Tick changes → the next interval writes exactly once.
      state = { ...state, tick: state.tick + 1 };
      vi.advanceTimersByTime(3000);
      const first = storage.getItem(STORAGE_KEY);
      expect(first).not.toBeNull();

      // No further tick change → still the same single write.
      vi.advanceTimersByTime(3000);
      expect(storage.getItem(STORAGE_KEY)).toBe(first);

      // Another tick change → exactly one more write.
      state = { ...state, tick: state.tick + 1 };
      vi.advanceTimersByTime(3000);
      expect(storage.getItem(STORAGE_KEY)).not.toBe(first);

      stop();
    });
  });
});
