import { baselinePolicy } from '../bots/baselinePolicy';
import { RangeTracker } from '../bots/rangeTracker';
import type { DecisionOption, Policy, RangeStrategy } from '../bots/types';
import { applyAction, getLegalActions, toPublicView } from '../engine/hand';
import type { Rng } from '../engine/rng';
import type { Action, HandState, LegalActions, Street } from '../engine/types';
import { comboIndex } from '../eval/combos';
import { buildStrengthTable, type StrengthTable } from '../eval/strengthTable';
import type { PreflopScenario } from '../ranges/scenario';
import { DEFAULT_SIZING, type SizingOptions } from '../ranges/sizing';

/** What the baseline strategy would do with the hero's hand at one of the hero's decisions. */
export interface DecisionRecord {
  /** Index of the resulting action in the hand's event list. */
  eventIndex: number;
  /** Number of actions taken before this decision. */
  actionIndex: number;
  player: number;
  street: Street;
  legal: LegalActions;
  options: DecisionOption[];
  /** Baseline probability of each option for the player's actual hand. */
  handProbs: number[];
  preflop?: PreflopScenario;
  adjusted: boolean;
  chosen: Action;
}

export interface HandRunnerOptions {
  /** Hero index, or -1 when every seat is a bot. */
  heroIndex: number;
  rng: Rng;
  /** Strategy of each seat. The hero's entry is ignored. Defaults to the baseline for everyone. */
  policies?: Policy[];
  /** Strategy everyone assumes the others play, used for public range estimates. */
  observer?: Policy;
  sizing?: SizingOptions;
}

/**
 * Runs one hand. At every decision it asks the acting seat's policy for a range strategy,
 * lets bots act on it, and keeps two sets of range estimates up to date:
 *   beliefs  what the table can infer, assuming everyone plays the observer strategy
 *   actual   what each bot's range really is, given the strategy it really plays
 * It also records what the baseline strategy would do at each of the hero's decisions.
 */
export class HandRunner {
  readonly hand: HandState;
  readonly heroIndex: number;
  readonly beliefs: RangeTracker;
  readonly actual: RangeTracker;
  readonly decisions: DecisionRecord[] = [];
  readonly policies: Policy[];
  readonly observer: Policy;
  private readonly rng: Rng;
  private readonly sizing: SizingOptions;
  private table: StrengthTable | null = null;
  private tableSize = 0;
  private actions = 0;
  private strategy: RangeStrategy | null = null;
  private observerStrategy: RangeStrategy | null = null;
  private baseline: RangeStrategy | null = null;
  private legal: LegalActions | null = null;

  constructor(hand: HandState, options: HandRunnerOptions) {
    this.hand = hand;
    this.heroIndex = options.heroIndex;
    this.rng = options.rng;
    const n = hand.players.length;
    this.policies = options.policies ?? new Array<Policy>(n).fill(baselinePolicy);
    this.observer = options.observer ?? baselinePolicy;
    this.sizing = options.sizing ?? DEFAULT_SIZING;
    this.beliefs = new RangeTracker(n);
    this.actual = new RangeTracker(n);
    this.prepare();
  }

  /** Alias kept for callers that only need one set of ranges. */
  get tracker(): RangeTracker {
    return this.beliefs;
  }

  get isComplete(): boolean {
    return this.hand.isComplete;
  }

  get heroToAct(): boolean {
    return !this.hand.isComplete && this.hand.toAct === this.heroIndex;
  }

  /** The acting seat's strategy at the current decision. */
  get currentStrategy(): RangeStrategy | null {
    return this.strategy;
  }

  /** The baseline strategy at the current decision (for the hero, what grading compares to). */
  get baselineStrategy(): RangeStrategy | null {
    return this.baseline;
  }

  get currentLegal(): LegalActions | null {
    return this.legal;
  }

  get strengthTable(): StrengthTable | null {
    return this.table;
  }

  get actionCount(): number {
    return this.actions;
  }

  private context(legal: LegalActions) {
    return {
      view: toPublicView(this.hand),
      actor: this.hand.toAct,
      legal,
      ranges: this.beliefs.ranges,
      table: this.table,
      sizing: this.sizing,
    };
  }

  private prepare(): void {
    const hand = this.hand;
    if (hand.board.length !== this.tableSize) {
      this.tableSize = hand.board.length;
      this.beliefs.removeCards(hand.board);
      this.actual.removeCards(hand.board);
      this.table = hand.board.length >= 3 ? buildStrengthTable(hand.board) : null;
    }
    this.strategy = null;
    this.observerStrategy = null;
    this.baseline = null;
    this.legal = getLegalActions(hand);
    if (!this.legal) return;
    const ctx = this.context(this.legal);
    const actor = hand.toAct;
    const isHero = actor === this.heroIndex;
    const policy = isHero ? baselinePolicy : this.policies[actor]!;
    this.strategy = policy.rangeStrategy(ctx);
    this.observerStrategy = this.observer === policy ? this.strategy : this.observer.rangeStrategy(ctx);
    if (isHero) this.baseline = this.strategy;
  }

  /** Apply an action for the player to act (hero or bot). */
  act(action: Action): void {
    const hand = this.hand;
    const strategy = this.strategy;
    const observed = this.observerStrategy;
    const legal = this.legal;
    if (!strategy || !observed || !legal) throw new Error('No decision is pending');
    const actor = hand.toAct;
    const street = hand.street;
    const eventIndex = hand.events.length;
    applyAction(hand, action);
    if (actor === this.heroIndex) {
      const hole = hand.players[actor]!.hole;
      const combo = comboIndex(hole[0], hole[1]);
      this.decisions.push({
        eventIndex,
        actionIndex: this.actions,
        player: actor,
        street,
        legal,
        options: strategy.options,
        handProbs: strategy.probs.map((p) => p[combo]!),
        preflop: strategy.preflop,
        adjusted: strategy.adjusted ?? false,
        chosen: action,
      });
    }
    this.actions++;
    this.beliefs.observe(actor, observed, action);
    this.actual.observe(actor, strategy, action);
    this.prepare();
  }

  /** Sample the acting bot's action from its strategy, using its actual hole cards. */
  botAction(): Action {
    const strategy = this.strategy;
    if (!strategy) throw new Error('No decision is pending');
    const hole = this.hand.players[this.hand.toAct]!.hole;
    const combo = comboIndex(hole[0], hole[1]);
    let total = 0;
    for (const p of strategy.probs) total += p[combo]!;
    if (total <= 0) {
      const passive = strategy.options.find((o) => o.kind === 'passive') ?? strategy.options[0]!;
      return passive.action;
    }
    let roll = this.rng.next() * total;
    for (let o = 0; o < strategy.options.length; o++) {
      roll -= strategy.probs[o]![combo]!;
      if (roll < 0) return strategy.options[o]!.action;
    }
    return strategy.options[strategy.options.length - 1]!.action;
  }

  /** Let one bot act. */
  stepBot(): Action {
    if (this.heroToAct) throw new Error('It is the hero to act');
    const action = this.botAction();
    this.act(action);
    return action;
  }

  /** Play bot actions until the hero must act or the hand ends. */
  runBots(): void {
    while (!this.hand.isComplete && this.hand.toAct !== this.heroIndex) this.stepBot();
  }
}
