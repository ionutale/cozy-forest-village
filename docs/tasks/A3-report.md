# A3 — Audio polish: wind gusts + cook-streak blips

Status: **DONE**. Both features implemented in `src/audio/index.ts`; `tsc`, `build` and `test` all
green (62/62). Changes left uncommitted.

Task: batch-3 polish wave, extending the B9 review (proposals **13 — wind gusts** and
**14 — cook blips that climb with a streak**). References read first: `DESIGN.md` §2 (feel pillars,
esp. *"Motion is gentle: everything eases; no snappy or jerky animation"* and *"Ambient life is
sparing… nothing loud or aggro"*), §3.2 (binding numbers), and the B9 review's audio findings.

## Files

| File | Lines | Change |
|---|---|---|
| `src/audio/index.ts` | 382 (was 339, +43) | **wind gusts** on the existing bed gain · **cook-streak pitch climb** on the existing two-note `mealBlip` |
| `docs/tasks/A3-report.md` | this file | report |

No other source file touched. No new deps, no `any`, no `Math.random` (all randomness goes through
the module's `mulberry32`), procedural only — zero assets. No commit, no subagents, no
`pnpm dev`, no chrome-devtools (the orchestrator owns the browser; audio was never force-started).

---

## 1. Wind gusts (B9 #13)

The bed already had a 0.08 Hz sine LFO (±0.18) summed **on top of** `windGain.gain` (base 0.5).
The gust adds a slow random-walk multiplier on that base — **no new voice, no new node beyond
reusing the one `GainNode`**:

```ts
// state (initAudio scope)
const gustRnd = mulberry32(1804);          // own stream — see note below
const WIND_BASE_GAIN = 0.5;
const GUST_MIN = 0.6, GUST_MAX = 1.4;
const GUST_TAU_S = 0.8;                    // setTargetAtTime τ → ~95 % settled in ~2.4 s
let gustFactor = 1, gustInMs = 4000 + gustRnd() * 8000, gustElapsedMs = 0;

// in update(), after the crackle block, same dtMs-accumulation idiom as chirp/crackle
gustElapsedMs += dtMs;
if (gustElapsedMs >= gustInMs) {
  gustElapsedMs = 0;
  gustInMs = 4000 + gustRnd() * 8000;                      // next re-target in 4–12 s
  let next = gustFactor + (gustRnd() * 0.9 - 0.45);        // ±0.45 step
  if (next < GUST_MIN) next = GUST_MIN + (GUST_MIN - next); // reflect, not clamp —
  if (next > GUST_MAX) next = GUST_MAX - (next - GUST_MAX); // never sticks at a bound
  gustFactor = Math.min(GUST_MAX, Math.max(GUST_MIN, next));
  windGain.gain.setTargetAtTime(WIND_BASE_GAIN * gustFactor, ctx.currentTime, GUST_TAU_S);
}
```

Numbers, checked against the brief:

| Requirement | Value used |
|---|---|
| factor range | `[0.6, 1.4]`, enforced after a reflecting step (single ±0.45 step can't overshoot twice over a 0.8-wide range) |
| re-target period | `4000 + rnd()*8000` ms → **4–12 s**, re-rolled after every step |
| ramp | `setTargetAtTime(…, τ = 0.8 s)` → ~63 % in 0.8 s, ~95 % in **2.4 s** (inside the 2–3 s ask), exponential ease-in-out — no step |
| PRNG | `mulberry32(1804)` only |

Resulting instantaneous bed level: base ∈ [0.30, 0.70] with the ±0.18 LFO still summed →
**0.12 … 0.88** of the original path, multiplied by the 0.12 master gain. Never clips, never
silent, never a sudden jump — it breathes rather than drones (B9 #13's actual ask).

**Why its own PRNG stream.** The main `rnd` stream drives chirp timing, crackle timing and every
±8 % jitter. Pulling two draws from it for the gust would have shifted *every* subsequent ambient
schedule relative to pre-A3. Giving the gusts `mulberry32(1804)` keeps the existing sequence
**byte-identical**, so A3 changes nothing audible except what it adds.

`buildBed` now names the node `bedGain` and publishes it to the closure (`windGain = bedGain`); the
LFO/`lowpass`/pad wiring is otherwise untouched.

## 2. Cook-streak blips (B9 #14)

State: `lastMealAtS = -Infinity`, `mealStreak = 0`, window **12 s**, cap **+4 semitones**.

```ts
function advanceMealStreak(nowS: number): number {
  const gap = nowS - lastMealAtS;
  lastMealAtS = nowS;
  mealStreak = gap <= MEAL_STREAK_WINDOW_S ? Math.min(mealStreak + 1, MEAL_STREAK_CAP) : 0;
  return mealStreak;
}
// playSfx:  case 'meal-cooked': mealBlip(advanceMealStreak(now)); break;
function mealBlip(semitones: number): void {
  const k = Math.pow(2, semitones / 12);          // 0 → 1, +4 → 1.2599
  voice(at,        520 * k, 520 * k, 0.20, 0.07, -0.15, 'sine');
  voice(at + 0.13, 660 * k, 660 * k, 0.22, 0.06,  0.15, 'sine');
}
```

- First meal of a run → `gap = Infinity > 12` → streak 0 → **base pitch 520 / 660 Hz** (unchanged
  sound). Every further meal inside 12 s of the previous blip → +1 semitone on **both** notes
  (they move together, so the interval stays a clean major third). Cap at +4 → 655 / 831 Hz —
  clearly higher, still a warm sine, not a whistle (§2.3: nothing loud or aggro).
- A gap **> 12 s** resets to 0 on the next meal — the phrase steps back to the base note rather
  than easing down (the brief specified a reset; B9 #14's "ease back down" was the looser wording).
- The streak advances **only when a blip actually sounds**, i.e. after the existing 400 ms
  per-type cooldown gate in `playSfx`. Two cooks landing in the same 400 ms window therefore count
  as one step — the pitch never races ahead of what the player hears.

**Preserved exactly:** the per-batch priority pick (`built 6 > meal-cooked 5 > rest-done 4 > eat 3 >
fuel-add 2 > gather 1 > chop 0`), all per-type 400 ms cooldowns, `lastSfx` initial values, and
everything downstream of `pick`.

## 3. Behaviour that must not move (verified line-by-line)

- **Lazy start**: still only `pointerdown`/`keydown` on `window`; both listeners still removed on
  success and on `dispose`. `update()` still no-ops until `started && ctx && master &&
  ctx.state === 'running'` — the gust block sits *after* that guard, so nothing schedules before
  or after the context exists. `init` failure still swallowed (`windGain = null` added to the
  existing catch so a failed retry can't leave a stale node).
- **Throttle**: `crackleInMs = (1000 / rate) * (0.5 + rnd())`, `chirpInMs = base + rnd()*base*2`
  unchanged; new timers (`gustInMs`) are additive state only.
- **`__cozyAudio` hook**: `{ state, started }` installed at the same place, `delete
  window.__cozyAudio` in `dispose` unchanged.
- **`dispose()`**: unchanged apart from `windGain = null` alongside `ctx`/`master`. All oscillators
  and per-grain nodes still self-disconnect in `onended`; the gust only ever touches one existing
  `AudioParam`, so it leaks nothing.

## 4. Verification

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | **exit 0** (strict, `noUncheckedIndexedAccess`, `noUnusedLocals`) |
| `pnpm build` (`tsc --noEmit && vite build`) | **exit 0** — 24 modules, `dist/assets/index-*.js` 620.66 kB / 158.93 kB gzip. Pre-existing >500 kB chunk-size warning only (three.js, not this change). `dist/` was rewritten as a normal build artifact. |
| `pnpm test` | **6 files / 62 tests passed** (199 ms) — the expected 62/62, no failures anywhere in the tree (nothing outside my scope broke either) |
| `grep 'Math.random\|: any\|as any' src/audio/index.ts` | only the header comment "no Math.random anywhere" — no matches in code |

Not run, deliberately: `pnpm dev`, any browser automation, any audible proof. Per the task, sound
quality is a human call.

## 5. Concerns / for the orchestrator

1. **Audible quality unverified by ear.** Suggested listening pass: (a) 30–60 s of idle wind — the
   bed should swell and settle over ~2.4 s every 4–12 s with no audible zipper (if you *do* hear
   stepping, the fix is `linearRampToValueAtTime` over 2.5 s instead of `setTargetAtTime`);
   (b) hold the cook loop through 5+ meals — expect a rising 523→554→587→622→655 Hz phrase, then
   the base note again after 12 s idle. The peak (+4) should read as "a cooking run", not as an
   alarm.
2. **No automated test for either feature.** The audio module has no test file today (6 test files
   cover sim + persist only) and `src/audio/*` was the only source file in my allow-list, so I
   could not add one without creating a new file. Behaviour above is argued from code, not asserted.
3. **Streak clock is `ctx.currentTime`** (the audio clock, frozen while the context is suspended).
   A tab suspended mid-streak and resumed later can carry the streak across a wall-clock gap —
   audible effect is at worst one extra step, and it self-corrects on the next 12 s gap.
4. **Gust pacing uses accumulated `dtMs`** (same idiom as chirp/crackle), so a long frame delays the
   next re-target slightly; the ramp itself is scheduled on the audio clock and is unaffected.
5. **`dist/` was regenerated** by running the requested `pnpm build`. Expected artifact; flagging it
   because other agents are working in this tree concurrently.
6. B9 #13 asked for "0.02–0.05 Hz" — a 4–12 s re-target with a 2.4 s settle sits above that band as
   a *random walk* rather than a periodic LFO, which is what the A3 brief specified (walk factors,
   4–12 s re-targets). If the orchestrator wants the slower 0.02–0.05 Hz drone instead, the change
   is one line (`gustInMs = 20000 + gustRnd() * 30000`).
