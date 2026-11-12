import type { Card } from '../engine/cards';
import type { Rng } from '../engine/rng';
import { COMBO_A, COMBO_B, NUM_COMBOS } from './combos';
import { evaluate } from './evaluator';

export interface EquityPlayer {
  /** Fixed hole cards, or a weighted range over the 1326 combos. */
  cards?: readonly Card[];
  range?: Float32Array;
}

export interface EquityResult {
  /** Share of the pot each player wins on average (ties split). */
  equity: number[];
  win: number[];
  tie: number[];
  samples: number;
  exact: boolean;
}

/**
 * Showdown equity of several players. Enumerates every runout when all hands are known
 * and at most two board cards are missing; otherwise samples.
 */
export function calcEquity(players: EquityPlayer[], board: readonly Card[], samples: number, rng: Rng): EquityResult {
  const n = players.length;
  const equity = new Array<number>(n).fill(0);
  const win = new Array<number>(n).fill(0);
  const tie = new Array<number>(n).fill(0);
  const fixedDead = new Set<Card>(board);
  for (const p of players) for (const c of p.cards ?? []) fixedDead.add(c);

  const holes: Card[][] = players.map((p) => (p.cards ? p.cards.slice() : [0, 0]));
  const cards = new Array<number>(7);
  const score = (hole: Card[], full: Card[]): number => {
    cards[0] = hole[0]!;
    cards[1] = hole[1]!;
    for (let i = 0; i < 5; i++) cards[2 + i] = full[i]!;
    return evaluate(cards, 7);
  };
  const settle = (full: Card[], weight: number) => {
    let best = -1;
    let count = 0;
    const scores = holes.map((h) => score(h, full));
    for (const s of scores) {
      if (s > best) {
        best = s;
        count = 1;
      } else if (s === best) count++;
    }
    scores.forEach((s, i) => {
      if (s !== best) return;
      equity[i]! += weight / count;
      if (count === 1) win[i]! += weight;
      else tie[i]! += weight;
    });
  };

  const allFixed = players.every((p) => p.cards && p.cards.length === 2);
  const missing = 5 - board.length;
  if (allFixed && missing <= 2) {
    const unseen: Card[] = [];
    for (let c = 0; c < 52; c++) if (!fixedDead.has(c)) unseen.push(c);
    let total = 0;
    if (missing === 0) {
      settle(board.slice(), 1);
      total = 1;
    } else if (missing === 1) {
      for (const c of unseen) {
        settle([...board, c], 1);
        total++;
      }
    } else {
      for (let i = 0; i < unseen.length; i++)
        for (let j = i + 1; j < unseen.length; j++) {
          settle([...board, unseen[i]!, unseen[j]!], 1);
          total++;
        }
    }
    return {
      equity: equity.map((x) => x / total),
      win: win.map((x) => x / total),
      tie: tie.map((x) => x / total),
      samples: total,
      exact: true,
    };
  }

  // Cumulative weights for sampling range combos.
  const cumulative = players.map((p) => {
    if (p.cards || !p.range) return null;
    const cum = new Float64Array(NUM_COMBOS);
    let acc = 0;
    for (let c = 0; c < NUM_COMBOS; c++) {
      const a = COMBO_A[c]!;
      const b = COMBO_B[c]!;
      if (!fixedDead.has(a) && !fixedDead.has(b)) acc += p.range[c]!;
      cum[c] = acc;
    }
    return acc > 0 ? cum : null;
  });
  if (players.some((p, i) => !p.cards && !cumulative[i])) {
    throw new Error('A range is empty after removing known cards');
  }

  const used = new Uint8Array(52);
  let done = 0;
  for (let s = 0; s < samples; s++) {
    used.fill(0);
    for (const c of fixedDead) used[c] = 1;
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const cum = cumulative[i];
      if (!cum) continue;
      let tries = 0;
      for (;;) {
        const target = rng.next() * cum[NUM_COMBOS - 1]!;
        let lo = 0;
        let hi = NUM_COMBOS - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid]! > target) hi = mid;
          else lo = mid + 1;
        }
        const a = COMBO_A[lo]!;
        const b = COMBO_B[lo]!;
        if (!used[a] && !used[b]) {
          used[a] = 1;
          used[b] = 1;
          holes[i]![0] = a;
          holes[i]![1] = b;
          break;
        }
        if (++tries > 200) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) continue;
    const full = board.slice();
    while (full.length < 5) {
      const c = rng.int(52);
      if (used[c]) continue;
      used[c] = 1;
      full.push(c);
    }
    settle(full, 1);
    done++;
  }
  const d = Math.max(1, done);
  return { equity: equity.map((x) => x / d), win: win.map((x) => x / d), tie: tie.map((x) => x / d), samples: done, exact: false };
}
