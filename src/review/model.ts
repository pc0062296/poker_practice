import type { Card } from '../engine/cards';
import { applyAction, createHand, getLegalActions, type HandRecord } from '../engine/hand';
import { assignPositions } from '../engine/positions';
import type { Action, Chips, HandState, PositionName } from '../engine/types';

/**
 * A hand the user played live and typed in. The hero always sits at index 0; the button is
 * placed so the hero gets the chosen position. Opponents' hole cards are unknown unless they
 * were shown; placeholders fill them in, and nothing in the analysis looks at placeholders.
 */
export interface ReviewHand {
  id?: number;
  title: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  numPlayers: number;
  heroPosition: PositionName;
  /** Starting stacks in chips (1 big blind = 100), index 0 = hero, then clockwise. */
  stacks: Chips[];
  smallBlind: Chips;
  bigBlind: Chips;
  straddle: Chips;
  heroCards: Card[];
  /** Community cards entered so far. */
  board: Card[];
  actions: Action[];
  /** Cards an opponent showed at the end, if any. */
  shown: (Card[] | null)[];
  /** Player type the user assigns to each seat (index 0 is ignored). */
  profiles: string[];
}

export const BB = 100;

export function newReview(): ReviewHand {
  const n = 9;
  const now = Date.now();
  return {
    title: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
    numPlayers: n,
    heroPosition: 'BTN',
    stacks: new Array<Chips>(n).fill(200 * BB),
    smallBlind: BB / 2,
    bigBlind: BB,
    straddle: 0,
    heroCards: [],
    board: [],
    actions: [],
    shown: new Array<Card[] | null>(n).fill(null),
    profiles: new Array<string>(n).fill('population'),
  };
}

/** Change the number of players, keeping what still fits. */
export function resizeReview(review: ReviewHand, numPlayers: number): ReviewHand {
  const fit = <T,>(list: T[], fill: T): T[] => {
    const out = list.slice(0, numPlayers);
    while (out.length < numPlayers) out.push(fill);
    return out;
  };
  const positions = assignPositions(numPlayers, 0);
  return {
    ...review,
    numPlayers,
    heroPosition: positions.includes(review.heroPosition) ? review.heroPosition : 'BTN',
    stacks: fit(review.stacks, 200 * BB),
    shown: fit(review.shown, null),
    profiles: fit(review.profiles, 'population'),
    actions: [],
    board: [],
  };
}

/** Button index that gives the hero (index 0) the chosen position. */
export function buttonFor(numPlayers: number, heroPosition: PositionName): number {
  for (let b = 0; b < numPlayers; b++) {
    if (assignPositions(numPlayers, b)[0] === heroPosition) return b;
  }
  return 0;
}

/** Positions of every seat, index 0 = hero. */
export function reviewPositions(review: ReviewHand): PositionName[] {
  return assignPositions(review.numPlayers, buttonFor(review.numPlayers, review.heroPosition));
}

/** Hole cards for every seat: the hero's, shown cards, and placeholders for the rest. */
function holeCards(review: ReviewHand): Card[][] {
  const used = new Set<Card>([...review.heroCards, ...review.board]);
  for (const s of review.shown) for (const c of s ?? []) used.add(c);
  const free: Card[] = [];
  for (let c = 51; c >= 0; c--) if (!used.has(c)) free.push(c);
  return Array.from({ length: review.numPlayers }, (_, i) => {
    // Until the hero's cards are chosen, placeholders keep the hand buildable.
    if (i === 0) return review.heroCards.length === 2 ? review.heroCards.slice() : [free.pop()!, free.pop()!];
    const shown = review.shown[i];
    if (shown && shown.length === 2) return shown.slice();
    return [free.pop()!, free.pop()!];
  });
}

export interface BuiltHand {
  hand: HandState;
  /** Actions that could be applied (the rest were illegal and are ignored). */
  applied: number;
  /** Community cards the next street needs before play can go on (0 when none). */
  needCards: number;
  error: string | null;
}

const STREET_SIZE = [0, 3, 4, 5];

