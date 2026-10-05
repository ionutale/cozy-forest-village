# Villager Favor Chains — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Project deviation (user instruction, takes precedence):** implementers **never run git and never
> commit** — each task ends by reporting to the orchestrator, who validates and commits. Tasks are
> dispatched as a **parallel wave** (F1–F4 are file-disjoint).

**Goal:** Villagers offer short escalating chains of cozy favors that complete through normal play, surface on the existing three UI zones, and persist across reloads.

**Architecture:** Favor state lives in `GameState` (sim-owned). Chain content is data in a new `src/sim/favors.ts`; offering is a deterministic pure derive from `state.seed`; completion consumes the sim events the tick already emits. Persistence migrates v1 → v2 additively. UI/audio/render consume two new events only.

**Tech Stack:** TypeScript (strict), three.js 0.186, vitest, Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-villager-favors-design.md`

## Global Constraints

- Touch only each task's listed files; no new deps; no `any`; no `Math.random` / clocks inside
  `src/sim/**` (DESIGN §3.1).
- Baseline: 91 tests green. Every task keeps them green and adds its own.
- Constants (verbatim from spec): `FIRST_OFFER_MS = 120000` · `NEXT_OFFER_GAP_MS = 90000` ·
  `MAX_ACTIVE_FAVORS = 2` · `CHAIN_LENGTH = 3` · `FIRE_WARM_FUEL = 33` (reuse `FIRE_STEADY` where
  importable) · thank-you window `6000` ms (UI-side only).
- The orchestrator amends `DESIGN.md` (§3 state + events, §3.2 favor rules, §3 persist v2 note,
  §3 public-surface additions: `createFavors` + the four favor constants) **before** dispatch;
  implementers do not touch DESIGN.md.
- Each task writes its report to `docs/tasks/F<n>-favor-<scope>-report.md`.

## Review Focus

Five inputs/failure modes the spec implies; each task adds the pinning test.

1. **Reload mid-favor** must restore the same active favor, progress and `nextOfferMs` (F2 test).
2. **Shared want kinds**: one event may count for both active villagers' favors but must never
   double-count a single favor (F1 test).
3. **v1 save load** must start chains fresh with no instant offer (`nextOfferMs = FIRST_OFFER_MS`)
   and leave the village untouched (F2 test).
4. **Fire favor pause**: time with `fuel < 33` must not accumulate, and the accumulation must not
   survive across a pause to double-fire (F1 test).
5. **Hint stability**: with two favors active/completing close together the line must switch at the
   recompute cadence without priority thrash between "would love" and "delighted" states (F3 test).

---

### Task F1: Sim — favors model, chains, offering, completion

**Files:**
- Modify: `src/sim/types.ts` (types + `GameState.favors` + event union)
- Create: `src/sim/favors.ts`
- Modify: `src/sim/index.ts` (init + tick hook)
- Test: `src/sim/favors.test.ts` (create)

**Interfaces:**
- Consumes: `GameState`, `SimEvent`, `mulberry32` (`./rng`), `FIRE_STEADY` (sim constants).
- Produces (later tasks import these):
  - `types.ts`: `FavorWant`, `FavorProgress { step: number; active: boolean; progress: number }`,
    `FavorsState { byVillager: FavorProgress[]; nextOfferMs: number }`, `GameState.favors:
    FavorsState`, `SimEvent.type` ∈ `… | 'favor-start' | 'favor-done'` (both with `villagerId`).
  - `favors.ts`: `FIRST_OFFER_MS`, `NEXT_OFFER_GAP_MS`, `MAX_ACTIVE_FAVORS`, `CHAIN_LENGTH`,
    `createFavors(villagerCount: number): FavorsState`,
    `favorWantFor(villagerIndex: number, step: number): FavorWant | null`,
    `tickFavors(state: GameState, dtMs: number): void` (exported for direct unit use).
  - `sim/index.ts` re-exports `createFavors` and the four constants on the **public surface**
    (the DESIGN §3 read-only-imports list is amended to include them, exactly like
    `STRUCTURE_COST`). The flavor copy ("a warm meal" …) is **UI-owned** in F3, not sim.

- [ ] **Step 1: Write failing tests** in `src/sim/favors.test.ts` — at least: first offer exactly at
  120 000 ms of ticks (not before); requester deterministic for a fixed seed (run the offer twice
  from identical states → identical `villagerId`) and differs across seeds 1 vs 2; max 2 active and
  no third offer while 2 active; after a completion the next offer waits ≥ 90 000 ms; `eat`/`self`
  completes only on the requester's eat, `eat`/`any` on any; `gather` counts (6), `chop` (4),
  `build` (1); `fire` accumulates only while `fuel >= 33` and pauses below; each done emits exactly
  one `favor-done` with `villagerId`; step 3 completion retires the villager (no more offers for
  them); an event shared by two active favors advances both without double-counting either.
  Drive completion by calling `tickFavors` directly with crafted `state.events` (and `dtMs` for fire).
- [ ] **Step 2: Run tests — expect failures** (`pnpm test -- favors` → module not found).
- [ ] **Step 3: Implement.** `types.ts` gains the three interfaces + `favors: FavorsState` on
  `GameState` + the event union members. `favors.ts`: constants; `createFavors`; `favorWantFor`
  (step 1 `{kind:'eat', who:'self', count:1}`; step 2 even index `{kind:'gather', count:6}` / odd
  `{kind:'chop', count:4}`; step 3 `index % 3` → `{kind:'eat', who:'any', count:3}` /
  `{kind:'build', count:1}` / `{kind:'fire', ms:120000}`; null beyond step 3); `tickFavors`: countdown
  (floor 0), offer when 0 && active < 2 (pick requester deterministically — a fresh
  `mulberry32(state.seed ^ 0x9e3779b9 ^ worth)` over the eligible list in order; document the exact
  derive in a comment), reset `nextOfferMs = NEXT_OFFER_GAP_MS`, `favor-start`; completion pass over
  `state.events` + fire accumulation; on threshold → advance step, `progress = 0`,
  `nextOfferMs = Math.max(nextOfferMs, NEXT_OFFER_GAP_MS)`, `favor-done`. `index.ts`:
  `createInitialState` sets `favors: createFavors(villagers.length)`; `tick()` calls
  `tickFavors(state, dtMs)` **as its last statement**.
- [ ] **Step 4: Run the full suite** — 91 + new tests green (`pnpm test`).
- [ ] **Step 5: Verify `pnpm exec tsc --noEmit` and `pnpm build`** — clean.
- [ ] **Step 6: Report** → `docs/tasks/F1-favor-sim-report.md` (orchestrator commits).

### Task F2: Persist — schema v2 with additive migration

**Files:**
- Modify: `src/persist/index.ts`
- Test: `src/persist/index.test.ts` (extend)

**Interfaces:**
- Consumes: `FavorsState`, `createFavors` from Task F1.
- Produces: `VERSION = 2`; `loadGame` accepting v1 (migrated) and v2; v2 `isPlausibleState` checks.

- [ ] **Step 1: Write failing tests** — (a) a handcrafted **v1** save blob loads: village values
  intact, `favors.byVillager` all `{0,false,0}`, `nextOfferMs === FIRST_OFFER_MS`; (b) v2 round-trip
  with an active favor mid-progress + custom `nextOfferMs` returns identical values (Review Focus 1);
  (c) v2 with `byVillager` length ≠ villagers length → null; (d) v2 with a non-finite number in
  favors → null.
- [ ] **Step 2: Run — expect failures.**
- [ ] **Step 3: Implement.** `VERSION = 2`; `loadGame`: parse → `version === 2` → validate (v1 shape
  + favors shape) → return; `version === 1` → validate v1 shape → `state.favors =
  createFavors(state.villagers.length)` → return; anything else → null. WRITE always emits v2.
- [ ] **Step 4: Full suite + `tsc` + `build`** green.
- [ ] **Step 5: Report** → `docs/tasks/F2-favor-persist-report.md`.

### Task F3: UI — favor hint priority, card heart, popover line

**Files:**
- Modify: `src/ui/derive.ts` (`villageLine` + formatting helpers)
- Modify: `src/ui/markup.ts` (popover `.favor-line`, card heart span)
- Modify: `src/ui/cards.ts` (heart toggle, transition-only)
- Modify: `src/ui/index.ts` (pump: popover line, thank-you window on `favor-done`)
- Test: `src/ui/derive.test.ts` (extend; adapt existing `villageLine` callers)

**Interfaces:**
- Consumes: `GameState.favors`, `FavorWant` (F1) via the sim's **public surface** only (types +
  sanctioned read-only imports, DESIGN §3).
- Produces: `villageLine(state: GameState, thanks: string | null): string`; exported
  `favorLine(state: GameState): string | null`, `favorProgressText(want, progress): string`, and
  `favorText(want: FavorWant): string` — the flavor copy is **UI-owned** (like `STRUCTURE_NAMES`),
  mapped from the want kind/count, unit-tested here.

- [ ] **Step 1: Write failing tests** — priority `embers > favor > dimming > cooking > well-fed >
  meals > roaring > default`; active favor line `"{Name} would love {want}."` with progress for
  countable wants `"(3/6)"` and fire `"(1:12/2:00)"`; `thanks !== null` renders
  `"{thanks} is delighted!"` in the same slot; two active favors → first by villager id; no favors →
  unchanged behavior (Review Focus 5: thanks overrides the favor line, never both).
- [ ] **Step 2: Run — expect failures** (signature change breaks existing tests; fix call sites).
- [ ] **Step 3: Implement.** `derive.ts`: helper `favorProgressText`; `villageLine(state, thanks)`
  with the priority insert. `markup.ts`: `.favor-line` in the popover above `.task-grid`; heart span
  in the card template (inline SVG, `--accent`). `cards.ts`: per-card guard toggling the heart when
  `favors.byVillager[idx].active` flips. `index.ts` pump: maintain `thanksName` for 6 000 ms after a
  `favor-done` event is seen; fill/clear the popover favor line for the selected villager; call
  `villageLine(state, thanksName)`.
- [ ] **Step 4: Full suite + `tsc` + `build`** green (derives tests now ≥ old 30 + new).
- [ ] **Step 5: Report** → `docs/tasks/F3-favor-ui-report.md`.

### Task F4: Audio + hearts — two cues and the favor-done trigger

**Files:**
- Modify: `src/audio/index.ts`
- Modify: `src/render/villagers/index.ts` (event trigger list)

**Interfaces:**
- Consumes: `favor-start` / `favor-done` events (F1).
- Produces: nothing downstream; behavior only.

- [ ] **Step 1: Implement audio.** `SfxKind` += `'favor-start' | 'favor-done'`; `lastSfx` entries
  `-10`; switch: `favor-start` → soft two-note "hm?" (sine, low gain, under the chirp register);
  `favor-done` → warm two-note chime, distinct pitch from `rest-done`, quieter than `built`.
  Priority table becomes `built 10 > favor-done 9 > meal-cooked 8 > rest-done 7 > favor-start 6 >
  eat 5 > fuel-add 4 > garden 3 > gather 2 > chop 1` (relative order preserved). Existing lazy
  start / cooldown / dispose untouched.
- [ ] **Step 2: Implement hearts.** In the villagers layer's per-update event scan, trigger the
  existing pooled hearts on `favor-done` with the same rules as `eat` (no new geometry, no new
  allocation).
- [ ] **Step 3: Verify** `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm test` — 91 + F1–F3 tests
  green (F4 adds no unit tests; browser-verified by the orchestrator).
- [ ] **Step 4: Report** → `docs/tasks/F4-favor-feedback-report.md`.

---

## Post-wave (orchestrator)

1. Freeze → integrated gate (`tsc` / `build` / full suite) → live pass: cook → a villager's meal
   favor completes (hint, heart, popover, hearts, chime); reload mid-favor; v1-save boot check.
2. Independent read-only review (mimo) over the wave diff → fix round if needed.
3. `REPORT.md` ledger + user handoff with the task → model → evaluation table.
