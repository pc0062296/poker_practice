import { replayHand } from '../engine/hand';
import type { Street } from '../engine/types';
import { countHand, emptyCounts, summarize, type StatSummary } from '../game/stats';
import type { OptionKind, PostflopGrade, Situation } from '../grading/postflop';
import type { PreflopChoice, PreflopGrade } from '../grading/preflop';
import { positionGroup, type ScenarioKind } from '../ranges/scenario';
import type { StoredHand } from '../storage/handStore';

const BB = 100;

export interface ReportSummary {
  hands: number;
  /** Chips won or lost. */
  net: number;
  /** Chips won or lost with all-in luck removed. */
  evNet: number;
  preflopGraded: number;
  preflopGood: number;
  postflopGraded: number;
  postflopGood: number;
  /** Total EV given up on postflop decisions, in chips. */
  evLoss: number;
}

export type PostflopDirection = 'overfold' | 'overcall' | 'passive' | 'aggressive' | 'sizing';

export interface PreflopLeak {
  key: string;
  kind: ScenarioKind;
  group: string;
  graded: number;
  wrong: number;
  /** How the wrong decisions went: what the hero chose instead. */
  wrongChoices: Record<PreflopChoice, number>;
}

export interface PostflopLeak {
  key: string;
  street: Street;
  situation: Situation;
  graded: number;
  wrong: number;
  evLoss: number;
  directions: Record<PostflopDirection, number>;
}

export interface ProgressPoint {
  /** Hands up to the end of this bucket. */
  upTo: number;
  hands: number;
  preflop: number | null;
  postflop: number | null;
  /** EV given up per 100 hands, in big blinds. */
  evLossPer100: number;
}

export interface SessionRow {
  id: number;
  start: number;
  hands: number;
  net: number;
  evNet: number;
  preflop: number | null;
  postflop: number | null;
}

export interface Report {
  summary: ReportSummary;
  preflopLeaks: PreflopLeak[];
  postflopLeaks: PostflopLeak[];
  heroStats: StatSummary;
  progress: ProgressPoint[];
  sessions: SessionRow[];
}

/** Reference ranges for a winning 9-max live player (rough guides, not targets to hit exactly). */
export const STAT_TARGETS: Partial<Record<keyof StatSummary, [number, number]>> = {
  vpip: [0.17, 0.26],
  pfr: [0.13, 0.21],
  limp: [0, 0.05],
  threeBet: [0.05, 0.1],
  foldTo3bet: [0.4, 0.58],
  cbet: [0.5, 0.72],
  foldToCbet: [0.35, 0.55],
  wtsd: [0.24, 0.33],
  wsd: [0.49, 0.57],
  aggression: [1.8, 3.5],
};

const good = (v: string) => v === 'best' || v === 'ok';
const wrongPreflop = (g: PreflopGrade) => g.verdict === 'inaccuracy' || g.verdict === 'mistake';
const wrongPostflop = (g: PostflopGrade) => !good(g.verdict);

function kindOfType(type: string): OptionKind {
  return type === 'fold' ? 'fold' : type === 'check' || type === 'call' ? 'passive' : 'aggressive';
}

export function postflopDirection(g: PostflopGrade): PostflopDirection {
  const best = kindOfType(g.values[g.bestIndex]!.action.type);
  const chosen = g.chosenKind;
  if (chosen === best) return 'sizing';
  if (chosen === 'fold') return 'overfold';
  if (chosen === 'passive') return best === 'fold' ? 'overcall' : 'passive';
  return 'aggressive';
}

function bucketSize(total: number): number {
  return total >= 600 ? 100 : total >= 150 ? 50 : 25;
}

