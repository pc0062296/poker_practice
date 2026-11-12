import { describe, expect, it } from 'vitest';
import { cardsToString } from './cards';
import {
  applyAction,
  buildPots,
  cloneHand,
  getLegalActions,
  potTotal,
  replayHand,
  toHandRecord,
  toPublicView,
} from './hand';
import { assignPositions } from './positions';
import { seededRng } from './rng';
import { BB, makeHand, NO_RAKE, play, randomAction, SB } from './testUtil';
import type { HandState } from './types';

const stacks = (s: HandState) => s.players.map((p) => p.stack);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('positions', () => {
  it('names all nine seats', () => {
    expect(assignPositions(9, 0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO']);
  });
  it('drops early positions first as the table gets shorter', () => {
    expect(assignPositions(8, 0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO']);
    expect(assignPositions(7, 0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO']);
    expect(assignPositions(6, 0)).toEqual(['BTN', 'SB', 'BB', 'LJ', 'HJ', 'CO']);
    expect(assignPositions(3, 1)).toEqual(['BB', 'BTN', 'SB']);
    expect(assignPositions(2, 1)).toEqual(['BB', 'BTN']);
  });
});

describe('blinds and acting order', () => {
  it('posts blinds and starts with the player left of the big blind', () => {
    const s = makeHand([20000, 20000, 20000, 20000, 20000], { button: 0 });
    expect(s.sbIndex).toBe(1);
    expect(s.bbIndex).toBe(2);
    expect(s.players[1]!.betThisStreet).toBe(SB);
    expect(s.players[2]!.betThisStreet).toBe(BB);
    expect(s.toAct).toBe(3);
    expect(s.currentBet).toBe(BB);
    expect(potTotal(s)).toBe(150);
  });

  it('lets the button act first before the flop and last after it when heads-up', () => {
    const s = makeHand([20000, 20000], { button: 1 });
    expect(s.sbIndex).toBe(1);
    expect(s.bbIndex).toBe(0);
    expect(s.toAct).toBe(1);
    play(s, 'c x');
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(0);
    play(s, 'x');
    expect(s.toAct).toBe(1);
  });

  it('gives the big blind an option after limps', () => {
    const s = makeHand([20000, 20000, 20000, 20000], { button: 0 });
    play(s, 'c c c');
    expect(s.street).toBe('preflop');
    expect(s.toAct).toBe(2);
    const legal = getLegalActions(s)!;
    expect(legal.canCheck).toBe(true);
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(200);
    play(s, 'x');
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(1);
  });

  it('awards the blinds to the big blind when everyone folds', () => {
    const s = makeHand([20000, 20000, 20000, 20000], { button: 0, rake: { percent: 5, cap: 300, noFlopNoDrop: true } });
    play(s, 'f f f');
    expect(s.isComplete).toBe(true);
    expect(s.result!.showdown).toBe(false);
    expect(s.result!.net).toEqual([0, -50, 50, 0]);
    expect(s.result!.rake).toBe(0);
  });

  it('handles a straddle: action starts after the straddler, who acts last', () => {
    const s = makeHand([20000, 20000, 20000, 20000, 20000], { button: 0, straddle: 200 });
    expect(s.straddleIndex).toBe(3);
    expect(s.currentBet).toBe(200);
    expect(s.toAct).toBe(4);
    expect(getLegalActions(s)!.minRaiseTo).toBe(400);
    play(s, 'c c c');
    expect(s.toAct).toBe(2);
    expect(getLegalActions(s)!.callAmount).toBe(100);
    play(s, 'c');
    expect(s.toAct).toBe(3);
    expect(getLegalActions(s)!.canCheck).toBe(true);
    expect(getLegalActions(s)!.canRaise).toBe(true);
    play(s, 'x');
    expect(s.street).toBe('flop');
    expect(potTotal(s)).toBe(1000);
  });

  it('skips the straddle with fewer than four players', () => {
    const s = makeHand([20000, 20000, 20000], { button: 0, straddle: 200 });
    expect(s.straddleIndex).toBe(-1);
    expect(s.currentBet).toBe(BB);
  });
});

describe('betting rules', () => {
  it('enforces the minimum raise', () => {
    const s = makeHand([20000, 20000, 20000, 20000], { button: 0 });
    expect(getLegalActions(s)!.minRaiseTo).toBe(200);
    play(s, 'r300');
    expect(getLegalActions(s)!.minRaiseTo).toBe(500);
    expect(() => applyAction(s, { type: 'raise', amount: 400 })).toThrow();
    play(s, 'r900');
    expect(getLegalActions(s)!.minRaiseTo).toBe(1500);
  });

  it('rejects illegal actions', () => {
    const s = makeHand([20000, 20000, 20000], { button: 0 });
    expect(() => applyAction(s, { type: 'check' })).toThrow();
    expect(() => applyAction(s, { type: 'raise', amount: 30000 })).toThrow();
    expect(() => applyAction(s, { type: 'raise' })).toThrow();
    play(s, 'c c x');
    expect(() => applyAction(s, { type: 'call' })).toThrow();
    expect(() => applyAction(s, { type: 'bet', amount: 50 })).toThrow();
  });

  it('allows an all-in below the minimum raise', () => {
    const s = makeHand([20000, 20000, 20000, 150], { button: 0 });
    const legal = getLegalActions(s)!;
    expect(legal.minRaiseTo).toBe(150);
    expect(legal.maxRaiseTo).toBe(150);
    play(s, 'r150');
    expect(s.players[3]!.allIn).toBe(true);
    expect(s.currentBet).toBe(150);
    // The short all-in raised by only 50, so the minimum raise increment stays 100.
    expect(getLegalActions(s)!.minRaiseTo).toBe(250);
  });

  it('treats an all-in of at least the minimum raise as a full raise', () => {
    const s = makeHand([20000, 20000, 20000, 250], { button: 0 });
    play(s, 'r250');
    expect(getLegalActions(s)!.minRaiseTo).toBe(400);
  });

  it('does not reopen the betting after a short all-in', () => {
    // Flop: P1 bets 1000, P2 calls, P0 shoves for 1400 total (raise of only 400).
    const s = makeHand([1500, 20000, 20000], { button: 0 });
    play(s, 'c c x');
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(1);
    play(s, 'b1000 c r1400');
    expect(s.toAct).toBe(1);
    const legal = getLegalActions(s)!;
    expect(legal.canRaise).toBe(false);
    expect(legal.callAmount).toBe(400);
    play(s, 'c');
    expect(getLegalActions(s)!.canRaise).toBe(false);
    play(s, 'c');
    expect(s.street).toBe('turn');
  });

  it('offers no raise when every remaining opponent is all-in', () => {
    // Flop: P1 bets 1000, P2 shoves 1500, P3 folds, P0 shoves 2200. Nobody is left to respond.
    const s = makeHand([2300, 20000, 1600, 20000], { button: 0 });
    play(s, 'c c c x');
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(1);
    play(s, 'b1000 r1500 f r2200');
    expect(s.toAct).toBe(1);
    const legal = getLegalActions(s)!;
    expect(legal.canRaise).toBe(false);
  });

  it('reopens the betting when short all-ins add up to a full raise', () => {
    const s = makeHand([2300, 20000, 1600, 20000], { button: 0 });
    play(s, 'c c c x');
    play(s, 'b1000 r1500 c r2200');
    // P1 bet 1000 and now faces 2200: a raise of 1200, at least a full raise.
    expect(s.toAct).toBe(1);
    const legal = getLegalActions(s)!;
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(3200);
    // P3 only called 1500 after the 1000 bet... and faces 700 more: not a full raise.
    play(s, 'c');
    expect(s.toAct).toBe(3);
    expect(getLegalActions(s)!.canRaise).toBe(false);
  });

  it('lets a bet go uncalled and returns it', () => {
    const s = makeHand([20000, 20000, 20000], { button: 0 });
    play(s, 'c c x');
    play(s, 'b500 f f');
    expect(s.isComplete).toBe(true);
    expect(s.events.some((e) => e.kind === 'uncalled' && e.player === 1 && e.amount === 500)).toBe(true);
    expect(s.result!.net).toEqual([-100, 200, -100]);
  });

  it('tracks the aggressor of the previous street', () => {
    const s = makeHand([20000, 20000, 20000], { button: 0 });
    play(s, 'r300 c c');
    expect(s.street).toBe('flop');
    expect(s.prevStreetAggressor).toBe(0);
    expect(s.lastAggressor).toBe(-1);
    play(s, 'x x x');
    expect(s.street).toBe('turn');
    expect(s.prevStreetAggressor).toBe(-1);
  });
});

describe('all-in and side pots', () => {
  it('builds side pots from contribution levels', () => {
    const pots = buildPots([
      { totalContributed: 1000, folded: false },
      { totalContributed: 3000, folded: false },
      { totalContributed: 3000, folded: false },
      { totalContributed: 500, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 3500, eligible: [0, 1, 2] },
      { amount: 4000, eligible: [1, 2] },
    ]);
  });

  it('awards main and side pots to different winners', () => {
    // P1 (short) has aces, P2 has kings, P0 (covers everyone) has queens.
    const s = makeHand([5000, 1000, 3000], {
      button: 0,
      holes: ['Qs Qd', 'As Ad', 'Ks Kd'],
      board: '2c 7h 9d Jc 3s',
    });
    play(s, 'r5000 c c');
    expect(s.isComplete).toBe(true);
    expect(s.board.length).toBe(5);
    // 2000 of P0's shove is uncalled.
    expect(s.events.some((e) => e.kind === 'uncalled' && e.player === 0 && e.amount === 2000)).toBe(true);
    expect(s.result!.pots).toEqual([
      { amount: 3000, eligible: [0, 1, 2], winners: [1] },
      { amount: 4000, eligible: [0, 2], winners: [2] },
    ]);
    expect(stacks(s)).toEqual([2000, 3000, 4000]);
  });

  it('does not let a player raise when every opponent is already all-in', () => {
    const s = makeHand([1000, 3000, 5000], { button: 0 });
    play(s, 'r1000 r3000');
    const legal = getLegalActions(s)!;
    expect(legal.canRaise).toBe(false);
    expect(legal.callAmount).toBe(2900);
  });

  it('goes straight to showdown when only one player has chips left', () => {
    const s = makeHand([1000, 20000], { button: 0, holes: ['As Ad', 'Ks Kd'], board: '2c 7h 9d Jc 3s' });
    play(s, 'r1000 c');
    expect(s.isComplete).toBe(true);
    expect(s.result!.showdown).toBe(true);
    expect(stacks(s)).toEqual([2000, 19000]);
    const deals = s.events.filter((e) => e.kind === 'deal');
    expect(deals.map((e) => (e.kind === 'deal' ? e.cards.length : 0))).toEqual([3, 1, 1]);
  });

  it('still asks the covering player to call an all-in', () => {
    const s = makeHand([20000, 1000], { button: 0 });
    // P0 is the button and small blind; limps, P1 shoves.
    play(s, 'c r1000');
    expect(s.toAct).toBe(0);
    const legal = getLegalActions(s)!;
    expect(legal.canRaise).toBe(false);
    expect(legal.callAmount).toBe(900);
  });

  it('handles a big blind that is all-in for less than the blind', () => {
    const s = makeHand([20000, 20000, 30, 20000], {
      button: 0,
      holes: ['2c 3d', '4c 5d', 'As Ad', 'Ks Kd'],
      board: '7h 8h 9d Jc Qs',
    });
    expect(s.players[2]!.allIn).toBe(true);
    expect(s.currentBet).toBe(BB);
    play(s, 'c f f');
    // P3 called 100 but only 50 (the small blind's dead money level) was matched.
    expect(s.isComplete).toBe(true);
    expect(s.events.some((e) => e.kind === 'uncalled' && e.player === 3 && e.amount === 50)).toBe(true);
    expect(s.result!.pots).toEqual([
      { amount: 90, eligible: [2, 3], winners: [2] },
      { amount: 40, eligible: [3], winners: [3] },
    ]);
    expect(stacks(s)).toEqual([20000, 19950, 90, 19990]);
  });

  it('runs out the board when the blinds put both players all-in', () => {
    const s = makeHand([40, 80], { button: 0, holes: ['As Ad', 'Ks Kd'], board: '2c 7h 9d Jc 3s' });
    expect(s.isComplete).toBe(true);
    expect(stacks(s)).toEqual([80, 40]);
  });
});

describe('showdown', () => {
  it('splits a tied pot and gives the odd chip to the first winner left of the button', () => {
    const s = makeHand([20000, 20000, 20000], {
      button: 0,
      smallBlind: 25,
      bigBlind: 50,
      holes: ['As Kd', '7c 2d', 'Ah Kc'],
      board: 'Qs Jd Th 3c 4s',
    });
    // Button raises, small blind folds 25 dead, big blind calls: pot 225.
    play(s, 'r100 f c');
    play(s, 'x x x x x x');
    expect(s.isComplete).toBe(true);
    expect(s.result!.pots[0]!.winners).toEqual([2, 0]);
    expect(s.result!.winnings).toEqual([112, 0, 113]);
  });

  it('shows the hands of everyone who reaches showdown', () => {
    const s = makeHand([20000, 20000, 20000], { button: 0 });
    play(s, 'c c x x x x x x x x x x');
    expect(s.isComplete).toBe(true);
    expect(s.events.filter((e) => e.kind === 'show').length).toBe(3);
    expect(s.result!.scores.every((x) => x !== null)).toBe(true);
  });
});

describe('rake', () => {
  const rake = { percent: 5, cap: 300, noFlopNoDrop: true };

  it('takes a capped percentage once the flop is dealt', () => {
    const s = makeHand([20000, 20000], { button: 0, rake, holes: ['As Ad', 'Ks Kd'], board: '2c 7h 9d Jc 3s' });
    play(s, 'r300 c');
    play(s, 'b400 c x x x x');
    expect(s.result!.rake).toBe(70);
    expect(stacks(s)).toEqual([20630, 19300]);
  });

  it('applies the cap', () => {
    const s = makeHand([20000, 20000], { button: 0, rake, holes: ['As Ad', 'Ks Kd'], board: '2c 7h 9d Jc 3s' });
    play(s, 'r20000 c');
    expect(s.result!.rake).toBe(300);
    expect(stacks(s)).toEqual([39700, 0]);
  });

  it('takes rake when the hand ends after the flop without a showdown', () => {
    const s = makeHand([20000, 20000], { button: 0, rake });
    play(s, 'r300 c b400 f');
    expect(s.result!.rake).toBe(30);
    expect(s.result!.net).toEqual([-300, 270]);
  });
});

describe('records and views', () => {
  it('replays a recorded hand to the same result', () => {
    const rng = seededRng(42);
    for (let h = 0; h < 200; h++) {
      const s = makeHand([20000, 15000, 8000, 30000, 12000, 20000], {
        button: h % 6,
        rng,
        straddle: h % 3 === 0 ? 200 : 0,
        rake: { percent: 5, cap: 300, noFlopNoDrop: true },
      });
      while (!s.isComplete) applyAction(s, randomAction(s, rng));
      const replayed = replayHand(toHandRecord(s, 0));
      expect(replayed.events).toEqual(s.events);
      expect(stacks(replayed)).toEqual(stacks(s));
      expect(cardsToString(replayed.board)).toBe(cardsToString(s.board));
    }
  });

  it('hides private cards in the public view', () => {
    const s = makeHand([20000, 20000, 20000], { button: 0 });
    const view = toPublicView(s) as unknown as Record<string, unknown>;
    expect(view.runout).toBeUndefined();
    for (const p of view.players as Record<string, unknown>[]) expect(p.hole).toBeUndefined();
  });

  it('clones without sharing mutable state', () => {
    const s = makeHand([20000, 20000, 20000], { button: 0 });
    const copy = cloneHand(s);
    play(copy, 'r300 f f');
    expect(s.isComplete).toBe(false);
    expect(s.players[0]!.betThisStreet).toBe(0);
    expect(s.events.length).toBe(2);
  });
});

function simulate(hands: number, seed: number) {
  const rng = seededRng(seed);
  for (let h = 0; h < hands; h++) {
    const n = 2 + rng.int(8);
    const start: number[] = [];
    for (let i = 0; i < n; i++) start.push(1 + rng.int(rng.next() < 0.2 ? 300 : 40000));
    const s = makeHand(start, {
      button: rng.int(n),
      rng,
      straddle: rng.next() < 0.3 ? 200 : 0,
      rake: rng.next() < 0.5 ? { percent: 5, cap: 300, noFlopNoDrop: true } : NO_RAKE,
    });
    let steps = 0;
    while (!s.isComplete) {
      applyAction(s, randomAction(s, rng));
      if (++steps > 500) throw new Error('Hand did not terminate');
      for (const p of s.players) if (p.stack < 0) throw new Error('Negative stack');
    }
    const result = s.result!;
    if (sum(stacks(s)) + result.rake !== sum(start)) throw new Error(`Chips not conserved in hand ${h}`);
    if (sum(result.net) !== -result.rake) throw new Error('Net results do not sum to the rake');
    for (const pot of result.pots) {
      if (pot.eligible.length === 0 || pot.winners.length === 0) throw new Error('Pot without a winner');
    }
    if (s.players.filter((p) => !p.folded).length > 1 && s.board.length !== 5) {
      throw new Error('Showdown without a full board');
    }
  }
}

describe('random play', () => {
  it('conserves chips over 20,000 random hands', () => {
    simulate(20000, 12345);
  });
});

describe.skipIf(!process.env.FULL_TESTS)('random play (full)', () => {
  it('conserves chips over 1,000,000 random hands', () => {
    simulate(1_000_000, 987654321);
  });
});
