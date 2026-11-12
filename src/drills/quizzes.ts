import { type Card } from '../engine/cards';
import type { Rng } from '../engine/rng';
import { calcEquity } from '../eval/equity';
import { categoryOf, evaluate, HIGH_CARD, STRAIGHT } from '../eval/evaluator';

/**
 * Mental-math quizzes for live play, where nobody shows you the pot or the odds.
 * Amounts are in big blinds.
 */

export type QuizKind = 'potOdds' | 'mdf' | 'outs' | 'potCount' | 'preflopEquity';

export const QUIZ_KINDS: QuizKind[] = ['potOdds', 'mdf', 'outs', 'potCount', 'preflopEquity'];

export interface PotStep {
  /** i18n key for the line and its parameters. */
  key: 'open' | 'call' | 'raise' | 'fold' | 'bet' | 'check' | 'street';
  name?: string;
  amount?: number;
}

export interface Quiz {
  kind: QuizKind;
  /** Parameters for the question text. */
  params: Record<string, string | number>;
  /** Cards to show with the question. */
  hero?: Card[];
  villain?: Card[];
  board?: Card[];
  /** For pot counting: the action to follow. */
  steps?: PotStep[];
  choices: number[];
  answer: number;
  /** Unit of the choices: percent, cards or big blinds. */
  unit: 'percent' | 'cards' | 'bb';
  /** Extra numbers for the explanation. */
  detail: Record<string, number>;
}

function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** Four distinct choices around the answer. */
function choicesAround(answer: number, spread: number, step: number, rng: Rng, min = 0, max = Infinity): number[] {
  const set = new Set<number>([answer]);
  const offsets = shuffle([-3, -2, -1, 1, 2, 3], rng);
  for (const k of offsets) {
    if (set.size >= 4) break;
    const v = roundTo(answer + k * spread, step);
    if (v >= min && v <= max && !set.has(v)) set.add(v);
  }
  return Array.from(set).sort((a, b) => a - b);
}

const BET_FRACTIONS = [1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 1.5];

function potAndBet(rng: Rng): { pot: number; bet: number } {
  const pot = roundTo(4 + rng.next() * 56, 0.5);
  const fraction = BET_FRACTIONS[rng.int(BET_FRACTIONS.length)]!;
  const bet = Math.max(1, roundTo(pot * fraction, 0.5));
  return { pot, bet };
}

function potOddsQuiz(rng: Rng): Quiz {
  const { pot, bet } = potAndBet(rng);
  const answer = Math.round((bet / (pot + 2 * bet)) * 100);
  return {
    kind: 'potOdds',
    params: { pot, bet },
    choices: choicesAround(answer, 6, 1, rng, 1, 99),
    answer,
    unit: 'percent',
    detail: { pot, bet, total: pot + 2 * bet },
  };
}

function mdfQuiz(rng: Rng): Quiz {
  const { pot, bet } = potAndBet(rng);
  const answer = Math.round((pot / (pot + bet)) * 100);
  return {
    kind: 'mdf',
    params: { pot, bet },
    choices: choicesAround(answer, 7, 1, rng, 1, 99),
    answer,
    unit: 'percent',
    detail: { pot, bet },
  };
}

function dealDistinct(rng: Rng, count: number, used: Set<Card>): Card[] {
  const out: Card[] = [];
  while (out.length < count) {
    const c = rng.int(52);
    if (used.has(c)) continue;
    used.add(c);
    out.push(c);
  }
  return out;
}

/** Cards that give the hero a straight or better that the board alone does not make. */
export function countOuts(hero: readonly Card[], board: readonly Card[]): number {
  const used = new Set<Card>([...hero, ...board]);
  let outs = 0;
  for (let c = 0; c < 52; c++) {
    if (used.has(c)) continue;
    const mine = categoryOf(evaluate([...hero, ...board, c]));
    if (mine < STRAIGHT) continue;
    const boardOnly = [...board, c];
    const boardCategory = boardOnly.length >= 5 ? categoryOf(evaluate(boardOnly)) : HIGH_CARD;
    if (boardCategory < mine) outs++;
  }
  return outs;
}

