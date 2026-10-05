# H — Independent read-only review: batch 6, huts → newcomers

Reviewer: independent read-only pass (batches 2 and 4 reviewed previously).
Scope: spec `docs/superpowers/specs/2026-10-05-huts-newcomers-design.md`, plan
`docs/superpowers/plans/2026-10-05-huts-newcomers.md`, `DESIGN.md` §3 / §3.2 / §6, and the wave
diff `4c3ec17` (H1) · `4a66786` (H2) · `cf2b323` (H3) · `d2f0d12` (H4) — plus the docs-only
follow-up `8be8c6f`, which touches no source.

## Verification (read-only)

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm test` | **209 / 209 passing, 11 files** (`src/persist/index.test.ts`, `src/sim/{behavior,favors,fire,food,huts,obstacles,rng,sim}.test.ts`, `src/ui/{derive,structure-card}.test.ts`) |

Working tree clean at review time; no file other than this report was created or modified.

**Findings: 1 Critical · 1 Important · 3 Minor (5 total, cap 10).**

---

## Findings

### C1 — Critical — the task grid is never re-enabled after a walk-in finishes

**`src/ui/index.ts:104`** (with the early return at `src/ui/index.ts:106`)

```ts
for (const btn of taskGrid.querySelectorAll<HTMLButtonElement>('.task-btn')) {
  btn.classList.toggle('active', btn.dataset.task === task);
  if (arriving) setDisabled(btn, true);   // ← written on the arriving branch only
}
if (arriving) return;
setDisabled(stopBtn, task === null);      // stop + cook recover by accident…
setDisabled(cookBtn, !…pot…built);        // …chop / berries / rest / tend never do
```

**What's wrong.** `.task-btn` covers all five work tasks *plus* Stop and Cook
(`src/ui/markup.ts:60-66`). While the selected villager is `'arriving'`, every one of them is set
`aria-disabled="true"`. Nothing ever writes `"false"` back: `setDisabled` has exactly three call
sites (`:104`, `:108`, `:110`) and only Stop and Cook are re-evaluated on a non-arriving frame.
`chop` / `berries` / `rest` / `tend` therefore keep the value written during the walk-in — for the
whole session.

The consequence is a hard functional break, not a cosmetic one:

- `src/styles/ui.css:270` — `opacity: 0.45; pointer-events: none`, so the buttons are visibly dead.
- `src/ui/index.ts:182` — `if (!task || target.getAttribute('aria-disabled') === 'true') return;`
  so the click never reaches the sim.
- `src/sim/index.ts:255` — `case 'idle': break;` and `assignTask` has exactly one caller
  (`src/main.ts:36`). **There is no auto-assignment.** A villager nobody can assign does nothing,
  forever.

So the sequence "click the new villager's card during the ~walk-in (the state the spec
explicitly tells the player to expect — spec Part 3: *"the popover's task buttons are disabled for
that villager"*), wait for them to settle at the hut" leaves that newcomer permanently un-assignable
for Chop · Gather · Rest · Tend. The wave's headline promise — *"newcomers inherit every existing
rule (tasks, …)"* — fails for the villager the feature is about. Only Cook survives (and only if
the pot is built), because it has its own `setDisabled` on the next line.

Reachability is high: nothing about the walk-in is hidden (the card reads "Arriving…" and the grid
is dimmed), so selecting the new villager while they walk is the natural thing to do. The live pass
(`REPORT.md:178`) verified "disabled tasks" *while arriving* but never the recovery after
"settles at hut-1", which is why this shipped.

**Minimal fix.** One line — let the loop own the whole transition, then let Stop/Cook refine it:

```ts
setDisabled(btn, arriving);   // instead of: if (arriving) setDisabled(btn, true);
```

When `arriving` is false every button is cleared, and the existing `setDisabled(stopBtn, …)` /
`setDisabled(cookBtn, …)` on `:108`/`:110` immediately re-apply their own gates, so the final
state is unchanged for Stop and Cook. Add a regression assertion (arriving → idle →
`aria-disabled === 'false'` on `.task-btn[data-task="chop"]`).

---

### I1 — Important — post-migration v3 validation is skipped; the justification is *almost* sound

**`src/persist/index.ts:167`** and **`src/persist/index.ts:177`** (vs. `src/persist/index.ts:120-128`)

**What's wrong.** Spec Part 2 states the chain to the letter: *"Migration: **v1 → v2 (existing) →
v3**, chained in the loader; **then v3 validation**."* The loader instead validates each blob
against *its own* schema and returns the migrated result directly:

```ts
if (parsed.version === 2) { if (!isPlausibleV2State(…)) return null; return migrateV2toV3(…); }
if (parsed.version === 1) { … return migrateV2toV3({ …parsed.state, favors: createFavors(…) }); }
```

**Is the justification sound?** Mostly yes — with one hole.

- *Sound for everything the migration constructs.* `migrateV2toV3` (`:136`) builds `arrivals: []`
  and appends the four `hut-*` plots from `HUT_PLOTS` itself, so `isPlausibleArrivals` (`:100`) and
  the hut presence can never fail afterwards; `createFavors(villagers.length)` guarantees
  `favors.byVillager.length === villagers.length` (`:91`). Re-validating those rules would be
  dead code. The batch-4 chain followed the same pattern and it held.
- *Sound on preservation grounds for real saves.* Every genuine v1/v2 village has exactly 8
  villagers (nothing before batch 6 ever added or removed one), so `isPlausibleState` applied
  post-migration would pass unconditionally — it would never cost a legitimate player their
  village. In other words, the skip buys **nothing** for real saves and the "historical fixture"
  rationale recorded at `REPORT.md:166` only protects synthetic blobs.
- *Not sound for the one v3 rule that is missing.* `isPlausibleState` (`:120-128`) adds two things
  over `isPlausibleV2State`: the arrivals shape (self-constructed ✓) and **`villagers.length ∈
  [8, 12]`** — which constrains a *pre-existing* field the migration never touches and therefore
  never enforces on the v1/v2 path. That bound is load-bearing: `castIndex = villagers.length − 8 +
  arrivals.length` (`src/sim/index.ts:172`) is only correct while the roster is 8 at first build.
  A migrated roster ≠ 8 drives `castIndex` outside `[0, 3]`, `NEWCOMER_CAST[castIndex]` comes back
  `undefined`, and the arrival is silently dropped at fire time (`src/sim/index.ts:216-220`) —
  after the player has paid **30 wood + 10 berries**, with no event, no card and no message. The
  sim's own comment calls that path "unreachable by construction"; on a migrated save it is
  reachable.

**Minimal fix.** One line in each of the two branches:

```ts
const v3 = migrateV2toV3(parsed.state); return isPlausibleState(v3) ? v3 : null;
```

plus widening the `v1Blob()` fixture (`src/persist/index.test.ts:47-78`, currently a synthetic
1-villager village) to the realistic 8, which the chained-migration test at `:220` will then pin.
That keeps the preserve-old-villages intent and closes the only rule the skip actually drops.
(Alternative that changes no test: a single `roster ∈ [8, 12]` guard inside `migrateV2toV3`.)

---

### M1 — Minor — world generation does not reserve the hut plots

**`src/sim/world.ts:55`** (with `src/sim/world.ts:14`)

`generateWorld` seeds its crowding list with the campfire only: `const taken: Placed[] = [{ x: 0, z: 0 }]`.
Node placement knows nothing about `HUT_PLOTS`. Trees are rejected into the annulus
`INNER_R = 7.5 … 28`, while the hut ring sits at **r = 7.6** with a 1.16 u pad (half-width 0.58)
and its arrival slot at r = 0.9 from the hut centre — i.e. the huts are *inside* the scatter field,
not outside it. `src/sim/world.ts:3` even gives the wrong rationale ("the inner radius moved out …
so the village ring (structures at r = 5.2) stays clear") — `INNER_R` predates batch 6
(`b738c62`), and nothing was added when batch 6 moved structures out to 7.6.

Nothing prevents a trunk landing inside a cabin footprint, and trunk avoidance is switched off
within `OBSTACLE_ENDGAME_RADIUS = 1.0` of the arrival point (`src/sim/tasks.ts:29`) — precisely the
zone a trunk on the plot would occupy. Not currently observable: `createInitialState(seed = 1)`
(`src/sim/index.ts:60`) is the only world the game ever makes, and I measured it read-only — the
nearest trunk to any hut centre is **3.18 u** (hut-2; hut-1 5.119, hut-3 4.433, hut-4 8.337), so the
shipped layout is clear and `huts.test.ts:127` passes for a real reason. It is luck, not a rule:
the moment the seed varies (or a regression moves `HUT_PLOTS`), a cabin can generate around a tree
and the walk-in can clip one on the final 1.0 u.

**Minimal fix.** Seed the taken list with the plots instead of only the fire:

```ts
const taken: Placed[] = [{ x: 0, z: 0 }, ...HUT_PLOTS.map((p) => ({ ...p.pos }))];
```

which reuses the existing 2.5 u min-gap rule and clears pad + slot + endgame in one line.

---

### M2 — Minor — card reconcile is keyed on an id-set size, so a duplicate id appends forever

**`src/ui/index.ts:288`** → **`src/ui/cards.ts:74`**

```ts
if (cards.size !== state.villagers.length) appendCards(list, cards, state);
…
const missing = villagersNeedingCards(cards.size, state.villagers.length);
```

The list grows *by index* (`list.children[i]` ↔ `state.villagers[i]`), but the trigger and the
range are both read from `cards.size` — the size of a **Set keyed by villager id**. `registerCard`
(`src/ui/cards.ts:49`) does `cards.set(v.id, …)`, so if a save ever carries two villagers sharing
an id, `cards.size` never reaches `villagers.length`: the guard fires every frame,
`insertAdjacentHTML` appends one more `.villager-card` per frame, `cards.set` still does not grow,
and the DOM grows without bound at frame rate while `syncCards` walks the same duplicate entries.

This wave is what made it self-perpetuating — before `appendCards`, `buildCards` ran exactly once
(`src/ui/index.ts:227-230`). And the precondition is unvalidated: `isPlausibleV1State`
(`src/persist/index.ts:40`) never checks that `v.id` is present, is a string, or is unique.

**Minimal fix.** Key the trigger and the range on the rendered DOM instead of the id set:

```ts
if (list.children.length !== state.villagers.length) appendCards(list, cards, state);
const missing = villagersNeedingCards(list.children.length, state.villagers.length);
```

`buildCards` writes one child per villager, so `children.length` is the honest rendered count and a
duplicate id can no longer wedge the reconcile.

---

### M3 — Minor — Review Focus 3's H3 half has no test

**plan `docs/superpowers/plans/2026-10-05-huts-newcomers.md:38-39`** (vs.
**`src/ui/derive.test.ts:558`, `:589`**)

The pin reads: *"index 8+ flows through variants/voice/hearts without special cases (**H1 + H3
tests**)"*. The H1 half is genuinely pinned — `src/sim/huts.test.ts:68-89` asserts the newcomer's
favor record appends in the same tick and `src/sim/huts.test.ts:164` asserts
`favors.byVillager` length 10 after the second walk-in. The H3 half is not: everything H3 added to
`derive.test.ts` is `cardLabel('Arriving…')` (`:558`, `:562`) and `villagersNeedingCards` (`:589`).
The phrasing fixtures still hard-code the eight founders (`const ROSTER = ['Maple', …, 'Clover']`,
`src/ui/derive.test.ts:326`), and `favorWantFor` is only ever called with indices 0, 1, 2 and 5
(`src/ui/derive.test.ts:444-452`). Nothing asserts that index 8–11 resolves a want line, a delight
suffix or a heart through the normal path.

The code is in fact index-agnostic (voice is name-hashed, `src/ui/derive.ts:153`; the heart reads
`byVillager[i]`, `src/ui/cards.ts:136`) — but that is exactly what the pin asked to have *pinned*,
and it is currently an inspection result, not a test result.

**Minimal fix.** One `derive.test.ts` case: a 12-villager fixture with `Lily` at index 8, assert
`favorPopoverLine(state, 8)` is a non-empty `Favor: …` line with no `undefined`/`NaN`, that
`delightText('Lily')` is a string, and `favorWantFor(8, 1)` equals `{ kind: 'gather', count: 6 }`.

---

## Review-Focus pins — coverage check

| # | Pin | Test | Verdict |
|---|---|---|---|
| 1 | Reload during walk-in (position/target + countdown restore) | `src/persist/index.test.ts:311` (`:332` asserts pos, target, `inMs`) | ✅ |
| 2 | Two huts in the same tick → distinct `castIndex`es in completion order | `src/sim/huts.test.ts:56` | ✅ |
| 3 | Array lockstep; index 8+ through variants/voice/hearts | lockstep: `src/sim/huts.test.ts:68`, `:164`, `:176`; index 8+ voice/variants/hearts: **none** | ⚠️ half-covered → **M3** |
| 4 | v1 → v2 → v3 chain keeps the village and adds four unbuilt huts | `src/persist/index.test.ts:220` | ✅ |
| 5 | Long walk-in: trunk avoidance + fire arc; assignment refusal cannot wedge | `src/sim/huts.test.ts:127` (trunk ≥ 0.57, fire > 1.0, slot ≤ 0.02), refusal `:115` | ✅ |

4 of 5 fully pinned; pin 3's H3 half is a gap.

## Verified clean (no finding)

- **`castIndex` formula and two-huts-same-tick ordering.** The object literal is evaluated before
  `arrivals.push`, so the length read is pre-push, and the algebra collapses to
  `castIndex = <huts completed before this one>` — uniqueness and completion order follow
  structurally, not just for the tested case. Counting the splice loop (`src/sim/index.ts:212-216`)
  element-by-element: after `splice(a, 1); a -= 1` the loop's `a += 1` lands on the *shifted* next
  element, so every entry is decremented exactly once per tick — no double decrement, no skip; the
  `!cast || length >= VILLAGE_CAP` guard splices before it drops, so no orphan entry survives.
- **Arrival firing.** Countdown floored at 0 (`:215`); append at `EDGE_SPAWN (0, −12)`
  (`:227`) with `id 'v${length+1}'`, cast row and `state 'arriving'`; `favors.byVillager.push` in
  the same iteration, so the arrays cannot desync — and the cap-drop path (`huts.test.ts:176`)
  proves they stay aligned when the villager is *not* appended. The loop sits after the events seed
  and before the villager loop, and `tickFavors` runs last, so a newcomer is offer-eligible on the
  tick they exist (spec Part 1.4).
- **`'arriving'` walk reuse.** `src/sim/index.ts:246` falls `'arriving'` into `walk`, which
  resolves `targetNodeId` against structures (`:261`), takes the structure branch →
  `structureSpot` (r = 0.9) with `arrivedTol = STRUCTURE_ARRIVAL_DISTANCE = 0.02` (`:439`),
  applies `avoidTrunks` (`:452`, no destination-node exemption because a hut is not a node), and
  keeps the fire-arc bend off because both endpoints stay ≥ ~3.5 u from the origin. Inside the 1.0 u
  endgame the detour is disabled and steering goes direct, so the slot is reached and the villager
  flips to `idle` (`:471-475`) — no wedge; a missing target degrades to `idle` instead
  (`:394-399`). `assignTask` refuses before any mutation (`src/sim/index.ts:111`).
- **No 8-length assumption anywhere** (spec Part 4): grep for `villagers[7]`, `length === 8`,
  `slice(0, 8)` returns nothing; `VillagerState` is only referenced from `types.ts`, so no
  exhaustive switch was left un-updated; `motion.ts:57` gives `'arriving'` the walking stride.
- **Validation depths (v3).** Arrivals: array-of-records, string `structureId`, finite `inMs ≥ 0`,
  integer `castIndex ∈ [0, 3]` with boundary cases 0 and 3 asserted; roster `[8, 12]` with both
  rejection sides and the 12-villager acceptance all pinned (`persist/index.test.ts:333-424`).
  Batch-4's `step`/`progress` depth is still present (`:288`).
- **UI reconcile / scroll / label.** Append-only tail, `cardHtml` seeds the real label so a
  newcomer paints "Arriving…" instead of flashing "Idle"; `STRUCTURE_NAMES.hut` is compile-forced
  by `Record<StructureKind, …>`; `#villager-list { max-height: 360px; overflow-y: auto }` lives
  inside zone 2 and the report records 8 cards fitting with the 9th engaging the scroll, so the
  layout does not jump at 8.
