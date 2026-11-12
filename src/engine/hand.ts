import { evaluate } from '../eval/evaluator';
import { fullDeck, type Card } from './cards';
import { assignPositions } from './positions';
import { shuffle, type Rng } from './rng';
import type {
  Action,
  ActionType,
  Chips,
  HandConfig,
  HandEvent,
  HandResult,
  HandState,
  LegalActions,
  PlayerState,
  PotResult,
  PublicView,
  SeatInput,
  Street,
} from './types';

export interface CreateHandOptions {
  handId: number;
  config: HandConfig;
  /** Players in clockwise order. */
  seats: SeatInput[];
  buttonIndex: number;
  rng: Rng;
  /** Fixed hole cards per player; missing entries are dealt at random. */
  holeCards?: (readonly Card[] | null | undefined)[];
  /** Fixed community cards (a prefix of the five); the rest are dealt at random. */
  board?: readonly Card[];
}

const NEXT_STREET: Record<Street, Street | null> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: null,
};

const BOARD_SIZE: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** Create a hand: post blinds, deal hole cards, and find the first player to act. */
export function createHand(opts: CreateHandOptions): HandState {
  const { seats, config, buttonIndex } = opts;
  const n = seats.length;
  if (n < 2 || n > 9) throw new Error(`Unsupported player count: ${n}`);
  if (buttonIndex < 0 || buttonIndex >= n) throw new Error(`Bad button index: ${buttonIndex}`);
  for (const seat of seats) {
    if (!Number.isInteger(seat.stack) || seat.stack <= 0) {
      throw new Error(`Player ${seat.name} needs a positive integer stack`);
    }
  }

  // Deal: fixed cards are honored, everything else comes from a shuffled deck.
  const used = new Set<Card>();
  const claim = (card: Card) => {
    if (used.has(card)) throw new Error(`Duplicate card: ${card}`);
    used.add(card);
  };
  const fixedHoles = seats.map((_, i) => {
    const h = opts.holeCards?.[i];
    if (!h) return null;
    if (h.length !== 2) throw new Error('Hole cards must be two cards');
    claim(h[0]!);
    claim(h[1]!);
    return [h[0]!, h[1]!] as [Card, Card];
  });
  const fixedBoard = (opts.board ?? []).slice(0, 5);
  fixedBoard.forEach(claim);
  const deck = shuffle(
    fullDeck().filter((c) => !used.has(c)),
    opts.rng,
  );
  let deckPos = 0;
  const draw = (): Card => deck[deckPos++]!;

  const positions = assignPositions(n, buttonIndex);
  const players: PlayerState[] = seats.map((seat, i) => ({
    index: i,
    name: seat.name,
    isHero: seat.isHero,
    position: positions[i]!,
    stack: seat.stack,
    startStack: seat.stack,
    folded: false,
    allIn: false,
    betThisStreet: 0,
    totalContributed: 0,
    hasActed: false,
    matchedLevel: 0,
    hole: fixedHoles[i] ?? [draw(), draw()],
  }));
  const runout = fixedBoard.slice();
  while (runout.length < 5) runout.push(draw());

  const sbIndex = n === 2 ? buttonIndex : (buttonIndex + 1) % n;
  const bbIndex = n === 2 ? (buttonIndex + 1) % n : (buttonIndex + 2) % n;

  const state: HandState = {
    handId: opts.handId,
    config,
    players,
    buttonIndex,
    sbIndex,
    bbIndex,
    straddleIndex: -1,
    board: [],
    runout,
    street: 'preflop',
    currentBet: 0,
    minRaise: config.bigBlind,
    lastAggressor: -1,
    prevStreetAggressor: -1,
    toAct: -1,
    isComplete: false,
    events: [],
    result: null,
  };

  const post = (index: number, amount: Chips, blind: 'sb' | 'bb' | 'straddle') => {
    const p = players[index]!;
    const paid = commit(p, amount);
    state.events.push({ kind: 'post', player: index, blind, amount: paid, allIn: p.allIn });
  };
  post(sbIndex, config.smallBlind, 'sb');
  post(bbIndex, config.bigBlind, 'bb');

  let level = config.bigBlind;
  let lastPoster = bbIndex;
  if (config.straddle > config.bigBlind && n >= 4) {
    const straddler = (bbIndex + 1) % n;
    // Only straddle when the player keeps chips behind afterwards.
    if (players[straddler]!.stack > config.straddle) {
      post(straddler, config.straddle, 'straddle');
      state.straddleIndex = straddler;
      level = config.straddle;
      lastPoster = straddler;
    }
  }
  // A short blind does not lower the amount others must call.
  state.currentBet = level;
  state.minRaise = level;

  state.toAct = findNextToAct(state, lastPoster);
  if (state.toAct < 0) endStreet(state);
  return state;
}

