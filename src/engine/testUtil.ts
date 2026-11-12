import { parseCards } from './cards';
import { applyAction, createHand, getLegalActions } from './hand';
import { seededRng, type Rng } from './rng';
import type { Action, HandConfig, HandState, RakeConfig } from './types';

export const SB = 50;
export const BB = 100;
export const NO_RAKE: RakeConfig = { percent: 0, cap: 0, noFlopNoDrop: true };

export interface MakeHandOptions {
  button?: number;
  holes?: (string | null)[];
  board?: string;
  straddle?: number;
  rake?: RakeConfig;
  smallBlind?: number;
  bigBlind?: number;
  rng?: Rng;
  heroIndex?: number;
}

/** Build a hand for tests from a list of stacks. */
export function makeHand(stacks: number[], opts: MakeHandOptions = {}): HandState {
  const config: HandConfig = {
    smallBlind: opts.smallBlind ?? SB,
    bigBlind: opts.bigBlind ?? BB,
    straddle: opts.straddle ?? 0,
    rake: opts.rake ?? NO_RAKE,
  };
  return createHand({
    handId: 1,
    config,
    seats: stacks.map((stack, i) => ({ name: `P${i}`, stack, isHero: i === (opts.heroIndex ?? 0) })),
    buttonIndex: opts.button ?? 0,
    rng: opts.rng ?? seededRng(1),
    holeCards: opts.holes?.map((h) => (h ? parseCards(h) : null)),
    board: opts.board ? parseCards(opts.board) : undefined,
  });
}

/**
 * Apply a sequence of actions written as short codes:
 *   f = fold, x = check, c = call, b300 / r300 = bet or raise to 300.
 */
export function play(state: HandState, codes: string): void {
  for (const code of codes.split(/\s+/).filter(Boolean)) {
    applyAction(state, parseCode(code));
  }
}

export function parseCode(code: string): Action {
  switch (code[0]) {
    case 'f':
      return { type: 'fold' };
    case 'x':
      return { type: 'check' };
    case 'c':
      return { type: 'call' };
    case 'b':
      return { type: 'bet', amount: Number(code.slice(1)) };
    case 'r':
      return { type: 'raise', amount: Number(code.slice(1)) };
    default:
      throw new Error(`Bad action code: ${code}`);
  }
}

/** Pick a random legal action; used by simulation tests. */
export function randomAction(state: HandState, rng: Rng): Action {
  const legal = getLegalActions(state);
  if (!legal) throw new Error('No legal actions');
  const roll = rng.next();
  if (legal.canRaise && roll < 0.25) {
    const span = legal.maxRaiseTo - legal.minRaiseTo;
    const pick = rng.next();
    let to = legal.minRaiseTo;
    if (pick < 0.15) to = legal.maxRaiseTo;
    else if (span > 0) to = legal.minRaiseTo + rng.int(Math.min(span, 2000) + 1);
    return { type: legal.raiseType, amount: to };
  }
  if (legal.canCheck) return roll < 0.97 ? { type: 'check' } : { type: 'fold' };
  return roll < 0.65 ? { type: 'call' } : { type: 'fold' };
}
