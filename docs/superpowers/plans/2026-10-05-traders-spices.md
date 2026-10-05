# Traders → Spices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Project deviation (user instruction, takes precedence):** implementers **never run git and never
> commit** — each task reports to the orchestrator, who validates and commits. Parallel wave on
> **free models** (fallbacks on rate limits).
> **Ordering:** dispatch **after the huts wave merges** (huts owns schema v3; this feature is v4).
> T1's type additions land concurrently — T2/T3/T4 retry gates until the sim types exist.

**Goal:** A trader visits periodically; the player trades wood↔berries and buys spices; spices turn meals hearty (fed 90 s instead of 60 s).

**Architecture:** Sim-owned `visitor` state machine + two `trade` actions + eat-time spice consumption; persistence chains to v4; the popover gains a third face; render derives the trader's position from `(phase, visitMs)` with no pathing.

**Tech Stack:** TypeScript (strict), three.js 0.186, vitest, Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-traders-spices-design.md`

## Global Constraints

- Touch only each task's listed files; no new deps; no `any`; no `Math.random` / clocks in `src/sim/**`.
- Baseline at dispatch time: the huts wave's merged suite (180 + H1–H4 additions). Keep it green.
- Constants (verbatim): `FIRST_VISIT_MS = 240000` · `VISIT_STAY_MS = 120000` ·
  `NEXT_VISIT_GAP_MS = 360000` · `TRADER_WALK_MS = 6000` · `TRADES_PER_VISIT = 3` ·
  `5 wood → 4 berries` · `6 berries → 1 spice` · `HEARTY_FED_MS = 90000` · schema **v4**.
- The orchestrator amends `DESIGN.md` (§3 shapes/surface, §3.2 visitor + hearty bullets, §3 persist
  v4, §6 batch-7 allowance) **before** dispatch; implementers do not touch DESIGN.md.
- Each task reports to `docs/tasks/T<n>-<scope>-report.md`.

## Review Focus

1. Reload mid-visit resumes exactly (`visitMs`, `tradesLeft`) and the render puts the trader at the
   same spot (T2 test + orchestrator live).
2. No trade while away, never negative resources, never more than `TRADES_PER_VISIT` (T1 test).
3. Big-`dt` ticks cannot double-consume spices or trades (T1 test).
4. Hint priority with embers + thanks/favor + trader all live simultaneously (T3 test).
5. The v1 → v2 → v3 → v4 chain stays intact end-to-end (T2 test).

---

### Task T1: Sim — visitor state, trades, hearty eat

**Files:**
- Modify: `src/sim/types.ts` (Visitor, `resources.spices`, event union/payloads)
- Modify: `src/sim/tasks.ts` (visitor constants, trade rates — where other constants live)
- Modify: `src/sim/index.ts` (schedule, `trade` action, eat path)
- Test: `src/sim/visitor.test.ts` (create)

**Interfaces (Produces — later tasks consume):**
- `types.ts`: `Visitor { phase: 'away' | 'visiting'; inMs: number; visitMs: number; tradesLeft: number }`;
  `resources: { wood; berries; spices }`; `SimEvent.type` += `'visitor-arrive' | 'visitor-leave' | 'trade'`;
  `SimEvent.tradeKind?: 'berries' | 'spice'`; `SimEvent.hearty?: boolean`.
- `tasks.ts`: `FIRST_VISIT_MS`, `VISIT_STAY_MS`, `NEXT_VISIT_GAP_MS`, `TRADER_WALK_MS`,
  `TRADES_PER_VISIT`, `HEARTY_FED_MS`.
- `sim/index.ts`: `trade(state, kind: 'berries' | 'spice'): boolean` + re-exports of all six
  constants on the public surface.

- [ ] **Step 1: Write failing tests** (`visitor.test.ts`): first arrival at exactly 240 000 ms;
  stay 120 000 ms then `visitor-leave` and a fresh 360 000 ms away timer; `tradesLeft` resets to 3
  per visit; each trade applies exact deltas + emits `trade` with its kind; refusals: away phase,
  out of stock, unaffordable (Review Focus 2); a single big-`dt` tick crossing visit boundaries
  consumes at most one trade/spice per call site (Review Focus 3); hearty eat: spice consumed,
  `fedMs = 90 000`, `eat.hearty === true`; no-spice eat unchanged; favor counting unaffected.
- [ ] **Step 2: Run — expect failures.**
- [ ] **Step 3: Implement** per spec §1.3–§1.5: schedule steps in `tick` (before the villager loop,
  near the arrivals processing), `trade` with the guards, the eat-path spice branch. Hearty sets
  `fedMs` only — rest duration and the full-belly guard untouched.
- [ ] **Step 4: Full suite + `tsc` + `build`** green (out-of-scope concurrent failures: note, re-run).
- [ ] **Step 5: Report** → `docs/tasks/T1-traders-sim-report.md`.

### Task T2: Persist — schema v4

**Files:**
- Modify: `src/persist/index.ts`
- Test: `src/persist/index.test.ts` (extend)

**Interfaces:**
- Consumes: `Visitor`, `FIRST_VISIT_MS` from T1's public surface.
- Produces: `VERSION = 4`; loader chain v1 → v2 → v3 → v4.

- [ ] **Step 1: Write failing tests**: v3 → v4 defaults (`spices: 0`; away visitor with
  `inMs = FIRST_VISIT_MS`, `visitMs 0`, `tradesLeft 0`); v1 → v4 chain keeps the village
  (Review Focus 5); v4 round-trip mid-visit (`visiting`, `tradesLeft 1`, `visitMs 45 000`) exact
  (Review Focus 1); invalid visitor shapes (`phase` not enum, negative times, `tradesLeft` out of
  range) → null; existing tests stay.
- [ ] **Step 2: Run — expect failures.**
- [ ] **Step 3: Implement.** Extend the chain: v3 → validate → migrate to v4; v2/v1 chain through.
  v4 validation = v3 checks + spices finite ≥ 0 + visitor shape. WRITE always v4.
- [ ] **Step 4: Full suite + `tsc` + `build`** green.
- [ ] **Step 5: Report** → `docs/tasks/T2-traders-persist-report.md`.

### Task T3: UI — spices pill, trader popover mode, hint slot, pot suffix

**Files:**
- Modify: `src/ui/markup.ts` (spices pill, trader popover section), `src/ui/index.ts` (pump +
  wiring + `selectTrader`), the module owning `villageLine`/pot status (`src/ui/derive.ts`),
  `src/styles/ui.css`
- Test: `src/ui/derive.test.ts` (extend)

**Interfaces:**
- Consumes: `resources.spices`, `Visitor` (T1); `UIHandle.selectTrader()`,
  `UIActions.trade(kind)` (DESIGN §3 additions).
- Produces: pure `tradeDisabled(state, kind): boolean`; hint slot at
  `embers > (thanks | favor) > trader > dimming`.

- [ ] **Step 1: Write failing tests**: hint reads "A trader is visiting!" while visiting and yields
  to embers/thanks/favor, returning after (Review Focus 4); `tradeDisabled` truth table (away,
  stock 0, each unaffordable, affordable) ; pot suffix present only when built and `spices > 0`;
  existing derive tests stay.
- [ ] **Step 2: Run — expect failures.**
- [ ] **Step 3: Implement.** Spices pill in the HUD row (same pill markup; `data-res="spices"`).
  Trader popover: a third section shown by `selectTrader()`, auto-closing on deselect/ground/visit
  end; two buttons wired to `actions.trade` with live disabled states from `tradeDisabled`. Hint
  slot + pot suffix in the pure module.
- [ ] **Step 4: Full suite + `tsc` + `build`** green.
- [ ] **Step 5: Report** → `docs/tasks/T3-traders-ui-report.md`.

### Task T4: Render + audio — the trader

**Files:**
- Create: `src/render/trader.ts`
- Modify: `src/render/index.ts` (wire + `pickTrader`/`setTraderSelected`), `src/main.ts` (click
  chain + UI wiring), `src/audio/index.ts` (two cues + priority renumber)
- Report: `docs/tasks/T4-traders-render-report.md`

**Interfaces:**
- Consumes: `Visitor`, `TRADER_WALK_MS` (T1); the villagers rig kit + `villagers/ring.ts` exports.
- Produces: `RenderHandle.pickTrader(clientX, clientY): boolean`,
  `RenderHandle.setTraderSelected(on: boolean)` (DESIGN §3).

- [ ] **Step 1: Implement `trader.ts`**: a rig from the shared kit with distinct colours + a small
  handcart; position purely from `(phase, visitMs)` — walk in from `EDGE_SPAWN` over
  `TRADER_WALK_MS`, slow deterministic linger sway, walk back out; hidden while away; zero per-frame
  allocations; selection ring reuse.
- [ ] **Step 2: Wire picking + chain**: `pickTrader` + `setTraderSelected` in `render/index.ts`;
  click order villager → trader → structure → ground in `main.ts`; selecting the trader calls
  `ui.selectTrader()`; deselect/ground clears.
- [ ] **Step 3: Audio**: `visitor-arrive` bell, `trade` clink; renumber priorities with relative
  order preserved (`built 12 > favor-done 11 > meal-cooked 10 > rest-done 9 > visitor-arrive 8 >
  favor-start 7 > trade 6 > eat 5 > fuel-add 4 > garden 3 > gather 2 > chop 1`).
- [ ] **Step 4: Full suite + `tsc` + `build`** green (no unit tests; orchestrator live-checks).
- [ ] **Step 5: Report** → `docs/tasks/T4-traders-render-report.md`.

---

## Post-wave (orchestrator)

1. Freeze → integrated gate → live pass: fast-forward the visit, watch the walk-in, trade both
   kinds, buy spices, eat hearty (fed ~90 s), hint line, reload mid-visit (same spot), v3-save boot
   check.
2. Independent read-only review (mimo) → fix round if needed.
3. `REPORT.md` ledger + user handoff (task → model → evaluation table).
