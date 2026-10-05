# Task F3 — Favor UI: hint priority, card heart, popover line

Plan: `docs/superpowers/plans/2026-10-05-villager-favors.md` → Task F3 · Spec: `…-favors-design.md` Part 3.
Status: implemented, full gate green. Nothing committed (orchestrator commits).

## Files

| File | Change |
|---|---|
| `src/ui/derive.ts` | `THANK_YOU_MS = 6000`; `favorText` (UI-owned copy), `favorProgressText` (`(3/6)` / `(1:12/2:00)`), `favorWantFor` (chain-content mirror), `favorLine` (first active by villager id), `favorLineFor`, `favorPopoverLine`; `villageLine(state, thanks)` with the `embers > favor > dimming > …` insert. |
| `src/ui/markup.ts` | `HEART_ICON` (inline SVG); `.favor-line` `<p>` above `.task-grid` (reserved two lines, `visibility`-toggled); `favorLine` ref added to `UiRefs`/`bindRefs`. |
| `src/ui/cards.ts` | Heart span inside `.villager-name` (keeps the card's 3-column grid intact); `CardParts.favor`; transition-only `heart.hidden` toggle next to the existing well-fed guard. |
| `src/ui/index.ts` | Pump: popover `Favor:` line for the selected villager (guarded writes); `favor-done` opens/closes the 6 s `thanksName` window; `villageLine(state, thanksName)`. |
| `src/ui/derive.test.ts` | All 25 existing tests adapted to the two-arg signature; +24 new favor tests → **49**. |
| `docs/tasks/F3-favor-ui-report.md` | This report. |

No deps, no `any`, no `Math.random`/clocks inside `src/sim` (untouched), no git, no files outside the allow-list.

## Decisions worth reviewing

1. **Chain-content mirror in the UI (no sim internals imported).** DESIGN §3's public surface exposes the
   `FavorWant`/`FavorProgress` **types** plus `createFavors` and the four constants — not `favorWantFor` —
   yet the UI must name what an active favor wants. So `derive.ts` restates the binding DESIGN §3.2 table
   (same precedent as the already-mirrored `FUEL_STEADY`), clearly commented. **Alignment checked against
   F1's landed `src/sim/favors.ts`:** the sim uses a 0-based step (`favorWantFor(i, progress.step)` while
   active); the UI mirror is 1-based and calls `favorWantFor(i, progress.step + 1)`. Both resolve
   0→eat/self, 1→gather/chop, 2→eat-any/build/fire, ≥3→null, so rendered lines match for every state the
   sim can produce. A pinning test drives all variants from the `state.favors` shape.
2. **Thanks window and the 10 s hint cadence.** `villageLine` is unchanged in cadence, but the pump makes
   the hint due at the *open and close edges* of the 6 s window (`hintDueAt = 0`). Without that, a
   `favor-done` landing just after a recompute would never show "delighted!" before the window expired.
   No new cadence, no per-frame recompute. Two events in one tick: the last resolvable name wins; thanks
   replaces the would-love line, never both (test-pinned).
3. **Reserved popover line.** `.favor-line` is `visibility:hidden` (not `hidden`/`display:none`) with
   `min-height:2.4em`, mirroring `.panel-hint`'s two-line reservation — the fire flavor wraps, so this
   guarantees no layout jump. Heart uses the `hidden` attribute (display toggles) inside the name span.
4. **Inline styles only.** `src/styles/ui.css` is outside this task's file list, so all new styling is an
   inline `style` on the two new elements. If the orchestrator prefers CSS rules, they can be lifted into
   `.favor-line` / `.favor-heart` later without code changes (both carry stable classes).

## Commands + results

- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm build` → exit 0 (`✓ built in ~360 ms`; only the pre-existing >500 kB chunk warning).
- `pnpm test` → 9 files, **139/139 pass**. `src/ui/derive.test.ts`: 49 (25 adapted + 24 new).
  Note: my first full run, before F1/F2 landed, showed 91 pass + 7 F2-red failures in
  `src/persist/**` — outside my scope, and green by the final gate once F2 landed.

## Review Focus 5 (hint stability) coverage

Pure-function tests pin: two active favors → first by villager id, not array order; thanks replaces the
favor line; after the window, the remaining active favor's line returns (`villageLine(s, 'V7')` →
delight, then `villageLine(s, null)` → the other's would-love). The change-guard still guarantees the DOM
is written only on real line changes.

## Remaining (orchestrator)

- Live browser pass (not run here per instructions): offer → hint/card heart/popover line; complete →
  "delighted!" for ~6 s, heart clears; reload mid-favor; v1-save boot.
- If the wave review prefers importing a future public `favorWantFor` over the UI mirror, that is a
  one-function swap in `derive.ts` (tests unchanged except the mirror-specific block).

## Micro-round — M6 interface drift closed

The wave review (F3 report, decision 1 above) flagged the chain-content mirror. `favorWantFor` is
now re-exported from `src/sim/index.ts` in the same public block as `createFavors` and the four
constants; `src/ui/derive.ts` imports it and the local mirror is deleted. `activeFavor` now calls
it with the sim's 0-based `progress.step` (the old mirror took `step + 1`); `favorText` /
`favorProgressText` stay UI-local display copy. The `derive.test.ts` mirror block now asserts
against the imported function with the 0-based contract, same coverage (8 content + 3 null
assertions); the old `(-1, …)` null assertion went with the mirror's input guard, which was never
the sim function's contract (the UI indexes `state.favors.byVillager`, so it cannot feed a
negative index). Supersedes decision 1's mirror rationale and the `favorWantFor` row above.

Gate: `tsc --noEmit` 0, `pnpm build` 0, `pnpm test` 139/139 (no count change). DESIGN.md's contract
list is the orchestrator's to update.
