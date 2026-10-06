// B3 tests: localStorage save / load / autosave with an in-memory Storage fake.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, VERSION, clearSave, loadGame, saveGame, startAutosave } from './index';
import {
  CHAIN_LENGTH, DAY_MS, FIRST_OFFER_MS, FIRST_VISIT_MS, FRESH_START_T, TRADES_PER_VISIT,
  createInitialState,
} from '../sim';
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

/** A state exactly as a pre-v5 save wrote it: no day/night clock (schema v1–v4, batch 8). */
function withoutClock(state: GameState): GameState {
  const old: GameState = { ...state };
  delete (old as unknown as Record<string, unknown>).clock;
  return old;
}

/** A batch-4 (v2) save: no hut plots, no arrivals block, no clock — the v2 → v3 input. */
function asV2(state: GameState): GameState {
  return withoutClock(
    withoutArrivals({
      ...state,
      structures: state.structures.filter((s) => s.kind !== 'hut'),
    }),
  );
}

/**
 * A batch-6 (v3) save: hut plots and arrivals present, no visitor, no spices, no clock — the
 * v3 → v4 migration's input (resources is copied so the delete never mutates the caller's state).
 */
function asV3(state: GameState): GameState {
  const v3 = withoutClock({ ...state, resources: { ...state.resources } });
  delete (v3 as unknown as Record<string, unknown>).visitor;
  delete (v3.resources as unknown as Record<string, unknown>).spices;
  return v3;
}

/**
 * A batch-7 (v4) save: everything the v4 schema had — spices + visitor — but no day/night clock.
 * The v4 → v5 migration's input.
 */
function asV4(state: GameState): GameState {
  return withoutClock(state);
}

/**
 * A realistic pre-favors (v1) village: the fixed eight of DESIGN §3's roster — the only count
 * a genuine pre-batch-6 save can have. `villagerCount` truncates it for the out-of-range
 * tests, so the migration fixture and the rejection fixture can never drift apart.
 */