/** Move chips from a player's stack into the pot. Returns the amount actually paid. */
function commit(p: PlayerState, amount: Chips): Chips {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.betThisStreet += paid;
  p.totalContributed += paid;
  if (p.stack === 0) p.allIn = true;
  return paid;
}

/** Total chips in the pot, including bets on the current street. */
export function potTotal(view: PublicView): Chips {
  let total = 0;
  for (const p of view.players) total += p.totalContributed;
  return total;
}

/** Number of players who have not folded. */
export function liveCount(view: PublicView): number {
  let count = 0;
  for (const p of view.players) if (!p.folded) count++;
  return count;
}

function findNextToAct(state: PublicView, from: number): number {
  const players = state.players;
  const n = players.length;
  let canAct = 0;
  let sole = -1;
  for (let i = 0; i < n; i++) {
    const p = players[i]!;
    if (!p.folded && !p.allIn) {
      canAct++;
      sole = i;
    }
  }
  if (canAct === 0) return -1;
  if (canAct === 1) {
    // A lone player with chips only acts when facing a bet; nobody can respond to a bet of theirs.
    return players[sole]!.betThisStreet < state.currentBet ? sole : -1;
  }
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const p = players[i]!;
    if (p.folded || p.allIn) continue;
    if (!p.hasActed || p.betThisStreet < state.currentBet) return i;
  }
  return -1;
}

/** Legal actions for the player to act, or null when nobody can act. */
export function getLegalActions(state: PublicView): LegalActions | null {
  if (state.isComplete || state.toAct < 0) return null;
  const p = state.players[state.toAct]!;
  const toCall = Math.max(0, state.currentBet - p.betThisStreet);
  const callAmount = Math.min(toCall, p.stack);
  const maxRaiseTo = p.betThisStreet + p.stack;

  let othersCanAct = false;
  for (const q of state.players) {
    if (q.index !== p.index && !q.folded && !q.allIn) {
      othersCanAct = true;
      break;
    }
  }
  // A player who already acted may only raise again when facing at least a full raise.
  const reopened = !p.hasActed || state.currentBet - p.matchedLevel >= state.minRaise;
  const canRaise = reopened && othersCanAct && maxRaiseTo > state.currentBet;
  const fullMinTo = state.currentBet + state.minRaise;

  return {
    player: p.index,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount,
    canRaise,
    raiseType: state.currentBet === 0 ? 'bet' : 'raise',
    minRaiseTo: canRaise ? Math.min(fullMinTo, maxRaiseTo) : 0,
    maxRaiseTo: canRaise ? maxRaiseTo : 0,
  };
}

/** Apply an action for the player to act. Throws when the action is illegal. */
export function applyAction(state: HandState, action: Action): void {
  const legal = getLegalActions(state);
  if (!legal) throw new Error('No player can act');
  const index = state.toAct;
  const p = state.players[index]!;
  const potBefore = potTotal(state);
  let type: ActionType = action.type;
  let paid = 0;

  switch (action.type) {
    case 'fold':
      p.folded = true;
      break;
    case 'check':
      if (!legal.canCheck) throw new Error('Cannot check when facing a bet');
      break;
    case 'call':
      if (!legal.canCall) throw new Error('Nothing to call');
      paid = commit(p, legal.callAmount);
      break;
    case 'bet':
    case 'raise': {
      if (!legal.canRaise) throw new Error('Raising is not allowed');
      const to = action.amount;
      if (to === undefined || !Number.isInteger(to)) throw new Error('Raise needs an integer amount');
      if (to > legal.maxRaiseTo) throw new Error(`Raise to ${to} exceeds stack`);
      if (to < legal.minRaiseTo) throw new Error(`Raise to ${to} is below the minimum ${legal.minRaiseTo}`);
      const raiseSize = to - state.currentBet;
      paid = commit(p, to - p.betThisStreet);
      // An all-in for less than a full raise does not change the minimum raise.
      if (raiseSize >= state.minRaise) state.minRaise = raiseSize;
      state.currentBet = to;
      state.lastAggressor = index;
      type = legal.raiseType;
      break;
    }
    default:
      throw new Error(`Unknown action: ${String(action.type)}`);
  }

  p.hasActed = true;
  p.matchedLevel = state.currentBet;
  state.events.push({
    kind: 'action',
    player: index,
    street: state.street,
    type,
    amount: paid,
    to: p.betThisStreet,
    allIn: p.allIn,
    potBefore,
  });

  if (liveCount(state) === 1) {
    settle(state, false);
    return;
  }
  const next = findNextToAct(state, index);
  if (next >= 0) {
    state.toAct = next;
    return;
  }
  endStreet(state);
}

