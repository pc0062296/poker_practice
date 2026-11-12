/** Random number source used by the engine. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
}

/** Cryptographically strong generator for real play (unbiased via rejection sampling). */
export function cryptoRng(): Rng {
  const buf = new Uint32Array(64);
  let pos = buf.length;
  const nextU32 = (): number => {
    if (pos >= buf.length) {
      globalThis.crypto.getRandomValues(buf);
      pos = 0;
    }
    return buf[pos++]!;
  };
  return {
    next: () => nextU32() / 4294967296,
    int: (n: number) => {
      if (n <= 0 || !Number.isInteger(n)) throw new Error(`Bad range: ${n}`);
      const limit = 4294967296 - (4294967296 % n);
      let x = nextU32();
      while (x >= limit) x = nextU32();
      return x % n;
    },
  };
}

/** Deterministic generator (sfc32) for tests and reproducible simulations. */
export function seededRng(seed: number): Rng {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = (seed >>> 0) ^ 0xdeadbeef;
  const nextU32 = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 16; i++) nextU32();
  return {
    next: () => nextU32() / 4294967296,
    int: (n: number) => {
      if (n <= 0 || !Number.isInteger(n)) throw new Error(`Bad range: ${n}`);
      const limit = 4294967296 - (4294967296 % n);
      let x = nextU32();
      while (x >= limit) x = nextU32();
      return x % n;
    },
  };
}

/** In-place Fisher-Yates shuffle. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}
