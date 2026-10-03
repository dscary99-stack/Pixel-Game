/**
 * Deterministic PRNG (sfc32) with a serializable state.
 * The server owns the state; it is never sent to the client (chapter 11 §2).
 * Same seed + same commands => same results, so a retry replays rather than re-rolls.
 */

export type RngState = readonly [number, number, number, number];

export function seedRng(seed: string): RngState {
  // cyrb128 string hash -> four 32-bit words.
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Mutable cursor over an RngState. Call `state()` to persist. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
  }

  state(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [0, n). */
  nextInt(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`nextInt: bad bound ${n}`);
    return Math.floor(this.nextFloat() * n);
  }

  /** True with probability p (0–1). */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.nextFloat() < p;
  }

  /** True with probability bp / 10000 (basis points). */
  chanceBp(bp: number): boolean {
    return this.nextInt(10000) < bp;
  }

  /** Index chosen by integer weights. */
  pickWeighted(weights: readonly number[]): number {
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) throw new Error("pickWeighted: no weight");
    let r = this.nextInt(total);
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}
