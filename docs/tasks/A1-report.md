# A1 Report — UI polish: fuel pulse, well-fed tint, pot recipe, garden countdown

Status: **DONE_WITH_CONCERNS**. All four items implemented; `tsc`/`build`/`test` green. No live
browser check — the orchestrator owns the browser for this wave, so verification here is static
plus a numeric simulation of the countdown. One concern needs a ruling (a re-introduced constant
duplication). Changes left uncommitted.

## Files

| File | Lines | Change |
|---|---|---|
| `src/ui/index.ts` | 519 (+57) | fuel pulse on `fuel-add`, well-fed class, pot recipe line, garden countdown + signature extension |
| `src/styles/ui.css` | 286 (+4) | `.task-label.well-fed` tint |

`git diff --name-only -- src` lists several other files (`audio/index.ts`, `main.ts`,
`render/environment.ts`, `render/index.ts`, `render/structures.ts`, `render/villagers.ts`) — those
are **concurrent batch-3 agents'** in-flight work (A2/A3/A4/A6 reports are in `docs/tasks/`). My diff
is exactly the two files above; I touched nothing else and ran no dev server or browser tooling.

## The four items

### 1. Fuel-pill pulse on a log deposit

`fuel-add` joins the existing yield-pulse mechanism — same `.yield-pulse` class, same
`pill-pulse` keyframes, same `lastPulseAt` throttle map keyed `'fuel'`:

```ts
if (state.events.some((ev) => ev.type === 'fuel-add')) {
  const now = performance.now();
  if (now - (lastPulseAt.get('fuel') ?? -Infinity) >= PULSE_THROTTLE_MS) {
    lastPulseAt.set('fuel', now);
    fuelPill.classList.remove('yield-pulse');
    void fuelPill.offsetWidth; // force reflow so the same class re-triggers
    fuelPill.classList.add('yield-pulse');
  }
}
```

Only three DOM writes per pulse, and only on a real event — the fire's 0.22/s decay never triggers
it. A log is +25 fuel, so this fires on progress rather than on noise. Kept deliberately separate
from the wood/berries loop rather than folded into it: those read `state.resources[res]` and fuel
reads `state.fire.fuel`, so generalising would have needed a per-resource accessor closure for one
extra row — more indirection than the duplication saves.

### 2. Well-fed badge

`CardParts` gained `fed: boolean` — the last rendered state. `fedMs` decays every frame, so
comparing against it is what keeps the class transition-only:

```ts
const fed = villager.fedMs > 0;
if (parts.fed !== fed) {
  parts.fed = fed;
  parts.label.classList.toggle('well-fed', fed);
}
```

No new DOM: the tint rides the existing `.task-label`, which already has a colour transition
(`.lift` covers `background-color`/`border-color`; the label colour itself swaps instantly, which
is fine for a state that lasts up to 60 s). CSS is one rule using the existing `--leaf` token.

### 3. Pot recipe line

`Meals: ${n} · ${COOK_BERRIES} berries + ${COOK_WOOD} wood each` — exactly the required string for
`n = 3`: `Meals: 3 · 3 berries + 1 wood each`.

### 4. Garden countdown

```ts
function secondsToBerry(gardenMs: number): number {
  const remaining = Math.max(0, GARDEN_PERIOD_MS - gardenMs);
  return Math.max(0, Math.ceil(remaining / 1000));
}
```

I read the sim first, as instructed. `src/sim/index.ts:143-151` accumulates `state.gardenMs += dtMs`
**only while the garden is built** and then wraps it:

```ts
while (state.gardenMs >= GARDEN_PERIOD_MS) {
  state.gardenMs -= GARDEN_PERIOD_MS;
  state.resources.berries += 1;
}
```

So `gardenMs` is a **modulo accumulator in `[0, 30000)`**, not a lifetime total — the remaining time
is `GARDEN_PERIOD_MS − gardenMs`, and the countdown restarts after each harvest. Verified by
replaying the sim's own loop against my helper (see below).

**Rounded up, not down.** `Math.floor` would show `Growing… 0s` for the last half-second while a
berry is still on its way; `ceil` keeps the number honest (at `gardenMs = 29900` it reads `1s`
where floor reads `0s`).

**M1 respected:** the signature carries the *rendered* seconds, not raw `gardenMs`:

```ts
const growIn = structure.kind === 'garden' && structure.built ? secondsToBerry(state.gardenMs) : -1;
const signature = `${kind}|${built}|${wood}|${berries}|${meals}|${growIn}`;
```

