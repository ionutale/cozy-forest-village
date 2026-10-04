// Procedural WebAudio: wind bed + warm pad, sparse chirps, sim-event SFX. Zero assets, no UI.
// Lazy: the AudioContext is created on the first real pointerdown/keydown; update() is a
// no-op before that, and init failure is swallowed silently.

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
  let started = false;
  let disposed = false;
  const rnd = mulberry32(20261006);
  let chirpInMs = 5000 + rnd() * 4000; // first chirp 5–9 s after start
  let chirpElapsedMs = 0;

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
    const windGain = context.createGain();
    windGain.gain.value = 0.5;
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoAmt = context.createGain();
    lfoAmt.gain.value = 0.18;
    lfo.connect(lfoAmt);
    lfoAmt.connect(windGain.gain);
    noise.connect(lowpass);
    lowpass.connect(windGain);
    windGain.connect(out);
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
    voice(ctx.currentTime + 0.01, 170, 85, 0.16, 0.14, 0, 'triangle'); // muffled wood knock
  }

  function pluck(): void {
    if (!ctx) return;
    voice(ctx.currentTime + 0.01, 520, 780, 0.22, 0.08, rnd() * 0.6 - 0.3, 'sine'); // soft upward pluck
  }

  function chime(): void {
    if (!ctx) return;
    const at = ctx.currentTime + 0.01;
    voice(at, 660, 660, 0.5, 0.06, -0.2, 'sine'); // quiet two-note chime
    voice(at + 0.18, 880, 880, 0.55, 0.05, 0.2, 'sine');
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
      ctx = context;
      master = out;
      started = true;
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      void context.resume();
    } catch {
      ctx = null;
      master = null;
    }
  }

  window.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
  window.__cozyAudio = { state: () => ctx?.state ?? 'none', started: () => started };

  return {
    update(state: GameState, dtMs: number): void {
      if (!started || !ctx || !master || ctx.state !== 'running') return;
      chirpElapsedMs += dtMs;
      if (chirpElapsedMs >= chirpInMs) {
        chirpElapsedMs = 0;
        chirpInMs = 4000 + rnd() * 8000;
        chirp();
      }
      for (const ev of state.events) {
        if (ev.type === 'chop') knock();
        else if (ev.type === 'gather') pluck();
        else if (ev.type === 'rest-done') chime();
      }
    },
    dispose(): void {
      disposed = true;
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      if (ctx) ctx.close().catch(() => undefined);
      ctx = null;
      master = null;
    },
  };
}
