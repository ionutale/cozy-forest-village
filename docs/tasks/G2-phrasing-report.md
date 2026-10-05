# G2 — Per-villager favor phrasing — Report

Status: **DONE**. Each villager now has a stable personal voice in the hint, the popover and the
thank-you line. No new deps, no `any`, no `Math.random`, no browser, no files outside the
allow-list (`src/ui/derive.ts`, `src/ui/derive.test.ts`, this report).

## Files

| File | Change |
|---|---|
| `src/ui/derive.ts` | `voiceIndex` (FNV-1a, name-keyed); 6 want-variant tables (3 each, slot 0 = DESIGN §3.2); `DELIGHT_SUFFIXES` (3); `favorText(want, villagerName)` signature; new `delightText(name)`; `villageLine`'s thanks slot and both favor surfaces use the voice |
| `src/ui/derive.test.ts` | 8 new tests (voice suite) + `delightText` import; one baseline phrase assertion updated (see below); direct `favorText` calls now pass `'V1'` (slot 0) |
| `docs/tasks/G2-phrasing-report.md` | this report |

## Design

- **One voice slot per villager.** `voiceIndex(name, variants)` hashes the villager's *name* with
  FNV-1a (`0x811c9dc5` / `0x01000193`, `Math.imul`, `>>> 0`) and takes `% variants.length`.
  Deterministic across calls, frames and reloads; nothing rerolls per render.
- **Name, not id, is the key** because the UI's thank-you window (`villageLine(state, thanks)`)
  only ever carries the name (`src/ui/index.ts` resolves `favor-done` → `done.name`). Hashing the
  name keeps the want line and the delight line on the same slot for the same person without
  touching `index.ts` (outside this task's allow-list).
- **Formats unchanged.** Hint: `"{Name} would love {want} {progress}."`; popover:
  `"Favor: {want} {progress}"`; delight: `"{Name} {suffix}"`. Only the `{want}` / delight wording
  varies. All variants read naturally after "would love" and after "Favor: ", and stay ≤ 38 chars
  (limit ~45).
- **Variants** (3 per category, slot 0 = the batch-4 phrase so an unrecognised name degrades to
  the original copy):
  - eat/self: `a warm meal` · `a cozy meal by the fire` · `something warm to eat`
  - eat/any: `a feast for the village` · `a shared feast tonight` · `a village-wide feast`
  - gather: `berries for the village` · `a basket of berries` · `sweet berries to share`
  - chop: `firewood for the village` · `a stack of firewood` · `fresh logs for the fire`
  - build: `something new built` · `a cozy new building` · `something built with care`
  - fire: `the fire kept warm for two minutes` · `the fire tended for two minutes` ·
    `the hearth kept glowing for two minutes`
  - delight: `is delighted!` · `beams with joy!` · `looks so happy!`
- **Missing villager data** in `favorPopoverLine` (malformed save) falls back to the empty-name
  voice (`?? ''`) instead of rendering `undefined`; `favorLineFor` still returns `null` when the
  name is missing, exactly as before.

## Tests (8 new, `src/ui/derive.test.ts`)

1. every (8 roster names × 6 wants) maps to one stable string across 5 repeated calls;
2. ≥ 2 distinct variants across the 8 villagers for every want (FNV-1a spreads them {0,1,2});
3. every phrase is non-empty, ≤ 45 chars, free of `undefined`/`NaN`;
4. golden pins (Fern = `a warm meal`, Pip = `fresh logs for the fire`, Moss = `Moss looks so
   happy!`) so a hash change is a deliberate content change;
5. delight lines are stable per name, name-prefixed, bounded, spread;
6. `villageLine(state, name)` renders `delightText(name)`;
7. hint and popover agree on the phrase for the same villager (all 3 villagers × 3 steps), and a
   non-active slot stays hidden/null;
8. empty-roster malformed state still yields `Favor: … (0/1)`, never `undefined`.

Existing progress/priority/exclusivity tests are unchanged and still green. **One baseline
assertion updated**: the V3 fire test (index variant 2) now reads `the fire tended for two
minutes` — V3's hash lands on slot 1, and slot 0 remains the previous phrase for the villagers who
draw it; the test still checks `(1:12/2:00)` progress formatting.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 — `dist/` written (pre-existing chunk-size warning only) |
| `pnpm test` | exit 0 — **180/180**, 10 files; `derive.test.ts` alone **64/64** (56 + 8) |

## Concerns for the orchestrator

1. **Suite count includes another concurrent writer's tests.** Baseline was 149/9 files; my 8
   tests bring `derive.test.ts` to 64 and the tree to 157. The observed 180/10 includes ~23 tests
   from a concurrently added test file (batch-5 work). All green; my scope is exactly the 8 above.
2. **A hash change alters visible copy.** Slot mapping is content: reordering variant tables or
   switching the hash re-voices villagers. The golden test plus the V3/`Fern` baseline assertions
   make such a change fail loudly rather than slip through.
3. **Name-keyed voice means a rename (hand-edited save) changes a villager's phrasing.** That is
   presentation-only and consistent across all surfaces; no sim behavior reads it.
4. **No browser pass** (rule for this batch): pure helpers + pump wiring are covered by
   type-check and unit tests; the live cadence was not re-observed.
