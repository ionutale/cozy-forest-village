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
| T3 | Forest environment (InstancedMesh, light, fog) | queued | — | — | — | — |
| T4 | Villagers (primitives + hats + procedural anim) | queued | — | — | — | — |
| T5 | Wiring sim ↔ render ↔ UI (full loop) | queued | — | — | — | — |
| T6 | Ambient life + procedural WebAudio | queued | — | — | — | — |
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

### 2026-10-04 — T2 complete (commit pending)
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
