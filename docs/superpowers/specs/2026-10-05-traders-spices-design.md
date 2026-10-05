# Traders → Spices — Design (batch 7)

Status: **approved in chat 2026-10-05**; awaiting written-spec review. No implementation until the
spec is reviewed and the implementation plan is approved (HARD GATE).
Authority: `DESIGN.md` §2 (feel), §3 (contracts), §3.2 (binding numbers), §6 (UI zones).
**Execution order:** this feature ships **after** the huts wave (which owns schema v3). This spec
pins schema **v4** on that assumption; if execution order ever flips, bump by one from whatever
version is current and extend the same chain.

## Goal

Every so often a trader wanders in from the forest path, lingers by the fire, and offers two calm
trades — wood ↔ berries, and a rare **spice** that turns ordinary meals into **hearty meals**
(longer well-fed). Then they leave. The village gets a gentle outside world and a small economy
that feeds the existing cook → eat → work loop.

## Non-goals

- No new UI zones; no marketplace, no haggling, no per-visitor dialogue.
- No pathfinding for the trader (a fixed path in/out; the sim never tracks their position).
- No spice decay, no spice recipes beyond hearty meals (future hook, not now).
- No multiple simultaneous visitors.

## Player experience

1. ~4 minutes into play, a bell: a trader with a little handcart walks in from the south path,
   lingers near the fire for ~2 minutes, then trundles away. They return every ~6 minutes.
2. Clicking the trader selects them (the familiar ring) and opens the popover with two trades:
   **5 wood → 4 berries** and **6 berries → 1 spice**, **3 trades per visit**.
3. Spices show as a fourth HUD pill. While the pantry has spices, meals eaten at the fire become
   **hearty** — the well-fed window stretches from 60 s to **90 s** — and the pot line says so.

## Part 1 — Sim model

### 1.1 State (DESIGN §3)

```ts
export interface Visitor {
  phase: 'away' | 'visiting';
  inMs: number;      // away: until arrival · visiting: until departure
  visitMs: number;   // elapsed in the current visit (0 while away)
  tradesLeft: number;
}
export interface GameState { /* … */ visitor: Visitor; }
// resources gains `spices: number` (starts 0)
```

`SimEvent.type` gains `'visitor-arrive' | 'visitor-leave' | 'trade'`; `trade` carries
`tradeKind?: 'berries' | 'spice'`; `eat` gains `hearty?: boolean` (additive).

### 1.2 Constants (binding)

| Constant | Value | Meaning |
|---|---|---|
| `FIRST_VISIT_MS` | `240_000` | first arrival ~4 min in |
| `VISIT_STAY_MS` | `120_000` | how long a visit lasts |
| `NEXT_VISIT_GAP_MS` | `360_000` | away time between visits |
| `TRADER_WALK_MS` | `6_000` | in/out walk window (shared with the render layer) |
| `TRADES_PER_VISIT` | `3` | stock per visit |
| wood→berries | **5 wood → 4 berries** | trade kind `'berries'` |
| berries→spice | **6 berries → 1 spice** | trade kind `'spice'` |
| `HEARTY_FED_MS` | `90_000` | fed window after a hearty meal (normal: 60 000) |

### 1.3 Visitor schedule (`tick`)

- `away`: `inMs -= dtMs` (floored); at 0 → `phase 'visiting'`, `inMs = VISIT_STAY_MS`,
  `visitMs = 0`, `tradesLeft = TRADES_PER_VISIT`, emit `visitor-arrive`.
- `visiting`: `visitMs += dtMs`, `inMs -= dtMs`; at 0 → `phase 'away'`,
  `inMs = NEXT_VISIT_GAP_MS`, `visitMs = 0`, emit `visitor-leave`.
- Deterministic, pure over state; no RNG.

### 1.4 Trades

`trade(state, kind: 'berries' | 'spice'): boolean` exported on the sim public surface (same
register as `buildStructure`): refuses (returns false) unless `phase === 'visiting'`,
`tradesLeft > 0`, and the cost is affordable; otherwise applies deltas exactly, `tradesLeft -= 1`,
emits `{ type: 'trade', tradeKind }`, returns true.

### 1.5 Hearty meals

In the eat path: if `resources.spices > 0`, the eater also consumes **1 spice**, sets
`fedMs = HEARTY_FED_MS` and emits `eat` with `hearty: true`; otherwise the existing
`fedMs = 60_000` behaviour is unchanged. All other eat-flow rules — rest duration, the full-belly
guard, consumers of `eat` — are unchanged. Cook/pot mechanics are untouched; favor counting counts
hearty eats like any other.

## Part 2 — Persist (schema v4, after huts' v3)

- `VERSION = 4`. Migration **v3 → v4**: `resources.spices = 0`; `visitor = { phase: 'away',
  inMs: FIRST_VISIT_MS, visitMs: 0, tradesLeft: 0 }`. The loader chain becomes
  **v1 → v2 → v3 → v4**; v4 validation adds: `spices` finite ≥ 0; visitor shape (enum phase, finite
  `inMs`/`visitMs` ≥ 0, integer `tradesLeft` in `[0, TRADES_PER_VISIT]`).
