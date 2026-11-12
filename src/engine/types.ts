import type { Card } from './cards';

/** All chip amounts are integers. By convention 1 big blind = 100 units. */
export type Chips = number;

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';

/**
 * A player action. For bet and raise, `amount` is the total the player will have
 * put in on the current street after the action (a "raise to" amount).
 */
export interface Action {
  type: ActionType;
  amount?: Chips;
}

export type PositionName = 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'UTG+2' | 'LJ' | 'HJ' | 'CO';

export interface RakeConfig {
  /** Percent of the pot, e.g. 5 for 5%. */
  percent: number;
  /** Maximum rake in chips. 0 means no cap. */
  cap: Chips;
  /** No rake when the hand ends before the flop. */
  noFlopNoDrop: boolean;
}

export interface HandConfig {
  smallBlind: Chips;
  bigBlind: Chips;
  /** Straddle amount posted by the player left of the big blind. 0 means no straddle. */
  straddle: Chips;
  rake: RakeConfig;
}

export interface SeatInput {
  name: string;
  stack: Chips;
  isHero: boolean;
}

/** Information about a player that everyone at the table can see. */
export interface PublicPlayer {
  index: number;
  name: string;
  isHero: boolean;
  position: PositionName;
  stack: Chips;
  startStack: Chips;
  folded: boolean;
  allIn: boolean;
  betThisStreet: Chips;
  totalContributed: Chips;
  hasActed: boolean;
  /** Bet level the player last matched or set on this street. */
  matchedLevel: Chips;
}

export interface PlayerState extends PublicPlayer {
  hole: [Card, Card];
}

export type HandEvent =
  | { kind: 'post'; player: number; blind: 'sb' | 'bb' | 'straddle'; amount: Chips; allIn: boolean }
  | { kind: 'deal'; street: Street; cards: Card[] }
  | {
      kind: 'action';
      player: number;
      street: Street;
      type: ActionType;
      /** Chips added by this action. */
      amount: Chips;
      /** The player's total bet on this street after the action. */
      to: Chips;
      allIn: boolean;
      /** Total pot before the action. */
      potBefore: Chips;
    }
  | { kind: 'uncalled'; player: number; amount: Chips }
  | { kind: 'show'; player: number; cards: [Card, Card]; score: number }
  | { kind: 'rake'; amount: Chips }
  | { kind: 'win'; player: number; amount: Chips; pot: number };

export interface PotResult {
  amount: Chips;
  eligible: number[];
  winners: number[];
}

export interface HandResult {
  showdown: boolean;
  pots: PotResult[];
  rake: Chips;
  /** Chips awarded to each player from the pots. */
  winnings: Chips[];
  /** Final stack minus starting stack for each player. */
  net: Chips[];
  /** Showdown scores; null for players who did not show. */
  scores: (number | null)[];
}

/** Everything about a hand that is public knowledge. Strategies only ever see this. */
export interface PublicView {
  handId: number;
  config: HandConfig;
  players: PublicPlayer[];
  buttonIndex: number;
  sbIndex: number;
  bbIndex: number;
  /** Index of the player who posted a straddle, or -1. */
  straddleIndex: number;
  board: Card[];
  street: Street;
  /** Highest total bet on the current street. */
  currentBet: Chips;
  /** Size of the last full bet or raise; the minimum legal raise increment. */
  minRaise: Chips;
  /** Last player to bet or raise on the current street, or -1. */
  lastAggressor: number;
  /** Last player to bet or raise on the previous street, or -1. */
  prevStreetAggressor: number;
  /** Player to act, or -1 when nobody can act. */
  toAct: number;
  isComplete: boolean;
  events: HandEvent[];
  result: HandResult | null;
}

export interface HandState extends PublicView {
  players: PlayerState[];
  /** The five community cards for this hand; `board` reveals them street by street. */
  runout: Card[];
}

export interface LegalActions {
  player: number;
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to call (capped at the player's stack). */
  callAmount: Chips;
  canRaise: boolean;
  /** Whether an aggressive action is a bet (no bet yet) or a raise. */
  raiseType: 'bet' | 'raise';
  /** Minimum and maximum legal "raise to" totals. */
  minRaiseTo: Chips;
  maxRaiseTo: Chips;
}
