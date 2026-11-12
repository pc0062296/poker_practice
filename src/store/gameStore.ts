import { create } from 'zustand';
import { cloneHand, toHandRecord } from '../engine/hand';
import { cryptoRng } from '../engine/rng';
import { beginHand, createSession, endHand, seatNet, type Session } from '../engine/session';
import type { Action, HandState, LegalActions } from '../engine/types';
import { HandRunner } from '../game/handRunner';
import { gradePreflopDecision, type PreflopGrade, type PreflopVerdict } from '../grading/preflop';
import { messages } from '../i18n';
import { countHands, saveHand } from '../storage/handStore';
import { loadSettings, needsRestart, saveSettings, toTableConfig, type Settings } from './settings';

/** The hero always sits at index 0. */
export const HERO = 0;

export type Phase = 'welcome' | 'playing' | 'handOver';

export interface HistoryEntry {
  id: number;
  time: number;
  hand: HandState;
  grades: PreflopGrade[];
  heroNet: number;
}

export interface SessionStats {
  hands: number;
  /** Hero's total result in chips. */
  net: number;
  /** Preflop decisions that had a chart to grade against. */
  graded: number;
  /** Graded decisions rated best or acceptable. */
  good: number;
}

export interface Toast {
  id: number;
  heroNet: number;
  /** Worst preflop verdict of the hand, or null when nothing was graded. */
  verdict: PreflopVerdict | null;
}

export interface GameState {
  settings: Settings;
  phase: Phase;
  hand: HandState | null;
  /** The hero's legal actions while it is the hero's turn. */
  legal: LegalActions | null;
  /** Number of community cards currently shown. */
  revealCount: number;
  lastHand: HistoryEntry | null;
  history: HistoryEntry[];
  stats: SessionStats;
  toast: Toast | null;
  /** Hands saved on this device, or null when storage is unavailable. */
  storedHands: number | null;
  start(): void;
  heroAct(action: Action): void;
  nextHand(): void;
  applySettings(next: Settings): void;
  dismissToast(): void;
}

const EMPTY_STATS: SessionStats = { hands: 0, net: 0, graded: 0, good: 0 };
const HISTORY_LIMIT = 100;
const BOT_DELAY_MS = { fast: 220, normal: 600, slow: 1000 } as const;
const REVEAL_DELAY_MS = { fast: 300, normal: 500, slow: 700 } as const;
const FOLD_DELAY_FACTOR = 0.45;
const VERDICT_RANK: Record<PreflopVerdict, number> = { ungraded: 0, best: 1, ok: 2, inaccuracy: 3, mistake: 4 };

const rng = cryptoRng();
let session: Session | null = null;
let runner: HandRunner | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

export const useGame = create<GameState>((set, get) => {
  const publish = (): void => {
    if (!runner) return;
    set({ hand: cloneHand(runner.hand), legal: runner.heroToAct ? runner.currentLegal : null });
  };

  const deal = (): void => {
    if (!session) return;
    const hand = beginHand(session, rng);
    runner = new HandRunner(hand, {
      heroIndex: HERO,
      rng,
      sizing: { openSize: get().settings.openSizeBB },
    });
    set({ phase: 'playing', revealCount: 0 });
    publish();
    pump();
  };

  const finishHand = (): void => {
    if (!runner || !session) return;
    const hand = runner.hand;
    endHand(session, hand);
    const hole = hand.players[HERO]!.hole;
    const grades: PreflopGrade[] = [];
    for (const decision of runner.decisions) {
      const grade = gradePreflopDecision(decision, hole);
      if (grade) grades.push(grade);
    }
    const heroNet = hand.result!.net[HERO]!;
    const time = Date.now();
    const entry: HistoryEntry = { id: hand.handId, time, hand: cloneHand(hand), grades, heroNet };

    const state = get();
    const counted = grades.filter((g) => g.verdict !== 'ungraded');
    const stats: SessionStats = {
      hands: state.stats.hands + 1,
      net: seatNet(session.seats[HERO]!),
      graded: state.stats.graded + counted.length,
      good: state.stats.good + counted.filter((g) => g.verdict === 'best' || g.verdict === 'ok').length,
    };
    const history = [entry, ...state.history].slice(0, HISTORY_LIMIT);

    void saveHand({
      time,
      heroIndex: HERO,
      heroNet,
      record: toHandRecord(hand, time),
      preflopGrades: grades,
    }).then((ok) => {
      if (ok) set((s) => ({ storedHands: (s.storedHands ?? 0) + 1 }));
    });

    const skipped = hand.players[HERO]!.folded && state.settings.skipAfterFold;
    if (skipped) {
      let worst: PreflopVerdict | null = null;
      for (const g of counted) {
        if (worst === null || VERDICT_RANK[g.verdict] > VERDICT_RANK[worst]) worst = g.verdict;
      }
      set({ lastHand: entry, history, stats, toast: { id: ++toastId, heroNet, verdict: worst } });
      deal();
      return;
    }
    set({ phase: 'handOver', lastHand: entry, history, stats, legal: null });
    const wait = state.settings.autoNextSeconds;
    if (wait > 0) timer = setTimeout(() => get().nextHand(), wait * 1000);
  };

  /** Advance the hand: reveal cards, let bots act, and stop when the hero must decide. */
  const pump = (): void => {
    clearTimer();
    if (!runner) return;
    const { settings, revealCount } = get();
    const hand = runner.hand;
    const hero = hand.players[HERO]!;

    if (hero.folded && settings.skipAfterFold) {
      runner.runBots();
      set({ revealCount: hand.board.length });
      publish();
      finishHand();
      return;
    }
    if (revealCount < hand.board.length) {
      const next = revealCount < 3 ? 3 : revealCount + 1;
      timer = setTimeout(() => {
        set({ revealCount: next });
        pump();
      }, REVEAL_DELAY_MS[settings.botSpeed]);
      return;
    }
    if (hand.isComplete) {
      finishHand();
      return;
    }
    if (runner.heroToAct) return;

    const action = runner.botAction();
    const jitter = 0.7 + 0.6 * Math.random();
    const delay = BOT_DELAY_MS[settings.botSpeed] * jitter * (action.type === 'fold' ? FOLD_DELAY_FACTOR : 1);
    const current = runner;
    timer = setTimeout(() => {
      if (runner !== current) return;
      current.act(action);
      publish();
      pump();
    }, delay);
  };

  const openTable = (): void => {
    clearTimer();
    session = createSession(toTableConfig(get().settings), messages.botNames, rng);
    session.seats[HERO]!.name = messages.heroName;
    runner = null;
    set({ stats: EMPTY_STATS, lastHand: null, toast: null, hand: null, legal: null });
    deal();
  };

  void countHands().then((n) => set({ storedHands: n }));

  return {
    settings: loadSettings(),
    phase: 'welcome',
    hand: null,
    legal: null,
    revealCount: 0,
    lastHand: null,
    history: [],
    stats: EMPTY_STATS,
    toast: null,
    storedHands: null,

    start: () => openTable(),

    heroAct: (action) => {
      if (!runner || !runner.heroToAct) return;
      runner.act(action);
      publish();
      pump();
    },

    nextHand: () => {
      if (get().phase !== 'handOver') return;
      clearTimer();
      deal();
    },

    applySettings: (next) => {
      const previous = get().settings;
      saveSettings(next);
      set({ settings: next });
      if (get().phase !== 'welcome' && needsRestart(previous, next)) openTable();
    },

    dismissToast: () => set({ toast: null }),
  };
});
