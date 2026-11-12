import type { HandState } from '../engine/types';

/** Raw counters for the usual poker statistics. Opportunities and occurrences are kept apart. */
export interface StatCounts {
  hands: number;
  vpip: number;
  pfr: number;
  /** Hands where the player acted with no raise in front (big blind excluded). */
  unopened: number;
  limp: number;
  threeBetOpp: number;
  threeBet: number;
  foldTo3betOpp: number;
  foldTo3bet: number;
  sawFlop: number;
  cbetOpp: number;
  cbet: number;
  foldToCbetOpp: number;
  foldToCbet: number;
  showdown: number;
  wonShowdown: number;
  postflopAggressive: number;
  postflopCalls: number;
}

export function emptyCounts(): StatCounts {
  return {
    hands: 0,
    vpip: 0,
    pfr: 0,
    unopened: 0,
    limp: 0,
    threeBetOpp: 0,
    threeBet: 0,
    foldTo3betOpp: 0,
    foldTo3bet: 0,
    sawFlop: 0,
    cbetOpp: 0,
    cbet: 0,
    foldToCbetOpp: 0,
    foldToCbet: 0,
    showdown: 0,
    wonShowdown: 0,
    postflopAggressive: 0,
    postflopCalls: 0,
  };
}

export function addCounts(into: StatCounts, from: StatCounts): void {
  for (const key of Object.keys(into) as (keyof StatCounts)[]) into[key] += from[key];
}

/** Add one finished hand to per-player counters (indexed like the hand's players). */
export function countHand(hand: HandState, counts: StatCounts[]): void {
  const n = hand.players.length;
  const voluntary = new Array<boolean>(n).fill(false);
  const raised = new Array<boolean>(n).fill(false);
  const actedPreflop = new Array<boolean>(n).fill(false);
  let raises = 0;
  let opener = -1;
  let preflopAggressor = -1;
  let flopSeen = false;
  const inAtFlop = new Array<boolean>(n).fill(false);
  let flopBetSeen = false;
  let cbettor = -1;
  const answeredCbet = new Array<boolean>(n).fill(false);
  const answered3bet = new Array<boolean>(n).fill(false);
  const folded = new Array<boolean>(n).fill(false);

  for (const e of hand.events) {
    if (e.kind === 'deal' && e.street === 'flop') {
      flopSeen = true;
      for (let i = 0; i < n; i++) inAtFlop[i] = !folded[i];
    }
    if (e.kind !== 'action') continue;
    const i = e.player;
    const c = counts[i]!;
    if (e.type === 'fold') folded[i] = true;
    if (e.street === 'preflop') {
      const first = !actedPreflop[i];
      actedPreflop[i] = true;
      if (first && raises === 0 && i !== hand.bbIndex && i !== hand.straddleIndex) {
        c.unopened++;
        if (e.type === 'call') c.limp++;
      }
      if (raises === 1 && opener !== i && first) {
        c.threeBetOpp++;
        if (e.type === 'raise') c.threeBet++;
      }
      if (raises === 2 && opener === i && !answered3bet[i]) {
        // The opener facing a 3-bet.
        answered3bet[i] = true;
        c.foldTo3betOpp++;
        if (e.type === 'fold') c.foldTo3bet++;
      }
      if (e.type === 'call' || e.type === 'raise') voluntary[i] = true;
      if (e.type === 'raise') {
        raised[i] = true;
        raises++;
        if (raises === 1) opener = i;
        preflopAggressor = i;
      }
    } else {
      if (e.type === 'bet' || e.type === 'raise') counts[i]!.postflopAggressive++;
      else if (e.type === 'call') counts[i]!.postflopCalls++;
      if (e.street === 'flop') {
        if (!flopBetSeen && i === preflopAggressor) {
          c.cbetOpp++;
          if (e.type === 'bet') {
            c.cbet++;
            cbettor = i;
          }
        }
        if (cbettor >= 0 && i !== cbettor && !answeredCbet[i]) {
          answeredCbet[i] = true;
          c.foldToCbetOpp++;
          if (e.type === 'fold') c.foldToCbet++;
        }
        if (e.type === 'bet') flopBetSeen = true;
      }
    }
  }

  const result = hand.result;
  hand.players.forEach((p, i) => {
    const c = counts[i]!;
    c.hands++;
    if (voluntary[i]) c.vpip++;
    if (raised[i]) c.pfr++;
    if (flopSeen && inAtFlop[i]) {
      c.sawFlop++;
      if (result?.showdown && !p.folded) {
        c.showdown++;
        if (result.winnings[i]! > 0) c.wonShowdown++;
      }
    }
  });
}

export interface StatSummary {
  hands: number;
  vpip: number | null;
  pfr: number | null;
  limp: number | null;
  threeBet: number | null;
  foldTo3bet: number | null;
  cbet: number | null;
  foldToCbet: number | null;
  wtsd: number | null;
  wsd: number | null;
  /** Postflop bets and raises per call. */
  aggression: number | null;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function summarize(c: StatCounts): StatSummary {
  return {
    hands: c.hands,
    vpip: ratio(c.vpip, c.hands),
    pfr: ratio(c.pfr, c.hands),
    limp: ratio(c.limp, c.unopened),
    threeBet: ratio(c.threeBet, c.threeBetOpp),
    foldTo3bet: ratio(c.foldTo3bet, c.foldTo3betOpp),
    cbet: ratio(c.cbet, c.cbetOpp),
    foldToCbet: ratio(c.foldToCbet, c.foldToCbetOpp),
    wtsd: ratio(c.showdown, c.sawFlop),
    wsd: ratio(c.wonShowdown, c.showdown),
    aggression: ratio(c.postflopAggressive, c.postflopCalls),
  };
}
