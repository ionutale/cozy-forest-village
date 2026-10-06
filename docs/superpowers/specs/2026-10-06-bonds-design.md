# Bonds — Design (batch 9)

Status: **approved in chat 2026-10-06** (three design sections); awaiting written-spec review. No
implementation until the spec is reviewed and the implementation plan is approved (HARD GATE).
Authority: `DESIGN.md` §2 (feel), §3 (contracts), §3.2 (binding numbers), §6 (UI zones).
Execution: ships after batch 8 (day/night, merged); this spec pins schema **v6** on that assumption.
If execution order ever flips, bump by one from whatever version is current and extend the chain.

## Goal

Friendships grow between villagers from **pure proximity** — whoever spends quiet time together
(the evening fire does this for free) slowly warms. Four levels (none → warming → close → best),
never decaying. Close friends work a touch faster near each other, reunions and level-ups puff
hearts, and the villager cards and popover quietly show who matters to whom. No new UI zones, no
failure states, fully deterministic and saved.

## Non-goals

- No bonds between villagers and the player (the player is outside the pair model).
- No decay of any kind (a bond, once formed, is permanent).
- No special-case bond sources (meals, favors, work): proximity is the only mechanic.
- No per-pair dialogue, no matchmaking UI, no bond editing.
- No audio; no new UI zones; no new dependencies.

## Player experience

1. Every evening, the gathering drift seats villagers around the fire; neighbors quietly warm night
   after night. After a few evenings, pairs around the ring are **close** and the village starts
   showing it.
2. A close pair working side by side gets there a little faster (glass-half-full, never punishing).
3. When two friends meet again after a while apart, a soft heart puff; when a bond levels up, a
   puff at both villagers.
4. The card of anyone with a close friend carries a small heart mark; selecting them shows a
   **Bonds line** — *"Close with Moss · Warming to Clover"*.

## Part 1 — Sim model

### 1.1 State (DESIGN §3)

```ts
export interface BondsState {
  scores: number[]; // row-major 12×12 pair table (144 slots; only i<j written)
  gapMs: number[];  // same layout: ms since the pair was last within BOND_RADIUS; never saved
}
export interface GameState { /* … */ bonds: BondsState; }
```

Pair lookup uses `(min,max)` sorted indices; both directions read the same cell. `MAX_VILLAGERS`
is 12 (`VILLAGE_CAP`), so the table is 144 numbers — trivial.

### 1.2 Constants & derivations (binding)

