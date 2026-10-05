# F — Independent review: batch-4 villager-favor wave

Read-only review of the committed favor wave against
`docs/superpowers/specs/2026-10-05-villager-favors-design.md` (the spec) and
`docs/superpowers/plans/2026-10-05-villager-favors.md` (the plan), with `DESIGN.md` §3 / §3.2 / §6
as the binding contract.

**Method.** Read the spec, plan, DESIGN favour sections, and the full diff of the five wave commits
(`936165a`, `15cf291`, `6b99d66`, `7ac8b68`, `14370d4`, `b9517da`). Working tree was clean at the
start of review. Verification run (read-only):

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 — no errors anywhere |
| `pnpm test` | **139/139 pass, 9 files** (51 → 139 across the batch) |

**Verdict: 0 Critical · 1 Important · 8 Minor.** The sim, persist, UI and feedback layers match the
spec's rules to the letter in every code path I could construct; the one Important is a *contract
document* gap, not a behaviour bug.

---

## Findings

### Important

**I1 — Spec Part 8's DESIGN.md amendments 4 and 5 were never applied (and `THANK_YOU_MS` is missing
from §3.2).**
`DESIGN.md:300` (also absent from `DESIGN.md` §3 / §3.2 entirely; spec
`2026-10-05-villager-favors-design.md:196`, `:197`, `:67`)

`DESIGN.md:300` still reads *"Batch 2 explicitly allows, inside the three zones: … Nothing else."*
— the §6 anti-bloat whitelist has no batch-4 entry for the requester heart (zone 2), the popover
`Favor:` line (zone 3) or the favor/delighted hint (zone 2). `DESIGN.md` also contains no hint
priority order (Part 8 §4) and **no `schema v2` / `VERSION` / migration text at all** (Part 8 §5:
grep for `version|migration|localStorage|schema` in `DESIGN.md` returns only line 183, unrelated).
Part 8 §3 asked for §3.2 "carrying Part 1's numbers verbatim" — `THANK_YOU_MS | 6 000`
(spec:67) is the one number from the Part 1.2 table that is not there.

What's wrong: `DESIGN.md` is the binding authority for three-zone compliance and anti-bloat, so
today it *contradicts* shipped code — a future reviewer reading §6 would flag the batch-4 UI as a
violation, and the v2 save schema has no contract home. (The code itself *is* compliant: heart and
hint are zone 2, `Favor:` line is zone 3, no fourth zone, no new deps — Part 8 §1–§3 and
`favorWantFor` were applied correctly in `936165a` / `b9517da`.)

Minimal fix: add one §6 bullet — *"Batch 4 allows, inside the three zones: a requester heart glyph
on the villager card, a `Favor:` line reserved above the task grid, and favor text in the panel
hint"* — plus a one-line §3.2 note for `THANK_YOU_MS = 6000` and a one-line §3 persist note
*"`VERSION = 2`; v1 saves migrate additively (village intact, fresh chains)."*

---

### Minor

**M1 — Two `favor-done` events in one tick: the first requester's "delighted!" window is dropped.**
`src/ui/index.ts:293` (loop body `:295`–`:300`)

The loop assigns `thanksName` / `thanksUntil` for *every* `favor-done` in `state.events`, so the
last one wins and a single `thanksUntil` is written. Two favors completing in the same tick is
reachable — two `eat/self` requesters whose rest timers expire in the same tick (or two `eat/any`
favors fed by the same batch of eats; `src/sim/favors.test.ts:272` asserts exactly this shape) — and
then only the higher-index villager ever gets `"{Name} is delighted!"`; the other completion's bond
moment never renders. Hearts and audio are unaffected (they iterate all events).

Minimal fix: keep the *first* `favor-done` in the array (`const done = state.events.find(…)`) so at
least the lowest-index requester wins deterministically, or carry a one-slot queue and advance it
on the window's close edge. Add a test beside `src/ui/derive.test.ts:253`.

**M2 — A `dt <= 0` tick hands events to every consumer *except* `tickFavors`.**
`src/sim/index.ts:163` (vs. the guarantee at `src/sim/index.ts:159`, and `src/sim/index.ts:198`)

`tick()` seeds `state.events = pendingEvents.slice()` and empties the queue at `:160`–`:161`, then
returns at `:163` before `tickFavors` at `:198`. A `built` queued by `buildStructure` during a
zero-dt tick is therefore seen by audio, render and UI, then wiped on the next tick's reassignment —
never counted toward a `build` favor. This contradicts the comment's *"consumers miss nothing"*.
`src/main.ts:133` makes `dt = 0` only if two rAF timestamps compare equal (essentially never), so
this is latent rather than live.

Minimal fix: move `tickFavors(state, 0)` above the `if (!(dtMs > 0)) return;` guard (it already
clamps `dt` internally at `src/sim/favors.ts:70`), or narrow the guard to the movement block only.

**M3 — `isPlausibleFavors` accepts a finite but out-of-range `step`, which yields a phantom
offer loop.** `src/persist/index.ts:70`

