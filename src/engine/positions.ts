import type { PositionName } from './types';

const EARLY: PositionName[] = ['UTG', 'UTG+1', 'UTG+2'];
const LATE: PositionName[] = ['LJ', 'HJ', 'CO'];

/**
 * Position names for the seats between the big blind and the button, in acting order.
 * Late names (LJ, HJ, CO) are assigned from the button backwards; any remaining
 * seats get early names.
 */
function middleNames(count: number): PositionName[] {
  const late = LATE.slice(Math.max(0, LATE.length - count));
  const early = EARLY.slice(0, Math.max(0, count - LATE.length));
  return [...early, ...late];
}

/** Position name for every player index given the button index. */
export function assignPositions(numPlayers: number, buttonIndex: number): PositionName[] {
  const out = new Array<PositionName>(numPlayers);
  if (numPlayers === 2) {
    out[buttonIndex] = 'BTN';
    out[(buttonIndex + 1) % 2] = 'BB';
    return out;
  }
  out[buttonIndex] = 'BTN';
  out[(buttonIndex + 1) % numPlayers] = 'SB';
  out[(buttonIndex + 2) % numPlayers] = 'BB';
  const names = middleNames(numPlayers - 3);
  for (let i = 0; i < names.length; i++) {
    out[(buttonIndex + 3 + i) % numPlayers] = names[i]!;
  }
  return out;
}

/** Order in which players act after the flop: 0 acts first. */
export function postflopOrder(numPlayers: number, buttonIndex: number, playerIndex: number): number {
  return (playerIndex - buttonIndex - 1 + numPlayers) % numPlayers;
}
