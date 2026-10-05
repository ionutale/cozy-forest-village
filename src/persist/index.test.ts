// B3 tests: localStorage save / load / autosave with an in-memory Storage fake.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, VERSION, clearSave, loadGame, saveGame, startAutosave } from './index';
import { FIRST_OFFER_MS, createInitialState } from '../sim';

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

  describe('v2 round-trip with favors', () => {
    it('saves as v2 and restores an active favor mid-progress plus nextOfferMs', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.favors.byVillager[0] = { step: 1, active: true, progress: 3 };
      state.favors.nextOfferMs = 12_345;
      saveGame(state, storage);
      const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(raw.version).toBe(2);
      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(state);
      // Review Focus 1: reload mid-favor keeps the same active favor, progress and countdown.
      expect(loaded!.favors.byVillager[0]).toEqual({ step: 1, active: true, progress: 3 });
      expect(loaded!.favors.nextOfferMs).toBe(12_345);
    });
  });

  describe('v1 → v2 migration', () => {
    it('loads a v1 save, keeps the village intact and starts chains fresh', () => {
      const storage = makeStorageFake();
      const v1State = {
        tick: 42,
        seed: 7,
        resources: { wood: 5, berries: 2 },
        villagers: [
          {
            id: 'villager-0',
            name: 'Fern',
            hatColor: '#e8b4b8',
            task: 'chop',
            state: 'working',
            pos: { x: 1.5, z: -0.5 },
            facing: 0.25,
            targetNodeId: 'tree-0',
            progressMs: 400,
            fedMs: 1200,
            carrying: false,
            restMs: 0,
          },
        ],
        nodes: [{ id: 'tree-0', kind: 'tree', pos: { x: 8, z: 0 } }],
        structures: [],
        fire: { fuel: 55, max: 100 },
        pot: { meals: 2 },
        gardenMs: 300,
        events: [],
        pendingEvents: [],
      };
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: v1State }));
      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      // The village survives untouched.
      expect(loaded!.tick).toBe(42);
      expect(loaded!.seed).toBe(7);
      expect(loaded!.resources).toEqual({ wood: 5, berries: 2 });
      expect(loaded!.villagers).toHaveLength(1);
      expect(loaded!.villagers[0]!.task).toBe('chop');
      expect(loaded!.villagers[0]!.progressMs).toBe(400);
      expect(loaded!.fire.fuel).toBe(55);
      expect(loaded!.pot.meals).toBe(2);
      expect(loaded!.gardenMs).toBe(300);
      // Chains start fresh: no instant offer, every villager unprompted.
      expect(loaded!.favors.nextOfferMs).toBe(FIRST_OFFER_MS);
      expect(loaded!.favors.byVillager).toEqual([{ step: 0, active: false, progress: 0 }]);
    });

    it('returns null when a v1 blob fails the v1 shape check', () => {
      const storage = makeStorageFake();
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: { resources: {} } }));
      expect(loadGame(storage)).toBeNull();
    });
  });

  describe('v2 favors validation', () => {
    it('returns null when a v2 save has no favors block', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      delete (state as unknown as Record<string, unknown>).favors;
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null when byVillager length does not match the roster', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.favors.byVillager.push({ step: 0, active: false, progress: 0 });
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null when a favors number is non-finite', () => {
      const storage = makeStorageFake();
      const inf = createInitialState();
      inf.favors.nextOfferMs = Infinity; // serializes to null → rejected
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: inf }));
      expect(loadGame(storage)).toBeNull();

      const nan = createInitialState();
      nan.favors.byVillager[0]!.progress = NaN; // serializes to null → rejected
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: nan }));
      expect(loadGame(storage)).toBeNull();

      const str = createInitialState();
      (str.favors as unknown as Record<string, unknown>).nextOfferMs = 'soon';
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: str }));
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null when a byVillager entry is not a progress record', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      (state.favors as unknown as Record<string, unknown>).byVillager = [42, 42, 42];
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
      expect(loadGame(storage)).toBeNull();
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