Raw `gardenMs` in the signature would rewrite the card every frame and undo the whole point of the
M1 guard. The rendered integer changes once a second, which is exactly when the text changes, so
the card still repaints on time and stays quiet in between. `-1` marks "not a growing garden" so a
built non-garden card keeps its old signature shape.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 — `dist/assets/index-DEJGhHr8.css 6.25 kB`, `index-Dk24jq2J.js 627.27 kB │ gzip: 160.94 kB` |
| `pnpm test` | exit 0 — 6 files, **62/62** |

**Transient concurrent failure, not mine:** the first `tsc` run failed with three `TS6133`
unused-constant errors in `src/render/structures.ts` (`STEAM_BASE`, `STEAM_GROWTH`, `SPROUT_SWAY`) —
a mid-edit state in another agent's file. I confirmed the error set contained nothing from
`src/ui/`, did not touch `structures.ts`, and re-ran once the concurrent agent landed their fix;
everything was green from that point. Flagging so the transient is not mistaken for a regression
if it reappears in a shared-tree run.

**Countdown arithmetic**, checked by replaying the sim's exact accumulator loop against my helper
at `dt = 16.7 ms` over 62 s:

| t (ms) | `gardenMs` | shown | berries |
|---|---|---|---|
| 17 | 17 | `30` | 0 |
| 1002 | 1002 | `29` | 0 |
| 2004 | 2004 | `28` | 0 |
| 5010 | 5010 | `25` | 0 |
| 62007 | 2007 | `28` | 2 |

30 → 29 → 28 once per second, then wraps back up after the second harvest at 60 s. `berries` reached
2 at 62 s, matching §3.2.

