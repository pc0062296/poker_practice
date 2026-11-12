import { actionLikelihood } from '../bots/rangeTracker';
import type { Policy, RangeStrategy } from '../bots/types';
import type { Card } from '../engine/cards';
import { applyAction, buildPots, cloneHand, getLegalActions, potTotal, toPublicView } from '../engine/hand';
import type { Action, HandState, LegalActions } from '../engine/types';
import { COMBO_A, COMBO_B, NUM_COMBOS } from '../eval/combos';
import { evaluate } from '../eval/evaluator';
import { buildStrengthTable, type StrengthTable } from '../eval/strengthTable';
import { clampRaise, type SizingOptions } from '../ranges/sizing';

/**
 * Expected value of the hero's options at a postflop decision, against opponents who
 * play known strategies.
 *
 * The evaluator walks the public game tree. Opponents' hidden cards are never sampled;
 * each opponent carries a weighted range, and every opponent action splits that range by
 * how likely each combo is to take it. Future community cards are enumerated one street
 * ahead and sampled two streets ahead. At the hero's later decisions the hero takes the
 * best option, so a value assumes good play afterwards.
 *
 * Simplifications: opponents' ranges are treated as independent of each other, card
 * removal by opponents' hands is ignored when dealing future cards, after the graded
 * decision at most two bets or raises happen on that street and one on later streets,
 * branches less likely than 1% are dropped, and when three or more players are still in
 * at the end of a street the rest of the hand is valued as if it were checked down.
 */

export interface EvalModel {
  /** Strategy that produces each seat's actions (the hero's entry is ignored). */
  policies: readonly Policy[];
  /** Strategy players assume for each other, used for public range beliefs. */
  observer: Policy;
  sizing: SizingOptions;
}

export interface EvalBudget {
  /** Turn cards sampled for a flop decision. */
  turnCards: number;
  /** River cards sampled per turn card for a flop decision. */
  riverCards: number;
  /** River cards sampled for a turn decision; 0 enumerates all of them (exact). */
  turnRivers: number;
}

export interface EvalInput {
  /** The hand with the hero to act. Opponents' hole cards in it are ignored. */
  hand: HandState;
  heroIndex: number;
  /** Public range beliefs about every player. */
  beliefs: readonly Float32Array[];
  /** Ranges the evaluation assumes for the opponents. */
  weights: readonly Float32Array[];
  candidates: Action[];
  model: EvalModel;
  budget?: Partial<EvalBudget>;
  seed?: number;
}

export interface ActionValue {
  action: Action;
  /** Expected change of the hero's stack from this decision on, in chips. */
  ev: number;
  /** Standard error from sampling future cards (0 when exact). */
  se: number;
}

export interface EvalResult {
  values: ActionValue[];
  /** True when every future card was enumerated. */
  exact: boolean;
  /** True when some lines were valued as checked down (multiway pots). */
  checkdown: boolean;
  /** Strategy evaluations performed. */
  nodes: number;
  ms: number;
}

const TREMBLE = 0.04;
const PRUNE = 0.01;
/** Bets and raises allowed per street: on the graded street, and on later streets. */
const MAX_RAISES_ROOT_STREET = 2;
const MAX_RAISES_LATER = 1;

interface Node {
  hand: HandState;
  beliefs: Float32Array[];
  weights: Float32Array[];
  /** Bets and raises on the current street since the graded decision. */
  raises: number;
}

interface Branch {
  action: Action;
  p: number;
  /** Actor's per-combo probability of the action. */
  row: Float32Array;
  /** Observer's per-combo probability of the action. */
  seen: Float32Array;
}

export function defaultBudget(opponents: number): EvalBudget {
  if (opponents <= 1) return { turnCards: 6, riverCards: 5, turnRivers: 0 };
  if (opponents === 2) return { turnCards: 4, riverCards: 3, turnRivers: 16 };
  return { turnCards: 3, riverCards: 2, turnRivers: 10 };
}