`step` and `progress` are only checked for finiteness. A hand-corrupted-but-accepted save with
`step: 1.5` (or `-1`) passes validation; the offer pass at `src/sim/favors.ts:88` still treats
`step < CHAIN_LENGTH` as eligible, so it opens a favor and emits `favor-start` (card heart flashes,
"hm?" cue plays), and the completion pass at `src/sim/favors.ts:116`–`:121` finds
`favorWantFor(...) === null` and closes it one tick later — with no `favor-done` and no gap
enforcement. Result: a phantom offer every 90 s, forever. Self-produced saves can never reach this
(`step` only ever becomes `1, 2, 3`), which is why it is Minor.

Minimal fix: `if (!Number.isInteger(progress.step) || progress.step < 0 || progress.step > CHAIN_LENGTH) return false;`
(and `progress.progress >= 0`).

**M4 — `favor-done` is pushed without the roster guard that `favor-start` has.**
`src/sim/favors.ts:145` (contrast `src/sim/favors.ts:101`)

`villagerId: state.villagers[i]?.id` can be `undefined` when `byVillager` outlives `villagers`,
while `favor-start` is wrapped in `if (villager)`. Spec Part 1.5 says both events carry
`villagerId`; an id-less `favor-done` is silently dropped by render
(`src/render/villagers/index.ts:88`) and by the thanks window (`src/ui/index.ts:295`), so the
hearts and the "delighted!" line would both be lost while the chain still advanced. Unreachable in
production (both `createInitialState` and `isPlausibleFavors` enforce equal lengths) — the defect is
the asymmetry.

Minimal fix: hoist `const villager = state.villagers[i];` and emit only `if (villager)`, mirroring
`:101`.

**M5 — Requester determinism is pinned for the *first offer only*, not the sequence.**
`src/sim/favors.test.ts:97`

Spec Part 6 asks for "same seed → same **requester sequence**; different seeds differ". The test
runs one offer and compares one id. Nothing pins the second/third offer, the tie between
`completedSteps` and `activeCount` in `worth`, or that a reload mid-chain resumes the same sequence
(the derive is a pure function of `(seed, worth, eligible)`, so I could not construct a divergence —
this is a coverage gap, not a defect).

Minimal fix: drive two or three offers (offer → complete → offer) from two identically seeded states
and `expect(sequenceA).toEqual(sequenceB)`.

**M6 — Review Focus 5's cadence half has no test.**
`src/ui/index.ts:299` (and `:303`)

The plan says *"each task adds the pinning test"*. The priority/exclusivity half of Focus 5 is
covered by `src/ui/derive.test.ts:253` (thanks wins, other line returns after) — good. The other
half, *"the line must switch at the recompute cadence"*, lives in the edge-forced
`hintDueAt = 0` writes at `:299` and `:303`, and there is no `src/ui/index.test.ts` anywhere in the
repo, so nothing pins that the window opens promptly (rather than up to 10 s late, missing the 6 s
window entirely) or that it closes and restores the favor line.

Minimal fix: extract the thanks-open/close + recompute decision into a small pure helper in
`derive.ts` (it is already pure apart from `performance.now()`) and unit-test it, or add a thin
`ui/index.test.ts` against a jsdom root.

**M7 — `favorLineFor` is exported but nothing outside the module uses it.**
`src/ui/derive.ts:162`

Repo-wide, `favorLineFor` appears only at `src/ui/derive.ts:162` (declaration) and
`src/ui/derive.ts:180` (its single caller, `favorLine`). No import from `src/ui/index.ts` or the
tests. `noUnusedLocals` does not flag exports, so it is dead public surface — against DESIGN §6's
anti-bloat intent (and the same class of issue that F3b had to fix for `favorWantFor`, see
`REPORT.md:160`).

Minimal fix: drop the `export` keyword (keep the function), or add a test that imports it.

**M8 — A step-0 completion double-spawns hearts against a 4-slot pool.**
`src/render/villagers/index.ts:87` (pool: `src/render/villagers/hearts.ts:11`, burst size:
`src/render/villagers/hearts.ts:99`)

Step 0 is `{eat, self, 1}`, so *every* first-favor completion happens on the same tick as the
requester's own `eat` event. The loop at `:84`–`:93` therefore calls `spawnHearts` twice for the
same rig in one tick: 2–3 hearts, then 2–3 more, into `HEART_POOL = 4`. The second burst exhausts
the free slots and `heartSlot` ("a free heart, else the oldest") recycles the first burst's oldest
hearts, resetting `ageMs = 0` and truncating them. Spec Part 4 says hearts "trigger on `favor-done`
exactly as they do on `eat` (same pool, same burst rules)", so two triggers are in-spec — but the
observable is a stuttering burst on the single most common completion path.

Minimal fix: skip the `eat` burst when a `favor-done` for the same `villagerId` is in the same
event batch (or pass a per-tick de-dup set), keeping one burst per villager per tick.

---

## Review Focus pins (plan `:29`–`:41`)