/**
 * Rebuild the hand from the entered data, stopping where a street needs community cards
 * that were not entered yet.
 */
export function buildHand(
  review: ReviewHand,
  upTo: number = review.actions.length,
  names?: readonly string[],
): BuiltHand {
  const positions = reviewPositions(review);
  const hand = createHand({
    handId: 1,
    config: {
      smallBlind: review.smallBlind,
      bigBlind: review.bigBlind,
      straddle: review.straddle,
      rake: { percent: 0, cap: 0, noFlopNoDrop: true },
    },
    seats: review.stacks.map((stack, i) => ({ name: names?.[i] ?? (i === 0 ? 'hero' : positions[i]!), stack, isHero: i === 0 })),
    buttonIndex: buttonFor(review.numPlayers, review.heroPosition),
    rng: { next: () => 0, int: () => 0 },
    holeCards: holeCards(review),
    board: review.board,
  });
  let applied = 0;
  let error: string | null = null;
  const boardNeeded = () => (hand.board.length > review.board.length ? hand.board.length - review.board.length : 0);
  for (let i = 0; i < upTo && i < review.actions.length; i++) {
    if (boardNeeded() > 0) break;
    try {
      applyAction(hand, review.actions[i]!);
      applied++;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  let needCards = boardNeeded();
  if (needCards > 0) {
    // When everyone is all-in the whole board comes at once; ask for one street at a time.
    const next = STREET_SIZE.find((size) => size > review.board.length) ?? 5;
    needCards = next - review.board.length;
  }
  return { hand, applied, needCards, error };
}

/** True when the hand has been entered to the end. */
export function isComplete(review: ReviewHand): boolean {
  const built = buildHand(review);
  return built.hand.isComplete && built.needCards === 0 && built.applied === review.actions.length;
}

/** A replayable record for the grader. Board cards not entered are placeholders and unused. */
export function toRecord(review: ReviewHand): HandRecord {
  const built = buildHand(review);
  const hand = built.hand;
  return {
    version: 1,
    handId: 1,
    time: review.updatedAt,
    config: hand.config,
    seats: hand.players.map((p) => ({ name: p.name, stack: p.startStack, isHero: p.isHero })),
    buttonIndex: hand.buttonIndex,
    holeCards: hand.players.map((p) => [p.hole[0], p.hole[1]] as [Card, Card]),
    runout: hand.runout.slice(),
    actions: review.actions.slice(0, built.applied),
  };
}

/** Turn a hand played at the practice table into a review. */
export function reviewFromRecord(record: HandRecord, profiles: string[], heroIndex: number): ReviewHand | null {
  if (heroIndex !== 0) return null;
  const replayed = createHand({
    handId: record.handId,
    config: record.config,
    seats: record.seats,
    buttonIndex: record.buttonIndex,
    rng: { next: () => 0, int: () => 0 },
    holeCards: record.holeCards,
    board: record.runout,
  });
  for (const a of record.actions) applyAction(replayed, a);
  const n = record.seats.length;
  const shown = replayed.players.map((p, i) =>
    i !== 0 && replayed.result?.showdown && !p.folded ? [p.hole[0], p.hole[1]] : null,
  );
  return {
    title: '',
    notes: '',
    createdAt: record.time,
    updatedAt: record.time,
    numPlayers: n,
    heroPosition: assignPositions(n, record.buttonIndex)[0]!,
    stacks: record.seats.map((s) => s.stack),
    smallBlind: record.config.smallBlind,
    bigBlind: record.config.bigBlind,
    straddle: record.config.straddle,
    heroCards: record.holeCards[0]!.slice(),
    board: replayed.board.slice(),
    actions: record.actions.slice(),
    shown,
    profiles: profiles.slice(),
  };
}

/** Legal actions for the player to act in the entered hand, or null. */
export function nextDecision(review: ReviewHand) {
  const built = buildHand(review);
  if (built.needCards > 0 || built.hand.isComplete) return null;
  return getLegalActions(built.hand);
}
