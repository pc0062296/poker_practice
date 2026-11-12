/**
 * Hand evaluator for 5 to 7 cards.
 *
 * Returns an integer score where a higher score is a better hand:
 *   score = (category << 20) | kickers
 * Kickers are packed as 4-bit rank nibbles, most significant first.
 */

export const HIGH_CARD = 0;
export const PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;

/** Highest straight top rank for a 13-bit rank mask, or -1 when there is none. */
export const STRAIGHT_HIGH = new Int8Array(8192);
/** Number of set bits for a 13-bit rank mask. */
export const BIT_COUNT = new Uint8Array(8192);

const WHEEL_MASK = 0x100f; // A, 2, 3, 4, 5

for (let m = 0; m < 8192; m++) {
  let n = 0;
  for (let b = 0; b < 13; b++) if (m & (1 << b)) n++;
  BIT_COUNT[m] = n;
  let high = -1;
  for (let h = 12; h >= 4; h--) {
    const window = 0x1f << (h - 4);
    if ((m & window) === window) {
      high = h;
      break;
    }
  }
  if (high < 0 && (m & WHEEL_MASK) === WHEEL_MASK) high = 3;
  STRAIGHT_HIGH[m] = high;
}

function highBit(mask: number): number {
  return 31 - Math.clz32(mask);
}

/** Pack the top `n` ranks of a mask into 4-bit nibbles. */
function packTop(mask: number, n: number): number {
  let result = 0;
  for (let i = 0; i < n; i++) {
    const r = 31 - Math.clz32(mask);
    result = (result << 4) | r;
    mask &= ~(1 << r);
  }
  return result;
}

/** Evaluate the best 5-card hand among `n` cards (5 <= n <= 7). */
export function evaluate(cards: ArrayLike<number>, n: number = cards.length): number {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  // m1: ranks seen at least once, m2: at least twice, m3: at least three times, m4: four times
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i]!;
    const bit = 1 << (c >> 2);
    switch (c & 3) {
      case 0:
        s0 |= bit;
        break;
      case 1:
        s1 |= bit;
        break;
      case 2:
        s2 |= bit;
        break;
      default:
        s3 |= bit;
    }
    if (m1 & bit) {
      if (m2 & bit) {
        if (m3 & bit) m4 |= bit;
        else m3 |= bit;
      } else m2 |= bit;
    } else m1 |= bit;
  }

  // With at most 7 cards a flush excludes quads and full houses.
  let fm = 0;
  if (BIT_COUNT[s0]! >= 5) fm = s0;
  else if (BIT_COUNT[s1]! >= 5) fm = s1;
  else if (BIT_COUNT[s2]! >= 5) fm = s2;
  else if (BIT_COUNT[s3]! >= 5) fm = s3;
  if (fm) {
    const sh = STRAIGHT_HIGH[fm]!;
    if (sh >= 0) return (STRAIGHT_FLUSH << 20) | sh;
    return (FLUSH << 20) | packTop(fm, 5);
  }

  if (m4) {
    const q = highBit(m4);
    const k = highBit(m1 & ~(1 << q));
    return (QUADS << 20) | (q << 4) | k;
  }
  if (m3) {
    const t = highBit(m3);
    const rest = m2 & ~(1 << t);
    if (rest) return (FULL_HOUSE << 20) | (t << 4) | highBit(rest);
  }
  const sh = STRAIGHT_HIGH[m1]!;
  if (sh >= 0) return (STRAIGHT << 20) | sh;
  if (m3) {
    const t = highBit(m3);
    return (TRIPS << 20) | (t << 8) | packTop(m1 & ~(1 << t), 2);
  }
  if (m2) {
    const p1 = highBit(m2);
    const rest = m2 & ~(1 << p1);
    if (rest) {
      const p2 = highBit(rest);
      const k = highBit(m1 & ~(1 << p1) & ~(1 << p2));
      return (TWO_PAIR << 20) | (p1 << 8) | (p2 << 4) | k;
    }
    return (PAIR << 20) | (p1 << 12) | packTop(m1 & ~(1 << p1), 3);
  }
  return packTop(m1, 5);
}

export function categoryOf(score: number): number {
  return score >> 20;
}

export interface HandDescription {
  category: number;
  /** Ranks that define the hand, most significant first (0 = deuce ... 12 = ace). */
  ranks: number[];
}

/** Decode a score into its category and defining ranks. */
export function describeScore(score: number): HandDescription {
  const category = score >> 20;
  const k = score & 0xfffff;
  const nibble = (i: number) => (k >> (4 * i)) & 0xf;
  switch (category) {
    case STRAIGHT_FLUSH:
    case STRAIGHT:
      return { category, ranks: [k] };
    case QUADS:
    case FULL_HOUSE:
      return { category, ranks: [nibble(1), nibble(0)] };
    case FLUSH:
    case HIGH_CARD:
      return { category, ranks: [nibble(4), nibble(3), nibble(2), nibble(1), nibble(0)] };
    case TRIPS:
      return { category, ranks: [nibble(2), nibble(1), nibble(0)] };
    case TWO_PAIR:
      return { category, ranks: [nibble(2), nibble(1), nibble(0)] };
    default:
      return { category, ranks: [nibble(3), nibble(2), nibble(1), nibble(0)] };
  }
}

/** Find the 5 cards that make the best hand (used to highlight winners). */
export function bestFive(cards: readonly number[]): number[] {
  const n = cards.length;
  if (n <= 5) return cards.slice();
  let best = -1;
  let bestCombo: number[] = [];
  const pick: number[] = [0, 0, 0, 0, 0];
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            pick[0] = cards[a]!;
            pick[1] = cards[b]!;
            pick[2] = cards[c]!;
            pick[3] = cards[d]!;
            pick[4] = cards[e]!;
            const s = evaluate(pick, 5);
            if (s > best) {
              best = s;
              bestCombo = pick.slice();
            }
          }
  return bestCombo;
}
