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
  heroIndex: number;
  rng: Rng;
  policy?: Policy;
  sizing?: SizingOptions;
}

/**
 * Runs one hand: asks the policy for a range strategy at every decision, lets bots act
 * on it, keeps the range estimates up to date, and records the hero's decisions.
 */
export class HandRunner {
  readonly hand: HandState;
  readonly heroIndex: number;
  readonly tracker: RangeTracker;
  readonly decisions: DecisionRecord[] = [];
  private readonly rng: Rng;
  private readonly policy: Policy;
  private readonly sizing: SizingOptions;
  private table: StrengthTable | null = null;
  private tableSize = 0;
  private strategy: RangeStrategy | null = null;
  private legal: LegalActions | null = null;

  constructor(hand: HandState, options: HandRunnerOptions) {
    this.hand = hand;
    this.heroIndex = options.heroIndex;
    this.rng = options.rng;
    this.policy = options.policy ?? baselinePolicy;
    this.sizing = options.sizing ?? DEFAULT_SIZING;
    this.tracker = new RangeTracker(hand.players.length);
    this.prepare();
  }

  get isComplete(): boolean {
    return this.hand.isComplete;
  }

  get heroToAct(): boolean {
    return !this.hand.isComplete && this.hand.toAct === this.heroIndex;
  }

  /** The baseline range strategy for the player to act. */
  get currentStrategy(): RangeStrategy | null {
    return this.strategy;
  }

  get currentLegal(): LegalActions | null {
    return this.legal;
  }

  private prepare(): void {
    const hand = this.hand;
    if (hand.board.length !== this.tableSize) {
      this.tableSize = hand.board.length;
      this.tracker.removeCards(hand.board);
      this.table = hand.board.length >= 3 ? buildStrengthTable(hand.board) : null;
    }
    this.strategy = null;
    this.legal = getLegalActions(hand);
    if (!this.legal) return;
    this.strategy = this.policy.rangeStrategy({
      view: toPublicView(hand),
      actor: hand.toAct,
      legal: this.legal,
      ranges: this.tracker.ranges,
      table: this.table,
      sizing: this.sizing,
    });
  }

  /** Apply an action for the player to act (hero or bot). */
  act(action: Action): void {
    const hand = this.hand;
    const strategy = this.strategy;
    const legal = this.legal;
    if (!strategy || !legal) throw new Error('No decision is pending');
    const actor = hand.toAct;
    const street = hand.street;
    const eventIndex = hand.events.length;
    applyAction(hand, action);
    if (actor === this.heroIndex) {
      const hole = hand.players[actor]!.hole;
      const combo = comboIndex(hole[0], hole[1]);
      this.decisions.push({
        eventIndex,
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
    this.tracker.observe(actor, strategy, action);
    this.prepare();
  }

  /** Sample the baseline action for the bot to act, using its actual hole cards. */
  botAction(): Action {
    const strategy = this.strategy;
    if (!strategy) throw new Error('No decision is pending');
    const hole = this.hand.players[this.hand.toAct]!.hole;
    const combo = comboIndex(hole[0], hole[1]);
    let total = 0;
    for (const p of strategy.probs) total += p[combo]!;
    if (total <= 0) {
      // Should not happen; fall back to the passive option.
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
