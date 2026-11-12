import type { Card } from '../engine/cards';
import { COMBO_A, COMBO_B, NUM_COMBOS } from '../eval/combos';
import { evaluate } from '../eval/evaluator';

/**
 * Heads-up turn and river solver (Discounted CFR over a small bet-size abstraction).
 *
 * Players are 0 (out of position) and 1 (in position). Each player's range is a list of
 * combos with weights; strategies are stored per combo. Payoffs are chips won or lost from
 * the root of the solve. Card removal is handled exactly at showdowns; future river cards
 * are averaged per combo. Rake is ignored.
 */

export interface SolverConfig {
  /** Bet sizes as fractions of the pot, per street. */
  turnBets: number[];
  riverBets: number[];
  /** Raise sizes as fractions of the pot after calling. */
  raises: number[];
  /** Bets and raises allowed per street (including any already made at the root). */
  maxRaises: number;
  /** Offer an all-in when the stack is at most this many pots. */
  allInPots: number;
}

export const DEFAULT_SOLVER_CONFIG: SolverConfig = {
  turnBets: [0.66],
  riverBets: [0.33, 0.75],
  raises: [1],
  maxRaises: 2,
  allInPots: 2.5,
};

/** Smaller tree for turn solves, where every river card gets its own subtree. */
export const TURN_SOLVER_CONFIG: SolverConfig = {
  turnBets: [0.66],
  riverBets: [0.66],
  raises: [1],
  maxRaises: 2,
  allInPots: 1.5,
};

/** Iterations that give a usable reference (about 1-3% of the pot exploitable). */
export const RIVER_ITERATIONS = 400;
export const TURN_ITERATIONS = 40;

export type SolverActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface SolverAction {
  type: SolverActionType;
  /** Street total for the actor after a bet, raise or call. */
  to: number;
}

export interface SolveInput {
  board: Card[];
  /** Ranges of player 0 (out of position) and player 1 (in position) over the 1326 combos. */
  ranges: [Float32Array, Float32Array];
  /** Chips in the pot at the root, including bets on the current street. */
  pot: number;
  stacks: [number, number];
  /** Chips each player has put in on the current street. */
  bets: [number, number];
  toAct: 0 | 1;
  /** Bets and raises already made on this street. */
  raises: number;
  /** True when the player not to act has already acted on this street (for check-check). */
  otherActed: boolean;
  config?: Partial<SolverConfig>;
}

export interface SolveResult {
  actions: SolverAction[];
  /** Average strategy at the root: probs[action][combo] over the 1326 combos. */
  probs: Float32Array[];
  /** Exploitability as a share of the pot (0 = equilibrium). */
  exploitability: number;
  iterations: number;
  ms: number;
}

interface Showdown {
  /** For each player, combo list positions sorted by score, with group boundaries. */
  order: [Int32Array, Int32Array];
  scores: [Int32Array, Int32Array];
}

interface TreeNode {
  kind: 'action' | 'fold' | 'showdown' | 'chance';
  player: 0 | 1;
  actions: SolverAction[];
  children: TreeNode[];
  /** Chips each player added since the root. */
  added: [number, number];
  folder: 0 | 1;
  /** River cards of a chance node (one child each). */
  cards: Card[];
  /** Board at this node (for showdowns). */
  board: Card[];
  showdown: Showdown | null;
  regret: Float64Array[];
  avg: Float64Array[];
}

interface State {
  street: 'turn' | 'river';
  board: Card[];
  pot: number;
  bets: [number, number];
  stacks: [number, number];
  toAct: 0 | 1;
  raises: number;
  otherActed: boolean;
}

export class Solver {
  readonly cfg: SolverConfig;
  /** Combo ids in each player's range and their weights. */
  readonly combos: [Int32Array, Int32Array];
  readonly weights: [Float64Array, Float64Array];
  readonly root: TreeNode;
  private readonly rootPot: number;
  private readonly rootStacks: [number, number];
  private iter = 0;
  /** Same-combo lookup between the two lists, for card removal. */
  private readonly cardsOf: [Uint8Array, Uint8Array][];

