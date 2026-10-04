# B3 Report — Persist: localStorage save / load / autosave (schema v1)

**Status: DONE**
**Model:** longcat-2.5-preview-free
**Date:** 2026-10-04

## What was implemented

All deliverables from `docs/tasks/B3.md`, per the binding contract in `DESIGN.md` §3.

### `src/persist/index.ts` (new)
- `STORAGE_KEY = 'cozy-forest-village.save'`, `VERSION = 1` (both exported for tests).
- `loadGame(storage = localStorage): GameState | null` — parses `{version, state}`; accepts only
  `version === 1` with a plausible shape (`villagers` / `nodes` / `structures` arrays, `fire` / `pot`
  objects). Any failure (missing, bad JSON, wrong version, wrong shape) → `null`. Never throws.
- `saveGame(state, storage = localStorage): void` — writes `{version, state}`; swallows quota /
  serialization errors.
- `clearSave(storage = localStorage): void`.
- `startAutosave(getState, storage = localStorage): () => void` — every **3000 ms**, saves only when
  `state.tick` changed since the last save; returns a stop function.
- JSON only — the `GameState` is plain data (no Maps / class instances), guaranteed by DESIGN §3.

### `src/persist/index.test.ts` (new)
- In-memory `Storage` fake matching the DOM `Storage` interface.
- Round-trip deep-equal; wrong version → null; corrupt JSON → null; missing arrays → null;
  non-object `fire` → null; `clearSave` empties; autosave writes once per tick change and not twice
  without change (vitest fake timers).

### `src/main.ts` wiring
- `const state = loadGame() ?? createInitialState();` — load on boot, fresh boot when absent/corrupt.
- `const stopAutosave = startAutosave(() => state);` — autosave started.
- On `pagehide`: `stopAutosave()` then `saveGame(state)` **before** disposing the layers. Everything
  else in `main.ts` is unchanged.

## Files changed

| File | Change |
|---|---|
| `src/persist/index.ts` | **new** — load / save / clearSave / autosave |
| `src/persist/index.test.ts` | **new** — 8 B3 tests |
| `src/main.ts` | load on boot, autosave, save on pagehide |

## Verification

- `pnpm exec tsc --noEmit` — **green**
- `pnpm build` — **green**
- `pnpm test` — **49 passed** (41 existing + 8 new B3)
- No `any`; persist files are 91 / 126 lines (well under ~220).
- `src/sim`, `src/render`, `src/ui`, `src/audio` were **not** modified.

## Concerns

- None. The persist module is fully defensive (never throws), the validation matches the spec exactly,
  and the autosave is tick-gated so an idle game does not rewrite storage. The orchestrator's browser
  checks (build → wait 4 s → reload persists; corrupted storage → clean fresh boot) are covered by
  the `loadGame` validation path.
