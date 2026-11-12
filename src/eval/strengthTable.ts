import { rankOf, suitOf, type Card } from '../engine/cards';
import { COMBO_A, COMBO_B, NUM_COMBOS } from './combos';
import { evaluate, STRAIGHT_HIGH } from './evaluator';

/**
 * Made-hand strength of every two-card combo on a given board (3 to 5 cards).
 * Shared by all players, so it is built once per street.
 */
export interface StrengthTable {
  board: Card[];
  /** Evaluator score per combo; -1 for combos that use a board card. */
  scores: Int32Array;
  /** Indices of the playable combos, sorted from weakest to strongest. */
  order: Uint16Array;
}

export function buildStrengthTable(board: readonly Card[]): StrengthTable {
  if (board.length < 3 || board.length > 5) throw new Error('Board must have 3 to 5 cards');
  const scores = new Int32Array(NUM_COMBOS).fill(-1);
  const onBoard = new Uint8Array(52);
  for (const c of board) onBoard[c] = 1;
  const cards = [0, 0, ...board];
  const playable: number[] = [];
  for (let i = 0; i < NUM_COMBOS; i++) {
    const a = COMBO_A[i]!;
    const b = COMBO_B[i]!;
    if (onBoard[a] || onBoard[b]) continue;
    cards[0] = a;
    cards[1] = b;
    scores[i] = evaluate(cards);
    playable.push(i);
  }
  playable.sort((x, y) => scores[x]! - scores[y]!);
  return { board: board.slice(), scores, order: Uint16Array.from(playable) };
}

/**
 * For every combo, the share of a weighted range that it currently beats
 * (ties count half). Card removal between the combo and the range is ignored.
 */
export function beatFractions(
  table: StrengthTable,
  weights: ArrayLike<number>,
  out: Float32Array = new Float32Array(NUM_COMBOS),
): Float32Array {
  const { order, scores } = table;
  let total = 0;
  for (let k = 0; k < order.length; k++) total += weights[order[k]!]!;
  out.fill(0);
  if (total <= 0) {
    for (let k = 0; k < order.length; k++) out[order[k]!] = 0.5;
    return out;
  }
  let below = 0;
  let k = 0;
  while (k < order.length) {
    const score = scores[order[k]!]!;
    let end = k;
    let group = 0;
    while (end < order.length && scores[order[end]!] === score) {
      group += weights[order[end]!]!;
      end++;
    }
    const value = (below + group / 2) / total;
    for (let j = k; j < end; j++) out[order[j]!] = value;
    below += group;
    k = end;
  }
  return out;
}

/** Chance that a drawing hand improves, by number of outs, with 2 or 1 cards to come. */
function improveChance(outs: number, cardsToCome: number): number {
  if (cardsToCome >= 2) {
    // Discounted: the hand will not always get to see both cards cheaply.
    return (1 - ((47 - outs) / 47) * ((46 - outs) / 46)) * 0.85;
  }
  return outs / 46;
}

/**
 * Draw strength of every combo on the flop or turn: the approximate chance of
 * completing a flush or straight draw. Zero for made straights and flushes and on the river.
 */
export function drawStrengths(
  board: readonly Card[],
  out: Float32Array = new Float32Array(NUM_COMBOS),
): Float32Array {
  out.fill(0);
  if (board.length >= 5) return out;
  const cardsToCome = 5 - board.length;
  const suitCount = [0, 0, 0, 0];
  let boardMask = 0;
  const onBoard = new Uint8Array(52);
  for (const c of board) {
    suitCount[suitOf(c)]!++;
    boardMask |= 1 << rankOf(c);
    onBoard[c] = 1;
  }
  for (let i = 0; i < NUM_COMBOS; i++) {
    const a = COMBO_A[i]!;
    const b = COMBO_B[i]!;
    if (onBoard[a] || onBoard[b]) continue;
    const ra = a >> 2;
    const rb = b >> 2;
    const sa = a & 3;
    const sb = b & 3;
    let outs = 0;

    // Flush draw: four to a flush using both hole cards, or one high hole card.
    let madeFlush = false;
    if (sa === sb) {
      const n = suitCount[sa]! + 2;
      if (n >= 5) madeFlush = true;
      else if (n === 4) outs += 9;
    } else {
      const na = suitCount[sa]! + 1;
      const nb = suitCount[sb]! + 1;
      if (na >= 5 || nb >= 5) madeFlush = true;
      else if ((na === 4 && ra >= 10) || (nb === 4 && rb >= 10)) outs += 9;
    }
    if (madeFlush) continue;

    // Straight draw: ranks that complete a straight which needs a hole card.
    const mask = boardMask | (1 << ra) | (1 << rb);
    if (STRAIGHT_HIGH[mask]! >= 0) continue;
    let ranks = 0;
    for (let r = 0; r < 13; r++) {
      const bit = 1 << r;
      if (mask & bit) continue;
      if (STRAIGHT_HIGH[mask | bit]! >= 0 && STRAIGHT_HIGH[boardMask | bit]! < 0) ranks++;
    }
    if (ranks >= 2) outs += outs > 0 ? 6 : 8;
    else if (ranks === 1) outs += outs > 0 ? 3 : 4;

    if (outs > 0) out[i] = improveChance(outs, cardsToCome);
  }
  return out;
}