function outsQuiz(rng: Rng): Quiz {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const used = new Set<Card>();
    const hero = dealDistinct(rng, 2, used);
    const boardSize = rng.next() < 0.6 ? 3 : 4;
    const board = dealDistinct(rng, boardSize, used);
    // Only drawing hands: no pair or better yet.
    if (categoryOf(evaluate([...hero, ...board])) !== HIGH_CARD) continue;
    const outs = countOuts(hero, board);
    if (outs < 4 || outs > 15) continue;
    const toCome = 5 - boardSize;
    const exact = toCome === 2 ? 1 - ((47 - outs) / 47) * ((46 - outs) / 46) : outs / 46;
    return {
      kind: 'outs',
      params: { street: boardSize === 3 ? 'flop' : 'turn' },
      hero,
      board,
      choices: choicesAround(outs, 2, 1, rng, 1, 20),
      answer: outs,
      unit: 'cards',
      detail: { outs, rule: outs * (toCome === 2 ? 4 : 2), exact: Math.round(exact * 100), toCome },
    };
  }
  throw new Error('Could not build an outs question');
}

const NAMES = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

/** A short preflop and flop sequence; the question is the pot at the end. */
function potCountQuiz(rng: Rng): Quiz {
  const steps: PotStep[] = [];
  const opener = NAMES[rng.int(3)]!;
  const open = [2.5, 3, 3.5, 4, 5][rng.int(5)]!;
  steps.push({ key: 'open', name: opener, amount: open });
  let pot = 1.5 + open;
  const callers: string[] = [];
  for (const name of NAMES.slice(NAMES.indexOf(opener) + 1)) {
    if (rng.next() < 0.35) {
      steps.push({ key: 'call', name, amount: open });
      // A blind only adds the difference to what it already posted.
      pot += name === 'SB' ? open - 0.5 : name === 'BB' ? open - 1 : open;
      callers.push(name);
    } else {
      steps.push({ key: 'fold', name });
    }
  }
  if (callers.length === 0) {
    // Someone has to call: the big blind defends.
    const last = steps[steps.length - 1]!;
    last.key = 'call';
    last.amount = open;
    pot += open - 1;
    callers.push('BB');
  }
  // Dead blinds when the blinds folded are already counted in the starting 1.5.
  steps.push({ key: 'street' });
  const bettor = rng.next() < 0.5 ? opener : callers[0]!;
  const bet = Math.max(1, roundTo(pot * BET_FRACTIONS[rng.int(4)]!, 0.5));
  steps.push({ key: 'bet', name: bettor, amount: bet });
  pot += bet;
  const others = [opener, ...callers].filter((n) => n !== bettor);
  for (const name of others) {
    if (rng.next() < 0.55) {
      steps.push({ key: 'call', name, amount: bet });
      pot += bet;
    } else steps.push({ key: 'fold', name });
  }
  const answer = roundTo(pot, 0.5);
  return {
    kind: 'potCount',
    params: {},
    steps,
    choices: choicesAround(answer, Math.max(1.5, roundTo(answer * 0.12, 0.5)), 0.5, rng, 1),
    answer,
    unit: 'bb',
    detail: { pot: answer },
  };
}

function preflopEquityQuiz(rng: Rng): Quiz {
  const used = new Set<Card>();
  const hero = dealDistinct(rng, 2, used);
  const villain = dealDistinct(rng, 2, used);
  const result = calcEquity([{ cards: hero }, { cards: villain }], [], 4000, rng);
  const answer = roundTo(result.equity[0]! * 100, 5);
  return {
    kind: 'preflopEquity',
    params: {},
    hero,
    villain,
    choices: choicesAround(answer, 10, 5, rng, 5, 95),
    answer,
    unit: 'percent',
    detail: { equity: Math.round(result.equity[0]! * 100) },
  };
}

export function makeQuiz(kind: QuizKind, rng: Rng): Quiz {
  switch (kind) {
    case 'potOdds':
      return potOddsQuiz(rng);
    case 'mdf':
      return mdfQuiz(rng);
    case 'outs':
      return outsQuiz(rng);
    case 'potCount':
      return potCountQuiz(rng);
    default:
      return preflopEquityQuiz(rng);
  }
}