/** Close the current street: deal the next one, or go to showdown after the river. */
function endStreet(state: HandState): void {
  for (;;) {
    const next = NEXT_STREET[state.street];
    if (!next) {
      settle(state, true);
      return;
    }
    state.street = next;
    const dealt = state.runout.slice(state.board.length, BOARD_SIZE[next]);
    state.board = state.runout.slice(0, BOARD_SIZE[next]);
    state.events.push({ kind: 'deal', street: next, cards: dealt });
    for (const p of state.players) {
      p.betThisStreet = 0;
      p.hasActed = false;
      p.matchedLevel = 0;
    }
    state.currentBet = 0;
    state.minRaise = state.config.bigBlind;
    state.prevStreetAggressor = state.lastAggressor;
    state.lastAggressor = -1;
    state.toAct = findNextToAct(state, state.buttonIndex);
    if (state.toAct >= 0) return;
  }
}

/** Split contributions into a main pot and side pots. */
export function buildPots(players: readonly { totalContributed: Chips; folded: boolean }[]): {
  amount: Chips;
  eligible: number[];
}[] {
  const levels = Array.from(
    new Set(players.filter((p) => !p.folded && p.totalContributed > 0).map((p) => p.totalContributed)),
  ).sort((a, b) => a - b);
  const pots: { amount: Chips; eligible: number[] }[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    const eligible: number[] = [];
    players.forEach((p, i) => {
      amount += Math.min(p.totalContributed, level) - Math.min(p.totalContributed, prev);
      if (!p.folded && p.totalContributed >= level) eligible.push(i);
    });
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  return pots;
}

/** Finish the hand: return uncalled bets, take rake, and award the pots. */
function settle(state: HandState, showdown: boolean): void {
  const players = state.players;
  const n = players.length;
  const events = state.events;

  // Return the part of the largest bet that nobody matched.
  let top = 0;
  for (let i = 1; i < n; i++) {
    if (players[i]!.totalContributed > players[top]!.totalContributed) top = i;
  }
  let second = 0;
  for (let i = 0; i < n; i++) {
    if (i !== top && players[i]!.totalContributed > second) second = players[i]!.totalContributed;
  }
  const excess = players[top]!.totalContributed - second;
  if (excess > 0) {
    players[top]!.totalContributed -= excess;
    players[top]!.stack += excess;
    events.push({ kind: 'uncalled', player: top, amount: excess });
  }

  const pots = buildPots(players);
  let total = 0;
  for (const pot of pots) total += pot.amount;

  const { rake: rakeConfig } = state.config;
  let rake = 0;
  if (rakeConfig.percent > 0 && !(rakeConfig.noFlopNoDrop && state.board.length < 3)) {
    rake = Math.floor((total * rakeConfig.percent) / 100);
    if (rakeConfig.cap > 0) rake = Math.min(rake, rakeConfig.cap);
  }
  if (rake > 0) {
    let left = rake;
    for (const pot of pots) {
      const take = Math.min(left, pot.amount);
      pot.amount -= take;
      left -= take;
      if (left === 0) break;
    }
    events.push({ kind: 'rake', amount: rake });
  }

  const scores: (number | null)[] = new Array<number | null>(n).fill(null);
  if (showdown) {
    const cards: Card[] = [0, 0, ...state.board];
    // Show hands starting with the last aggressor, otherwise the first player left of the button.
    const first = state.lastAggressor >= 0 ? state.lastAggressor : (state.buttonIndex + 1) % n;
    for (let k = 0; k < n; k++) {
      const i = (first + k) % n;
      const p = players[i]!;
      if (p.folded) continue;
      cards[0] = p.hole[0];
      cards[1] = p.hole[1];
      const score = evaluate(cards);
      scores[i] = score;
      events.push({ kind: 'show', player: i, cards: [p.hole[0], p.hole[1]], score });
    }
  }

  const winnings: Chips[] = new Array<Chips>(n).fill(0);
  const potResults: PotResult[] = [];
  pots.forEach((pot, potIndex) => {
    let winners: number[];
    if (showdown) {
      let best = -1;
      for (const i of pot.eligible) best = Math.max(best, scores[i]!);
      winners = pot.eligible.filter((i) => scores[i] === best);
    } else {
      winners = pot.eligible.slice();
    }
    // Odd chips go to the winners closest to the left of the button.
    winners.sort((a, b) => ((a - state.buttonIndex - 1 + n) % n) - ((b - state.buttonIndex - 1 + n) % n));
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const i of winners) {
      let amount = share;
      if (remainder > 0) {
        amount++;
        remainder--;
      }
      if (amount > 0) {
        winnings[i]! += amount;
        players[i]!.stack += amount;
        events.push({ kind: 'win', player: i, amount, pot: potIndex });
      }
    }
    potResults.push({ amount: pot.amount, eligible: pot.eligible, winners });
  });

  const result: HandResult = {
    showdown,
    pots: potResults,
    rake,
    winnings,
    net: players.map((p) => p.stack - p.startStack),
    scores,
  };
  state.result = result;
  state.isComplete = true;
  state.toAct = -1;
}