export function buildReport(hands: readonly StoredHand[]): Report {
  const sorted = hands.slice().sort((a, b) => a.time - b.time);
  const summary: ReportSummary = {
    hands: 0,
    net: 0,
    evNet: 0,
    preflopGraded: 0,
    preflopGood: 0,
    postflopGraded: 0,
    postflopGood: 0,
    evLoss: 0,
  };
  const preflopLeaks = new Map<string, PreflopLeak>();
  const postflopLeaks = new Map<string, PostflopLeak>();
  const heroCounts = emptyCounts();
  const sessions = new Map<number, SessionRow & { preGraded: number; preGood: number; postGraded: number; postGood: number }>();
  const progress: ProgressPoint[] = [];
  const size = bucketSize(sorted.length);
  let bucket = { hands: 0, preG: 0, preOk: 0, postG: 0, postOk: 0, loss: 0 };

  sorted.forEach((h, n) => {
    summary.hands++;
    summary.net += h.heroNet;
    summary.evNet += h.heroEvNet ?? h.heroNet;
    const preflop = h.preflopGrades.filter((g) => g.verdict !== 'ungraded');
    const postflop = h.postflopGrades ?? [];
    summary.preflopGraded += preflop.length;
    summary.preflopGood += preflop.filter((g) => good(g.verdict)).length;
    summary.postflopGraded += postflop.length;
    summary.postflopGood += postflop.filter((g) => good(g.verdict)).length;
    const loss = postflop.reduce((s, g) => s + g.loss, 0);
    summary.evLoss += loss;

    for (const g of preflop) {
      const group = positionGroup(g.heroPosition);
      const key = `pre|${g.kind}|${group}`;
      let leak = preflopLeaks.get(key);
      if (!leak) {
        leak = { key, kind: g.kind, group, graded: 0, wrong: 0, wrongChoices: { fold: 0, call: 0, raise: 0 } };
        preflopLeaks.set(key, leak);
      }
      leak.graded++;
      if (wrongPreflop(g)) {
        leak.wrong++;
        leak.wrongChoices[g.chosen]++;
      }
    }
    for (const g of postflop) {
      const key = `post|${g.street}|${g.situation}`;
      let leak = postflopLeaks.get(key);
      if (!leak) {
        leak = {
          key,
          street: g.street,
          situation: g.situation,
          graded: 0,
          wrong: 0,
          evLoss: 0,
          directions: { overfold: 0, overcall: 0, passive: 0, aggressive: 0, sizing: 0 },
        };
        postflopLeaks.set(key, leak);
      }
      leak.graded++;
      leak.evLoss += g.loss;
      if (wrongPostflop(g)) {
        leak.wrong++;
        leak.directions[postflopDirection(g)]++;
      }
    }

    // Hero statistics come from replaying the stored record; practice spots and replays
    // would distort frequencies like VPIP, so they are left out.
    if (!h.spot && !h.replay) {
      try {
        const replayed = replayHand(h.record);
        const counts = replayed.players.map(() => emptyCounts());
        countHand(replayed, counts);
        const mine = counts[h.heroIndex]!;
        for (const k of Object.keys(mine) as (keyof typeof mine)[]) heroCounts[k] += mine[k];
      } catch {
        // A record that no longer replays is skipped for statistics only.
      }
    }

    const sid = h.sessionId ?? 0;
    let row = sessions.get(sid);
    if (!row) {
      row = { id: sid, start: h.time, hands: 0, net: 0, evNet: 0, preflop: null, postflop: null, preGraded: 0, preGood: 0, postGraded: 0, postGood: 0 };
      sessions.set(sid, row);
    }
    row.hands++;
    row.net += h.heroNet;
    row.evNet += h.heroEvNet ?? h.heroNet;
    row.preGraded += preflop.length;
    row.preGood += preflop.filter((g) => good(g.verdict)).length;
    row.postGraded += postflop.length;
    row.postGood += postflop.filter((g) => good(g.verdict)).length;

    bucket.hands++;
    bucket.preG += preflop.length;
    bucket.preOk += preflop.filter((g) => good(g.verdict)).length;
    bucket.postG += postflop.length;
    bucket.postOk += postflop.filter((g) => good(g.verdict)).length;
    bucket.loss += loss;
    if (bucket.hands === size || n === sorted.length - 1) {
      progress.push({
        upTo: n + 1,
        hands: bucket.hands,
        preflop: bucket.preG > 0 ? bucket.preOk / bucket.preG : null,
        postflop: bucket.postG > 0 ? bucket.postOk / bucket.postG : null,
        evLossPer100: (bucket.loss / BB / bucket.hands) * 100,
      });
      bucket = { hands: 0, preG: 0, preOk: 0, postG: 0, postOk: 0, loss: 0 };
    }
  });

  return {
    summary,
    preflopLeaks: Array.from(preflopLeaks.values())
      .filter((l) => l.wrong > 0)
      .sort((a, b) => b.wrong - a.wrong || b.wrong / b.graded - a.wrong / a.graded),
    postflopLeaks: Array.from(postflopLeaks.values())
      .filter((l) => l.evLoss > 0)
      .sort((a, b) => b.evLoss - a.evLoss),
    heroStats: summarize(heroCounts),
    progress,
    sessions: Array.from(sessions.values())
      .map(({ preGraded, preGood, postGraded, postGood, ...row }) => ({
        ...row,
        preflop: preGraded > 0 ? preGood / preGraded : null,
        postflop: postGraded > 0 ? postGood / postGraded : null,
      }))
      .sort((a, b) => b.start - a.start),
  };
}