  constructor(input: SolveInput) {
    const base = input.board.length >= 5 ? DEFAULT_SOLVER_CONFIG : TURN_SOLVER_CONFIG;
    this.cfg = { ...base, ...input.config };
    const dead = new Set<Card>(input.board);
    const list = (range: Float32Array): [Int32Array, Float64Array] => {
      const ids: number[] = [];
      const w: number[] = [];
      for (let c = 0; c < NUM_COMBOS; c++) {
        if (range[c]! <= 1e-6 || dead.has(COMBO_A[c]!) || dead.has(COMBO_B[c]!)) continue;
        ids.push(c);
        w.push(range[c]!);
      }
      return [Int32Array.from(ids), Float64Array.from(w)];
    };
    const [c0, w0] = list(input.ranges[0]);
    const [c1, w1] = list(input.ranges[1]);
    if (c0.length === 0 || c1.length === 0) throw new Error('Empty range');
    this.combos = [c0, c1];
    this.weights = [w0, w1];
    this.cardsOf = [
      [Uint8Array.from(c0, (c) => COMBO_A[c]!), Uint8Array.from(c0, (c) => COMBO_B[c]!)],
      [Uint8Array.from(c1, (c) => COMBO_A[c]!), Uint8Array.from(c1, (c) => COMBO_B[c]!)],
    ];
    this.rootPot = input.pot;
    this.rootStacks = [input.stacks[0], input.stacks[1]];
    const street = input.board.length >= 5 ? 'river' : 'turn';
    this.root = this.build({
        street,
        board: input.board.slice(),
        pot: input.pot,
        bets: [input.bets[0], input.bets[1]],
        stacks: [input.stacks[0], input.stacks[1]],
        toAct: input.toAct,
        raises: input.raises,
        otherActed: input.otherActed,
    });
  }

  // ---------- Tree ----------

  private node(kind: TreeNode['kind'], s: State): TreeNode {
    return {
      kind,
      player: s.toAct,
      actions: [],
      children: [],
      added: [this.rootStacks[0] - s.stacks[0], this.rootStacks[1] - s.stacks[1]],
      folder: 0,
      cards: [],
      board: s.board,
      showdown: null,
      regret: [],
      avg: [],
    };
  }

  private endStreet(s: State): TreeNode {
    const allIn = s.stacks[0] === 0 || s.stacks[1] === 0;
    if (s.street === 'river') {
      const n = this.node('showdown', s);
      n.showdown = this.showdownFor(s.board);
      return n;
    }
    const chance = this.node('chance', s);
    const dead = new Set<Card>(s.board);
    for (let c = 0; c < 52; c++) {
      if (dead.has(c)) continue;
      chance.cards.push(c);
      const river: State = {
        street: 'river',
        board: [...s.board, c],
        pot: s.pot,
        bets: [0, 0],
        stacks: [s.stacks[0], s.stacks[1]],
        toAct: 0,
        raises: 0,
        otherActed: false,
      };
      if (allIn) {
        const sd = this.node('showdown', river);
        sd.showdown = this.showdownFor(river.board);
        chance.children.push(sd);
      } else chance.children.push(this.build(river));
    }
    return chance;
  }

  private build(s: State): TreeNode {
    const me = s.toAct;
    const other = (1 - me) as 0 | 1;
    const facing = s.bets[other] - s.bets[me];
    const node = this.node('action', s);
    const actions: SolverAction[] = [];
    const pot = s.pot;
    const add = (a: SolverAction) => {
      if (!actions.some((x) => x.type === a.type && Math.abs(x.to - a.to) < 1)) actions.push(a);
    };
    if (facing > 0) {
      add({ type: 'fold', to: s.bets[me] });
      const call = Math.min(facing, s.stacks[me]);
      add({ type: 'call', to: s.bets[me] + call });
      if (s.raises < this.cfg.maxRaises && s.stacks[me] > call && s.stacks[other] > 0) {
        const max = s.bets[me] + s.stacks[me];
        for (const f of this.cfg.raises) {
          const to = Math.round(s.bets[other] + f * (pot + facing));
          add({ type: 'raise', to: to >= max * 0.8 ? max : Math.max(to, s.bets[other] + facing) });
        }
        if (s.stacks[me] <= this.cfg.allInPots * (pot + facing)) add({ type: 'raise', to: max });
      }
    } else {
      add({ type: 'check', to: s.bets[me] });
      if (s.stacks[me] > 0 && s.stacks[other] > 0 && s.raises < this.cfg.maxRaises) {
        const max = s.bets[me] + s.stacks[me];
        for (const f of s.street === 'turn' ? this.cfg.turnBets : this.cfg.riverBets) {
          const to = Math.round(s.bets[me] + f * pot);
          add({ type: 'bet', to: to >= max * 0.8 ? max : to });
        }
        if (s.stacks[me] <= this.cfg.allInPots * pot) add({ type: 'bet', to: max });
      }
    }
    node.actions = actions;
    for (const a of actions) node.children.push(this.child(s, a));
    const n = this.combos[me].length;
    node.regret = actions.map(() => new Float64Array(n));
    node.avg = actions.map(() => new Float64Array(n));
    return node;
  }

