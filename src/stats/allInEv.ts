import type { Card } from '../engine/cards';
import { seededRng } from '../engine/rng';
import type { HandState } from '../engine/types';
import { calcEquity } from '../eval/equity';

/**
 * The hero's result with luck removed from all-in showdowns: when the money went in before
 * the river, the pots are shared by equity at that moment instead of by the actual runout.
 * Needs everyone's real cards, so it only applies to hands from the practice table.
 */
export function allInAdjustedNet(hand: HandState, heroIndex: number): number {
  const result = hand.result;
  const actual = result?.net[heroIndex] ?? 0;
  if (!result || !result.showdown) return actual;
  let lastAction = -1;
  hand.events.forEach((e, i) => {
    if (e.kind === 'action') lastAction = i;
  });
  let boardAtAllIn = 0;
  let dealtAfter = false;
  hand.events.forEach((e, i) => {
    if (e.kind !== 'deal') return;
    if (i < lastAction) boardAtAllIn += e.cards.length;
    else dealtAfter = true;
  });
  if (!dealtAfter || boardAtAllIn >= 5) return actual;
  const board: Card[] = hand.board.slice(0, boardAtAllIn);
  const rng = seededRng(hand.handId * 31 + 7);
  let expected = 0;
  for (const pot of result.pots) {
    if (!pot.eligible.includes(heroIndex)) continue;
    if (pot.eligible.length === 1) {
      expected += pot.amount;
      continue;
    }
    const players = pot.eligible.map((i) => ({ cards: hand.players[i]!.hole.slice() }));
    const eq = calcEquity(players, board, 20000, rng);
    expected += pot.amount * eq.equity[pot.eligible.indexOf(heroIndex)]!;
  }
  return actual - result.winnings[heroIndex]! + expected;
}
