// Deterministic PRNG (DESIGN.md §3.1: no Math.random, no clocks inside sim/).
// mulberry32: fast, seedable, good enough for world scatter and spawn jitter.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 0..1 hash from an index + salt — no RNG state, no wall-clock. The same formula
 * the render layers already use for their scattering (e.g. `render/villagers/rig.ts`), exposed
 * here so sim-side deterministic jitter (batch 8's warm-seat radius) needs no RNG stream.
 */
export function hash01(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
