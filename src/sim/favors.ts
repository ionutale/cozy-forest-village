// Villager favor chains (batch 4): model, chain content, offering, completion.
// Binding rules: DESIGN.md §3.2 ("Favor chains") and
// docs/superpowers/specs/2026-10-05-villager-favors-design.md Parts 1–2.
// Pure and deterministic: no Math.random, no clocks, no stored RNG stream
// (DESIGN.md §3.1).

import type { FavorsState, FavorWant, GameState, SimEvent } from './types';
import { mulberry32 } from './rng';
import { FIRE_STEADY } from './tasks';

/** ~2 minutes of play before the first favor. */
export const FIRST_OFFER_MS = 120_000;
/** Minimum wait between offers; re-armed per offer, re-enforced per completion. */
export const NEXT_OFFER_GAP_MS = 90_000;
/** Never more than two villagers asking at once. */
export const MAX_ACTIVE_FAVORS = 2;
/** Steps per villager; completing the last loops back to step 0 (no retirement). */
export const CHAIN_LENGTH = 3;

/** "Warm enough" for the fire favor — the steady-fire threshold (DESIGN.md §3.2). */
const FIRE_WARM_FUEL = FIRE_STEADY; // 33
/** The fire favor's accumulated warm-time target. */
const FIRE_FAVOR_MS = 120_000;

/** All-fresh favor progress for a roster, with the first offer 120 s out. */
export function createFavors(villagerCount: number): FavorsState {
  return {
    byVillager: Array.from({ length: villagerCount }, () => ({
      step: 0,
      active: false,
      progress: 0,
    })),
    nextOfferMs: FIRST_OFFER_MS,
  };
}

/**
 * Chain content (spec Part 2): one shared template over the villager's stable
 * 0-based roster index and the 0-based step. Returns null beyond the chain.
 */
export function favorWantFor(villagerIndex: number, step: number): FavorWant | null {
  if (step === 0) return { kind: 'eat', who: 'self', count: 1 };
  if (step === 1) {
    return villagerIndex % 2 === 0 ? { kind: 'gather', count: 6 } : { kind: 'chop', count: 4 };
  }
  if (step === 2) {
    const variant = villagerIndex % 3;
    if (variant === 0) return { kind: 'eat', who: 'any', count: 3 };
    if (variant === 1) return { kind: 'build', count: 1 };
    return { kind: 'fire', ms: FIRE_FAVOR_MS };
  }
  return null;
}

/** Sim event type that counts toward each countable want kind. */
const EVENT_TYPE_FOR: Readonly<Record<'eat' | 'gather' | 'chop' | 'build', SimEvent['type']>> = {
  eat: 'eat',
  gather: 'gather',
  chop: 'chop',
  build: 'built',
};

/**
 * One favor step per tick (DESIGN.md §3.2): count the offer countdown down,
 * open one favor when due and under the cap, then count this tick's events and
 * warm-fire time toward any favor that was already active.
 */
export function tickFavors(state: GameState, dtMs: number): void {
  const favors = state.favors;
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;

  // 1. Countdown, floored at 0: a due offer waits (and retries each tick) when
  // the board is full or nobody is eligible.
  if (dt > 0) favors.nextOfferMs = Math.max(0, favors.nextOfferMs - dt);

  // Favors active before this tick's offer pass: only they can complete on
  // this tick's events / dt, which all belong to the moment before a newly
  // opened favor existed.
  const activeBefore = favors.byVillager.map((p) => p.active);

  // 2. Offer one favor when due and under the cap.
  if (favors.nextOfferMs <= 0) {
    // Durable heal for batch-4 saves: records parked at CHAIN_LENGTH (the old
    // retired state) rejoin the loop at step 0. Runs before the max-2 check so
    // a full board cannot strand them.
    for (const p of favors.byVillager) {
      if (p.step >= CHAIN_LENGTH) p.step = 0;
    }
    let activeCount = 0;
    const eligible: number[] = [];
    for (let i = 0; i < favors.byVillager.length; i += 1) {
      const p = favors.byVillager[i]!;
      if (p.active) activeCount += 1;
      else if (p.step < CHAIN_LENGTH) eligible.push(i);
    }
    if (activeCount < MAX_ACTIVE_FAVORS && eligible.length > 0) {
      const completedSteps = favors.byVillager.reduce((sum, p) => sum + p.step, 0);
      // Pure requester derive (spec §1.3): a fresh mulberry32 stream keyed by
      // `seed ^ 0x9e3779b9 ^ worth`, where `worth = (completed steps + active
      // count) * 2654435761` (Knuth multiplicative scramble), picks uniformly
      // from the eligible list in villager order. No stored RNG state, so
      // reloads resume identically and existing sim sequences are untouched.
      const worth = (completedSteps + activeCount) * 2654435761;
      const rnd = mulberry32(state.seed ^ 0x9e3779b9 ^ worth);
      const index = eligible[Math.floor(rnd() * eligible.length)]!;
      const villager = state.villagers[index];
      if (villager) {
        const progress = favors.byVillager[index]!;
        progress.active = true;
        progress.progress = 0;
        favors.nextOfferMs = NEXT_OFFER_GAP_MS;
        state.events.push({ type: 'favor-start', villagerId: villager.id });
      }
    }
  }

  // 3. Completion pass: this tick's events (any villager) + warm-fire time.
  for (let i = 0; i < favors.byVillager.length; i += 1) {
    if (!activeBefore[i]) continue;
    const progress = favors.byVillager[i]!;
    const want = favorWantFor(i, progress.step);
    if (!want) {
      // Defensive: an active favor with no chain content (a legacy active
      // step-3 record seen before a heal pass) retires instead of wedging the
      // sim; the next due offer pass heals its step to 0.
      progress.active = false;
      continue;
    }
    let target: number;
    if (want.kind === 'fire') {
      if (state.fire.fuel >= FIRE_WARM_FUEL) progress.progress += dt;
      target = want.ms;
    } else {
      const requesterId = state.villagers[i]?.id;
      let gained = 0;
      for (const event of state.events) {
        if (event.type !== EVENT_TYPE_FOR[want.kind]) continue;
        // eat/self: only the requester's own meal counts. eat/any and the
        // resource wants count any villager's event.
        if (want.kind === 'eat' && want.who === 'self' && event.villagerId !== requesterId) continue;
        gained += 1;
      }
      progress.progress += gained;
      target = want.count;
    }
    const villager = state.villagers[i];
    if (progress.progress >= target) {
      progress.active = false;
      // Completing step 3 loops the chain back to step 0: villagers never
      // permanently retire and the same gap re-paces each loop (DESIGN.md §3.2).
      progress.step = progress.step + 1 < CHAIN_LENGTH ? progress.step + 1 : 0;
      progress.progress = 0;
      // Breathing room after every completion (spec §1.4).
      favors.nextOfferMs = Math.max(favors.nextOfferMs, NEXT_OFFER_GAP_MS);
      // Mirror favor-start's roster guard: no id means no renderable event.
      if (villager) state.events.push({ type: 'favor-done', villagerId: villager.id });
    }
  }
}