  private child(s: State, a: SolverAction): TreeNode {
    const me = s.toAct;
    const other = (1 - me) as 0 | 1;
    if (a.type === 'fold') {
      const n = this.node('fold', s);
      n.folder = me;
      return n;
    }
    const paid = a.to - s.bets[me];
    const next: State = {
      ...s,
      pot: s.pot + paid,
      bets: me === 0 ? [a.to, s.bets[1]] : [s.bets[0], a.to],
      stacks: me === 0 ? [s.stacks[0] - paid, s.stacks[1]] : [s.stacks[0], s.stacks[1] - paid],
      toAct: other,
      otherActed: true,
    };
    if (a.type === 'call') {
      // An all-in call for less: the bettor takes back what was not matched.
      const excess = next.bets[other] - next.bets[me];
      if (excess > 0) {
        next.bets[other] -= excess;
        next.stacks[other] += excess;
        next.pot -= excess;
      }
      return this.endStreet(next);
    }
    if (a.type === 'check') {
      if (s.otherActed) return this.endStreet(next);
      return this.build(next);
    }
    return this.build({ ...next, raises: s.raises + 1 });
  }

  private readonly showdowns = new Map<string, Showdown>();

  private showdownFor(board: Card[]): Showdown {
    const key = board.join(',');
    let sd = this.showdowns.get(key);
    if (sd) return sd;
    const dead = new Set<Card>(board);
    const make = (p: 0 | 1): [Int32Array, Int32Array] => {
      const ids = this.combos[p];
      const scores = new Int32Array(ids.length);
      const cards = [0, 0, ...board];
      for (let k = 0; k < ids.length; k++) {
        const c = ids[k]!;
        if (dead.has(COMBO_A[c]!) || dead.has(COMBO_B[c]!)) {
          scores[k] = -1;
          continue;
        }
        cards[0] = COMBO_A[c]!;
        cards[1] = COMBO_B[c]!;
        scores[k] = evaluate(cards);
      }
      const order = Int32Array.from(ids.keys()).sort((x, y) => scores[x]! - scores[y]!);
      return [order, scores];
    };
    const [o0, s0] = make(0);
    const [o1, s1] = make(1);
    sd = { order: [o0, o1], scores: [s0, s1] };
    this.showdowns.set(key, sd);
    return sd;
  }

  // ---------- Values ----------

  /** Opponent reach compatible with each of the player's combos (card removal). */
  private compatible(p: 0 | 1, reach: Float64Array, out: Float64Array, board: Card[]): void {
    const o = (1 - p) as 0 | 1;
    const card = new Float64Array(52);
    let total = 0;
    const [oa, ob] = this.cardsOf[o];
    const dead = new Uint8Array(52);
    for (const c of board) dead[c] = 1;
    for (let j = 0; j < reach.length; j++) {
      const r = reach[j]!;
      if (r === 0 || dead[oa[j]!] || dead[ob[j]!]) continue;
      total += r;
      card[oa[j]!]! += r;
      card[ob[j]!]! += r;
    }
    const [pa, pb] = this.cardsOf[p];
    for (let i = 0; i < out.length; i++) {
      // A combo identical to the player's is subtracted twice by the card sums; add it back.
      out[i] = total - card[pa[i]!]! - card[pb[i]!]! + this.sameCombo(p, i, reach);
    }
  }

  private sameIndex: [Int32Array, Int32Array] | null = null;

  private sameCombo(p: 0 | 1, i: number, reach: Float64Array): number {
    if (!this.sameIndex) {
      const map = new Map<number, number>();
      this.combos[1].forEach((c, k) => map.set(c, k));
      const s0 = Int32Array.from(this.combos[0], (c) => map.get(c) ?? -1);
      const back = new Map<number, number>();
      this.combos[0].forEach((c, k) => back.set(c, k));
      const s1 = Int32Array.from(this.combos[1], (c) => back.get(c) ?? -1);
      this.sameIndex = [s0, s1];
    }
    const j = this.sameIndex[p][i]!;
    return j >= 0 ? reach[j]! : 0;
  }