function v1Blob(villagerCount = 8): unknown {
  const first = {
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
  };
  const rest = ['Maple', 'Birch', 'Pip', 'Hazel', 'Juniper', 'Moss', 'Clover'].map((name, i) => ({
    id: `villager-${i + 1}`,
    name,
    hatColor: '#7fa653',
    task: null,
    state: 'idle',
    pos: { x: -1, z: 2 },
    facing: 0,
    targetNodeId: null,
    progressMs: 0,
    fedMs: 0,
    carrying: false,
    restMs: 0,
  }));
  return {
    tick: 42,
    seed: 7,
    resources: { wood: 5, berries: 2 },
    villagers: [first, ...rest].slice(0, villagerCount),
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

  describe('v5 round-trip with favors', () => {
    it('saves as the current schema (v5) and restores an active favor mid-progress plus nextOfferMs', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.favors.byVillager[0] = { step: 1, active: true, progress: 3 };
      state.favors.nextOfferMs = 12_345;
      saveGame(state, storage);
      const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(raw.version).toBe(VERSION);
      expect(VERSION).toBe(5); // v5 = v4 + the day/night clock (DESIGN §3 persist)
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
      // Shares the realistic eight-villager fixture with the chained-migration test below — a
      // 1-villager blob is outside the v3 roster rule and would now be rejected (review I1).
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: v1Blob() }));
      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      // The village survives untouched (the migration adds only spices + the visitor).
      expect(loaded!.tick).toBe(42);
      expect(loaded!.seed).toBe(7);
      expect(loaded!.resources).toEqual({ wood: 5, berries: 2, spices: 0 });
      expect(loaded!.villagers).toHaveLength(8);
      expect(loaded!.villagers[0]!.task).toBe('chop');
      expect(loaded!.villagers[0]!.progressMs).toBe(400);
      expect(loaded!.fire.fuel).toBe(55);
      expect(loaded!.pot.meals).toBe(2);
      expect(loaded!.gardenMs).toBe(300);
      // Chains start fresh: no instant offer, every villager unprompted.
      expect(loaded!.favors.nextOfferMs).toBe(FIRST_OFFER_MS);
      expect(loaded!.favors.byVillager).toEqual(
        Array.from({ length: 8 }, () => ({ step: 0, active: false, progress: 0 })),
      );
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
      expect(loaded!.resources).toEqual({ wood: 17, berries: 0, spices: 0 });
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
      const partial = withoutClock(
        withoutArrivals({
          ...state,
          structures: state.structures.filter((s) => s.id !== 'hut-2'),
        }),
      );
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, state: partial }));

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      const ids = loaded!.structures.filter((s) => s.kind === 'hut').map((s) => s.id);
      expect([...ids].sort()).toEqual(['hut-1', 'hut-2', 'hut-3', 'hut-4']);
    });

    it('rejects a v2 roster outside [8, 12] instead of migrating it (review I1)', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.villagers.pop();
      state.favors.byVillager.pop();
      expect(state.villagers).toHaveLength(7); // passes v2 validation; only the v3 bound rejects
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, state: asV2(state) }));
      expect(loadGame(storage)).toBeNull();
    });
  });

  describe('v1 → v5 chained migration (Review Focus 4 + 5)', () => {
    it('keeps the village intact and adds hut plots, an empty queue, spices, the visitor and a fresh clock', () => {
      const storage = makeStorageFake();
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: v1Blob() }));

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      // v1 → v2 half: the village survives, chains start fresh.
      expect(loaded!.tick).toBe(42);
      expect(loaded!.seed).toBe(7);
      expect(loaded!.resources).toEqual({ wood: 5, berries: 2, spices: 0 });
      expect(loaded!.villagers).toHaveLength(8);
      expect(loaded!.villagers[0]!.name).toBe('Fern');
      expect(loaded!.villagers[0]!.progressMs).toBe(400);
      expect(loaded!.favors.nextOfferMs).toBe(FIRST_OFFER_MS);
      expect(loaded!.favors.byVillager).toEqual(
        Array.from({ length: 8 }, () => ({ step: 0, active: false, progress: 0 })),
      );
      // v2 → v3 half: four empty plots, no pending arrivals, nothing else changes.
      expect(loaded!.structures.filter((s) => s.kind !== 'hut')).toEqual([]);
      const huts = loaded!.structures.filter((s) => s.kind === 'hut');
      expect(huts.map((h) => h.id)).toEqual(['hut-1', 'hut-2', 'hut-3', 'hut-4']);
      expect(huts.every((h) => !h.built)).toBe(true);
      expect(loaded!.arrivals).toEqual([]);
      // v3 → v4 half (Review Focus 5): the chain reaches the trader's schema end-to-end.
      expect(loaded!.visitor).toEqual({
        phase: 'away',
        inMs: FIRST_VISIT_MS,
        visitMs: 0,
        tradesLeft: 0,
      });
      // v4 → v5 half: an ancient save wakes on a fresh morning.
      expect(loaded!.clock).toEqual({ dayMs: DAY_MS * FRESH_START_T });
    });

    it('rejects a v1 roster outside [8, 12] after the chain (review I1)', () => {
      const storage = makeStorageFake();
      // Seven villagers survive the v1 and v2 shape checks; only the post-migration v3
      // roster bound catches them, before they can drive castIndex off the cast table.
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: v1Blob(7) }));
      expect(loadGame(storage)).toBeNull();
    });
  });

  describe('v3 → v5 chained migration', () => {
    it('adds spices 0, an away visitor and a fresh clock, village untouched', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.resources.wood = 17;
      state.villagers[0]!.task = 'chop';
      const v3 = asV3(state); // batch-6 save: huts + arrivals, no visitor, no spices, no clock
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, state: v3 }));

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      // The village is untouched …
      expect(loaded!.tick).toBe(state.tick);
      expect(loaded!.villagers).toEqual(state.villagers);
      expect(loaded!.favors).toEqual(state.favors);
      expect(loaded!.structures).toEqual(state.structures);
      expect(loaded!.arrivals).toEqual([]);
      expect(loaded!.fire).toEqual(state.fire);
      expect(loaded!.pot).toEqual(state.pot);
      // … and it gains exactly the v4 fields and the v5 clock.
      expect(loaded!.resources).toEqual({ wood: 17, berries: 0, spices: 0 });
      expect(loaded!.visitor).toEqual({
        phase: 'away',
        inMs: FIRST_VISIT_MS,
        visitMs: 0,
        tradesLeft: 0,
      });
      expect(loaded!.clock).toEqual({ dayMs: DAY_MS * FRESH_START_T });
    });

    it('rejects a v3 blob that fails the v3 shape check', () => {
      const storage = makeStorageFake();
      const v3 = asV3(createInitialState());
      delete (v3 as unknown as Record<string, unknown>).arrivals;
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, state: v3 }));
      expect(loadGame(storage)).toBeNull();
    });
  });

  describe('v4 → v5 migration', () => {
    it('wakes an ancient save on a fresh morning, keeping the village intact', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.resources.wood = 17;
      state.villagers[0]!.task = 'chop';
      state.visitor = { phase: 'visiting', inMs: 75_000, visitMs: 45_000, tradesLeft: 1 };
      const v4 = asV4(state); // batch-7 save: spices + visitor, no clock
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 4, state: v4 }));

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      // The v4 village survives untouched …
      expect(loaded!.tick).toBe(state.tick);
      expect(loaded!.villagers).toEqual(state.villagers);
      expect(loaded!.resources).toEqual(state.resources);
      expect(loaded!.visitor).toEqual(state.visitor);
      expect(loaded!.structures).toEqual(state.structures);
      // … and it gains exactly the v5 clock at the fresh mid-morning start.
      expect(loaded!.clock).toEqual({ dayMs: DAY_MS * FRESH_START_T });
    });

    it('rejects a v4 blob that fails the v4 shape check', () => {
      const storage = makeStorageFake();
      const v4 = asV4(createInitialState());
      delete (v4.resources as unknown as Record<string, unknown>).spices;
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 4, state: v4 }));
      expect(loadGame(storage)).toBeNull();
    });
  });

  describe('v5 round-trip mid-evening (Review Focus 1)', () => {
    it('restores dayMs exactly', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.clock.dayMs = 400_000; // mid-evening (dusk/night)

      saveGame(state, storage);
      const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(raw.version).toBe(VERSION);

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(state);
      expect(loaded!.clock.dayMs).toBe(400_000);
    });
  });

  describe('v5 clock validation', () => {
    it('returns null when the clock is missing, non-finite or out of range', () => {
      const storage = makeStorageFake();
      const bad: unknown[] = [
        undefined, // clock missing entirely
        'morning', // not a record
        {}, // no dayMs
        { dayMs: 'soon' }, // non-number dayMs
        { dayMs: Number.NaN }, // NaN serializes to null → rejected
        { dayMs: Number.POSITIVE_INFINITY }, // Infinity serializes to null → rejected
        { dayMs: -1 }, // below the floor
        { dayMs: DAY_MS }, // the wrap point is exclusive
        { dayMs: DAY_MS + 1 }, // above the cycle
      ];
      for (const clock of bad) {
        const state = createInitialState();
        (state as unknown as Record<string, unknown>).clock = clock;
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
        expect(loadGame(storage)).toBeNull();
      }
    });

    it('accepts both ends of the valid range', () => {
      const storage = makeStorageFake();
      for (const dayMs of [0, DAY_MS - 1]) {
        const state = createInitialState();
        state.clock.dayMs = dayMs;
        saveGame(state, storage);
        expect(loadGame(storage)).toEqual(state);
      }
    });
  });

  describe('v5 round-trip mid-visit (Review Focus 1)', () => {
    it('restores a visiting trader exactly: countdown, elapsed visit and trades left', () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.visitor = { phase: 'visiting', inMs: 75_000, visitMs: 45_000, tradesLeft: 1 };
      state.resources.spices = 2;

      saveGame(state, storage);
      const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(raw.version).toBe(5); // WRITE is always the current schema

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(state);
      expect(loaded!.visitor).toEqual({ phase: 'visiting', inMs: 75_000, visitMs: 45_000, tradesLeft: 1 });
      expect(loaded!.resources.spices).toBe(2);
    });
  });

  describe('v5 visitor validation', () => {
    it('returns null for an invalid visitor shape', () => {
      const storage = makeStorageFake();
      const bad: unknown[] = [
        undefined, // visitor missing entirely
        'away', // not a record
        { inMs: 100, visitMs: 0, tradesLeft: 0 }, // no phase
        { phase: 'gone', inMs: 100, visitMs: 0, tradesLeft: 0 }, // phase off-enum
        { phase: 'visiting', inMs: -1, visitMs: 0, tradesLeft: 0 }, // negative countdown
        { phase: 'visiting', inMs: 100, visitMs: -1, tradesLeft: 0 }, // negative elapsed
        { phase: 'visiting', inMs: 'soon', visitMs: 0, tradesLeft: 0 }, // non-number countdown
        { phase: 'visiting', inMs: 100, visitMs: Infinity, tradesLeft: 0 }, // non-finite → null in JSON
        { phase: 'visiting', inMs: 100, visitMs: 0 }, // no tradesLeft
        { phase: 'visiting', inMs: 100, visitMs: 0, tradesLeft: -1 }, // below the floor
        { phase: 'visiting', inMs: 100, visitMs: 0, tradesLeft: TRADES_PER_VISIT + 1 }, // one above stock
        { phase: 'visiting', inMs: 100, visitMs: 0, tradesLeft: 1.5 }, // not an integer
      ];
      for (const visitor of bad) {
        const state = createInitialState();
        (state as unknown as Record<string, unknown>).visitor = visitor;
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
        expect(loadGame(storage)).toBeNull();
      }
    });

    it('accepts both phases at the valid boundaries', () => {
      const storage = makeStorageFake();
      const visitors: GameState['visitor'][] = [
        { phase: 'away', inMs: FIRST_VISIT_MS, visitMs: 0, tradesLeft: 0 },
        { phase: 'visiting', inMs: 0, visitMs: 45_000, tradesLeft: TRADES_PER_VISIT },
      ];
      for (const visitor of visitors) {
        const state = createInitialState();
        state.visitor = visitor;
        saveGame(state, storage);
        expect(loadGame(storage)).toEqual(state);
      }
    });
  });

  describe('v5 spices validation', () => {
    it('returns null when spices is missing, non-finite or negative', () => {
      const storage = makeStorageFake();
      for (const spices of [undefined, -1, Infinity, NaN, 'pinch']) {
        const state = createInitialState();
        (state.resources as unknown as Record<string, unknown>).spices = spices;
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }));
        expect(loadGame(storage)).toBeNull();
      }

      // A non-negative finite number round-trips.
      const full = createInitialState();
      full.resources.spices = 3;
      saveGame(full, storage);
      expect(loadGame(storage)).toEqual(full);
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

  describe('v5 round-trip with arrivals (Review Focus 1)', () => {
    it("restores a villager mid-walk-in and a pending arrival's countdown exactly", () => {
      const storage = makeStorageFake();
      const state = createInitialState();
      state.villagers[0]!.state = 'arriving';
      state.villagers[0]!.targetNodeId = 'hut-1';
      state.villagers[0]!.pos = { x: 0, z: -12 }; // EDGE_SPAWN: still walking in from the forest edge
      state.arrivals.push({ structureId: 'hut-1', inMs: 45_000, castIndex: 0 });

      saveGame(state, storage);
      const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
      expect(raw.version).toBe(VERSION);

      const loaded = loadGame(storage);
      expect(loaded).not.toBeNull();
      expect(loaded).toEqual(state);
      expect(loaded!.villagers[0]!.state).toBe('arriving');
      expect(loaded!.villagers[0]!.targetNodeId).toBe('hut-1');
      expect(loaded!.villagers[0]!.pos).toEqual({ x: 0, z: -12 });
      expect(loaded!.arrivals).toEqual([{ structureId: 'hut-1', inMs: 45_000, castIndex: 0 }]);
    });
  });

  describe('v5 arrivals validation', () => {
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

  describe('v5 roster bound', () => {
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
