import { RANK_CHARS, SUIT_CHARS } from '../engine/cards';
import { CLASS_KINDS, CLASS_LABELS, classFromRanks, NUM_CLASSES } from '../eval/handClass';

/**
 * Range text format, compatible with the notation used by common poker tools:
 *
 *   AA            a single class            AKs  AKo  AK (suited and offsuit)
 *   TT+           pairs TT and better       ATs+ (ATs, AJs, AQs, AKs)
 *   QQ-99         a run of pairs            A5s-A2s (same high card)
 *   T9s-76s       a run of connectors with the same gap
 *   A5s:0.5       a weight between 0 and 1 (also accepts 50%)
 *   AhKh          a single combo (adds its share to the class weight)
 *
 * Tokens are separated by commas, semicolons or whitespace. A later token overrides an
 * earlier one for the same class, so "A2s+,AKs:0.5" works as expected.
 */

export interface ParsedRange {
  weights: Float32Array;
  errors: string[];
}

const TOKEN = /([^\s,;:]+)(?:\s*:\s*([0-9]*\.?[0-9]+%?))?/g;

function rankIndex(ch: string): number {
  return RANK_CHARS.indexOf(ch.toUpperCase());
}

interface ClassSpec {
  hi: number;
  lo: number;
  /** 's', 'o', or '' for both (ignored for pairs). */
  suit: string;
}

function parseSpec(text: string): ClassSpec | null {
  const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)$/i.exec(text);
  if (!m) return null;
  const a = rankIndex(m[1]!);
  const b = rankIndex(m[2]!);
  const suit = m[3]!.toLowerCase();
  if (a === b && suit) return null;
  return { hi: Math.max(a, b), lo: Math.min(a, b), suit };
}

function setSpec(weights: Float32Array, hi: number, lo: number, suit: string, w: number): void {
  if (hi === lo) {
    weights[classFromRanks(hi, lo, false)] = w;
    return;
  }
  if (suit !== 'o') weights[classFromRanks(hi, lo, true)] = w;
  if (suit !== 's') weights[classFromRanks(hi, lo, false)] = w;
}

function applyToken(body: string, w: number, weights: Float32Array): boolean {
  // Single combo, e.g. AhKh
  const combo = /^([2-9TJQKA])([cdhs])([2-9TJQKA])([cdhs])$/i.exec(body);
  if (combo) {
    const r1 = rankIndex(combo[1]!);
    const r2 = rankIndex(combo[3]!);
    const s1 = SUIT_CHARS.indexOf(combo[2]!.toLowerCase());
    const s2 = SUIT_CHARS.indexOf(combo[4]!.toLowerCase());
    if (r1 === r2 && s1 === s2) return false;
    const k = classFromRanks(r1, r2, s1 === s2);
    const share = CLASS_KINDS[k] === 'pair' ? 6 : CLASS_KINDS[k] === 'suited' ? 4 : 12;
    weights[k] = Math.min(1, weights[k]! + w / share);
    return true;
  }

  // Run, e.g. QQ-99, A5s-A2s, T9s-76s
  const dash = body.indexOf('-');
  if (dash > 0) {
    const from = parseSpec(body.slice(0, dash));
    const to = parseSpec(body.slice(dash + 1));
    if (!from || !to || from.suit !== to.suit) return false;
    const fromPair = from.hi === from.lo;
    const toPair = to.hi === to.lo;
    if (fromPair !== toPair) return false;
    if (fromPair) {
      const lo = Math.min(from.hi, to.hi);
      const hi = Math.max(from.hi, to.hi);
      for (let r = lo; r <= hi; r++) setSpec(weights, r, r, '', w);
      return true;
    }
    if (from.hi === to.hi) {
      const lo = Math.min(from.lo, to.lo);
      const hi = Math.max(from.lo, to.lo);
      for (let r = lo; r <= hi; r++) setSpec(weights, from.hi, r, from.suit, w);
      return true;
    }
    if (from.hi - from.lo === to.hi - to.lo) {
      const gap = from.hi - from.lo;
      const lo = Math.min(from.hi, to.hi);
      const hi = Math.max(from.hi, to.hi);
      for (let r = lo; r <= hi; r++) setSpec(weights, r, r - gap, from.suit, w);
      return true;
    }
    return false;
  }

  // Plus form, e.g. TT+, ATs+
  if (body.endsWith('+')) {
    const spec = parseSpec(body.slice(0, -1));
    if (!spec) return false;
    if (spec.hi === spec.lo) {
      for (let r = spec.hi; r <= 12; r++) setSpec(weights, r, r, '', w);
    } else {
      for (let r = spec.lo; r < spec.hi; r++) setSpec(weights, spec.hi, r, spec.suit, w);
    }
    return true;
  }

  const spec = parseSpec(body);
  if (!spec) return false;
  setSpec(weights, spec.hi, spec.lo, spec.suit, w);
  return true;
}

/** Parse range text, collecting problems instead of throwing. */
export function tryParseRange(text: string): ParsedRange {
  const weights = new Float32Array(NUM_CLASSES);
  const errors: string[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text)) !== null) {
    const body = m[1]!;
    let w = 1;
    if (m[2] !== undefined) {
      w = m[2].endsWith('%') ? Number(m[2].slice(0, -1)) / 100 : Number(m[2]);
      if (!Number.isFinite(w) || w < 0 || w > 1) {
        errors.push(`${body}:${m[2]}`);
        continue;
      }
    }
    if (!applyToken(body, w, weights)) errors.push(body);
  }
  return { weights, errors };
}

/** Parse range text; throws when any token is invalid. */
export function parseRange(text: string): Float32Array {
  const { weights, errors } = tryParseRange(text);
  if (errors.length > 0) throw new Error(`Bad range tokens: ${errors.join(', ')}`);
  return weights;
}

/** Write per-class weights as range text (one token per class, weights rounded to 2 decimals). */
export function formatRange(weights: ArrayLike<number>): string {
  const full: string[] = [];
  const partial: string[] = [];
  for (let k = 0; k < NUM_CLASSES; k++) {
    const w = Math.round(weights[k]! * 100) / 100;
    if (w <= 0) continue;
    if (w >= 1) full.push(CLASS_LABELS[k]!);
    else partial.push(`${CLASS_LABELS[k]}:${w}`);
  }
  return [...full, ...partial].join(',');
}

/** Fraction of all 1326 combos covered by a range. */
export function rangeFraction(weights: ArrayLike<number>): number {
  let total = 0;
  for (let k = 0; k < NUM_CLASSES; k++) {
    const kind = CLASS_KINDS[k]!;
    total += weights[k]! * (kind === 'pair' ? 6 : kind === 'suited' ? 4 : 12);
  }
  return total / 1326;
}
