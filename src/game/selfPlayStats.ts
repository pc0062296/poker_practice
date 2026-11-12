import { beginHand, createSession, endHand, type TableConfig } from '../engine/session';
import { seededRng } from '../engine/rng';
import { HandRunner } from './handRunner';

export interface SelfPlayStats {
  hands: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  sawFlop: number;
  flopsSeenPerHand: number;
  cbet: number;
  foldToCbet: number;
  wentToShowdown: number;
  showdownHands: number;
  avgPotBB: number;
  betRiver: number;
  msPerHand: number;
}

export const DEFAULT_TABLE: TableConfig = {
  numPlayers: 9,
  smallBlind: 50,
  bigBlind: 100,
  heroBuyIn: 20000,
  botBuyInMin: 20000,
  botBuyInMax: 20000,
  topUp: 'always',
  straddle: 'off',
  rake: { percent: 5, cap: 300, noFlopNoDrop: true },
};

/** Let the baseline policy play itself and collect table statistics. */
export function selfPlay(hands: number, seed: number, config: TableConfig = DEFAULT_TABLE): SelfPlayStats {
  const rng = seededRng(seed);
  const session = createSession(config, [], rng);
  const n = config.numPlayers;
  let opportunities = 0;
  let vpip = 0;
  let pfr = 0;
  let threeBetOpp = 0;
  let threeBet = 0;
  let flops = 0;
  let playersAtFlop = 0;
  let cbetOpp = 0;
  let cbet = 0;
  let faceCbet = 0;
  let foldCbet = 0;
  let showdowns = 0;
  let playersAtShowdown = 0;
  let potSum = 0;
  let riverSpots = 0;
  let riverBets = 0;
  const start = Date.now();

  for (let h = 0; h < hands; h++) {
    const hand = beginHand(session, rng);
    // heroIndex -1: every seat is a bot.
    const runner = new HandRunner(hand, { heroIndex: -1, rng });
    runner.runBots();
    endHand(session, hand);

    const voluntarily = new Set<number>();
    const raised = new Set<number>();
    let raises = 0;
    const facedOpen = new Set<number>();
    const threeBettors = new Set<number>();
    let preflopAggressor = -1;
    let flopBettor = -1;
    let flopFirstBetSeen = false;
    const flopResponded = new Set<number>();
    let total = 0;
    for (const p of hand.players) total += p.totalContributed;
    potSum += total;

    for (const e of hand.events) {
      if (e.kind !== 'action') continue;
      if (e.street === 'preflop') {
        if (raises === 1 && !raised.has(e.player)) facedOpen.add(e.player);
        if (e.type === 'call') voluntarily.add(e.player);
        if (e.type === 'raise') {
          voluntarily.add(e.player);
          raised.add(e.player);
          raises++;
          if (raises === 2) threeBettors.add(e.player);
          preflopAggressor = e.player;
        }
      } else if (e.street === 'flop') {
        if (!flopFirstBetSeen) {
          if (e.player === preflopAggressor) {
            cbetOpp++;
            if (e.type === 'bet') {
              cbet++;
              flopBettor = e.player;
              flopFirstBetSeen = true;
            }
          } else if (e.type === 'bet') {
            flopFirstBetSeen = true;
          }
        } else if (flopBettor >= 0 && e.player !== flopBettor && !flopResponded.has(e.player)) {
          flopResponded.add(e.player);
          faceCbet++;
          if (e.type === 'fold') foldCbet++;
        }
      } else if (e.street === 'river') {
        if (e.type === 'check' || e.type === 'bet') {
          riverSpots++;
          if (e.type === 'bet') riverBets++;
        }
      }
    }
    opportunities += n;
    vpip += voluntarily.size;
    pfr += raised.size;
    threeBetOpp += facedOpen.size;
    threeBet += threeBettors.size;
    if (hand.events.some((e) => e.kind === 'deal' && e.street === 'flop')) {
      flops++;
      // Players still in when the flop was dealt.
      const foldedPre = new Set<number>();
      for (const e of hand.events) {
        if (e.kind === 'deal') break;
        if (e.kind === 'action' && e.type === 'fold') foldedPre.add(e.player);
      }
      playersAtFlop += n - foldedPre.size;
    }
    if (hand.result!.showdown) {
      showdowns++;
      playersAtShowdown += hand.players.filter((p) => !p.folded).length;
    }
  }

  return {
    hands,
    vpip: vpip / opportunities,
    pfr: pfr / opportunities,
    threeBet: threeBetOpp > 0 ? threeBet / threeBetOpp : 0,
    sawFlop: flops / hands,
    flopsSeenPerHand: flops > 0 ? playersAtFlop / flops : 0,
    cbet: cbetOpp > 0 ? cbet / cbetOpp : 0,
    foldToCbet: faceCbet > 0 ? foldCbet / faceCbet : 0,
    wentToShowdown: playersAtFlop > 0 ? playersAtShowdown / playersAtFlop : 0,
    showdownHands: showdowns / hands,
    avgPotBB: potSum / hands / config.bigBlind,
    betRiver: riverSpots > 0 ? riverBets / riverSpots : 0,
    msPerHand: (Date.now() - start) / hands,
  };
}
