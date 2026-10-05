// B3 tests: localStorage save / load / autosave with an in-memory Storage fake.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, VERSION, clearSave, loadGame, saveGame, startAutosave } from './index';
import { CHAIN_LENGTH, FIRST_OFFER_MS, createInitialState } from '../sim';
import type { GameState } from '../sim';

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

/** A state exactly as batch 4 wrote it: no arrivals block (schema v2). */
function withoutArrivals(state: GameState): GameState {
  const v2: GameState = { ...state };
  delete (v2 as unknown as Record<string, unknown>).arrivals;
  return v2;
}

/** A batch-4 (v2) save: no hut plots, no arrivals block — the v2 → v3 migration's input. */
function asV2(state: GameState): GameState {
  return withoutArrivals({
    ...state,
    structures: state.structures.filter((s) => s.kind !== 'hut'),
  });
}

/** A minimal but valid pre-favors (v1) state, for the chained-migration test. */
function v1Blob(): unknown {
  return {
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

  describe('v3 round-trip with favors', () => {
    it('saves as the current schema (v3) and restores an active favor mid-progress plus nextOfferMs', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.favors.byVillager[0] = { step: 1, active: true, progress: 3 };
      state.favors.nextOfferMs = 12_345;
      saveGame(state, storage);
      const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(raw.version).toBe(VERSION);
      expect(VERSION).toBe(3); // v3 = v2 + the four hut plots + arrivals (DESIGN §3 persist)
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

  describe('v2 → v3 migration', () => {
    it('appends four unbuilt hut plots and an empty arrivals queue, village untouched', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.resources.wood = 17;
      state.villagers[0]!.task = 'chop';
      state.favors.byVillager[1] = { step: 2, active: true, progress: 4 };
      state.favors.nextOfferMs = 4321;
      const v2 = asV2(state);
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, state: v2 }));

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      // The existing village is untouched …
      expect(loaded!.tick).toBe(state.tick);
      expect(loaded!.resources).toEqual({ wood: 17, berries: 0 });
      expect(loaded!.villagers).toEqual(state.villagers);
      expect(loaded!.favors).toEqual(state.favors);
      expect(loaded!.fire).toEqual(state.fire);
      expect(loaded!.structures.filter((s) => s.kind !== 'hut')).toEqual(v2.structures);
      // … and it gains exactly the four unbuilt plots (hut-1…hut-4) and an empty queue.
      const huts = loaded!.structures.filter((s) => s.kind === 'hut');
      expect(huts.map((h) => h.id)).toEqual(['hut-1', 'hut-2', 'hut-3', 'hut-4']);
      expect(huts.every((h) => !h.built)).toBe(true);
      expect(loaded!.arrivals).toEqual([]);
    });

    it('never duplicates a hut plot the save already has', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      // A half-migrated blob: hut-2 missing, the others present.
      const partial = withoutArrivals({
        ...state,
        structures: state.structures.filter((s) => s.id !== 'hut-2'),
      });
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, state: partial }));

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      const ids = loaded!.structures.filter((s) => s.kind === 'hut').map((s) => s.id);
      expect([...ids].sort()).toEqual(['hut-1', 'hut-2', 'hut-3', 'hut-4']);
    });
  });

  describe('v1 → v2 → v3 chained migration (Review Focus 4)', () => {
    it('keeps the village intact and adds four unbuilt hut plots plus an empty queue', () => {
      const storage = makeStorageFake();
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: v1Blob() }));

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      // v1 → v2 half: the village survives, chains start fresh.
      expect(loaded!.tick).toBe(42);
      expect(loaded!.seed).toBe(7);
      expect(loaded!.resources).toEqual({ wood: 5, berries: 2 });
      expect(loaded!.villagers).toHaveLength(1);
      expect(loaded!.villagers[0]!.name).toBe('Fern');
      expect(loaded!.villagers[0]!.progressMs).toBe(400);
      expect(loaded!.favors.nextOfferMs).toBe(FIRST_OFFER_MS);
      expect(loaded!.favors.byVillager).toEqual([{ step: 0, active: false, progress: 0 }]);
      // v2 → v3 half: four empty plots, no pending arrivals, nothing else changes.
      expect(loaded!.structures.filter((s) => s.kind !== 'hut')).toEqual([]);
      const huts = loaded!.structures.filter((s) => s.kind === 'hut');
      expect(huts.map((h) => h.id)).toEqual(['hut-1', 'hut-2', 'hut-3', 'hut-4']);
      expect(huts.every((h) => !h.built)).toBe(true);
      expect(loaded!.arrivals).toEqual([]);
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

    it('returns null for a non-integer or out-of-range step, and negative progress', () => {
      const storage = makeStorageFake();
      for (const step of [1.5, -1, CHAIN_LENGTH + 1]) {
        const state = createInitialState();
        state.favors.byVillager[0]!.step = step;
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
        expect(loadGame(storage)).toBeNull();
      }

      const negative = createInitialState();
      negative.favors.byVillager[0]!.progress = -1;
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: negative }));
      expect(loadGame(storage)).toBeNull();

      // CHAIN_LENGTH itself is legal: a retired villager round-trips.
      const retired = createInitialState();
      retired.favors.byVillager[0]!.step = CHAIN_LENGTH;
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state: retired }));
      expect(loadGame(storage)).not.toBeNull();
    });
  });

  describe('v3 round-trip with arrivals (Review Focus 1)', () => {
    it("restores a villager mid-walk-in and a pending arrival's countdown exactly", () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.villagers[0]!.state = 'arriving';
      state.villagers[0]!.targetNodeId = 'hut-1';
      state.villagers[0]!.pos = { x: 0, z: -12 }; // EDGE_SPAWN: still walking in from the forest edge
      state.arrivals.push({ structureId: 'hut-1', inMs: 45_000, castIndex: 0 });

      saveGame(state, storage);
      const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(raw.version).toBe(3);

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(state);
      expect(loaded!.villagers[0]!.state).toBe('arriving');
      expect(loaded!.villagers[0]!.targetNodeId).toBe('hut-1');
      expect(loaded!.villagers[0]!.pos).toEqual({ x: 0, z: -12 });
      expect(loaded!.arrivals).toEqual([{ structureId: 'hut-1', inMs: 45_000, castIndex: 0 }]);
    });
  });

  describe('v3 arrivals validation', () => {
    it('returns null when arrivals is missing or not an array', () => {
      const storage = makeStorageFake();
      for (const arrivals of [undefined, 'queue', 42, { structureId: 'hut-1' }]) {
        const state = createInitialState();
        (state as unknown as Record<string, unknown>).arrivals = arrivals;
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
        expect(loadGame(storage)).toBeNull();
      }
    });

    it('returns null for an arrival that is not a valid record', () => {
      const storage = makeStorageFake();
      const bad: unknown[] = [
        42, // not a record
        { inMs: 100, castIndex: 0 }, // no structureId
        { structureId: 7, inMs: 100, castIndex: 0 }, // non-string structureId
        { structureId: 'hut-1', castIndex: 0 }, // no inMs
        { structureId: 'hut-1', inMs: -1, castIndex: 0 }, // negative countdown
        { structureId: 'hut-1', inMs: 'soon', castIndex: 0 }, // non-number countdown
        { structureId: 'hut-1', inMs: Number.NaN, castIndex: 0 }, // NaN serializes to null
        { structureId: 'hut-1', inMs: 100 }, // no castIndex
      ];
      for (const arrival of bad) {
        const state = createInitialState();
        (state as unknown as Record<string, unknown>).arrivals = [arrival];
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
        expect(loadGame(storage)).toBeNull();
      }
    });

    it('returns null for a non-integer or out-of-range castIndex', () => {
      const storage = makeStorageFake();
      for (const castIndex of [-1, 4, 1.5]) {
        const state = createInitialState();
        state.arrivals.push({ structureId: 'hut-1', inMs: 1000, castIndex });
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
        expect(loadGame(storage)).toBeNull();
      }
    });

    it('accepts a valid queue, including the castIndex boundaries 0 and 3', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.arrivals.push(
        { structureId: 'hut-1', inMs: 0, castIndex: 0 },
        { structureId: 'hut-4', inMs: 89_999, castIndex: 3 },
      );
      saveGame(state, storage);
      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      expect(loaded!.arrivals).toEqual(state.arrivals);
    });
  });

  describe('v3 roster bound', () => {
    it('returns null above the 12-villager cap', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      // 13 villagers with 13 favor records — only the roster rule can reject this.
      for (let i = 0; i < 5; i += 1) {
        state.villagers.push({ ...state.villagers[0]!, id: `extra-${i}` });
        state.favors.byVillager.push({ step: 0, active: false, progress: 0 });
      }
      expect(state.villagers).toHaveLength(13);
      saveGame(state, storage);
      expect(loadGame(storage)).toBeNull();
    });

    it('returns null below the fixed eight', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.villagers.pop();
      state.favors.byVillager.pop();
      expect(state.villagers).toHaveLength(7);
      saveGame(state, storage);
      expect(loadGame(storage)).toBeNull();
    });

    it('accepts the full twelve: the fixed eight plus four newcomers', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      for (let i = 0; i < 4; i += 1) {
        state.villagers.push({ ...state.villagers[0]!, id: `newcomer-${i}` });
        state.favors.byVillager.push({ step: 0, active: false, progress: 0 });
      }
      expect(state.villagers).toHaveLength(12);
      saveGame(state, storage);
      expect(loadGame(storage)).toEqual(state);
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