  private terminal(node: TreeNode, p: 0 | 1, reach: Float64Array, out: Float64Array): void {
    const o = (1 - p) as 0 | 1;
    const addMe = node.added[p];
    const addOpp = node.added[o];
    if (node.kind === 'fold') {
      this.compatible(p, reach, out, node.board);
      const amount = node.folder === p ? -addMe : this.rootPot + addOpp;
      for (let i = 0; i < out.length; i++) out[i]! *= amount;
      return;
    }
    // Showdown: sweep both lists in score order.
    const sd = node.showdown!;
    const [myOrder, oppOrder] = [sd.order[p], sd.order[o]];
    const [myScores, oppScores] = [sd.scores[p], sd.scores[o]];
    const [pa, pb] = this.cardsOf[p];
    const [oa, ob] = this.cardsOf[o];
    const win = this.rootPot + addOpp;
    const lose = addMe;
    const tie = (this.rootPot + addOpp - addMe) / 2;
    const lowerCard = new Float64Array(52);
    const equalCard = new Float64Array(52);
    let lower = 0;
    let k = 0;
    // Skip opponent combos that conflict with the board.
    while (k < oppOrder.length && oppScores[oppOrder[k]!]! < 0) k++;
    const compat = new Float64Array(out.length);
    this.compatible(p, reach, compat, node.board);
    let i = 0;
    while (i < myOrder.length) {
      const score = myScores[myOrder[i]!]!;
      let end = i;
      while (end < myOrder.length && myScores[myOrder[end]!] === score) end++;
      if (score < 0) {
        for (let x = i; x < end; x++) out[myOrder[x]!] = 0;
        i = end;
        continue;
      }
      // Opponent combos strictly below this score.
      while (k < oppOrder.length && oppScores[oppOrder[k]!]! < score) {
        const j = oppOrder[k]!;
        const r = reach[j]!;
        lower += r;
        lowerCard[oa[j]!]! += r;
        lowerCard[ob[j]!]! += r;
        k++;
      }
      // Opponent combos with exactly this score.
      let equal = 0;
      let e = k;
      while (e < oppOrder.length && oppScores[oppOrder[e]!] === score) {
        const j = oppOrder[e]!;
        const r = reach[j]!;
        equal += r;
        equalCard[oa[j]!]! += r;
        equalCard[ob[j]!]! += r;
        e++;
      }
      for (let x = i; x < end; x++) {
        const m = myOrder[x]!;
        const a = pa[m]!;
        const b = pb[m]!;
        const w = lower - lowerCard[a]! - lowerCard[b]!;
        const t = equal - equalCard[a]! - equalCard[b]! + this.sameCombo(p, m, reach);
        const l = compat[m]! - w - t;
        out[m] = w * win + t * tie - l * lose;
      }
      for (let x = k; x < e; x++) {
        const j = oppOrder[x]!;
        equalCard[oa[j]!] = 0;
        equalCard[ob[j]!] = 0;
      }
      i = end;
    }
  }

  /** Counterfactual values for player p; `reach` is the opponent's reach. */
  private cfr(node: TreeNode, p: 0 | 1, reach: Float64Array, selfReach: Float64Array, br: boolean): Float64Array {
    const n = this.combos[p].length;
    const out = new Float64Array(n);
    if (node.kind === 'fold' || node.kind === 'showdown') {
      this.terminal(node, p, reach, out);
      return out;
    }
    if (node.kind === 'chance') {
      const o = (1 - p) as 0 | 1;
      const [pa, pb] = this.cardsOf[p];
      const [oa, ob] = this.cardsOf[o];
      node.cards.forEach((card, idx) => {
        const r = reach.slice();
        for (let j = 0; j < r.length; j++) if (oa[j] === card || ob[j] === card) r[j] = 0;
        const s = selfReach.slice();
        for (let m = 0; m < s.length; m++) if (pa[m] === card || pb[m] === card) s[m] = 0;
        const v = this.cfr(node.children[idx]!, p, r, s, br);
        for (let m = 0; m < n; m++) if (pa[m] !== card && pb[m] !== card) out[m]! += v[m]!;
      });
      // Every pair of hands sees each river card except their four cards.
      const scale = 1 / (node.cards.length - 4);
      for (let m = 0; m < n; m++) out[m]! *= scale;
      return out;
    }
    const actor = node.player;
    const strategy = br && actor !== p ? this.average(node) : this.current(node);
    if (actor === p) {
      const values = node.children.map((child, a) => {
        const s = selfReach.slice();
        for (let m = 0; m < n; m++) s[m]! *= strategy[a]![m]!;
        return this.cfr(child, p, reach, s, br);
      });
      if (br) {
        for (let m = 0; m < n; m++) {
          let best = -Infinity;
          for (const v of values) best = Math.max(best, v[m]!);
          out[m] = best;
        }
        return out;
      }
      for (let m = 0; m < n; m++) {
        let v = 0;
        for (let a = 0; a < values.length; a++) v += strategy[a]![m]! * values[a]![m]!;
        out[m] = v;
      }
      // Discounted CFR updates.
      const t = this.iter;
      const pos = Math.pow(t, 1.5) / (Math.pow(t, 1.5) + 1);
      const neg = Math.pow(t, 0.5) / (Math.pow(t, 0.5) + 1);
      const avgWeight = Math.pow(t / (t + 1), 2);
      for (let a = 0; a < values.length; a++) {
        const reg = node.regret[a]!;
        const avg = node.avg[a]!;
        const va = values[a]!;
        const sa = strategy[a]!;
        for (let m = 0; m < n; m++) {
          const r = reg[m]!;
          reg[m] = (r > 0 ? r * pos : r * neg) + va[m]! - out[m]!;
          avg[m] = avg[m]! * avgWeight + selfReach[m]! * sa[m]!;
        }
      }
      return out;
    }
    node.children.forEach((child, a) => {
      const r = reach.slice();
      const s = strategy[a]!;
      for (let j = 0; j < r.length; j++) r[j]! *= s[j]!;
      const v = this.cfr(child, p, r, selfReach, br);
      for (let m = 0; m < n; m++) out[m]! += v[m]!;
    });
    return out;
  }