- Round-trip: a save mid-visit (`visiting`, `tradesLeft 1`, `visitMs 45 000`) restores exactly; a
  mid-visit reload resumes the visit at the same point (the render derives position from
  `(phase, visitMs)`, so the trader is where they were).

## Part 3 — UI (still exactly three zones)

- **HUD**: fourth pill — Spices (`data-res="spices"`), same pattern/colours register (§6 whitelist
  line added).
- **Trader = popover mode 3**: selecting the trader shows two trade buttons
  ("5 wood → 4 berries", "6 berries → 1 spice"), a "Trades left: N" line, and live disabled states
  (unaffordable / no stock). The mode closes on deselection, on ground click, and automatically when
  the visit ends. Same zone 3 — the popover simply has a third face.
- **Hint line** gains a trader slot (while `phase === 'visiting'`):
  **"A trader is visiting!"** — priority `embers > (thanks | favor) > trader > dimming > …`.
- **Pot line**: when built and `spices > 0`, append "· hearty while spices last".

## Part 4 — Render & audio

- **Trader body** (`src/render/trader.ts`, new): the shared villager rig kit with distinct colours
  plus a small handcart prop; position **derived purely from `(phase, visitMs)`** — walk in from the
  south edge over `TRADER_WALK_MS`, linger with a slow deterministic sway until the visit ends,
  walk back out. No pathfinding, no saved trader position, zero per-frame allocations.
- **Picking & selection**: the trader is picked like a villager (`pickTrader`); selection reuses the
  existing soft ring (`villagers/ring.ts` exports it). Click-chain order becomes
  villager → trader → structure → ground.
- **Audio**: `visitor-arrive` → a soft two-note cart bell; `trade` → a tiny clink. Priority table
  renumbered with relative order preserved:
  `built 12 > favor-done 11 > meal-cooked 10 > rest-done 9 > visitor-arrive 8 > favor-start 7 >
  trade 6 > eat 5 > fuel-add 4 > garden 3 > gather 2 > chop 1`.

## Part 5 — Tests

- **Sim**: first visit at exactly 240 000 ms of play; phases/events fire once each; `tradesLeft`
  resets to 3 per visit; both trades apply exact deltas, refuse when unaffordable / out of stock /
  away; `trade` event carries the kind; hearty eat consumes one spice, sets `HEARTY_FED_MS`, emits
  `hearty: true`; no-spice eats unchanged; big-`dt` ticks cannot double-consume (spice or trades);
  favors count hearty eats normally.
- **Persist**: v3 → v4 migration defaults (spices 0, away visitor with first-visit timer);
  v1 → v4 chain keeps the village; v4 round-trip mid-visit; invalid visitor shapes → null.
- **UI**: hint trader slot priority (incl. with thanks/favor active); pot suffix presence; trade
  button disabled-state derivation is pure and unit-tested (`tradeDisabled(state, kind)`).

**Review Focus pins** (each lands in a task's tests): (1) reload mid-visit resumes exactly
(persist); (2) no trade while away and never negative resources (sim); (3) big-dt does not
double-consume spices or trades (sim); (4) hint priority with trader + thanks + favor simultaneously
(UI); (5) the v1→v4 migration chain stays intact end-to-end (persist).

## Part 6 — Execution plan (after spec approval + plan)

One parallel, file-disjoint wave on **free models** (fallbacks on rate limits), dispatched **after
the huts wave merges** (schema ordering):

| Task | Files | Scope |
|---|---|---|
| T1 sim | `src/sim/**` | Visitor state/schedule, trades, hearty eat, events, constants, tests |
| T2 persist | `src/persist/**` | v4 + chained migrations + tests |
| T3 UI | `src/ui/**`, `src/styles/ui.css` | spices pill, trader popover mode, hint slot, pot suffix, tests |
| T4 render + audio | `src/render/trader.ts` (new), `src/render/index.ts`, `src/main.ts`, `src/audio/index.ts` | trader rig + cart, picking/sel ring, two cues, click-chain order |

Then: freeze → live pass (walk-in, trade both kinds, hearty eat, reload mid-visit) → commits →
independent review (mimo) → fix round.

## Part 7 — DESIGN.md amendments (applied by the orchestrator with this spec)

1. §3: `Visitor` shape; `resources.spices`; event members (`visitor-arrive`/`visitor-leave`/`trade`,
   `eat.hearty`); public surface additions — `trade(state, kind)`, `FIRST_VISIT_MS`, `VISIT_STAY_MS`,
   `NEXT_VISIT_GAP_MS`, `TRADER_WALK_MS`, `TRADES_PER_VISIT`, `HEARTY_FED_MS`,
   `RenderHandle.pickTrader(clientX, clientY): boolean`, `RenderHandle.setTraderSelected(on: boolean)`,
   `UIActions.trade(kind: 'berries' | 'spice'): void`, `UIHandle.selectTrader(): void`.
2. §3.2: “Trader visits” bullet (constants/trades) + hearty-eat sentence in the eat rules.
3. §3 persist: schema v4 + migration chain.
4. §6: batch-7 allowance (spices pill; trader popover mode).
