# Orchestration Report — Cozy Forest Village

Authority: `DESIGN.md`. Updated after every task. This is the ledger: task → model → attempts →
validation → evaluation. Recovery map: commits named here exist in git.

## Free model roster (from `opencode` model list, 2026-10-04)

| Model ID | Variants | Intended use |
|---|---|---|
| `opencode/space-bunny-free` | low…max | probe + complex/creative tasks |
| `opencode/fledge-alpha-free` | low…max | ⚠️ geo-blocked — "not available in your country" (excluded) |
| `opencode/longcat-2.5-preview-free` | — | complex tasks |
| `opencode/ling-3.1-flash-free` | — | small mechanical tasks |
| `opencode/mimo-v2.6-flash-free` | — | small mechanical tasks |
| `opencode/muse-spark-1.3-contributor-free` | minimal…xhigh | medium tasks |
| `opencode/nemotron-3.5-lightning-free` | — | small mechanical tasks |

Paid fallback proposals (cheapest OpenCode Go first), only on user approval:
`muse-spark-1.3-contributor` $0.10/$0.20 · `gpt-6-luna` $0.10/$0.50 · `mimo-v2.6-flash` $0.14/$0.28 ·
`hy3` $0.14/$0.58 · `qwen3.8-flash` $0.15/$0.47 · `glm-5.3-flash` $0.15/$0.50 · `deepseek-v4-flash` $0.15/$0.60.

Batch-4 favor wave (2026-10-05): executed on `opencode-go/deepseek-v4.1-flash#max` by **explicit user
instruction** (4-way parallel wave + 1 micro-round). The free-roster rules remain the default unless
the user re-instructs otherwise.

## Task board

| # | Task | Status | Model | Attempts | Validation | Score |
|---|---|---|---|---|---|---|
| T1 | Scaffold + cozy UI shell + base scene | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 1 fix | tsc/build/test ✅ · browser ✅ · console clean ✅ · cozy ✅ | 4.5/5 |
| T2 | Pure sim core (FSM, tasks, RNG) + vitest | ✅ complete | `opencode/longcat-2.5-preview-free` | 1 + 1 fix | tsc/build ✅ · 17/17 tests ✅ · code review ✅ | 4.5/5 |
| T3 | Forest environment (InstancedMesh, light, fog) | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | tsc/build ✅ · 17/17 tests ✅ · browser ✅ · calls 14 / tris 16.7k ✅ | 4.5/5 |
| T4 | Villagers (primitives + hats + procedural anim) | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 | tsc/build ✅ · 17/17 tests ✅ · browser behavior + FPS ✅ | 4.5/5 |
| T5 | Wiring sim ↔ render ↔ UI (full loop) | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 1 fix | tsc/build ✅ · 19/19 ✅ · browser: select/clear/drag/pulse ✅ | 4.5/5 |
| T6 | Ambient life + procedural WebAudio | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | tsc/build ✅ · 19/19 ✅ · browser: motion ✅ · calls 117 ✅ · console clean ✅ | 4.5/5 |
| T7 | Final review + 20 proposals | ✅ complete | `opencode/mimo-v2.6-flash-free` | 1 | 0 Critical · 6 Important · 6 Minor; evidence-backed | 5/5 |
| F1 | Pre-playtest fixes: sim (I1, I3, I6, M7) | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 + 1 fix | 24/24 tests ✅ · min fire dist 1.588 ✅ · work pair ≥ 0.55 ✅ | 4/5 |
| F2 | Pre-playtest fixes: UI/render (I2, M10, M11, M12) | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 1 fix | browser: Stop/labels/pulse ✅ · calls 117→89 ✅ · console clean ✅ | 4.5/5 |
| F3 | Pre-playtest fixes: audio/env (I4, I5, M8) | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | tsc/build ✅ · 24/24 ✅ · console clean ✅ · audio dormant pre-gesture ✅ | 4.5/5 |
| B1 | Sim: fire + Tend fire + warmth | ✅ complete | `opencode/longcat-2.5-preview-free` | 1 | tsc/build ✅ · 32/32 ✅ · 50-seed sweep 0 violations ✅ · keeper loop live ✅ | 4.5/5 |
| B2 | Sim: build + cook/meals/eat + garden | ✅ complete | `opencode/longcat-2.5-preview-free` | 1 | tsc/build ✅ · 41/41 ✅ · live: costs/meals/eat/garden exact ✅ | 4.5/5 |
| B3 | Persist: localStorage save/load/autosave | ✅ complete | `opencode/longcat-2.5-preview-free` | 1 | tsc/build ✅ · 49/49 ✅ · live: build → reload → restored ✅ · corrupt → fresh ✅ | 4.5/5 |
| B4 | Render: fire visuals + warm light | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | tsc/build ✅ · 49/49 ✅ · fuel 70/20/0 screenshots ✅ · calls 86 ✅ | 4.5/5 |
| B5 | Render: structures + ghosts + picking | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 | tsc/build ✅ · 49/49 ✅ · pick 7/7 (cross-validated probe) ✅ · calls 120/154 ✅ | 5/5 |
| B6 | Render: villager poses (carry/stir/eat/shiver/hearts) | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 | tsc/build ✅ · 49/49 ✅ · stir 1.19Hz · shiver 6.96Hz · hearts pooled 4 · calls 168 ✅ | 4.5/5 |
| B7 | UI: fuel pill, task grid, build cards, reset | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 | tsc/build ✅ · 49/49 ✅ · orchestrator flow: card→build→cook ✅ · calls 135 ✅ | 4.5/5 |
| B8 | Audio: crackle + new SFX | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | tsc/build ✅ · 51/51 ✅ · dormant pre-gesture ✅ · console clean ✅ | 4.5/5 |
| B9 | Batch-2 independent review + 20 proposals | ✅ complete | `opencode/mimo-v2.6-flash-free` | 1 | 1 Critical · 4 Important · 7 Minor (all real) | 5/5 |
| B9-1 | Fix batch: sim + persist (C-level findings 1; I1–I4; M3, M4, M6, M7) | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 + 3 micro-rounds (M3 geometry) | 62/62 ✅ · live: queue flush + log settle ✅ | 4.5/5 |
| B9-2 | Fix batch: UI + render (C1; M1, M2, M5, M6-UI) | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 | 62/62 ✅ · all three click paths ✅ · innerHTML 118→0 ✅ | 4.5/5 |
| A1 | Batch-3 UI polish + sim constant export (A1b) | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 1 micro-round | 62/62 ✅ · live: pulse/tint/recipe/countdown ✅ | 4.5/5 |
| A2 | Batch-3 warmth disc | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | 62/62 ✅ · visuals high/low fuel ✅ · +1 call ✅ | 5/5 |
| A3 | Batch-3 audio: wind gusts + cook streaks | ✅ complete | `opencode/mimo-v2.6-flash-free` | 1 | 62/62 ✅ · dormant pre-gesture ✅ · console clean ✅ | 4.5/5 |
| A4 | Batch-3 hover cursor cue | ✅ complete | `opencode/longcat-2.5-preview-free` | 1 | 62/62 ✅ · live cursor pointer/'' ✅ | 4.5/5 |
| A5 | Batch-3 structures: meals read + merge/instance | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 | 62/62 ✅ · calls 97/111 (was 121/145+) ✅ · picks 8/8 ✅ | 5/5 |
| A6 | Batch-3 split `villagers.ts` (5 modules) | ✅ complete | `opencode/ling-3.1-flash-free` | 1 | 62/62 ✅ · public API unchanged ✅ | 4.5/5 |
| WB1 | Batch-3 Wave B: rotating village line | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 | 63/63 ✅ · live: dimming/embers lines, 1 change/12 samples ✅ | 4.5/5 |
| WB2 | Batch-3 Wave B: structure selection cue | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 1 continuation | 63/63 ✅ · live: cue ghost/built, exclusive, clears ✅ · +4 calls | 4.5/5 |
| WB4 | Batch-3 Wave B: garden event + pluck | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | 63/63 ✅ · live yield 0→1 ✅ · audible = human | 4.5/5 |
| WD1 | Batch-3 Wave D: UI split + guard + tests | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 | 91/91 ✅ · markup byte-identical ✅ · caught 2 real bugs | 4.5/5 |
| WD2 | Batch-3 Wave D: cue → `selectionCue.ts` | ✅ complete | `opencode/mimo-v2.6-flash-free` (fb; ling rate-limited) | 1 | 91/91 ✅ · differential 376 frames, 0 mismatches ✅ | 4.5/5 |
| WD3 | Batch-3 Wave D: obstacle-aware walking | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | 91/91 ✅ · head-on 0.620 vs 0.57 bar ✅ · live walk clean ✅ | 4.5/5 |
| F1 | Batch-4: favor sim (chains, cadence, completion, events) | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` | 1 | 139/139 ✅ · 17 new tests ✅ · live: organic offer + completion ✅ | 5/5 |
| F2 | Batch-4: save schema v2 + additive v1 migration | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` | 1 | 139/139 ✅ · 7 new tests ✅ · live reload retains favors ✅ | 4.5/5 |
| F3 | Batch-4: favor UI (hint priority, card heart, popover) | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` | 1 + 1 micro-round (F3b) | 139/139 ✅ · 24 new tests ✅ · live ✅ | 4.5/5 |
| F4 | Batch-4: favor audio + pooled hearts | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` | 1 | 139/139 ✅ · live wiring ✅ · audible = human | 4.5/5 |
| F-review | Batch-4 independent review | ✅ complete | `opencode/mimo-v2.6-flash-free` | 1 | 0 Critical · 1 Important · 8 Minor — all adjudicated real | 5/5 |
| F-fix | Review fix round (M1–M8 + DESIGN I1) | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` ×3 parallel + orchestrator docs | 1 | 149/149 ✅ · post-fix browser sanity ✅ | 4.5/5 |
| G1 | Batch-5: structure-card signature test | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` | 1 | 180/180 ✅ · mutation-proved the guarantee | 4.5/5 |
| G2 | Batch-5: per-villager phrasing | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` | 1 | 180/180 ✅ · live: variants + "beams with joy!" ✅ | 4.5/5 |
| G3 | Batch-5: completion heart pulse | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` | 1 | 180/180 ✅ · live: pulse class caught ✅ | 4.5/5 |
| G4 | Batch-5: recurring favors + legacy heal | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` | 1 + 1 micro-round | 180/180 ✅ · live: step 3 → 0 heal + eligible ✅ | 4.5/5 |
| G5 | Batch-5: camera focus on selection | ✅ complete | `opencode-go/deepseek-v4.1-flash#max` | 1 | 180/180 ✅ · live: eased + cancel drift 0 ✅ | 4.5/5 |
| H1 | Batch-6: huts sim (arrivals, cast, `'arriving'`) | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | 209/209 ✅ · 9 tests · walk-in trunk 0.620 / slot 0.0000 ✅ | 5/5 |
| H2 | Batch-6: persist v3 + chained migrations | ✅ complete | `opencode/mimo-v2.6-flash-free` | 1 | 209/209 ✅ · 11 tests · live reload mid-walk resumed ✅ | 4.5/5 |
| H3 | Batch-6: card reconcile + scroll + "Arriving…" | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 1 micro-round (fixture) | 209/209 ✅ · 8 tests · live scroll 360/544 @12 ✅ | 4.5/5 |
| H4 | Batch-6: hut model + ghost + arriving gait | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 1 micro-round (gait) | 209/209 ✅ · 1 call/hut ✅ · live ✓ | 4.5/5 |
| H-fix | Batch-6 review fix round (C1, I1, M1–M3) | ✅ complete | space-bunny + mimo + muse-spark (3 parallel) | 1 | 216/216 ✅ · live: arriving lock releases + real Chop assigned ✅ | 4.5/5 |
| T1 | Batch-7: trader sim (schedule, trades, hearty) | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | 254/254 ✅ · 12 tests · live: schedule + rates exact ✅ | 5/5 |
| T2 | Batch-7: persist v4 chain | ✅ complete | `opencode/mimo-v2.6-flash-free` | 1 | 254/254 ✅ (persist 38/38) · live: mid-visit reload resumes ✅ | 5/5 |
| T3 | Batch-7: spices pill + trader popover face | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 3 micro-rounds (b/c/d) | 254/254 ✅ · 19 tests · live: gate table + face ✅ | 4.5/5 |
| T4 | Batch-7: trader rig + handcart + picking + cues | ✅ complete | `opencode/space-bunny-free#xhigh` (2nd session) | 1 + 1 critical fix | 254/254 ✅ · live: 1-click pick + walk ✓ | 4/5 |
| T-fix | Batch-7 review fix round (I1, M1, M2, M3, M5) | ✅ complete | space-bunny ×2 + muse-spark (3 parallel) | 1 | 260/260 ✅ · first render-layer test ✓ · live walk-out re-shot ✅ | 4.5/5 |

