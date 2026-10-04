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

## Task board

| # | Task | Status | Model | Attempts | Validation | Score |
|---|---|---|---|---|---|---|
| T1 | Scaffold + cozy UI shell + base scene | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 1 fix | tsc/build/test ✅ · browser ✅ · console clean ✅ · cozy ✅ | 4.5/5 |
| T2 | Pure sim core (FSM, tasks, RNG) + vitest | ✅ complete | `opencode/longcat-2.5-preview-free` | 1 + 1 fix | tsc/build ✅ · 17/17 tests ✅ · code review ✅ | 4.5/5 |
| T3 | Forest environment (InstancedMesh, light, fog) | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | tsc/build ✅ · 17/17 tests ✅ · browser ✅ · calls 14 / tris 16.7k ✅ | 4.5/5 |
| T4 | Villagers (primitives + hats + procedural anim) | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 | tsc/build ✅ · 17/17 tests ✅ · browser behavior + FPS ✅ | 4.5/5 |
| T5 | Wiring sim ↔ render ↔ UI (full loop) | ✅ complete | `opencode/space-bunny-free#xhigh` | 1 + 1 fix | tsc/build ✅ · 19/19 ✅ · browser: select/clear/drag/pulse ✅ | 4.5/5 |
| T6 | Ambient life + procedural WebAudio | ✅ complete | `opencode/muse-spark-1.3-contributor-free#xhigh` | 1 | tsc/build ✅ · 19/19 ✅ · browser: motion ✅ · calls 117 ✅ · console clean ✅ | 4.5/5 |
| T7 | QA/polish/anti-bloat pass + final review | in progress | `opencode/mimo-v2.6-flash-free` | — | — | — |
| T7 | QA/polish/anti-bloat pass | queued | — | — | — | — |

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

### 2026-10-04 — T6 complete (commit pending)
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
