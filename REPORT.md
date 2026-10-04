# Orchestration Report — Cozy Forest Village

Authority: `DESIGN.md`. Updated after every task. This is the ledger: task → model → attempts →
validation → evaluation. Recovery map: commits named here exist in git.

## Free model roster (from `opencode` model list, 2026-10-04)

| Model ID | Variants | Intended use |
|---|---|---|
| `opencode/space-bunny-free` | low…max | probe + complex/creative tasks |
| `opencode/fledge-alpha-free` | low…max | complex tasks (backup probe) |
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
| T1 | Scaffold + cozy UI shell + base scene | in progress | `opencode/space-bunny-free#xhigh` | — | — | — |
| T2 | Pure sim core (FSM, tasks, RNG) + vitest | queued | — | — | — | — |
| T3 | Forest environment (InstancedMesh, light, fog) | queued | — | — | — | — |
| T4 | Villagers (primitives + hats + procedural anim) | queued | — | — | — | — |
| T5 | Wiring sim ↔ render ↔ UI (full loop) | queued | — | — | — | — |
| T6 | Ambient life + procedural WebAudio | queued | — | — | — | — |
| T7 | QA/polish/anti-bloat pass | queued | — | — | — | — |

## Log

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
