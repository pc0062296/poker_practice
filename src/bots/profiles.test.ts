import { describe, expect, it } from 'vitest';
import { seededRng } from '../engine/rng';
import { makeHand } from '../engine/testUtil';
import { getLegalActions, toPublicView } from '../engine/hand';
import { parseClassLabel } from '../eval/handClass';
import { collapseToClasses, NUM_COMBOS } from '../eval/combos';
import { HandRunner } from '../game/handRunner';
import { selfPlay } from '../game/selfPlayStats';
import { assignProfiles, DEFAULT_LINEUP, maybeChangeSeat } from '../game/lineup';
import { createSession } from '../engine/session';
import { DEFAULT_TABLE } from '../game/selfPlayStats';
import { DEFAULT_SIZING } from '../ranges/sizing';
import { CLASS_PERCENTILE } from '../ranges/handRanking';
import { baselinePolicy } from './baselinePolicy';
import { policyFor } from './policies';
import { customParams, makeProfile, SEAT_PROFILE_IDS, type ProfileId } from './profiles';

describe('hand ranking', () => {
  it('puts aces first and junk last', () => {
    expect(CLASS_PERCENTILE[parseClassLabel('AA')]!).toBeLessThan(0.01);
    expect(CLASS_PERCENTILE[parseClassLabel('72o')]!).toBeGreaterThan(0.9);
    expect(CLASS_PERCENTILE[parseClassLabel('AKs')]!).toBeLessThan(CLASS_PERCENTILE[parseClassLabel('KQo')]!);
  });
});

describe('human strategies', () => {
  it('give every combo a probability distribution', () => {
    const s = makeHand([20000, 20000, 20000, 20000], { button: 0, board: 'Kh 7c 2d 9s 4h' });
    const runner = new HandRunner(s, { heroIndex: -1, rng: seededRng(3) });
    for (const id of SEAT_PROFILE_IDS) {
      const policy = policyFor(makeProfile(id));
      const legal = getLegalActions(s)!;
      const strategy = policy.rangeStrategy({
        view: toPublicView(s),
        actor: s.toAct,
        legal,
        ranges: runner.beliefs.ranges,
        table: null,
        sizing: DEFAULT_SIZING,
      });
      for (let c = 0; c < NUM_COMBOS; c += 7) {
        let total = 0;
        for (const p of strategy.probs) {
          expect(p[c]!).toBeGreaterThanOrEqual(0);
          total += p[c]!;
        }
        expect(total).toBeCloseTo(1, 4);
      }
    }
  });

  it('play recognizably different styles at a mixed table', () => {
    const lineup: ProfileId[] = ['tag', 'limper', 'station', 'nit', 'lag', 'maniac', 'population', 'baseline', 'limper'];
    const s = selfPlay(3000, 21, { profiles: lineup });
    const p = s.byProfile;
    expect(p.nit!.vpip!).toBeLessThan(0.15);
    expect(p.tag!.vpip!).toBeGreaterThan(0.12);
    expect(p.tag!.vpip!).toBeLessThan(0.24);
    expect(p.limper!.vpip!).toBeGreaterThan(0.33);
    expect(p.limper!.limp!).toBeGreaterThan(0.35);
    expect(p.station!.foldToCbet!).toBeLessThan(0.35);
    expect(p.maniac!.pfr!).toBeGreaterThan(0.25);
    expect(p.maniac!.threeBet!).toBeGreaterThan(0.12);
    expect(p.lag!.pfr!).toBeGreaterThan(p.tag!.pfr!);
    expect(p.nit!.foldTo3bet!).toBeGreaterThan(p.station!.foldTo3bet!);
  });

  it('turns custom VPIP and PFR targets into matching play', () => {
    const lineup: ProfileId[] = ['custom', 'limper', 'station', 'tag', 'nit', 'lag', 'population', 'tag', 'limper'];
    for (const target of [{ vpip: 18, pfr: 12 }, { vpip: 45, pfr: 10 }]) {
      const custom = { vpip: target.vpip, pfr: target.pfr, threeBet: 4, aggression: 50, bluff: 20, sticky: 50, openSize: 3 };
      const s = selfPlay(2500, 5, { profiles: lineup, custom });
      expect(Math.abs(s.byProfile.custom!.vpip! * 100 - target.vpip)).toBeLessThan(5);
      expect(Math.abs(s.byProfile.custom!.pfr! * 100 - target.pfr)).toBeLessThan(5);
    }
    expect(customParams({ vpip: 30, pfr: 30, threeBet: 5, aggression: 50, bluff: 20, sticky: 50, openSize: 3 }).raiseFirstIn).toBe(1);
  });
});

describe('two range models', () => {
  it('tracks what a limper really holds separately from what the table assumes', () => {
    const s = makeHand(new Array<number>(9).fill(20000), { button: 0 });
    const policies = new Array(9).fill(baselinePolicy);
    policies[3] = policyFor(makeProfile('limper'));
    const runner = new HandRunner(s, {
      heroIndex: -1,
      rng: seededRng(1),
      policies,
      observer: policyFor(makeProfile('population')),
    });
    runner.act({ type: 'call' });
    const actual = collapseToClasses(runner.actual.ranges[3]!);
    const believed = collapseToClasses(runner.beliefs.ranges[3]!);
    // A limper limps a hand like T7o from early position; a generic player would not.
    const t7o = parseClassLabel('T7o');
    expect(actual[t7o]!).toBeGreaterThan(0.5);
    expect(believed[t7o]!).toBeLessThan(0.25);
    // Both models agree that limping 72o is rare.
    expect(actual[parseClassLabel('72o')]!).toBeLessThan(0.1);
  });
});

describe('lineups', () => {
  it('assigns profiles from a preset and from custom seats', () => {
    const rng = seededRng(4);
    const macau = assignProfiles(DEFAULT_LINEUP, 8, rng);
    expect(macau.length).toBe(8);
    expect(macau.every((id) => SEAT_PROFILE_IDS.includes(id))).toBe(true);
    const custom = assignProfiles({ ...DEFAULT_LINEUP, preset: 'custom', customSeats: ['nit', 'maniac'] }, 3, rng);
    expect(custom).toEqual(['nit', 'maniac', 'population']);
    expect(assignProfiles({ ...DEFAULT_LINEUP, preset: 'baseline' }, 4, rng)).toEqual(['baseline', 'baseline', 'baseline', 'baseline']);
  });

  it('replaces a bot between hands without touching the hero', () => {
    const rng = seededRng(9);
    const session = createSession(DEFAULT_TABLE, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], rng, new Array(8).fill('tag'));
    const change = maybeChangeSeat(session, DEFAULT_LINEUP, 1, ['x', 'y'], rng);
    expect(change).not.toBeNull();
    expect(change!.seat).toBeGreaterThan(0);
    expect(['x', 'y']).toContain(session.seats[change!.seat]!.name);
    expect(session.seats[0]!.isHero).toBe(true);
    expect(maybeChangeSeat(session, DEFAULT_LINEUP, 0, ['z'], rng)).toBeNull();
  });
});
