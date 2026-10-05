# F fix batch 2 — Report

Status: **DONE**. M1, M6 and M7 fixed exactly as scoped. No commit, no new deps, no `any`, no
browser, no files outside the allow-list.

## Files

| File | Change |
|---|---|
| `src/ui/derive.ts` | **M1** `firstFavorDoneVillagerId(events)`; **M6** `hintRecomputeDue(...)`; **M7** `favorLineFor` export dropped |
| `src/ui/index.ts` | pump now selects the first `favor-done` via the helper and decides recompute via `hintRecomputeDue` |
| `src/ui/derive.test.ts` | 7 new tests (M1: 3, M6: 4) |

## M1 — first `favor-done` in the batch wins

`src/ui/index.ts` no longer loops and lets the last `favor-done` overwrite `thanksName` /
`thanksUntil`. The selection is the pure `firstFavorDoneVillagerId` in `derive.ts`, which returns
the first `favor-done` carrying a `villagerId` (id-less events are skipped, as the old
`if (!done) continue` did). The pump then resolves it against `state.villagers` as before; all
other event consumers (hearts, audio) are untouched. Tested: two events in either array order →
first id; no event / other event types → null; id-less first event → next usable id.

## M6 — recompute decision extracted and edge-tested

```ts
export function hintRecomputeDue(
  now: number, hintDueAt: number,
  thanksBefore: string | null, thanksAfter: string | null,
): boolean {
  return thanksBefore !== thanksAfter || now >= hintDueAt;
}
```

The pump captures `thanksBefore` before advancing the window (open/extend via a `favor-done`,
close via `now >= thanksUntil`) and passes it with the post-state `thanksName`. This makes the
old edge-forced `hintDueAt = 0` writes explicit and testable: open edge → recompute now, close
edge → recompute now, same-frame swap → recompute now; otherwise the 10 s cadence is the only
trigger (false before due, true at due). The change-guard on `panelHint.textContent` is
unchanged, so the DOM is still written only when the line actually changes.

## M7 — dead public surface

`favorLineFor` is now module-private (`function`, not `export function`); its single caller
(`favorLine`) and behaviour are unchanged. Repo-wide grep confirms no external import.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 (see concern 1 for a transient failure) |
| `pnpm build` | exit 0 — 35 modules, `dist/` written |
| `pnpm test` | exit 0 — 9 files, **149/149**; `derive.test.ts` alone **56/56** (49 + my 7) |

## Concerns for the orchestrator

1. **Concurrent edit in `src/persist/index.ts` briefly broke `tsc`.** When I first ran the
   verification at 17:09–17:10, `tsc --noEmit` and `pnpm build` failed with three TS18046s
   (`progress.step` / `progress.progress` is `unknown`) in `isPlausibleFavors` — an M3-style
   range check added at 17:09:45 that had not yet been type-narrowed. The file is outside this
   batch's allow-list and not mine, so I waited; it was fixed by the other writer at 17:10:32 and
   both commands then passed. Final state verified green (`tsc`, `build`, `test`). If the
   orchestrator runs its own verification, re-run from the current tree.
2. **Suite count includes 3 tests from that concurrent persist fix.** Baseline 139 + my 7 = 146;
   the 149 total includes 3 tests added to `src/persist/index.test.ts` (mtime 17:10:15) by the
   other writer. My additions are exactly the 7 in `src/ui/derive.test.ts`.
3. **No browser pass was possible in this batch** (no-browser rule). The helpers are pure and the
   pump wiring is covered by type-check + the existing tests; the live cadence behaviour itself
   was not re-observed.