/** Deep copy of a hand state. Events and config are immutable and shared. */
export function cloneHand(state: HandState): HandState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, hole: [p.hole[0], p.hole[1]] as [Card, Card] })),
    board: state.board.slice(),
    runout: state.runout.slice(),
    events: state.events.slice(),
  };
}

/** Strip private information so a strategy cannot see any hole cards or future cards. */
export function toPublicView(state: HandState): PublicView {
  return {
    handId: state.handId,
    config: state.config,
    players: state.players.map((p) => ({
      index: p.index,
      name: p.name,
      isHero: p.isHero,
      position: p.position,
      stack: p.stack,
      startStack: p.startStack,
      folded: p.folded,
      allIn: p.allIn,
      betThisStreet: p.betThisStreet,
      totalContributed: p.totalContributed,
      hasActed: p.hasActed,
      matchedLevel: p.matchedLevel,
    })),
    buttonIndex: state.buttonIndex,
    sbIndex: state.sbIndex,
    bbIndex: state.bbIndex,
    straddleIndex: state.straddleIndex,
    board: state.board.slice(),
    street: state.street,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    lastAggressor: state.lastAggressor,
    prevStreetAggressor: state.prevStreetAggressor,
    toAct: state.toAct,
    isComplete: state.isComplete,
    events: state.events,
    result: state.result,
  };
}

/** Compact record of a finished hand; enough to replay it exactly. */
export interface HandRecord {
  version: 1;
  handId: number;
  time: number;
  config: HandConfig;
  seats: SeatInput[];
  buttonIndex: number;
  holeCards: [Card, Card][];
  runout: Card[];
  actions: Action[];
}

export function toHandRecord(state: HandState, time: number): HandRecord {
  const actions: Action[] = [];
  for (const e of state.events) {
    if (e.kind !== 'action') continue;
    if (e.type === 'bet' || e.type === 'raise') actions.push({ type: e.type, amount: e.to });
    else actions.push({ type: e.type });
  }
  return {
    version: 1,
    handId: state.handId,
    time,
    config: state.config,
    seats: state.players.map((p) => ({ name: p.name, stack: p.startStack, isHero: p.isHero })),
    buttonIndex: state.buttonIndex,
    holeCards: state.players.map((p) => [p.hole[0], p.hole[1]] as [Card, Card]),
    runout: state.runout.slice(),
    actions,
  };
}

/** Rebuild the final state of a recorded hand by replaying its actions. */
export function replayHand(record: HandRecord, upTo: number = record.actions.length): HandState {
  const state = createHand({
    handId: record.handId,
    config: record.config,
    seats: record.seats,
    buttonIndex: record.buttonIndex,
    rng: { next: () => 0, int: () => 0 },
    holeCards: record.holeCards,
    board: record.runout,
  });
  for (let i = 0; i < upTo && i < record.actions.length; i++) applyAction(state, record.actions[i]!);
  return state;
}

export type { HandEvent };