/** Deterministic seed from a board, so the same board always samples the same next cards. */
function hashCards(cards: readonly Card[], seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const c of cards) {
    h = Math.imul(h ^ (c + 1), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0 || 1;
}

function sample<T>(items: readonly T[], count: number, seed: number): T[] {
  if (count >= items.length) return items.slice();
  const pool = items.slice();
  let s = seed || 1;
  for (let i = 0; i < count; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const j = i + Math.floor(((s >>> 0) / 4294967296) * (pool.length - i));
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  return pool.slice(0, count);
}

function stripCards(ranges: readonly Float32Array[], cards: readonly Card[]): Float32Array[] {
  const dead = new Uint8Array(52);
  for (const c of cards) dead[c] = 1;
  return ranges.map((r) => {
    const out = r.slice();
    for (let c = 0; c < NUM_COMBOS; c++) if (dead[COMBO_A[c]!] || dead[COMBO_B[c]!]) out[c] = 0;
    return out;
  });
}

export class DecisionEvaluator {
  private readonly hero: number;
  private readonly heroCards: [Card, Card];
  private readonly model: EvalModel;
  private readonly budget: EvalBudget;
  private readonly seed: number;
  private readonly rootBoard: number;
  private readonly tables = new Map<string, StrengthTable>();
  /** For flop decisions: the turn card of the current outer sample. */
  private fixedTurn: Card | null = null;
  private usedCheckdown = false;
  nodes = 0;

  constructor(private readonly input: EvalInput) {
    this.hero = input.heroIndex;
    const h = input.hand.players[this.hero]!.hole;
    this.heroCards = [h[0], h[1]];
    this.model = input.model;
    const opponents = input.hand.players.filter((p) => !p.folded && p.index !== this.hero).length;
    this.budget = { ...defaultBudget(opponents), ...input.budget };
    this.seed = input.seed ?? 12345;
    this.rootBoard = input.hand.board.length;
    if (this.rootBoard < 3) throw new Error('Only postflop decisions are evaluated');
  }

  run(): EvalResult {
    const start = Date.now();
    const { hand, candidates } = this.input;
    const stack0 = hand.players[this.hero]!.stack;
    const weights = this.input.weights.map((r) => r.slice());
    const [a, b] = this.heroCards;
    weights.forEach((range, i) => {
      if (i === this.hero) return;
      for (let c = 0; c < NUM_COMBOS; c++) {
        const x = COMBO_A[c]!;
        const y = COMBO_B[c]!;
        if (x === a || x === b || y === a || y === b) range[c] = 0;
      }
    });
    const root: Node = { hand, beliefs: this.input.beliefs.map((r) => r.slice()), weights, raises: 0 };

    let values: ActionValue[];
    if (this.rootBoard === 3) {
      // Flop: the same sampled turn cards for every option (common random numbers).
      const unseen = this.unseen(hand.board);
      const turns = sample(unseen, this.budget.turnCards, hashCards(hand.board, this.seed));
      const fpc = turns.length > 1 ? Math.sqrt((unseen.length - turns.length) / (unseen.length - 1)) : 0;
      values = candidates.map((action) => {
        const vs = turns.map((t) => {
          this.fixedTurn = t;
          return this.applyAndValue(root, action);
        });
        this.fixedTurn = null;
        const mean = vs.reduce((s, v) => s + v, 0) / vs.length;
        const variance = vs.length > 1 ? vs.reduce((s, v) => s + (v - mean) ** 2, 0) / (vs.length - 1) : 0;
        return { action, ev: mean - stack0, se: Math.sqrt(variance / vs.length) * fpc };
      });
    } else {
      values = candidates.map((action) => ({ action, ev: this.applyAndValue(root, action) - stack0, se: 0 }));
    }
    const exact = this.rootBoard === 5 || (this.rootBoard === 4 && this.budget.turnRivers === 0);
    return { values, exact, checkdown: this.usedCheckdown, nodes: this.nodes, ms: Date.now() - start };
  }

  private unseen(board: readonly Card[]): Card[] {
    const dead = new Set<Card>([...this.heroCards, ...board]);
    const out: Card[] = [];
    for (let c = 0; c < 52; c++) if (!dead.has(c)) out.push(c);
    return out;
  }

  private table(board: readonly Card[]): StrengthTable | null {
    if (board.length < 3) return null;
    const key = board.join(',');
    let t = this.tables.get(key);
    if (!t) {
      t = buildStrengthTable(board);
      this.tables.set(key, t);
    }
    return t;
  }

  private strategy(policy: Policy, node: Node, legal: LegalActions): RangeStrategy {
    this.nodes++;
    return policy.rangeStrategy({
      view: toPublicView(node.hand),
      actor: node.hand.toAct,
      legal,
      ranges: node.beliefs,
      table: this.table(node.hand.board),
      sizing: this.model.sizing,
    });
  }

  /** Expected final stack of the hero from this node. */
  private value(node: Node): number {
    const hand = node.hand;
    const hero = hand.players[this.hero]!;
    if (hero.folded) return hero.stack;
    const legal = hand.isComplete ? null : getLegalActions(hand);
    if (!legal) return this.terminal(node);
    const actor = hand.toAct;

    if (actor === this.hero) {
      const observed = this.strategy(this.model.observer, node, legal);
      let best = -Infinity;
      for (const action of this.heroOptions(node, legal)) {
        const seen = action.type === 'fold' ? null : actionLikelihood(observed, action);
        best = Math.max(best, this.applyAndValue(node, action, null, seen));
      }
      return best;
    }

    const branches = this.opponentBranches(node, actor, legal);
    if (branches.length === 0) return this.terminal(node);
    let value = 0;
    let used = 0;
    for (const br of branches) {
      value += br.p * this.applyAndValue(node, br.action, br.row, br.seen);
      used += br.p;
    }
    return value / used;
  }

  /** The opponent's possible actions with their probabilities under the evaluation weights. */
  private opponentBranches(node: Node, actor: number, legal: LegalActions): Branch[] {
    const policy = this.model.policies[actor]!;
    const strategy = this.strategy(policy, node, legal);
    const observed = this.model.observer === policy ? strategy : this.strategy(this.model.observer, node, legal);
    const w = node.weights[actor]!;
    let total = 0;
    for (let c = 0; c < NUM_COMBOS; c++) total += w[c]!;
    const capped = node.raises >= this.raiseCap(node);

    const out: Branch[] = [];
    strategy.options.forEach((option, o) => {
      if (capped && option.kind === 'aggressive') return;
      const row = strategy.probs[o]!.slice();
      if (capped && option.kind === 'passive') {
        // Raises beyond the cap are played as calls.
        strategy.options.forEach((other, k) => {
          if (other.kind !== 'aggressive') return;
          const extra = strategy.probs[k]!;
          for (let c = 0; c < NUM_COMBOS; c++) row[c]! += extra[c]!;
        });
      }
      let mass = 0;
      for (let c = 0; c < NUM_COMBOS; c++) mass += w[c]! * row[c]!;
      const p = total > 0 ? mass / total : option.kind === 'passive' ? 1 : 0;
      if (p < PRUNE) return;
      out.push({ action: option.action, p, row, seen: actionLikelihood(observed, option.action) ?? row });
    });
    return out;
  }

  private raiseCap(node: Node): number {
    return node.hand.board.length === this.rootBoard ? MAX_RAISES_ROOT_STREET : MAX_RAISES_LATER;
  }

  /** Simple option set for the hero's later decisions: fold, check or call, one bet or raise. */
  private heroOptions(node: Node, legal: LegalActions): Action[] {
    const hand = node.hand;
    const out: Action[] = [];
    if (!legal.canCheck) out.push({ type: 'fold' });
    out.push({ type: legal.canCheck ? 'check' : 'call' });
    if (legal.canRaise && node.raises < this.raiseCap(node)) {
      const pot = potTotal(hand);
      const desired = legal.raiseType === 'bet' ? pot * 0.66 : hand.currentBet * 3 + pot * 0.15;
      out.push({ type: legal.raiseType, amount: clampRaise(desired, legal, toPublicView(hand)) });
    }
    return out;
  }

  /**
   * Apply an action and return the hero's expected final stack. `row` and `seen` are the
   * actor's and the observer's per-combo probabilities of the action; for the hero they are
   * worked out here.
   */
  private applyAndValue(
    node: Node,
    action: Action,
    row: Float32Array | null = null,
    seen: Float32Array | null = null,
  ): number {
    const hand = node.hand;
    const actor = hand.toAct;
    if (actor === this.hero && action.type === 'fold') return hand.players[this.hero]!.stack;
    if (actor === this.hero && !seen) {
      const legal = getLegalActions(hand)!;
      seen = actionLikelihood(this.strategy(this.model.observer, node, legal), action);
    }

    let beliefs = node.beliefs;
    if (seen) {
      beliefs = node.beliefs.slice();
      const prev = node.beliefs[actor]!;
      const next = new Float32Array(NUM_COMBOS);
      let max = 0;
      for (let c = 0; c < NUM_COMBOS; c++) {
        const x = prev[c]! * ((1 - TREMBLE) * seen[c]! + TREMBLE);
        next[c] = x;
        if (x > max) max = x;
      }
      if (max > 0) for (let c = 0; c < NUM_COMBOS; c++) next[c]! /= max;
      beliefs[actor] = next;
    }
    let weights = node.weights;
    if (row) {
      weights = node.weights.slice();
      const prev = node.weights[actor]!;
      const next = new Float32Array(NUM_COMBOS);
      for (let c = 0; c < NUM_COMBOS; c++) next[c] = prev[c]! * row[c]!;
      weights[actor] = next;
    }

    const boardBefore = hand.board.length;
    const probe = cloneHand(hand);
    applyAction(probe, action);
    if (probe.board.length === boardBefore) {
      const aggressive = action.type === 'bet' || action.type === 'raise';
      return this.value({ hand: probe, beliefs, weights, raises: node.raises + (aggressive ? 1 : 0) });
    }

    // New community cards.
    const live = probe.players.filter((p) => !p.folded).length;
    if (live >= 3) return this.checkdown(probe, hand.board, weights);
    const newCards = probe.board.length - boardBefore;
    const unseen = this.unseen(hand.board);
    const riverCount =
      this.rootBoard === 3 ? this.budget.riverCards : this.budget.turnRivers > 0 ? this.budget.turnRivers : unseen.length;
    const runouts: Card[][] = [];
    if (boardBefore === 3) {
      const turns = this.fixedTurn !== null ? [this.fixedTurn] : sample(unseen, this.budget.turnCards, hashCards(hand.board, this.seed));
      for (const t of turns) {
        if (newCards === 1) runouts.push([t]);
        else {
          const rest = unseen.filter((c) => c !== t);
          for (const r of sample(rest, riverCount, hashCards([...hand.board, t], this.seed))) runouts.push([t, r]);
        }
      }
    } else {
      for (const r of sample(unseen, riverCount, hashCards(hand.board, this.seed))) runouts.push([r]);
    }

    let sum = 0;
    for (const cards of runouts) {
      const child = cloneHand(hand);
      for (let k = 0; k < cards.length; k++) child.runout[boardBefore + k] = cards[k]!;
      applyAction(child, action);
      sum += this.value({ hand: child, beliefs: stripCards(beliefs, cards), weights: stripCards(weights, cards), raises: 0 });
    }
    return sum / runouts.length;
  }

  /**
   * Value with no further betting: the hero's share of the pots over future boards.
   * `after` holds the contributions once the street closed; only `board` is known.
   */
  private checkdown(after: HandState, board: readonly Card[], weights: readonly Float32Array[]): number {
    this.usedCheckdown = true;
    const hero = after.players[this.hero]!;
    const pots = buildPots(after.players);
    const rake = after.config.rake;
    let total = 0;
    for (const pot of pots) total += pot.amount;
    let rakeLeft = rake.percent > 0 ? Math.floor((total * rake.percent) / 100) : 0;
    if (rake.cap > 0) rakeLeft = Math.min(rakeLeft, rake.cap);
    for (const pot of pots) {
      const take = Math.min(rakeLeft, pot.amount);
      pot.amount -= take;
      rakeLeft -= take;
    }
    // Uncalled excess is in a pot whose only eligible player is its owner.
    const boards: Card[][] = [];
    const unseen = this.unseen(board);
    if (board.length === 5) boards.push(board.slice());
    else if (board.length === 4) {
      for (const r of sample(unseen, 20, hashCards(board, this.seed))) boards.push([...board, r]);
    } else {
      for (const t of sample(unseen, 8, hashCards(board, this.seed))) {
        const rest = unseen.filter((c) => c !== t);
        for (const r of sample(rest, 5, hashCards([...board, t], this.seed))) boards.push([...board, t, r]);
      }
    }
    let gained = 0;
    for (const full of boards) gained += this.potShare(full, pots, weights);
    return hero.stack + gained / boards.length;
  }

  /** Expected chips the hero wins from the given pots on a complete board. */
  private potShare(
    board: readonly Card[],
    pots: readonly { amount: number; eligible: number[] }[],
    weights: readonly Float32Array[],
  ): number {
    const heroScore = evaluate([this.heroCards[0], this.heroCards[1], ...board]);
    const table = this.table(board)!;
    const odds = new Map<number, { win: number; tie: number }>();
    const oddsFor = (j: number) => {
      let hit = odds.get(j);
      if (!hit) {
        const w = weights[j]!;
        let total = 0;
        let win = 0;
        let tie = 0;
        for (let c = 0; c < NUM_COMBOS; c++) {
          const x = w[c]!;
          if (x <= 0) continue;
          const s = table.scores[c]!;
          if (s < 0) continue;
          total += x;
          if (s < heroScore) win += x;
          else if (s === heroScore) tie += x;
        }
        hit = total > 0 ? { win: win / total, tie: tie / total } : { win: 0.5, tie: 0 };
        odds.set(j, hit);
      }
      return hit;
    };
    let gained = 0;
    for (const pot of pots) {
      if (!pot.eligible.includes(this.hero)) continue;
      let winAll = 1;
      let atLeastTie = 1;
      for (const j of pot.eligible) {
        if (j === this.hero) continue;
        const o = oddsFor(j);
        winAll *= o.win;
        atLeastTie *= o.win + o.tie;
      }
      gained += pot.amount * (winAll + 0.5 * (atLeastTie - winAll));
    }
    return gained;
  }

  /** Expected final stack of the hero when the hand is over. */
  private terminal(node: Node): number {
    const hand = node.hand;
    const hero = hand.players[this.hero]!;
    const result = hand.result;
    if (!result || !result.showdown) return hero.stack;
    // Stack before the (meaningless) placeholder showdown awarded anything.
    const base = hero.stack - result.winnings[this.hero]!;
    return base + this.potShare(hand.board, result.pots, node.weights);
  }
}

export function evaluateDecision(input: EvalInput): EvalResult {
  return new DecisionEvaluator(input).run();
}