| # | Focus | Test | Verdict |
|---|---|---|---|
| 1 | Reload mid-favor restores active favor, progress, `nextOfferMs` | `src/persist/index.test.ts:54` | ✅ |
| 2 | One event counts for both favors, never twice for one | `src/sim/favors.test.ts:272` | ✅ |
| 3 | v1 save → fresh chains, `nextOfferMs = FIRST_OFFER_MS`, village intact | `src/persist/index.test.ts:72` | ✅ |
| 4 | Fire pause: `< 33` does not accumulate, no double-fire | `src/sim/favors.test.ts:246` | ✅ |
| 5 | Hint stability across two favors / completion | `src/ui/derive.test.ts:253` | ⚠️ priority covered; cadence edge (M6) untested |

Also checked against spec Part 6: first offer at 120 s (`favors.test.ts:89`) ✅ · 90 s gap after
completion (`:156`) ✅ · max-2 incl. hold-at-zero retry (`:111`) ✅ · all five want kinds complete
(`:175`, `:200`, `:212`, `:237`, `:246`) ✅ · `favor-done` exactly once, no double-completion
(`:194`, `:266`) ✅ · requester determinism — first offer only, see M5 ⚠️ · persist round-trip /
migration / corruption (`persist/index.test.ts:54`, `:72`, `:127`) ✅ · UI priority + copy +
thanks-window exclusivity (`derive.test.ts:112`, `:145`, `:232`) ✅.

## Areas reviewed and found clean

- **Cadence / max-2 / gap / hold-at-zero / clamping** — `src/sim/favors.ts:74` floors the countdown
  at 0 and holds it there under the cap; `:105` re-arms per offer and `:144` enforces
  `max(nextOfferMs, 90000)` per completion, exactly as spec §1.3/§1.4 read. Completion sets
  `progress = 0` (`:142`), so overshoot is clamped. The offer pass runs before the completion pass
  and `activeBefore` (`:79`) correctly excludes a just-opened favor from this tick's events.
- **RNG isolation** — the derive at `:98` builds a *fresh* `mulberry32(state.seed ^ 0x9e3779b9 ^
  worth)`; `state.seed` is never written after creation, and `createInitialState`'s stream
  (`src/sim/index.ts:53`) is local and dead after world-gen. `mulberry32` has exactly two call
  sites in the sim. All five pre-existing sim suites (`rng`, `sim`, `behavior`, `fire`, `food`) are
  green, so existing sequences are untouched.
- **Completion accounting** — eat/self vs eat/any gating at `favors.ts:133`; `favor-start` and
  `favor-done` are pushed onto `state.events` but can never match
  `EVENT_TYPE_FOR` (`favors.ts:56`), so a favor is counted at most once per tick and a single event
  advances both sharing favors once each. `active = false` gates re-emission.
- **Fire ≥ 33 pause / pause-resume** — `favors.ts:124` accumulates only at `fuel >= 33`, sampled
  post-decay and post-tend at end of tick; a pause adds 0 and keeps progress, and `active = false`
  makes a replay impossible.
- **Save v2** — `persist/index.ts:95`–`:104`: v2 validates then returns untouched; v1 migrates
  additively with `createFavors(villagers.length)`; unknown version → null; `isPlausibleFavors`
  enforces container types, `active` boolean, finiteness and roster length. Round-trip and
  corruption depth are both tested (except the range check in M3).
- **UI priority / copy / exclusivity** — `derive.ts:89`–`:96` implements
  `embers > (thanks | favor) > dimming > cooking > well-fed > meals > roaring > default`, matching
  spec §3.1 and the pre-existing order byte-for-byte above the insert; `thanks` sits in the favor
  slot and short-circuits it (`:91`), so the two never render together. Hint selection is by
  villager id, not array order (`:176`–`:184`), and the popover uses the same progress formatter
  (`:192`). The reserved line uses `visibility` + `min-height: 2.4em`
  (`src/ui/markup.ts:58`), so no layout jump.
- **Hearts / audio wiring** — render gates event consumption on `state.tick`
  (`render/villagers/index.ts:82`) so an extra pass cannot double-burst; `favor-start`/`favor-done`
  are in the `SfxKind` union, the `lastSfx` seed table and `playSfx`
  (`src/audio/index.ts:57`, `:178`–`:179`). Priority table `built 10 > favor-done 9 > meal-cooked 8
  > rest-done 7 > favor-start 6 > eat 5 > fuel-add 4 > garden 3 > gather 2 > chop 1`
  (`:390`–`:399`) is the spec table verbatim, and the existing 400 ms per-type cooldown is
  untouched (`:171`). `favorChime` peaks 0.045/0.04 at C5→G5, below `built`'s 0.05 chime + knock and
  pitched clear of `rest-done`'s 660/880 — spec Part 4 satisfied.
- **Three-zone compliance / anti-bloat (code)** — heart + hint live in zone 2, `Favor:` line in
  zone 3, no fourth zone, no new dependencies, no new sim exports beyond the six names DESIGN §3
  lists (`src/sim/index.ts:44`), and `tickFavors` correctly stays internal.