  /** Regret-matching strategy at a node. */
  private current(node: TreeNode): Float64Array[] {
    const n = node.regret[0]?.length ?? 0;
    const k = node.actions.length;
    const out = node.actions.map(() => new Float64Array(n));
    for (let m = 0; m < n; m++) {
      let sum = 0;
      for (let a = 0; a < k; a++) sum += Math.max(0, node.regret[a]![m]!);
      for (let a = 0; a < k; a++) out[a]![m] = sum > 0 ? Math.max(0, node.regret[a]![m]!) / sum : 1 / k;
    }
    return out;
  }

  /** Average strategy at a node. */
  average(node: TreeNode): Float64Array[] {
    const n = node.avg[0]?.length ?? 0;
    const k = node.actions.length;
    const out = node.actions.map(() => new Float64Array(n));
    for (let m = 0; m < n; m++) {
      let sum = 0;
      for (let a = 0; a < k; a++) sum += node.avg[a]![m]!;
      for (let a = 0; a < k; a++) out[a]![m] = sum > 0 ? node.avg[a]![m]! / sum : 1 / k;
    }
    return out;
  }

  /** Run iterations; `onProgress` gets the share done. */
  run(iterations: number): void {
    for (let t = 0; t < iterations; t++) {
      this.iter++;
      for (const p of [0, 1] as const) {
        this.cfr(this.root, p, this.weights[1 - p]!.slice(), this.weights[p]!.slice(), false);
      }
    }
  }

  /** Exploitability of the average strategies, as a share of the pot. */
  exploitability(): number {
    let total = 0;
    for (const p of [0, 1] as const) {
      const v = this.cfr(this.root, p, this.weights[1 - p]!.slice(), this.weights[p]!.slice(), true);
      const w = this.weights[p]!;
      const compat = new Float64Array(w.length);
      this.compatible(p, this.weights[1 - p]!, compat, this.root.board);
      let num = 0;
      let den = 0;
      for (let m = 0; m < w.length; m++) {
        num += w[m]! * v[m]!;
        den += w[m]! * compat[m]!;
      }
      total += den > 0 ? num / den : 0;
    }
    // Best responses together can win at most the pot when both play an equilibrium.
    return Math.max(0, (total - this.rootPot) / 2 / this.rootPot);
  }

  /** Root strategy expanded to the 1326 combos of the acting player. */
  rootStrategy(): Float32Array[] {
    const avg = this.average(this.root);
    const ids = this.combos[this.root.player];
    return avg.map((row) => {
      const out = new Float32Array(NUM_COMBOS);
      ids.forEach((c, m) => (out[c] = row[m]!));
      return out;
    });
  }
}

export function solve(input: SolveInput, iterations: number): SolveResult {
  const start = Date.now();
  const solver = new Solver(input);
  solver.run(iterations);
  return {
    actions: solver.root.actions,
    probs: solver.rootStrategy(),
    exploitability: solver.exploitability(),
    iterations,
    ms: Date.now() - start,
  };
}
