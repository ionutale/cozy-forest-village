# Villager Favor Chains — Design (batch 4)

Status: **approved in chat 2026-10-05**; awaiting written-spec review. No implementation until the
spec is reviewed and the implementation plan is approved (HARD GATE).
Authority: `DESIGN.md` §2 (feel), §3 (contracts), §3.2 (binding numbers), §6 (UI zones).

## Goal

Villagers occasionally ask each other (and thereby the player) for small, cozy favors. Each
villager has a short escalating **chain** of favors; completing a favor is a bond moment — hearts,
a thank-you line, a soft chime — and quietly advances that villager's chain. Nothing expires,
nothing punishes, nothing inflates the economy.

## Non-goals

- No tutorial/guide arc; favorites are ambient content, not onboarding.
- No village milestones, no unlockables, no material rewards.
- No expiry timers, no failure states, no notifications when the player is away (no push).
- No new UI zones (DESIGN §6 stays three), no new dependencies, no save churn beyond v2 migration.

## Player experience

1. ~2 minutes into play, a villager asks for something by playing normally ("Fern would love a warm
   meal."). At most two villagers have open favors at once; each holds exactly one.
2. The favor is visible on the requester's card (a small heart), in the popover
   (`Favor: a warm meal`), and in the panel hint line while it matters.
3. Completing the ask — Fern eats, berries are gathered, a structure goes up, the fire stays
   warm — bursts hearts, replaces the hint with "Fern is delighted!" for a few seconds, plays a
   warm chime, and advances Fern's chain (3 steps, then she retires from asking).

## Part 1 — Sim model (source of truth)

### 1.1 State (added to `GameState`, DESIGN §3)

```ts
export type FavorWant =
  | { kind: 'eat'; who: 'self' | 'any'; count: number } // eat events
  | { kind: 'gather'; count: number }                    // gather events (berries)
  | { kind: 'chop'; count: number }                      // chop events (wood)
  | { kind: 'build'; count: number }                     // built events
  | { kind: 'fire'; ms: number };                        // accumulated ms with fuel ≥ steady

export interface FavorProgress {
  step: number;      // 0..CHAIN_LENGTH (3 = chain complete, retired)
  active: boolean;   // this villager currently has an open favor
  progress: number;  // counts consumed / ms accumulated for the current step
}

export interface FavorsState {
  byVillager: FavorProgress[]; // same length and order as `villagers`
  nextOfferMs: number;         // countdown until the next offer attempt
}
```

`createInitialState` fills `byVillager` all `{ step: 0, active: false, progress: 0 }` and
`nextOfferMs = FIRST_OFFER_MS`.

### 1.2 Constants (binding for v1; tunable only with a DESIGN update)

| Constant | Value | Meaning |
|---|---|---|
| `FIRST_OFFER_MS` | 120 000 | ~2 min of play before the first favor |
| `NEXT_OFFER_GAP_MS` | 90 000 | minimum wait between offers (re-armed on every offer, re-enforced after every completion) |
| `MAX_ACTIVE_FAVORS` | 2 | never more than two villagers asking at once |
| `CHAIN_LENGTH` | 3 | steps per villager, then retired |
| `FIRE_WARM_FUEL` | 33 | "warm enough" threshold (matches `FIRE_STEADY`) |
| `THANK_YOU_MS` | 6 000 | UI-side "delighted!" window after `favor-done` (not sim state) |

### 1.3 Offering

On each tick, `nextOfferMs -= dtMs` (floored at 0). When it reaches 0 **and**
`activeCount < MAX_ACTIVE_FAVORS`: pick one eligible villager (`!active && step < CHAIN_LENGTH`),
open their next step's favor (`active = true`, `progress = 0`, emit `{ type: 'favor-start',
villagerId }`), and reset `nextOfferMs = NEXT_OFFER_GAP_MS`. If it reaches 0 while two favors are
active, no offer happens — the countdown holds at 0 and retries each tick.

**Requester selection is pure and deterministic**: a fresh `mulberry32(state.seed ^ 0x9e3779b9 ^
(Σ completed steps + activeCount) * 2654435761)`-style derive (implementer may store a tiny
`offerCount` in `FavorsState` if it reads better) picks uniformly from the eligible list in
villager order. No stored RNG stream, no effect on existing sim sequences.

### 1.4 Completion

A `tickFavors(state, dtMs)` step at the **end** of `tick()`, after all existing systems have pushed
this tick's events:

- `eat`: on each `eat` event — `who === 'self'` requires `villagerId === requester`; `'any'`
  counts any villager. `progress += 1`.
- `gather` / `chop` / `build`: count matching events (any villager). `progress += 1`.
- `fire`: `progress += dtMs` while `state.fire.fuel >= FIRE_WARM_FUEL`.

When `progress >= count` (or `>= ms`): `active = false`, `step += 1`, `progress = 0`, emit
`{ type: 'favor-done', villagerId }`, and enforce breathing room after every completion:
`nextOfferMs = max(nextOfferMs, NEXT_OFFER_GAP_MS)`. **Favors never expire** — an unserved favor
waits forever (including across reloads; it is part of the save).

### 1.5 Events (DESIGN §3 union additions)

`'favor-start' | 'favor-done'`, both carrying `villagerId`. Consumers: UI hint/popover/mark,
render hearts, audio. No other sim behavior reacts to favors.

## Part 2 — Chain content v1 (data, `src/sim/favors.ts`)

One shared template applied to every villager; the requester varies; step variants depend on the
villager's index (position in `state.villagers`, **0-based**) — stable across saves because roster
order is stable.

| Step | Variant | Want | Flavor (UI text) |
|---|---|---|---|
| 1 | all | `{ eat, self, 1 }` | "a warm meal" |
| 2 | even index | `{ gather, 6 }` | "berries for the village" |
| 2 | odd index | `{ chop, 4 }` | "firewood for the village" |
| 3 | index % 3 === 0 | `{ eat, any, 3 }` | "a feast for the village" |
| 3 | index % 3 === 1 | `{ build, 1 }` | "something new built" |
| 3 | index % 3 === 2 | `{ fire, 120000 }` | "the fire kept warm for two minutes" |

Counting semantics: events count for the favor that is active at the time of the event; a single
event never completes two favors of the same villager (only one active per villager), but may be
counted by both active villagers' favors when they share a want kind.

## Part 3 — UI (still exactly three zones)

### 3.1 Hint line (`villageLine` priority — replaces the current order)

`embers > favor > dimming > cooking > well-fed > meals > roaring > default`

- While any favor is active, first by villager id: `"{Name} would love {want}."` with progress for
  countable wants: `"…(3/6)"`; fire favors show `"(1:12/2:00)"` (m:ss).
- For `THANK_YOU_MS` after a `favor-done` event, the line reads `"{Name} is delighted!"` at the
  same priority position (UI-side timer; no sim state).
- The existing 10 s recompute + change-guard discipline is unchanged.

### 3.2 Card mark

A small heart glyph on the requester's card (inline SVG, `--accent`), toggled on transitions only
(the existing per-card guard pattern). Absent when no favor is active.

### 3.3 Popover

When selecting a villager with an active favor, a `Favor: {want}` line (same progress formatting)
sits above the task grid; hidden otherwise. No layout jump — the popover reserves the line.

Three-zone assertion: no new panels, chips, or banners; all three surfaces already exist.

## Part 4 — Feedback & audio

- **Hearts**: the render layer's pooled heart sprites trigger on `favor-done` exactly as they do on
  `eat` (same pool, same burst rules; no new geometry).
- **Audio**: two procedural cues — `favor-start` (soft two-note "hm?" under the chirp register)
  and `favor-done` (a warm chime, distinct from `rest-done` by pitch; quieter than `built`).
  Priority table slots: `built > favor-done > meal-cooked > rest-done > favor-start > eat >
  fuel-add > garden > gather > chop`; existing per-type 400 ms cooldown applies.

## Part 5 — Persistence (schema v2, additive migration)

- `VERSION` becomes **2**. `SaveFile` for v2 = v1 + `favors`.
- **Migration v1 → v2**: a structurally valid v1 save loads with `favors` defaulted
  (`byVillager`: all-fresh, `nextOfferMs = FIRST_OFFER_MS`). The village survives untouched; chains
  start fresh. (This is the first real migration — the pattern to keep.)
- `isPlausibleState` gains favor-shape checks: `byVillager` array with `villagers.length` entries,
  finite numbers everywhere; wrong shape → null → fresh (existing behavior).
- Round-trip: active favor + progress + `nextOfferMs` survive save → reload exactly.

## Part 6 — Tests

- **Sim** (`src/sim/favors.test.ts` + existing suites stay green):
  first offer at 120 s; 90 s gap after a completion; max-2 invariant incl. hold-at-zero retry;
  deterministic selection (same seed → same requester sequence; different seeds differ);
  each want kind completes (eat/self, eat/any, gather 6, chop 4, build 1, fire 120 s incl. the
  below-threshold pause); a `favor-done` event fires exactly once; no double-completion.
- **Persist**: v1 file → migrated state keeps village + fresh favors; v2 round-trip with active
  favor; corrupted/missing favors → null.
- **UI**: extend the existing `villageLine` tests with the favor priority + progress formatting +
  the thank-you window.

## Part 7 — Execution plan (after spec approval + plan)

One parallel, file-disjoint wave:

| Task | Files | Scope |
|---|---|---|
| F1 sim | `src/sim/**` | model, chains data, offering, completion, events, tests |
| F2 persist | `src/persist/**` | v2 + migration + tests |
| F3 UI | `src/ui/**` | hint priority, card mark, popover line, tests |
| F4 audio + hearts | `src/audio/**`, `src/render/villagers/**` | two cues, priority slots, heart trigger |

Then: orchestrator live pass (play a full chain: cook → Fern eats; watch mark/hint/popover/hearts;
reload mid-favor) + one independent read-only review (mimo) + fix round. Free models only, per
standing protocol.

## Part 8 — DESIGN.md amendments (applied by the orchestrator with this spec)

1. §3 `GameState`: add `favors: FavorsState` (+ the two shapes above).
2. §3 `SimEvent`: add `'favor-start' | 'favor-done'`.
3. §3.2: new “Favor chains” subsection carrying Part 1's numbers verbatim.
4. §3 UI notes + §6: hint priority order, card mark, popover line — three zones unchanged.
5. §3 persist: schema v2 = v1 + favors, additive migration rule.
