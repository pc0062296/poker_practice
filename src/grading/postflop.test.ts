import { describe, expect, it } from 'vitest';
import { DEFAULT_CUSTOM, type ProfileId } from '../bots/profiles';
import { toHandRecord } from '../engine/hand';
import { seededRng } from '../engine/rng';
import { beginHand, createSession, endHand } from '../engine/session';
import { HandRunner } from '../game/handRunner';
import { DEFAULT_LINEUP, observerPolicy, seatPolicies } from '../game/lineup';
import { DEFAULT_TABLE } from '../game/selfPlayStats';
import { gradePostflop, verdictFor } from './postflop';

describe('verdicts', () => {
  it('scale with the pot', () => {
    expect(verdictFor(0.1, 10)).toBe('best');
    expect(verdictFor(0.5, 4)).toBe('ok');
    expect(verdictFor(1.4, 4)).toBe('inaccuracy');
    expect(verdictFor(3, 4)).toBe('mistake');
    expect(verdictFor(10, 10)).toBe('blunder');
    // The same loss is less serious in a bigger pot.
    expect(verdictFor(2.5, 40)).toBe('ok');
  });
});

describe('grading recorded hands', () => {
  it('grades every postflop decision of the hero and nothing else', () => {
    const rng = seededRng(77);
    const profiles: ProfileId[] = ['tag', 'station', 'limper', 'nit', 'lag', 'population'];
    const config = { ...DEFAULT_TABLE, numPlayers: 6 };
    const session = createSession(config, [], rng, profiles.slice(1));
    session.seats[0]!.profile = 'hero';
    const policies = seatPolicies(session, DEFAULT_LINEUP);
    const observer = observerPolicy(session, DEFAULT_LINEUP);
    let graded = 0;
    let hands = 0;
    for (let h = 0; h < 200 && graded < 3; h++) {
      const hand = beginHand(session, rng);
      // The hero is played by the baseline strategy so the hand has realistic decisions.
      const runner = new HandRunner(hand, { heroIndex: 0, rng, policies, observer });
      while (!hand.isComplete) {
        runner.act(runner.botAction());
      }
      endHand(session, hand);
      const postflopDecisions = runner.decisions.filter((d) => d.street !== 'preflop');
      if (postflopDecisions.length === 0) continue;
      hands++;
      const grades = gradePostflop({
        record: toHandRecord(hand, 0),
        heroIndex: 0,
        profiles: session.seats.map((s) => s.profile),
        custom: DEFAULT_CUSTOM,
        useActualTypes: true,
        budget: { turnCards: 3, riverCards: 2, turnRivers: 8 },
      });
      expect(grades.length).toBe(postflopDecisions.length);
      for (const g of grades) {
        expect(g.values.length).toBeGreaterThanOrEqual(2);
        expect(g.loss).toBeGreaterThanOrEqual(0);
        expect(g.equity).toBeGreaterThanOrEqual(0);
        expect(g.equity).toBeLessThanOrEqual(1);
        expect(g.baseline.fold + g.baseline.passive + g.baseline.aggressive).toBeCloseTo(1, 3);
        expect(g.chosenIndex).toBeLessThan(g.values.length);
        expect(g.values[g.chosenIndex]!.action.type === 'fold').toBe(g.chosen.type === 'fold');
        if (g.villain) {
          const m = g.villain.mix;
          expect(m.strong + m.medium + m.draw + m.weak).toBeCloseTo(1, 3);
        }
        graded++;
      }
    }
    expect(hands).toBeGreaterThan(0);
    expect(graded).toBeGreaterThan(0);
  });
});
