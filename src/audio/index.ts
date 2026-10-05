// Procedural WebAudio: wind bed + warm pad, fire crackle, sparse chirps, sim-event SFX.
// Zero assets, no UI. Lazy: the AudioContext is created on the first real pointerdown/keydown;
// update() is a no-op before that, and init failure is swallowed silently.

import type { GameState } from '../sim';

export interface AudioHandle {
  update(state: GameState, dtMs: number): void;
  dispose(): void;
}

declare global {
  interface Window {
    __cozyAudio?: { state: () => string; started: () => boolean };
  }
}

/** Tiny seeded PRNG local to this module — no Math.random anywhere. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initAudio(): AudioHandle {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let crackleBuf: AudioBuffer | null = null; // one shared noise buffer for crackle + munch
  let started = false;
  let disposed = false;
  const rnd = mulberry32(20261006);
  let chirpInMs = 5000 + rnd() * 4000; // first chirp 5–9 s after start
  let chirpElapsedMs = 0;
  let crackleInMs = 300; // first grain lands soon after start
  let crackleElapsedMs = 0;
  // A3 — wind gusts: a seeded random walk on the bed's own gain (never a new voice).
  // Own PRNG stream so the pre-existing chirp/crackle/jitter sequence stays byte-identical.
  const gustRnd = mulberry32(1804);
  const WIND_BASE_GAIN = 0.5;
  const GUST_MIN = 0.6;
  const GUST_MAX = 1.4;
  const GUST_TAU_S = 0.8; // setTargetAtTime time constant → ~95 % settled in ~2.4 s
  let windGain: GainNode | null = null;
  let gustFactor = 1;
  let gustInMs = 4000 + gustRnd() * 8000; // first gust shift 4–12 s after start
  let gustElapsedMs = 0;
  // A3 — cook streak: consecutive meals within the window climb +1 semitone each (cap +4).
  const MEAL_STREAK_WINDOW_S = 12;
  const MEAL_STREAK_CAP = 4;
  let lastMealAtS = Number.NEGATIVE_INFINITY;
  let mealStreak = 0;
  const lastSfx: Record<string, number> = {
    chop: -10, gather: -10, 'rest-done': -10,
    'fuel-add': -10, 'meal-cooked': -10, eat: -10, built: -10, garden: -10,
  };

  type SfxKind = 'chop' | 'gather' | 'rest-done' | 'fuel-add' | 'meal-cooked' | 'eat' | 'built' | 'garden';

  /** One enveloped oscillator voice with optional pitch glide and random-safe pan. */
  function voice(at: number, from: number, to: number, dur: number, peak: number, pan: number, type: OscillatorType): void {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(from, 1), at);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), at + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    let tail: AudioNode = g;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      tail = p;
    }
    tail.connect(master);
    osc.onended = () => {
      try {
        osc.disconnect();
        g.disconnect();
        if (tail !== g) tail.disconnect();
      } catch {
        // Already torn down — nothing to release.
      }
    };
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  /** Wind bed (looped filtered noise, breathing LFO) + very quiet warm pad (two detuned sines). */
  function buildBed(context: AudioContext, out: GainNode): void {
    const noiseRnd = mulberry32(77);
    const len = context.sampleRate * 2;
    const buf = context.createBuffer(1, len, context.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = noiseRnd() * 2 - 1;
    const noise = context.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 400;
    const bedGain = context.createGain();
    bedGain.gain.value = WIND_BASE_GAIN;
    windGain = bedGain; // A3: the gust walk modulates this base (the 0.08 Hz LFO stays summed on top)
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoAmt = context.createGain();
    lfoAmt.gain.value = 0.18;
    lfo.connect(lfoAmt);
    lfoAmt.connect(bedGain.gain);
    noise.connect(lowpass);
    lowpass.connect(bedGain);
    bedGain.connect(out);
    noise.start();
    lfo.start();
    const padGain = context.createGain();
    padGain.gain.value = 0.015;
    for (const freq of [196, 197.4]) {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(padGain);
      osc.start();
    }
    padGain.connect(out);
  }

  /** A short cluster of 3–5 sine blips (1.5–3.8 kHz, 60–120 ms, fast decay, random pan). */
  function chirp(): void {
    if (!ctx) return;
    const n = 3 + Math.floor(rnd() * 3);
    let at = ctx.currentTime + 0.05;
    for (let i = 0; i < n; i += 1) {
      const freq = 1500 + rnd() * 2300;
      voice(at, freq, freq, 0.06 + rnd() * 0.06, 0.05, rnd() * 2 - 1, 'sine');
      at += 0.1 + rnd() * 0.09;
    }
  }

  function knock(): void {
    if (!ctx) return;
    const v = 1 + (rnd() * 2 - 1) * 0.08; // ±8 % so stacked knocks never phase-align
    voice(ctx.currentTime + 0.01, 170 * v, 85 * v, 0.16, 0.14 * v, 0, 'triangle');
  }

  function pluck(): void {
    if (!ctx) return;
    const v = 1 + (rnd() * 2 - 1) * 0.08;
    voice(ctx.currentTime + 0.01, 520 * v, 780 * v, 0.22, 0.08, rnd() * 0.6 - 0.3, 'sine');
  }

  /** Garden yield: same sine-glide family as the bush gather, softer and +2 semitones up. */
  function gardenPluck(): void {
    if (!ctx) return;
    const v = 1 + (rnd() * 2 - 1) * 0.08;
    const k = Math.pow(2, 2 / 12); // +2 semitones over the bush gather
    voice(ctx.currentTime + 0.01, 520 * k * v, 780 * k * v, 0.2, 0.05, rnd() * 0.6 - 0.3, 'sine');
  }

  /** At most one SFX per event batch; each type has its own ~400 ms cooldown. */
  function playSfx(kind: SfxKind, now: number): void {
    if (now - (lastSfx[kind] ?? -10) < 0.4) return;
    lastSfx[kind] = now;
    switch (kind) {
      case 'chop': knock(); break;
      case 'gather': pluck(); break;
      case 'garden': gardenPluck(); break;
      case 'rest-done': chime(); break;
      case 'fuel-add': thud(); break;
      case 'meal-cooked': mealBlip(advanceMealStreak(now)); break;
      case 'eat': munch(); break;
      case 'built': builtSfx(); break;
    }
  }

  /** A3: one step of the cook streak — a meal within 12 s of the last blip climbs the phrase. */
  function advanceMealStreak(nowS: number): number {
    const gap = nowS - lastMealAtS;
    lastMealAtS = nowS;
    mealStreak = gap <= MEAL_STREAK_WINDOW_S ? Math.min(mealStreak + 1, MEAL_STREAK_CAP) : 0;
    return mealStreak;
  }

  function chime(): void {
    if (!ctx) return;
    const at = ctx.currentTime + 0.01;
    voice(at, 660, 660, 0.5, 0.06, -0.2, 'sine'); // quiet two-note chime
    voice(at + 0.18, 880, 880, 0.55, 0.05, 0.2, 'sine');
  }

  function thud(): void {
    if (!ctx) return;
    voice(ctx.currentTime + 0.01, 180, 90, 0.15, 0.12, 0, 'triangle'); // soft low log thud
  }

  /** Two-note warm blip; `semitones` (0–4, cook streak) lifts both notes by the same ratio. */
  function mealBlip(semitones: number): void {
    if (!ctx) return;
    const k = Math.pow(2, semitones / 12);
    const at = ctx.currentTime + 0.01;
    voice(at, 520 * k, 520 * k, 0.2, 0.07, -0.15, 'sine'); // two-note warm blip
    voice(at + 0.13, 660 * k, 660 * k, 0.22, 0.06, 0.15, 'sine');
  }

  function munch(): void {
    if (!ctx || !master || !crackleBuf) return;
    const at = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = crackleBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.04, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    src.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.onended = () => {
      try {
        src.disconnect();
        lp.disconnect();
        g.disconnect();
      } catch {
        // Already torn down — nothing to release.
      }
    };
    src.start(at, rnd() * 0.8);
    src.stop(at + 0.12);
    voice(at, 300, 220, 0.1, 0.03, 0, 'sine'); // tiny sine body under the noise
  }

  function builtSfx(): void {
    if (!ctx) return;
    knock(); // wooden knock, with its ±8 % variation
    voice(ctx.currentTime + 0.13, 880, 880, 0.35, 0.05, 0.15, 'sine'); // small chime
  }

  /** One fire-crackle grain: short slice of the shared noise buffer through a bandpass
      with a fast-decay envelope. Nodes are per-grain (unavoidable) but light and released. */
  function crackleGrain(peak: number): void {
    if (!ctx || !master || !crackleBuf) return;
    const at = ctx.currentTime + 0.01;
    const dur = 0.02 + rnd() * 0.04; // 20–60 ms
    const src = ctx.createBufferSource();
    src.buffer = crackleBuf;
    src.playbackRate.value = 0.8 + rnd() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200 + rnd() * 3300;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * (0.7 + rnd() * 0.6), 0.0002), at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp);
    bp.connect(g);
    let tail: AudioNode = g;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = rnd() * 1.2 - 0.6;
      g.connect(p);
      tail = p;
    }
    tail.connect(master);
    src.onended = () => {
      try {
        src.disconnect();
        bp.disconnect();
        g.disconnect();
        if (tail !== g) tail.disconnect();
      } catch {
        // Already torn down — nothing to release.
      }
    };
    src.start(at, rnd() * 0.8);
    src.stop(at + dur + 0.05);
  }

  function start(): void {
    if (started || disposed) return;
    try {
      const Ctor = window.AudioContext;
      if (typeof Ctor !== 'function') return;
      const context = new Ctor();
      const out = context.createGain();
      out.gain.value = 0.12; // master: everything gentle
      out.connect(context.destination);
      buildBed(context, out);
      const clen = context.sampleRate; // 1 s of noise, shared by every crackle grain + munch
      const cbuf = context.createBuffer(1, clen, context.sampleRate);
      const cdata = cbuf.getChannelData(0);
      const crnd = mulberry32(913);
      for (let i = 0; i < clen; i += 1) cdata[i] = crnd() * 2 - 1;
      crackleBuf = cbuf;
      ctx = context;
      master = out;
      started = true;
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      void context.resume();
    } catch {
      ctx = null;
      master = null;
      windGain = null;
    }
  }

  window.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
  window.__cozyAudio = { state: () => ctx?.state ?? 'none', started: () => started };

  return {
    update(state: GameState, dtMs: number): void {
      if (!started || !ctx || !master || ctx.state !== 'running') return;
      const feederTuned = state.structures.some((s) => s.kind === 'feeder' && s.built);
      const chirpBase = feederTuned ? 2000 : 4000; // feeder halves the chirp interval
      chirpElapsedMs += dtMs;
      if (chirpElapsedMs >= chirpInMs) {
        chirpElapsedMs = 0;
        chirpInMs = chirpBase + rnd() * chirpBase * 2;
        chirp();
      }
      // Fire crackle (DESIGN §3.2 states): rate + gain follow fuel, jittered — never rhythmic.
      const fuel = state.fire.fuel;
      let rate: number;
      let peak: number;
      if (fuel >= 66) { rate = 3; peak = 0.08; } // roaring
      else if (fuel >= 33) { rate = 1.5; peak = 0.06; } // steady
      else if (fuel > 0) { rate = 0.5; peak = 0.05; } // dim
      else { rate = 0.1; peak = 0.04; } // embers
      crackleElapsedMs += dtMs;
      if (crackleElapsedMs >= crackleInMs) {
        crackleElapsedMs = 0;
        crackleInMs = (1000 / rate) * (0.5 + rnd());
        crackleGrain(peak);
      }
      // A3: wind gusts — a slow seeded random walk of the bed gain, re-targeted every 4–12 s and
      // eased with setTargetAtTime over ~2.4 s (DESIGN §2: everything eases, nothing snappy).
      if (windGain) {
        gustElapsedMs += dtMs;
        if (gustElapsedMs >= gustInMs) {
          gustElapsedMs = 0;
          gustInMs = 4000 + gustRnd() * 8000;
          let next = gustFactor + (gustRnd() * 0.9 - 0.45); // ±0.45 step, reflected at the bounds
          if (next < GUST_MIN) next = GUST_MIN + (GUST_MIN - next);
          if (next > GUST_MAX) next = GUST_MAX - (next - GUST_MAX);
          gustFactor = Math.min(GUST_MAX, Math.max(GUST_MIN, next));
          windGain.gain.setTargetAtTime(WIND_BASE_GAIN * gustFactor, ctx.currentTime, GUST_TAU_S);
        }
      }
      let pick: SfxKind | null = null;
      let best = -1;
      const consider = (kind: SfxKind, rank: number): void => {
        if (rank > best) { best = rank; pick = kind; }
      };
      for (const ev of state.events) {
        // Rarest first; garden sits just above the bush gather it resembles.
        // Existing relative order is unchanged — garden only slots in.
        switch (ev.type) {
          case 'built': consider('built', 7); break;
          case 'meal-cooked': consider('meal-cooked', 6); break;
          case 'rest-done': consider('rest-done', 5); break;
          case 'eat': consider('eat', 4); break;
          case 'fuel-add': consider('fuel-add', 3); break;
          case 'garden': consider('garden', 2); break;
          case 'gather': consider('gather', 1); break;
          case 'chop': consider('chop', 0); break;
          default: break; // 'arrived': silent
        }
      }
      if (pick !== null) playSfx(pick, ctx.currentTime);
    },
    dispose(): void {
      disposed = true;
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      if (ctx) ctx.close().catch(() => undefined);
      ctx = null;
      master = null;
      windGain = null;
      delete window.__cozyAudio;
    },
  };
}