**Not verified live** (browser is the orchestrator's): the fuel pill actually pulsing on a deposit,
the green tint appearing and clearing on a real `eat`/`fedMs` decay, and the two status strings in a
live popover. All three are pure text/class/DOM-property changes on paths already exercised every
frame, but they are worth a click-through.

### Suggested orchestrator browser checks

1. Assign **Tend fire** with `fuel ≤ 75` → the Fire pill pulses once per deposit, not on decay.
2. Build the pot + garden, open each: pot reads `Meals: 0 · 3 berries + 1 wood each`; garden reads
   `Growing… 30s` and ticks down once per second, then jumps back to 30 after a harvest.
3. Get a villager to **Eat** → their card's task label turns `--leaf` green and returns to normal
   when the 60 s `fedMs` runs out.

## Deviations

1. ~~**`GARDEN_PERIOD_MS` and `COOK_BERRIES`/`COOK_WOOD` are mirrored in the UI**~~ **Superseded by
   the micro-round below** — the orchestrator ruled for exporting them from the sim, and the UI now
   imports them, so the duplication no longer exists.
2. **The selected card's accent wins over the well-fed tint.** `.villager-card.selected .task-label`
   is 3 classes of specificity, `.task-label.well-fed` is 2, so a selected well-fed villager shows
   accent rather than leaf. I chose not to weaken the existing selection affordance (T05/B7 depend
   on it) and left both rules untouched; the comment in `ui.css` records the intent. One line to
   flip if the orchestrator wants the buff to always read.
3. **The fuel pulse is a separate block rather than a row in the wood/berries loop** — see item 1
   for why.
4. **No new transition for the tint.** The label colour swaps instantly. `fedMs` lasts up to 60 s
   and the flip happens twice in that window, so an eased transition would be a nicety, not a
   fix; the `.pill-pulse`-style keyframe machinery already exists if it is wanted later.

## Known gaps / concerns for the orchestrator

1. ~~**The §3 contract blocked the clean fix for the countdown and recipe.**~~ **Resolved in the
   micro-round below** — the orchestrator ruled for the export and the UI now imports the sim's own
   values. Kept in place so the original finding is not lost from the record.
2. **`src/ui/index.ts` is now 519 lines** (470 before this task, 268 before batch 2). It holds four
   distinct concerns: HUD counters, villager list, popover/task grid, structure card. No budget was
   set for batch 3, but it is well past the point where a split (e.g. `ui/hud.ts` +
   `ui/popover.ts`) would be an improvement rather than a refactor.
3. **No automated test covers any of the four items**, and this batch's allow-list is two source
   files. `secondsToBerry` is the obvious candidate — it is a pure function of `gardenMs` and the one
   piece with real arithmetic in it. I verified it by replaying the sim loop (table above) instead,
   which is decent evidence but not a regression guard. If a future task widens the allow-list, a
   five-line table test on `secondsToBerry` would lock the rounding choice down.
4. **The M1 signature now has six fields and no mechanical protection** against a future card field
   being added without updating it — the symptom would be a card that silently stops updating. This
   was already flagged in B9-fix2 and is now slightly worse, since the countdown depends on it
   staying correct.
5. Concurrent-tree note: `src/render/villagers.ts` has been **deleted and replaced by a
   `src/render/villagers/` directory** by another agent mid-session. Nothing in my change touches
   the render layer, so there is no interaction, but the A1 report's file list is only valid for
   `src/ui/**` and `src/styles/**`.
---

## Micro-round — concern 1 ruled: export the constants instead of mirroring them

Status: **DONE**. The duplication is gone; the sim is the single source of truth. Changes
uncommitted.

### Files

| File | Lines | Change |
|---|---|---|
| `src/sim/index.ts` | (+7) | re-exports `COOK_BERRIES`, `COOK_WOOD`, `GARDEN_PERIOD_MS` from `tasks.ts` |
| `src/ui/index.ts` | 515 (−4) | imports the three from `../sim`; local mirrored block and its apology comment deleted |

`src/sim/tasks.ts` was **not modified** — `git diff --stat -- src/sim/tasks.ts` is empty. The values
already existed there (`COOK_BERRIES = 3` line 53, `COOK_WOOD = 1` line 54, `GARDEN_PERIOD_MS =
30000` line 64) and `sim/index.ts` already imported all three internally for `tick()` and
`buildStructure()`. This round is plumbing only: no value, no logic, no behaviour touched.

### The export

```ts
/**
 * Binding numbers from DESIGN.md §3.2 that other layers display rather than re-derive: the
 * garden's berry period, and what one cooked meal costs. Re-exported unchanged from `tasks.ts`
 * (a re-export binds no local name, so it coexists with the internal import above).
 */
export { COOK_BERRIES, COOK_WOOD, GARDEN_PERIOD_MS } from './tasks';
```

Placed directly under the existing `STRUCTURE_COST` export so the sanctioned read-only data sits
together. `export … from` introduces **no local binding**, so it coexists with the module's own
`import { … GARDEN_PERIOD_MS … } from './tasks'` — no aliasing needed, unlike `STRUCTURE_COST` which
is aliased only because its re-export carries a `Readonly<Record<…>>` type annotation.

### The UI side

```ts
import { COOK_BERRIES, COOK_WOOD, GARDEN_PERIOD_MS, STRUCTURE_COST } from '../sim';
```

The nine-line mirrored block and its comment are gone. `tsc` type-checks the UI against the sim's
own declarations, so a future change to a binding §3.2 number is now a compile-time concern rather
than a silent visual drift — which was the whole point of the M6 lesson this was repeating.

**Rendered strings are byte-identical**, because the resolved values are unchanged: the template
literals were not touched, only where the identifiers come from.

| | before (mirrored) | after (imported) |
|---|---|---|
| pot, `meals = 3` | `Meals: 3 · 3 berries + 1 wood each` | identical |
| garden, `gardenMs = 0` | `Growing… 30s` | identical |

### Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 — `dist/assets/index-DeK1hjgH.js 627.59 kB │ gzip: 161.07 kB` |
| `pnpm test` | exit 0 — 6 files, **62/62** |

The build is itself the check that the public surface is correct: Rollup fails hard on a missing
named export, so a successful bundle means the UI's three new imports resolved against
`src/sim/index.ts`.

The concurrent `src/render/structures.ts` editor was idle for this round — `tsc` was clean on the
first run, with no out-of-scope errors to ignore. Nothing else in the tree was touched
(`src/audio/index.ts`, `src/main.ts`, `src/render/**` remain other agents' work).

### Remaining concerns after this round

1. **DESIGN §3 still needs updating** — the orchestrator owns that, and this round makes the code
   depend on it. The rule currently reads "import **types** and the read-only `STRUCTURE_COST` data
   table from `../sim`, and **nothing else**", which does not yet sanction these three. Until it is
   amended, `src/ui/index.ts` technically imports something §3 does not permit, even though the
   intent is exactly what the rule is for.
2. **The M1 signature has six fields and no mechanical guard** against a future card field being
   added without updating it (unchanged from the main A1 round, and the garden countdown now depends
   on it).
3. **No automated test covers `secondsToBerry`**, which is now the one piece of real arithmetic in
   the UI. It was verified in the main round by replaying the sim's accumulator loop; the micro-round
   did not change its behaviour.
4. `src/ui/index.ts` is 515 lines (was 519 — the micro-round was net −4). No file-size budget exists
   for batch 3, but it remains a split candidate.
