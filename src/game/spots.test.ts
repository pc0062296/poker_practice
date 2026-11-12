import { describe, expect, it } from 'vitest';
import { seededRng } from '../engine/rng';
import { beginHand, createSession, placeButton } from '../engine/session';
import { assignPositions } from '../engine/positions';
import { HandRunner } from './handRunner';
import { DEFAULT_LINEUP, observerPolicy, seatPolicies } from './lineup';
import { DEFAULT_TABLE } from './selfPlayStats';
import { runSpot, SPOTS, spotFits } from './spots';
import { buttonFor } from '../review/model';

describe('practice spots', () => {
  it('start every spot in the right place with consistent cards', () => {
    const rng = seededRng(12);
    const session = createSession(DEFAULT_TABLE, [], rng, ['tag', 'limper', 'station', 'nit', 'lag', 'population', 'limper', 'tag']);
    const policies = seatPolicies(session, DEFAULT_LINEUP);
    const observer = observerPolicy(session, DEFAULT_LINEUP);
    for (const spot of SPOTS) {
      expect(spotFits(spot, assignPositions(9, 0))).toBe(true);
      for (let rep = 0; rep < 10; rep++) {
        placeButton(session, buttonFor(9, spot.hero));
        const hand = beginHand(session, rng);
        expect(hand.players[0]!.position).toBe(spot.hero);
        const runner = new HandRunner(hand, { heroIndex: 0, rng, policies, observer });
        const ok = runSpot(runner, spot, 0, rng);
        expect(ok).toBe(true);
        // No card appears twice among hole cards and the board to come.
        const cards = [...hand.players.flatMap((p) => p.hole), ...hand.runout];
        expect(new Set(cards).size).toBe(cards.length);
        expect(hand.board).toEqual(hand.runout.slice(0, hand.board.length));
        if (['btnVsBb', 'coVsBtn', 'bbVsCo', 'threeBetPot', 'limpedPot'].includes(spot.id)) {
          expect(hand.street).toBe('flop');
          expect(hand.players.filter((p) => !p.folded).length).toBe(spot.id === 'limpedPot' ? 5 : 2);
        } else {
          expect(hand.street).toBe('preflop');
          expect(hand.toAct).toBe(0);
        }
        runner.runBots();
      }
    }
  });
});
