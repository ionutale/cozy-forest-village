# G3 — UI: requester-heart completion pulse

Status: **DONE** for the scoped change. All three gates pass on the final snapshot:
`pnpm exec tsc --noEmit` clean, `pnpm build` exit 0, `pnpm test` **10 files / 180 passed**
(the 149 baseline is green; the extra count is the concurrent batch-5 tests that landed).

## Files

| File | Change |
|---|---|
| `src/ui/cards.ts` | `CardParts.heartPulseTimer`; `startHeartPulse` / `cancelHeartPulse`; heart transition now pulses on true→false and cancels on false→true |
| `src/ui/index.ts` | `dispose()` cancels any in-flight pulse before `cards.clear()` |
| `src/styles/ui.css` | `.favor-heart` inline-block + `[hidden]` guard; `.favor-heart.heart-pulse` animation; `@keyframes heart-pulse` |
| `docs/tasks/G3-heart-pulse-report.md` | this report |

No other files touched. No new deps, no `any`, no per-frame DOM writes.

## Change (per the task brief)

- **Pulse on the true→false edge.** When a favor completes, the heart no longer vanishes:
  `startHeartPulse` adds `.heart-pulse` and starts a 600 ms timer. The CSS runs
  `heart-pulse 300ms ease-in-out 2` — scale 1 → 1.3 → 1, twice — so the whole goodbye is
  ~600 ms inside the 6 s thanks window the completion already opens.
- **Hide when the pulse ends.** The timer removes the class and sets `heart.hidden = true`.
  Visibility therefore still changes exactly once per transition; an idle frame with no favor
  touches nothing (the existing `parts.favor` guard is untouched).
- **Reduced motion.** `startHeartPulse` checks `matchMedia('(prefers-reduced-motion: reduce)')`
  and hides immediately, skipping the class entirely — the stylesheet's global
  `animation: none !important` would have killed the animation without ever firing an end event,
  so the JS check is what makes "skip the pulse, hide immediately" exact.
- **Re-offer mid-pulse.** The false→true edge calls `cancelHeartPulse`: pending timer cleared,
  class removed, heart stays/reverts visible. A later completion starts a fresh pulse and the
  animation re-triggers because the class was removed in between.
- **CSS detail.** `.favor-heart { display: inline-block }` is required for `transform` to apply to
  a span; `.favor-heart[hidden] { display: none }` keeps the `hidden` attribute authoritative
  (an author `display` would otherwise beat the UA's `[hidden]` rule). Transform only, so nothing
  around the heart reflows.
- **Dispose.** Any pending timer is cancelled in `dispose()`, so no callback writes to a detached
  card after teardown.

## Evidence

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0, no output |
| `pnpm build` | exit 0 (only the pre-existing >500 kB chunk warning) |
| `pnpm test` | **10 files / 180 passed**, 0 failed |
| `dist/assets/index-*.css` | `.favor-heart.heart-pulse{animation:.3s ease-in-out 2 heart-pulse}` and the `heart-pulse` keyframes present in the production CSS |

Concurrent-wave note: project-wide `tsc` was transiently red while other batch-5 agents were
mid-edit (`src/render/index.ts`, then `src/ui/derive.ts`, then `src/ui/derive.test.ts`); each was
re-checked until the wave settled. No error ever appeared in a G3 file, and the final combined
run above is a single consistent green snapshot.

## Concerns

1. **Duration lives in two places by design:** `HEART_PULSE_MS = 600` in `cards.ts` and
   `300ms × 2` in `ui.css`. Both comments cross-reference each other; if the pulse length is ever
   tuned, both must change. The JS timer is the source of truth for the hide.
2. **Visual feel is the orchestrator's browser pass** (no browser here): `scale(1.3)` on a 12 px
   heart and the `inline-block` baseline shift are intentionally small; if the heart reads too
   subtle or the name nudges a pixel on first pulse, the keyframe percentage / display choice are
   the levers.
3. **Background-tab throttling:** if the window is hidden, the timer may fire late, leaving the
   heart visible at rest until it does. Irrelevant in the intended moment (the player is looking
   at the thanks window), noted for completeness.