## Improvement candidates — round 1 (curated 10, easy → hard)

Curated by the orchestrator from T7's 20 proposals (model: mimo-v2.6-flash-free) + QA notes.
The user playtests, adds their own list, then picks ~5–6 for batch 2.

1. [easy] **Campfire life** — flame flicker (±6 % breathe) + one warm, low-intensity PointLight. The
   single cheapest win for the whole clearing. (T7 #5)
2. [easy] **Keyboard tasks** — `1/2/3/0` assigns chop/berries/rest/stop to the selected villager. No UI
   change, eight clicks become one. (T7 #7)
3. [easy] **Reduced-motion in 3D** — honour `prefers-reduced-motion` in the render layer (halve bob/sway,
   stop the ring pulse), matching what CSS already does. (T7 #8)
4. [easy] **Progress bar on the selected card** — a hairline bar driven by `progressMs`; completes the
   state-labels added in F2. (T7 #4)
5. [medium] **Gathering reads in the world** — berry dots on bushes; a pale cut-mark appears on the tree
   being chopped. Resources currently grow from invisible work. (T7 #10)
6. [medium] **Idle wander** — unassigned villagers stroll to a fresh spot every 6–10 s (well under walk
   speed). Eight statues around a fire is the emptiest the game ever looks. (T7 #13)
7. [medium] **Resting pose** — sit/lean toward the fire instead of standing; slower breathing. (T7 #12)
8. [medium] **Stockpile props** — a log pile and berry basket near the campfire whose count tracks the
   HUD numbers (capped). Turns abstract counters into scenery. (T7 #11)
9. [medium] **Audio warmth** — quiet fire crackle + soft footsteps between chirps (procedural, no
   assets). Fills the silence without touching UI. (T7 #6)
10. [hard] **The campfire burns wood** — a `fuel` value decays over time; flame scale, light radius and
    crackle density track it; chopping feeds it. The first real gameplay loop. (T7 #20)

Honourable mentions not in the 10: camera focus on selected villager (T7 #9), recent-activity line
(T7 #16), batch "assign to all idle" (T7 #19), `hash01`/`mulberry32` dedupe (M9), code-split for the
one remaining build warning (chunk > 500 kB, three.js).

## Improvement candidates — round 2 (curated 10, easy → hard)

Curated from B9's 20 proposals (the review-era bugs it found are fixed, not listed). User playtests,
adds their own, picks ~5–6 for batch 3.

**Wave A shipped (2026-10-05): #1–#9 + the `villagers.ts` split + cook-streak blips (A3).**
**Wave B shipped (2026-10-05): #10 rotating village line + the structure highlight + audible garden.**
**Wave D shipped (2026-10-05): `ui/index.ts` split + guard + tests (WD1), `selectionCue.ts` extraction
(WD2), obstacle-aware walking (WD3).**
Remaining: **traders → spices shipped (T1–T4)**. Next candidates: bond levels on cards · day/night
cycle · save-migration harness · the structure popover still shows the villager task grid (predates
batch 7; a one-rule fix if wanted). Known limitations: clicking an already-selected card does not
restart camera focus (UI same-selection no-op); the heart-pulse duration lives in both
`HEART_PULSE_MS` and CSS (comment-linked); the trader face's auto-close matrix has no DOM test
(live-verified instead); vite chunk warning (cosmetic).

1. [easy] **Fuel-pill pulse on a log deposit** — re-fire the yield pulse on `fuel-add`; the +25 becomes
   legible across the clearing. (B9 #5)
2. [easy] **Well-fed badge** — tint the card's task label with `--leaf` while `fedMs > 0`; explains the
   speed-up without a tooltip. (B9 #6)
3. [easy] **Pot recipe in the status line** — `Meals: N · 3 berries + 1 wood each`. (B9 #8)
4. [medium] **Garden countdown** — `Growing… 18s` from the existing `gardenMs`; a watched purchase.
   (B9 #9)
5. [medium] **Warmth disc breathes with fuel** — a soft translucent disc radius ∝ fuel; makes the
   "can eat here" warmth readable without numbers. (B9 #11)
6. [medium] **Cursor + hover cue** — throttled raycast on pointermove sets `cursor: pointer` over
   villagers/structures; closes the discoverability gap. (B9 #12)
7. [medium] **Meals past six read at the pot** — scale the top bowl or thicken the steam. (B9 #10)
8. [medium] **Wind gusts** — slow noise envelope on the existing wind gain; the forest breathes.
   (B9 #13)
9. [hard] **Instance/merge structure parts** — ~145 → ~80 draw calls before batch 3 spends them.
   (B9 #17)
10. [hard] **Rotating village line** — replace the panel hint with a throttled state-driven line
    ("The fire is dimming", "Clover is well-fed"). (B9 #20)

Honourable mentions: obstacle-aware walking around trunks (B9 #18), save schema v2 + migrations (#19),
cook-streak blips (#14), audible garden (#15), splitting `villagers.ts` (530) / `ui/index.ts` (470),
a 3D highlight for the selected structure.

## Log

### 2026-10-04 — T1 complete (commit d551aaf)
- Model: `opencode/space-bunny-free#xhigh` · attempts: 1 + 1 fix round · score 4.5/5.
- Validation evidence: `tsc --noEmit`/`build`/`test` green; live browser (isolated tab, port 5188):
  console clean, 8 cards, assign → label + `state.villagers[].task` update, Escape/outside-click close,
  popover no longer covers the edited card; screenshots `docs/validation/T01-*.png`.
- Fix round 1: (a) brief pinned `PCFSoftShadowMap`, removed at runtime in three 0.186 → `PCFShadowMap`
  (spec error — the model had flagged it); (b) popover overlapped the edited card → re-docked as a
  panel footer.
- Rulings: accepted `@types/three` (three 0.186 ships no types; strict TS needs it) — cost if wrong:
  one extra devDependency. T1 authored `src/sim/*` stubs per its brief while DESIGN §5 assigns sim to
  T2 — T2 replaces internals, signatures unchanged. Cost if wrong: none observed.
- Notes: vite chunk-size warning (three.js bundle) accepted; dev-server port 5188 (5173 is used by the
  user's other projects).

### 2026-10-05 — Batch-7 review fix round — 0 Critical · 1 Important · 5 Minor: 4 fixed + 1 recorded (3 parallel free models)
- **I1 (Important, `space-bunny` render)** — the walk-out cart counter-term assumed a π turn; the real arc
  is −135.9°, and the correct counter-term algebraically collapses to `0`: unconditional
  `cart.rotation.y = 0` + comment truth-fix (successive micro-fixes prove the value of the review).
  **M5** — the **first render-layer test** (`src/render/trader.test.ts`, 4 cases): downward rays at the
  stall and the edge pin scene attachment, visibility gating and live movement; verifiably bites
  (reverting `group.add(root)` fails exactly the two positive assertions).
- **M1 (Minor, `space-bunny` UI)** — visit-end auto-close now clears the render ring
  (`onSelect(null)`), so the next visit can't open with a stray lit ring. **M3** — the
  "trader + favor + thanks simultaneously" hint-priority assertion.
- **M2 (Minor, `muse-spark` sim)** — giant-`dt` spice single-consumption pin (adapted to a 0.5 s
  approach + one 300 s tick; the literal sketch couldn't eat with fuel floored — documented).
- **M4 (recorded debt)** — `src/ui/index.ts` has no DOM test; the trader-face open/close matrix stays
  live-verified until a DOM harness exists.
- Gates **260/260 (13 files)** · live re-run green incl. walk-out evidence `WT-trader-walkout.png`.

### 2026-10-05 — Batch-7 (traders → spices) wave complete — 4 parallel + 4 micro-rounds, 2 live-caught Criticals (free models)
- **T1 sim** (5/5): `Visitor` schedule (first 240 000, stay 120 000, gap 360 000, walk 6 000),
  `trade()` at `5 wood → 4 berries` / `6 berries → 1 spice`, max 3/visit; hearty eats (1 spice →
  fedMs 90 000, `eat.hearty`); events via `pendingEvents` (next-tick, like `buildStructure`) — 12 tests.
- **T2 persist** (5/5): schema **v4** + chained v1→v2→v3→v4 with post-migration re-validation;
  `resources.spices` + `visitor` with shape guards — persist 38/38.
- **T3 UI** (4.5/5): Spices pill + icon, trader popover face with the `tradeDisabled` gate table, hint
  slot (ember > thanks/favor > trader > dimming), pot hearty suffix. Micro-rounds: **T3b** (pot-suffix
  wiring + the `structure-card.test.ts` fixture that was blocking everyone's gate), **T3c** (trade
  costs single-sourced from the sim surface), **T3d** (trader face chrome: task grid + favor gap
  removed, "Trades left: N" wording, neutral disabled register; also closed a latent stale
  structure-card leak on structure→trader).
- **T4 render+audio** (4/5): trader rig from the villager kit + handcart; position and facing purely
  from `(phase, visitMs)` (reload-exact by construction); wheel roll derived, never accumulated;
  selection ring reuse; `pickTrader`/`setTraderSelected`; click chain villager → trader → structure →
  ground; cart-bell/clink cues with the priority renumber.
- **Live pass (Node Playwright)** — all green: first visit at 240 s → trader walks in → click-select at
  the projected stall pixel (962, 410) on the **first attempt** → both trades execute exactly
  (60→55/40→44; →38/1 spice; →32/2 spice; counter 3→0) → sold-out buttons disable → **mid-visit
  reload resumes the visit** (`visitMs` continuous, `tradesLeft: 0`, `spices: 2` persisted) → hearty
  meal consumes 1 spice for `fedMs 90 000` → console clean. Evidence:
  `docs/validation/WT-{walkin,stall,trade,reload}.png`.
- **Two Criticals caught by the live pass** (neither visible to `tsc`, build, or 254 tests):
  (1) **T4's trader `root` was never attached to the exported `group`** — invisible and unpickable in
  the shipped wave while the HUD advertised the visit; one-line fix + re-run. Recorded lesson: every
  render task's live pass needs a scene-graph assertion. (2) The trader face carried the villager task
  grid + favor gap — fixed in T3d.
- Review: independent read-only pass dispatched over the wave.

### 2026-10-05 — Batch-6 review fix round — 1 Critical · 1 Important · 3 Minor, all fixed (3 parallel free models)
- **C1 (Critical, `space-bunny`)** — the arriving lock never released: `chop`/`berries`/`rest`/`tend`
  stayed dead for the session after a walk-in. The loop now owns the transition
  (`setDisabled(btn, arriving)`); **live re-verified**: lock `true` during the walk, `false` after
  settling, and a real Chop click assigns the newcomer. Also **M2**: card reconcile keyed on
  `list.children.length` (a duplicate-id save can no longer append cards forever) and **M3**:
  index-8+ voice/variant tests (Lily at index 8, 4 tests).
- **I1 (Important, `mimo`)** — migrated states were returned without v3 validation, dropping the
  roster `[8, 12]` rule on old saves (an out-of-band roster could silently eat a paid arrival). Both
  branches now `return isPlausibleState(v3) ? v3 : null`; the v1 fixture is a realistic 8-villager
  village; out-of-band rejection pinned in both branches.
- **M1 (Minor, `muse-spark`)** — world generation now reserves the hut plots. **Pre-fix seeds 2/7/42
  already violated clearance** (2.35/2.43/2.31 < 2.5); post-fix every probed seed ≥ 2.5.
- Gates **216/216** · C1 live re-verified · console clean · review report `docs/tasks/H-review-report.md`.

### 2026-10-05 — Batch-6 (huts → newcomers) wave complete — 4 parallel tasks + 2 micro-rounds (free models)
- **H1 sim** (5/5): hut kind/cost, the arrivals queue with the frozen
  `castIndex = (villagers.length − 8) + arrivals.length` formula, `'arriving'` walker (trunk 0.620 /
  slot 0.0000 measured), assignment refusal, favor-record lockstep, cap guard — 9 tests.
- **H2 persist** (4.5/5): schema **v3** + chained v1→v2→v3; arrivals validation; post-migration
  states deliberately not re-validated (historical fixture) — documented.
- **H3 UI** (4.5/5): dynamic card reconcile (append-only tail), panel scroll (360 px cap; 8 cards
  exactly fit, the 9th engages the scroll — live-measured 360/406/544), "Arriving…" label seeded on
  the first painted frame, tasks disabled while arriving. Fixture micro-round H3b cleared the
  last `tsc` blocker from a prior wave (one line, `arrivals: []`).
- **H4 render** (4.5/5): low-poly cabin (94 verts / 48 tris, 1 call built / 1 ghost) through the
  existing merge path; `selectionCue.ts` footprint key blessed (`hut: 0.66` — a total Record);
  micro-round H4b fixed the `'arriving'` pose to stride (shares the walking branch).
- **Live pass — new harness**: chrome-devtools MCP dropped out of the callable toolset mid-wave;
  live validation moved to a **Node Playwright** script (reused `@playwright/test` from an existing
  install; script kept outside the repo). All four stages green: scheduled arrival at 90 000 ms →
  v9 **Lily** walks the south edge with the "Arriving…" card and disabled tasks → settles at hut-1 →
  reload mid-walk resumed the walk (pos −0.34,−11.03 → −0.75,−9.85) → 12 villagers = Lily, Rowan,
  Sage, Wren in completion order · scroll 360/544 · favors aligned · console clean. Evidence:
  `docs/validation/WH-hut-walkin.png`, `WH-village12.png`.
- Environment notes: Python Playwright was installed then removed the same day; the
  `webapp-testing` skill (Python-flavored) was deleted from `~/.agents/skills` at the user's request.

### 2026-10-05 — Batch-5 Wave G complete — 5 parallel tasks + 1 micro-round (`opencode-go/deepseek-v4.1-flash#max`)
- **G1** signature test: 23 tests incl. a mutation check — the guarantee fails the suite if the
  signature ever falls back to a hand-listed subset. 4.5/5.
- **G2** phrasing: a stable name-keyed FNV-1a "voice" picks 1-of-3 warm variants per want and for
  the delight line; slot 0 is always the batch-4 phrase (golden assertions pin it). Live:
  "a cozy meal by the fire" / "beams with joy!". 4.5/5.
- **G3** heart pulse: transition-only, 2×300 ms scale pulse, reduced-motion respected, re-offer
  cancels cleanly. Live: pulse class observed at completion. 4.5/5.
- **G4** recurring: chains loop back to step 0 with the same cadence; a micro-round added the legacy
  heal for batch-4 `step: 3` records (wrap at the offer pass, ahead of the max-2 gate). Live:
  `step 3 → 0` and immediately eligible. 4.5/5.
- **G5** camera focus: `focusVillager` eases the orbit target at 3.5/s by translating camera+target
  (orientation untouched), clamped r ≤ 8, 0.4 u dead-zone, `pointerdown` cancels, dispose-safe.
  Live: eased 15 px (the target was already near centre), cancel drift **0**. 4.5/5.
- Gates **180/180** (10 files) · console clean (synthetic-pointer artifact only) · `WG-batch5.png`.

### 2026-10-05 — Batch-4 favor wave — 4 parallel tasks + 1 micro-round (`opencode-go/deepseek-v4.1-flash#max`, user instruction)
- Spec → plan → wave: DESIGN contracts amended before dispatch (state, events, 8 constants +
  `createFavors`/`favorWantFor`, §3.2 binding rules). Reviews: F1 5/5, F2/F3/F4 4.5/5.
- **F1 sim**: favors state + chains + cadence + completion; pure per-offer requester derive
  (`seed ^ 0x9e3779b9 ^ worth`), `activeBefore` semantics (a favor opened at end-of-tick never
  consumes that tick's events); 17 tests incl. every want kind, shared-event no-double-count,
  fire-pause, retirement, and a real rest→eat integration. **Live: offers appeared organically
  after ~2 min; the max-2 hold-at-zero was observed in the wild before any script ran.**
- **F2 persist**: `VERSION = 2`; v1 migrates additively (village intact, fresh chains); favors shape
  validated; 7 tests. **Live: reload retained two active favors + the 89 416 ms countdown exactly.**
- **F3 UI**: hint priority `embers > favor > dimming > …` with progress `(n/m)`/`(m:ss)`; card heart
  (transition-only); popover `Favor:` line; 6 s "delighted!" window; 24 new tests. Its own report
  flagged the mirrored chain function → **F3b moved `favorWantFor` to the sim's public surface and
  deleted the mirror** (the M6 lesson, applied within the wave).
- **F4 feedback**: `favor-start` "hm?" + `favor-done` warm chime; priority renumber
  (`built 10 > favor-done 9 > …`); pooled hearts burst on `favor-done` via the same eat path.
- Orchestrator live pass (`WF-favor-offer.png`, `WF-favor-done.png`): heart only on the requester,
  hint + popover line, completion via real eating (step→1, gap re-armed, `fedMs` set), delight
  window then fallback to the other open favor; console clean; gates **139/139**.
- Follow-up: independent review (`mimo`, 0 Critical · 1 Important · 8 Minor) + full fix round
  (all resolved; 3 parallel DeepSeek fixes + orchestrator DESIGN edits): first `favor-done` in a
  batch wins deterministically (M1); zero-dt ticks no longer skip `tickFavors` (M2); save validation
  range-checks `step`/`progress` (M3); `favor-done` gains the roster guard (M4); requester **sequence**
  determinism pinned (M5); hint recompute decision extracted + edge-tested (M6); dead export removed
  (M7); one heart burst per villager per tick on favor-forced meal ticks (M8); DESIGN §6 whitelist +
  §3.2 `THANK_YOU_MS` + §3 persistence schema note added (I1). Post-fix gate **149/149**; browser
  sanity clean.

### 2026-10-05 — Batch-3 Wave D complete — 3 parallel tasks (commits per task in git)
- **WD1** UI split (`space-bunny#xhigh`): `ui/index.ts` 560→312 + `derive.ts` / `markup.ts` /
  `cards.ts` / `structure-card.ts`, **28 new tests** — which caught two real defects on the way
  (`secondsToBerry(-1000)` read 31s on a 30s cycle; a `NaN` leak that could render "Growing… NaNs"
  from a malformed save). The M1 guard is now mechanical via a per-card view object; markup proven
  byte-identical against `git HEAD`. 4.5/5.
- **WD2** cue extraction (`mimo-v2.6-flash-free`; ling hit a rate limit — roster rotation): new
  `selectionCue.ts` (160) out of `structures.ts` (629→512); zero-behavior proven with a 376-frame
  differential harness across 10 edge scenarios — 0 mismatches. 4.5/5.
- **WD3** obstacle walking (`muse-spark#xhigh`): deterministic tangent-waypoint detours around trunks
  (TRUNK_RADIUS 0.42; bend when a chord passes within 0.62; destination trunk exempt; direct within
  1.0 of arrival). Head-on min distance **0.620 vs the 0.57 bar** (0.043–0.090 with the detour
  disabled); live walk clean. DESIGN §3.2 updated. 4.5/5.
- Orchestrator live pass: hint/select/fed-tint/popover intact after the split; cue still clicks
  through (measured **+4 calls** on toggle, consistent with B2); console clean (synthetic-pointer
  artifact only); integrated gate **91/91**.
- Note: second rate-limit fallback this batch; the rotation held both times.

### 2026-10-05 — Batch-3 Wave B complete — 3 parallel tasks (commits per task in git)
- **WB1** rotating village line (`space-bunny#xhigh`): pure `villageLine()` (embers > dimming > cooking >
  well-fed > meals > roaring > default, `firstById` deterministic), 10 s wall-clock recompute +
  change-guard — live: "The fire is dimming." → "Only embers left …" at fuel 0, exactly **1 change in
  12 samples**. Reserved line height (2.4 em) trades a little air for zero list-jump. 4.5/5.
- **WB2** structure cue (`space-bunny#xhigh`): two-tone footprint rings (wide halo + thin warm band),
  untagged so picks can't be stolen, eased in/out, mutual exclusion wired 1:1 in `main.ts`; also
  removed A5's per-frame `Set`. Live: cue on ghost + built, cleared by villager select and ground
  click (screenshots `WB-*.png`); measured **+4 draw calls** (model's scene-graph estimate said +2 —
  measured beats claimed; worst case 115, budget 200). First run ended with no reply and left a
  `.probe/` folder; the continuation delivered `docs/tasks/B2-highlight-report.md` and removed it. 4.5/5.
- **WB4** audible garden (`muse-spark#xhigh`): a new `garden` event per yield (the one-line `types.ts`
  deviation blessed; DESIGN §3 synced), softer +2-semitone pluck above gather, priority/cooldown table
  intact. Live yield 0→1; cadence unit-tested; audible check = human. 4.5/5.
- **Orchestration incident — task-ID collision**: Wave-B ids reused batch-2 report filenames
  (B1 overwritten, B4 appended). Fixed by restoring both batch-2 reports from git and renaming the
  Wave-B reports to `WB1-line-report.md` / `WB4-garden-report.md`; Wave-B report names are `W`-prefixed
  from now on. Cost: one repair round, no content lost.
- Frozen-tree validation: tsc/build ✅ · **63/63** ✅ · console clean (synthetic-pointer artifact only)
  · hint/cue/garden-yield all verified live.

### 2026-10-05 — Batch-3 Wave A complete — 6 parallel tasks (commits per task in git)
Parallel wave: six file-disjoint tasks dispatched simultaneously; implementers never commit; the
orchestrator validated the frozen tree (tsc/build · 62/62 · live browser pass on :5188).
- **A1** UI polish (`space-bunny#xhigh`): fuel-pill pulse on `fuel-add`, well-fed tint (transition-only),
  pot recipe line, garden countdown (the *rendered* seconds go in the M1 signature — repaints 1/s, not
  per frame). Micro-round A1b: sim exports `GARDEN_PERIOD_MS`/`COOK_BERRIES`/`COOK_WOOD`; the UI's
  mirrored constants deleted — the M6 drift lesson applied pre-emptively. 1 + 1; 4.5/5.
- **A2** warmth disc (`muse-spark#xhigh`): one unit-circle mesh, scale 1.2→5.0 ∝ fuel, opacity ≤ 0.11,
  breathing with the exact flame flicker value; zero per-frame allocations; +1 draw call. Visuals
  verified high/low (`WA-warmth-*.png`). 5/5.
- **A3** audio (`mimo-v2.6-flash-free`): wind-gust random walk on the bed gain via its **own PRNG
  stream** (existing chirp/crackle schedule byte-identical), cook-streak blip +1 semitone/step, cap +4,
  12 s reset; lazy-start/dispose preserved; room to hear it is the human check. 4.5/5.
- **A4** hover cue (`longcat-2.5-preview-free`): `pickHover` (shared-scratch raycast, villager-first)
  + pointermove throttled at 80 ms/2 px, skipped while dragging; cursor verified `pointer`/`''` live;
  DESIGN §3 contract updated by the orchestrator. 4.5/5.
- **A5** structures pack (`space-bunny#xhigh`): meals-past-six read (second bowl column from 7, ×1.15
  top-bowl step, thicker steam), static parts merged per kind into one vertex-coloured mesh, animated
  cues instanced. **Calls: fresh 121→97, all-built 145+→111** (target ≤115 ✅). Picking preserved by
  construction; its differential harness caught and fixed a real cached-`boundingSphere` bug (risen
  steam became unpickable) — re-verified across 34,812 sampled poses. 5/5.
- **A6** split (`ling-3.1-flash-free`): 531-line `villagers.ts` → 5 modules (index/rig/motion/hearts/
  ring), public API byte-identical, tend pose + hearts + ring intact. 4.5/5.
- **Orchestrator live evidence**: picks 8/8 through the real click chain (ghost pot + all 7 built;
  garden needed a low probe ray — flat geometry, test artifact), ground clears both halves, villager
  pick + ring after the split, fed tint on/off, fuel pulse caught, recipe + countdown strings live
  (`Growing… 23s → 21s`), audio dormant at load (starts on gesture), console clean (synthetic-pointer
  artifact only). Evidence `docs/validation/WA-*.png`.
- Parallel-wave workflow ruling: file-disjoint waves + one freeze point for validation scaled well
  (6 tasks ≈ 1 serialization window); keep for Wave B. Cost if wrong: none observed.

### 2026-10-05 — B9 complete + fix batches B9-1 / B9-2 (commit 8176871)
- Review (`mimo-v2.6-flash-free`, 5/5): 1 Critical, 4 Important, 7 Minor — all adjudicated as real;
  contract scorecard clean; perf 120–145 calls; save round-trip verified. Report `docs/tasks/B9-report.md`.
- Fix batch 1 (`muse-spark#xhigh`, sim + persist): pendingEvents queue (built SFX now plays),
  settle-carried-log on reassignment, universal flame-avoiding arc (measured min fire distance > 1.0
  for tend-cook legs), cook affordability per deduction (large-dt ledger safe), structure arrival
  slots, full-belly eat guard, stricter save shape, STRUCTURE_COST export.
- M3 geometry took three evidence-driven micro-rounds: r=0.75 floor 0.419 < 0.45 → r=0.85 still
  variance-limited → **r=0.9 + 0.02 arrival tolerance** (movement clamps, so villagers land exactly on
  their slot): measured min pair **0.5031**, all 62 tests green. Ruling recorded: shared-structure
  arrivals needed the tight tolerance, not just a wider ring; cost if wrong: none observed.
- Fix batch 2 (`space-bunny#xhigh`, UI + render): C1 world-click popover fixed (all three click paths
  verified by orchestrator: villager → grid, ghost → card "Cooking pot", ground → cleared),
  structure-card per-frame churn 118→0 writes/2 s, keeper watch pose (no more air-chop), stale comments,
  `STRUCTURE_COST` imported from sim, pageshow save-before-reload (wiped-guard preserved).
- Live orchestrator evidence: pending queue flush ['built'] → 0 next frame; carrying reassignment
  refunds wood (+1) and clears the pose; calls 127; console clean (synthetic-pointer artifact only).
- Notes: render-layer/models report sizes growing (`villagers.ts` 530, `ui/index.ts` 470,
  `sim/index.ts` 342) — improvement candidates; M1 signature guard has no mechanical protection
  (adding a card field without updating the signature silently stops repaints) — documented.

### 2026-10-04 — B8 complete (commit 3a3c5bc)
- Model: `opencode/muse-spark-1.3-contributor-free#xhigh` · 1 attempt, 0 fix rounds · 4.5/5.
- Deliverable: fire crackle grains (rate/gain by fuel state: 3/1.5/0.5/0.1 per s, jittered, shared
  noise buffer), SFX for `fuel-add` (thud), `meal-cooked` (two-note blip), `eat` (munch), `built`
  (knock + chime), priority pick per batch with per-type 400 ms cooldown, feeder halves the chirp
  interval. All nodes released on `ended`.
- Verified: 51/51 tests; console clean; audio dormant pre-gesture (`state 'none'`, `started false`).
  Audible quality is the human playtest check — not forced in automation.

### 2026-10-04 — B7 complete + keeper-ring field fix (commit c8e78fa)
- Model: `opencode/space-bunny-free#xhigh` · 1 attempt, 0 fix rounds · 4.5/5.
- Deliverable: fuel pill (value + mini bar + `data-state`), 2×3 task grid with Cook/Stop gating,
  structure cards (cost/shortfall/Build; built status incl. `Meals: N`), two-step reset, `Tending…`/
  `Cooking` labels, canvas pick order villager → structure → clear.
- Model-side catch: `resetVillage` was undone by M12's `pagehide → saveGame` — fixed with a `wiped`
  guard and re-verified end to end (boundary bugs like this are exactly why per-task validation exists).
- Orchestrator flow run: calibrated projection (0.00 px error vs `projectVillager`) → clicked the pot
  ghost → card showed cost, Build disabled-correctly and spent 50→30 wood, ghost→model swap; Cook
  enabled only with the pot; one meal cooked; fuel pill live (`Fire 68`, roaring); calls 135; console
  clean (synthetic-pointer `setPointerCapture` artifact only). Evidence `docs/validation/B7-*.png`.
- **Field fix dispatched after playtest-style validation**: the Tend keeper stood at 0.42 from the fire
  centre — inside the stone ring. Ruling: any campfire-bound destination (rest AND tend legs) now uses
  the rest-ring spot + approach arc (muse-spark, F1 arc author). Keeper settles at 1.95; the fix also
  removed `arrived`-event spam that the ring spot would otherwise have caused (caught by the model).
  51/51 tests; DESIGN §3.2 updated.
- Delegated/checked afterwards: `STRUCTURE_COST` is duplicated in the UI (sim does not export it) —
  parked for the B9 fix batch; no 3D highlight for a selected structure (playtest improvement).

### 2026-10-04 — B6 complete (commit 0446852)
- Model: `opencode/space-bunny-free#xhigh` · 1 attempt, 0 fix rounds · 4.5/5.
- Deliverable: carry log + raised arms while `carrying`, cook stir (`working`+`cook`), pooled heart
  sprites on `eat` events (max 4) with savoring bob, embers shiver (`fuel 0`, idle/resting only).
- Measured in-browser (temporary probe, removed): stir 1.19 Hz, shiver 6.96 Hz at ±0.00593 u (within
  the ±0.006 cap), hearts pooled at exactly 4 on a double-meal request, none on plain rests; worst-case
  calls 168 (<200). Screenshots `docs/validation/B6-*.png` (carry at the fire, hearts above the eater).
- Carried forward: `villagers.ts` is 511 lines (longest render file) — B9's review should weigh a split;
  render-layer motions have no unit tests (browser-measured, documented).

### 2026-10-04 — B5 complete (commit 901cfb5)
- Model: `opencode/space-bunny-free#xhigh` · 1 attempt, 0 fix rounds · 5/5.
- Deliverable: `src/render/structures.ts` (six models + ghosts from one shared code path, bowls/steam/
  sprout-growth/lantern breath as pure functions of state+time), `pickStructure` on the handle with a
  visibility filter (three.js raycasts ignore `visible`), `env.update(timeSec, state.fire)` integration
  fix. Screenshots: ghosts + all-built (`docs/validation/B5-*.png`).
- Measured: calls 120 fresh / 154 all-built (<200); picking 7/7 ghosts and built, probe projection
  cross-checked against `__cozy.projectVillager` to 0.00 px; sky/grass clicks null; console clean.
- Accepted deviations: structures face the campfire; two palette keys (`soil`, `cauldron`); ghost pot
  hides bowls/steam; ghost colour = `flowerWhite` (palette has no `paper` key — noted again for polish).
- Gaps carried forward: B5 has no unit tests (render layer, browser-validated); end-to-end
  ghost→Build via the real `buildStructure` path lands in B7's validation.

### 2026-10-04 — B4 complete (commit c57bed2)
- Model: `opencode/muse-spark-1.3-contributor-free#xhigh` · 1 attempt, 0 fix rounds · 4.5/5.
- Evidence: flame scale `0.25 + 0.75·ratio` × gentle two-sine flicker, colour lerp ember→fire, one
  warm point light `0.25 + 1.15·ratio` (distance 14, no shadows), 16-dot ember bed fading in as fuel
  drops. Screenshots at fuel 70/20/0 (`docs/validation/B4-fuel*.png`) — the clearing cools visibly,
  difference reads at a glance, not loud. Calls 86 (<200), console clean.
- Boundary note: `environment.update` accepts an optional `Fire` and otherwise falls back to the
  `__cozy` hook (the model could not touch `render/index.ts`). B5 now passes `state.fire` explicitly —
  the hook path becomes a defensive fallback only.
- `PALETTE.ember = '#a5502f'` added (muted dark orange).

### 2026-10-04 — B3 complete (commit b1bb532)
- Model: `opencode/longcat-2.5-preview-free` · 1 attempt, 0 fix rounds · 4.5/5.
- Evidence: 49/49 tests (8 new: round-trip, version mismatch, corrupt JSON, missing arrays, autosave
  semantics with fake timers). Orchestrator live: built a pot → autosave wrote (pot built, wood 30) →
  reload → restored (built, wood 30, tick continued); corrupt save seeded before first boot in a fresh
  context → clean fresh village (fuel 70, tick 84), console clean.
- Harness note: an earlier corrupt-save attempt looked like a miss — it was my test confound (the live
  page's autosave re-wrote the file, or bfcache resumed the page). Clean-context rerun proves the code.
- Persist is defensive by construction (never throws into the frame loop) and version-gated.

### 2026-10-04 — B2 complete (commit f7425fa)
- Model: `opencode/longcat-2.5-preview-free` · 1 attempt, 0 fix rounds · 4.5/5.
- Evidence: 41/41 tests (9 new: ring shape, build spend/refuse/never-partial, cook loop + exact costs +
  auto-idle, eat gating by fire, 1190 ms fed boundary, garden timing). Orchestrator live: pot 40→20 wood,
  3 meals cooked (wood −3, berries −9 exact), a rester ate (meals 4→3, `fedMs` 54 884, `restMs` 5500),
  garden +1 berry at 30 s, unaffordable/unknown builds refused, console clean.
- Contract addition ratified: `Villager.restMs` (rest duration committed at rest start) — DESIGN §3/§3.2
  updated. Cost if wrong: one state field; supports the 5500 ms eating rest exactly.
- Notes: `src/sim/index.ts` now 342 lines (guideline ~220) — flagged for B9 review; logic is cohesive
  but extraction candidates exist (tend/rest helpers → tasks.ts).

### 2026-10-04 — B1 complete (commit b738c62)
- Model: `opencode/longcat-2.5-preview-free` (rate limits cleared) · 1 attempt, 0 fix rounds · 4.5/5.
- Evidence: 32/32 tests (8 new: decay+floor, rest durations incl. boundaries, keeper fetch/deposit/cap/
  stand-watch, world ring, initial shape). Orchestrator live: keeper ran wood 5→3, fuel 30→79 then
  stood watch; decay 0.22/s observed; console clean.
- Independent check: 50-seed sweep of the all-8-chop no-stacking invariant — 0 violations, worst pair
  0.498 u (≥0.45), 0 stuck seeds. Screenshot `docs/validation/B1-world.png`.
- Deviations accepted: (1) `src/ui/index.ts` got 3 lines adding `tend`/`cook` labels — required by the
  `TaskId` union, zero behaviour change; (2) world-gen re-tuned (`min gap 2.5`, uniform-in-radius,
  r≥7.5) to keep the no-stacking invariant honest after the inner-ring change — validated across seeds,
  layout reads better (open village ring, forest hugging it).
- Notes: `src/sim/index.ts` is 262 lines (over the ~220 guideline) — watch in B2; rest duration is
  evaluated live against the fire (matches spec wording, no extra state).

### 2026-10-04 — Batch 2 spec written (user-approved design)
- Scope: warmth (fire fuel + Tend fire + warmth effects), food (pot → cook → meals → eat/fed), village
  growth (6 build spots + build API), localStorage save/load (schema v1), fuel pill + task grid +
  structure cards + reset (inside the existing three zones).
- Spec: DESIGN §3 (contracts incl. `pickStructure`, `selectStructure`, `build`, `resetVillage`),
  §3.2 (all binding numbers), §6 (explicit allowed additions). Briefs B1–B9 in `docs/tasks/`.
- Task order: sim → persist → render → UI → audio → review (each validated before the next).

### 2026-10-04 — Pre-playtest fix batch F1–F3 complete
- **F1 sim** (`muse-spark#xhigh` after longcat rate-limit): work arrival slots r=0.75 golden-angle (no
  stacking; measured min pair 0.55, bodies ~0.34 wide), rest approach arc without radius gate (measured
  min fire distance 1.588), `tick` non-finite guard, same-task no-op. 24/24 tests. Needed one extra
  round: first attempt left the `rv > 2.2` gate (min dist 0.563) and a too-tight slot radius.
- **F2 UI/render** (`space-bunny#xhigh`): Stop button (aria-disabled when idle), card labels show
  `Walking…`/task/`Resting`/`Idle`, pulse throttle 600 ms/pill, villager shadows trimmed (calls
  117→89), frame-loop try/catch + one-shot log, `pagehide` teardown. Round 2 fixed the pagehide
  zombie (loop keeps scheduling after dispose → GL errors): `stopped` flag stops the loop; `pageshow`
  reloads for a clean restore. Orchestrator browser pass: all paths ✅, console clean.
- **F3 audio/env** (`muse-spark#xhigh`): SFX = max one per batch + 400 ms per-type cooldown + ±8 %
  variation; voice chains disconnect on `ended`; `PALETTE.disc` replaces the hardcoded disc colour;
  `__cozyAudio` cleaned on dispose. Console clean, audio dormant pre-gesture.
- Rulings: work-slot worst case (chord − 2×arrival slop) justified r=0.75 with test ≥0.45; the rest
  arc drops the radius gate (any large `dAng` swings via r=2.2) — DESIGN §3.1 updated both times.
  Cost if wrong: slightly wider work spread / slightly longer rest walks; all revertible.
- **Slice 1 is feature-complete and validated.** Dev server on port 5188 for the human playtest.
  Audio audibility = human check (synthetic events are not user activation).

### 2026-10-04 — T7 review (commit 48b6bba)
- Model: `opencode/mimo-v2.6-flash-free` (fresh family, read-only) · delivered 0 Critical / 6 Important /
  6 Minor + 20 improvement proposals. Score 5/5 — measured claims (`node -e` re-runs), file:line evidence,
  clean sections stated explicitly. Report: `docs/tasks/T07-report.md`.
- Findings accepted: I1 villagers stack on one tree (measured pair 0.072 u apart) · I2 no way to stop a
  villager from the UI · I3 rest paths cross the flames (min distance 0.22 u) · I4 work SFX clatter
  (measured ~4–5 knocks/s) · I5 audio voices never disconnected · I6 `tick(Infinity)` hangs.
  Minors: M7 same-task click wipes progress · M8 stale palette listing + hardcoded disc colour ·
  M9 duplicated `hash01`/`mulberry32` + dead export · M10 shadows: 96 of 117 calls are villagers ·
  M11 pulse throb + card label never shows travel state · M12 no frame-loop containment, dead dispose
  paths, duplicate ledger row.
- Rulings: **I3** bends "straight line (no pathfinding)" → adopted the single-bend approach arc
  (r=2.2 bisector) in DESIGN §3.1; cost if wrong: slightly longer rest walks, revertible. **I2** adopted
  as a "Stop" button inside the existing popover zone + same-task no-op guard (M7). **M9 parked** —
  dedupe refactor touches four files for no player value pre-playtest; kept as an improvement candidate.
  **M8** DESIGN §4 updated here; the `disc` key lands with F3.
- Fix batches dispatched (pre-playtest): F1 sim · F2 UI/render · F3 audio/env.

### 2026-10-04 — T6 complete (commit 913f2b0)
- Models: `opencode/longcat-2.5-preview-free` → provider rejection "Rate limit exceeded" (no work done);
  `opencode/muse-spark-1.3-contributor-free#xhigh` → DONE, 1 attempt, 0 fix rounds · 4.5/5.
- Evidence: `tsc`/`build`/19 tests green; code read — ambient = 7 draws (birds 3, butterflies 3, motes 1),
  deterministic hash phases; crown sway ≤ 0.03 rad; audio is lazy on first real gesture, seeded PRNG,
  master 0.12, silent-failure init, `__cozyAudio` hook. Browser: console clean, `calls 117`,
  `triangles 29.1k`, ~60 fps (tab throttle suspected vs 8.3 ms earlier), audio `state 'none' /
  started false` pre-gesture; two screenshots 3.2 s apart show a bird translating across the frame
  and motes drifting (subtle, not snow). Evidence `docs/validation/T06-t0.png`, `T06-t1.png`.
- Ruling: longcat rate-limit was transient (not overall free-quota exhaustion) → continue on remaining
  free models; revisit paid models only if the whole roster blocks. Cost if wrong: one slower dispatch.
- Notes: butterflies wander centred within r≈7.6 (brief said r=2…14) — accepted, keeps them in the
  meadow; `environment.ts` sits exactly at 220 lines — watch it in future edits.
- Human check pending: audible output on a real gesture (synthetic events are not user activation).

### 2026-10-04 — T5 complete (commit f456266)
- Model: `opencode/space-bunny-free#xhigh` · attempts: 1 + 1 fix round · score 4.5/5.
- Evidence: `tsc`/`build`/19 tests green; code read (raycast pick, ring, click/drag threshold, pulsing);
  orchestrator browser: select via projected villager point ✅, ground-click clears ✅, 40 px drag does
  not select ✅, Escape clears ✅, card-click shows ring (after fix) ✅, yield pulse observed with
  wood +1 ✅, `calls` 105–112 (<200) ✅, console clean after fresh load ✅.
- Found by the model and fixed: a pre-existing document click handler would close the popover right
  after `ui.select()` on canvas clicks (dismissal is now scoped to clicks inside `#ui`).
- Fix round 1: (a) card-click selection did not light the 3D ring → `UIActions.onSelect` sync;
  (b) ring was unreadable on the clearing disc → two-tone cream+accent ring, y-offset, opacity ~0.9.
- Artifact note: dispatching synthetic PointerEvents produces a one-off `setPointerCapture`
  `NotFoundError` from OrbitControls (no active pointer). Fresh load without synthetic input is
  clean; real input carries a real pointer — classified as a test artifact, not an app bug.
- Deferred minors (T7): `villagers.ts` 250 lines / `ui/index.ts` 235 lines (past the ~220 guideline);
  ring color mirrors `PALETTE.fire` instead of a dedicated `accent` key.
- Audio caveat carried to T6: synthetic events do not count as user activation, so audible output is
  a human check at playtest; automated checks cover module hygiene and the hook.

### 2026-10-04 — T2 follow-up: rest ring (commit e334d0d)
- Model: `opencode/longcat-2.5-preview-free` (resumed T2 session) · 1 round · tests 19/19 ✅.
- Fix: `REST_RING_RADIUS = 1.6` + deterministic golden-angle `restSpot()`; `walk()` targets the spot
  for `rest` (arrival, facing, `arrived` event unchanged; `targetNodeId` stays `campfire`).
- Orchestrator browser check: two resters settle at 1.95 / 1.56 from the fire (ring radius 0.92) —
  outside the flames; screenshot `docs/validation/T02-restfix.png`. DESIGN §3.1 updated.
- Follow-up note: separation is covered by unit test (two spots pairwise > 1.0 apart).

### 2026-10-04 — T4 complete (commit 307df70)
- Model: `opencode/space-bunny-free#xhigh` · attempts: 1 (no fix round; two concerns ruled on) · 4.5/5.
- Evidence: `tsc`/`build`/17 tests green; code read (rigs, shared geoms, eased posing, shortest-arc turns);
  orchestrator browser run: chop → walk 8.2u → working; berries → 6.43u → working; rest → resting at
  dist 0.45 (bug, see ruling); FPS avg 8.33 ms/frame, p95 9 ms, `calls 110 / tris 28.6k`; screenshots
  `docs/validation/T04-*.png`, `T04-orch-check.png`.
- Ruling: draw-call budget **raised 120 → 200**. Measured 110 calls at ~120 fps headroom; budget was an
  arbitrary number, and instancing 8 animated characters would add real complexity for ~100 calls.
  World geometry (trees/tufts/rocks) is already instanced per the brief. Cost if wrong: narrower perf
  headroom for T6 — T7 re-checks with real numbers.
- Ruling: resting villagers stood **inside** the campfire ring (arrival 0.45 < ring radius 0.92). This is
  a sim bug → fix dispatched to T2's implementer (rest spot on ring r=1.6, DESIGN §3.1 updated).
- Accepted as-is: per-hat-color material cache (geometry/skin/tunic shared); render-layer easing helpers
  have no unit tests (browser behavior is the gate).

### 2026-10-04 — T3 complete (commit f24bac1)
- Model: `opencode/muse-spark-1.3-contributor-free#xhigh` · attempts: 1 (no fix round) · score 4.5/5.
- Evidence: `tsc`/`build`/17 tests green; code read against brief — 6 instanced meshes (trunks, crowns,
  bushes, rocks, 420 tufts, 60 flowers), deterministic `hash01` variation, T1 placeholder fully removed.
- Browser (orchestrator, isolated tab port 5188): console clean; `__cozyRender.info()` = calls 14,
  triangles 16,720, geometries 10, textures 2 (budget: <80 / <400k / <30) ✅; screenshots
  `docs/validation/T03-default.png`, `T03-wide.png` — fuller forest, clearing disc, distinct rocks/tufts.
- Notes: model reported no browser in sandbox (expected — live checks are the orchestrator's job).
- Deferred minor (T7): clearing-disc color `#ece0c3` is hardcoded in `environment.ts` instead of a
  `palette.ts` key.

### 2026-10-04 — T2 complete (commit 1e6e56d)
- Model attempts in order: `opencode/fledge-alpha-free#max` → instant provider rejection
  ("This model is not available in your country"), no work done, free; then
  `opencode/longcat-2.5-preview-free` → DONE. Attempts: 1 (+1 fix round). Score 4.5/5.
- Evidence: `tsc`/`build`/`test` green; 17 tests across 3 files with real oracles (nearest-node
  recomputation, arrival-boundary math, event lifecycle, assignment retargeting, dtMs=0, determinism);
  code read against DESIGN §3.1 — constants and FSM transitions match.
- Fix round 1: accumulators were hidden in a module-level `WeakMap` (public shape preserved, but
  state was no longer the single source of truth → breaks serialization/replay). Ruling: `progressMs`
  is a public `Villager` field (DESIGN §3/§3.1 updated). Cost if wrong: one extra state field.
- Notes: villager names/colors/nodes shape verified by tests; node tie-break is lexicographic id
  ascending (`tree-10` < `tree-2`) — accepted as spec-faithful ("id ascending").

### 2026-10-04 — setup
- Ruling: no git worktree — brand-new solo repo at `cozy-forest-village/`; single writer at a
  time (sequential dispatches). Cost if wrong: trivial to relocate/open a worktree later.
- Ruling: implementers do not commit; orchestrator validates then commits. Why: mirrors user's
  protocol (validate → compare → reprompt) and keeps history clean. Cost if wrong: some failed
  attempts leave no trace in git (they remain in task reports).
- Ruling: orchestrator performs the review (skill's task-reviewer role) using objective gates
  (tsc/build/tests/browser) + code read, per user instruction. Cost if wrong: weaker independent
  review; compensated by objective gates and final cross-task pass (T7).
- Plan conflict scan: tasks are sequential; file ownership in DESIGN §5; T3 consumes `state.nodes`
  from the T1 contract; T5 wires after T2–T4; no shared-file overlaps found. Clean.
- Ledger initialized; base commit: pending.