| Constant / function | Value / rule | Meaning |
|---|---|---|
| `BOND_RADIUS` | `3.0` | pairs within this distance accrue score (and the perk's nearness radius) |
| `BOND_RATE_PER_S` | `1` | score per second of closeness (flat inside the radius) |
| level thresholds | `120` / `300` / `720` | warming / close / best |
| `BOND_REUNION_GAP_MS` | `90_000` | apart longer than this, then near → one `bond-reunion` |
| `BOND_SCORE_MAX` | `100_000` | validation bound for stored scores |
| `FRIEND_PERK_LEVEL` | `2` | close or better enables the work perk |
| `FRIEND_PERK_SCALE` | `0.9` | work period multiplier near a close friend |

Public surface additions: `BOND_RADIUS`, `BOND_RATE_PER_S`, `BOND_REUNION_GAP_MS`,
`BOND_SCORE_MAX`, `FRIEND_PERK_LEVEL`, `FRIEND_PERK_SCALE`, the `BondLevel` type, plus
`bondLevelFor(state, a, b): 0 | 1 | 2 | 3`,
`strongestBondLevel(state, villagerId): 0 | 1 | 2 | 3`, and
`bondPartners(state, villagerId): { id: string; name: string; level: 1 | 2 | 3 }[]`
(strongest first; ties by score desc, then roster index asc).

### 1.3 Growth, levels, reunions (`src/sim/bonds.ts`, driven from `tick`)

- **Growth:** in the `dtMs > 0` region, for every pair `i < j` within `BOND_RADIUS`:
  `score += (dtMs / 1000) × BOND_RATE_PER_S`, and `gapMs = 0`; otherwise `gapMs += dtMs`.
  Deterministic sorted iteration; no RNG; no wall-clock. Scores never decay. Giant `dt` accrues
  proportionally (the same convention as `fedMs` decay) and is documented.
- **Levels:** a crossing (score reaching 120/300/720) pushes
  `{ type: 'bond-up', villagerId, otherId, bondLevel }` once; no re-fire while the level holds.
- **Reunions:** when a pair first comes within radius with `gapMs > BOND_REUNION_GAP_MS`, push
  `{ type: 'bond-reunion', villagerId, otherId }` (the gap resets to 0, so a cooldown falls out
  naturally — no extra field).
- **Edges (decided):** newcomers arrive at zero with everyone and join in immediately; `'arriving'`
  villagers count as present (they are physically there); `gapMs` starts at 0 (recently close), so
  a fresh load never fires a phantom reunion.

### 1.4 The perk (work synergy)

In the work-yield path: a `'working'` villager with at least one `FRIEND_PERK_LEVEL`-or-better
partner within `BOND_RADIUS` uses `period × FRIEND_PERK_SCALE` (stacking exactly like the well-fed
modifier: well-fed 1190 → 1071; base likewise). Symmetric and passive — both friends benefit. No
other timer is touched; the multiplier can never reach zero.

## Part 2 — UI (still exactly three zones)

- **Card mark:** a tiny heart glyph on the card row when `strongestBondLevel ≥ 2`. No numbers.
- **Bonds line:** a new `<p class="bonds-line">` in the existing villager popover face, above the
  task grid, from a pure `bondsLine(state, villagerId)` helper (new in `derive.ts`): top two
  partners, formatted `Warming to {name}` / `Close with {name}` / `Best with {name}`, joined by
  ` · `; hidden when the strongest bond is 0. §6 gets a one-line batch-9 allowance for exactly
  this (no new zones).

## Part 3 — Render

- **Hearts:** the existing event→hearts path (the favor-delight pulse) also spawns on
  `bond-up` — one puff at **both** villagers — and on `bond-reunion` — a subtler single puff each.
  Strictly transition-driven; never per-tick. No new objects, no audio.

## Part 4 — Persist (schema v6, after day/night's v5)

- `VERSION = 6`. Migration **v5 → v6**: `bonds = { scores: new Array(144).fill(0), gapMs: new
  Array(144).fill(0) }`. Loader chain becomes **v1 → v2 → v3 → v4 → v5 → v6** with the
  post-migration `isPlausibleState` re-validation on every branch (the batch-6 rule).
- Validation adds: `bonds.scores` is an array of length 144, every entry finite and
  `0 ≤ x ≤ BOND_SCORE_MAX`. `gapMs` is **not saved** — the save writes `scores` only; load resets
  `gapMs` to zeros (no phantom reunions).
- Round-trip: a save mid-bonds restores every score exactly.

## Part 5 — Tests

- **Sim**: growth accrues exactly (`rate × dt`) inside `BOND_RADIUS` and not outside (boundary at
  3.0); thresholds map exactly at 119/120, 299/300, 719/720; no decay (scores hold as pairs
  separate); `bond-up` fires once per crossing; reunion fires exactly once after
  `BOND_REUNION_GAP_MS` apart and the natural cooldown holds; the perk applies `×0.9` only for a
  working villager within radius of a level-≥2 partner — unchanged when far, when the partner is
  warming-only, when idle, and stacking exactly with well-fed; two identical runs deep-equal;
  newcomers start at zero; favor counting ignores the new events.
- **Persist**: v5 → v6 zeros; round-trip mid-bonds exact; validation rejects wrong length, NaN,
  negative, over-cap; v1 → v6 chain intact end-to-end.
- **UI**: `bondsLine` ordering (top two, strongest first), wording, hidden below level 1; the card
  heart condition (≥2).

**Review Focus pins** (each lands in a task's tests): (1) no heart spam — hearts fire only on real
transitions, never per tick while near (sim event emission); (2) the perk is exact and leak-free —
every other timer byte-identical (sim); (3) level math survives giant ticks and extreme scores
(sim + persist cap); (4) the v1 → v6 chain stays intact and scores round-trip exactly (persist);
(5) bonds form the way the fiction says — fast-forwarded evenings produce close bonds specifically
with the ring-neighbors (sim).

## Part 6 — Execution plan (after spec approval + plan)

One parallel, file-disjoint wave on free models if the quota has reset by dispatch (probe first;
otherwise the orchestrator returns to the user with the cheapest authorized fallback), dispatched
after batch 8 (merged — schema v6 builds on v5):

| Task | Files | Scope |
|---|---|---|
| K1 sim | `src/sim/bonds.ts` (new), `src/sim/{types,index,tasks}.ts`, `src/sim/bonds.test.ts` (new) | table, growth, levels, reunions, perk, events, helpers, constants, tests; additive fixture repairs in `src/ui/*.test.ts` if the new required field breaks them |
| K2 persist | `src/persist/**` | v6 + chain + validation + tests |
| K3 UI | `src/ui/{derive,cards,markup,index}.ts`, `src/styles/ui.css`, `src/ui/derive.test.ts` | card heart mark, Bonds line, `bondsLine`, tests |
| K4 render | `src/render/villagers/index.ts` | hearts on `bond-up` / `bond-reunion` |

Then: freeze → live pass (fast-forwarded evenings → ring-neighbor bonds; card/popover screenshots;
a staged reunion puff; the perk on a `progressMs` timeline; reload mid-bonds) → commits →
independent review → fix round.

## Part 7 — DESIGN.md amendments (applied by the orchestrator with this spec)

1. §3: `BondsState` + `GameState.bonds`; event members `bond-up` / `bond-reunion` (with
   `otherId` / `bondLevel` fields); public surface additions — `BOND_RADIUS`, `BOND_RATE_PER_S`,
   `BOND_REUNION_GAP_MS`, `FRIEND_PERK_LEVEL`, `FRIEND_PERK_SCALE`, `bondLevelFor`,
   `strongestBondLevel`, `bondPartners`, `BondLevel`.
2. §3.2: "Bonds" bullet — proximity growth, thresholds, never-decay, reunions, the perk.
3. §3 persist: schema v6 + migration chain (v5 → v6 zeros; `gapMs` never saved).
4. §6: batch-9 allowance — the card heart mark and the Bonds line inside the existing villager
   face; no new zones.