- **`selectionCue` footprint key**: `FOOTPRINT: Record<StructureKind, number>` gains
  `hut: 0.66` (`selectionCue.ts:34`) — total Record, so the key omission this report's predecessors
  would have caught is impossible; 0.66 clears the 0.58 half-width pad.
- **Arriving gait**: `'arriving'` shares the `case 'walking'` branch in `motion.ts:57-59`.
- **DESIGN amendments (spec Part 7) — all four applied**, closing the gap batch 4 left open:
  §3 `StructureKind`/`STRUCTURE_COST.hut`/`GameState.arrivals`/`VillagerState`/`Arrival`
  (`DESIGN.md:76`, `:91`); §3.2 "Huts" bullet with the ring, cost, 90 000 ms, the exact castIndex
  formula, `EDGE_SPAWN`, cast order and cap (`DESIGN.md:249-253`); §3 persist `VERSION = 3` +
  chain (`DESIGN.md:266-268`); §6 batch-6 allowance line (`DESIGN.md:331`).
- **Three zones / anti-bloat**: no fourth zone, no new panel, no new dependency (no manifest change
  in any of the four commits), no `any`, sim's public re-export surface still limited to the
  DESIGN-sanctioned names (`src/sim/index.ts:53`).
- **No new audio for arrivals** (spec non-goal) — the arrival fires no `SimEvent`; `built` flows
  through the existing event path.
