import { create } from 'zustand';
import { cloneHand, createHand, potTotal, toHandRecord, type HandRecord } from '../engine/hand';
import { modelsFor } from '../grading/postflop';
import { assignPositions } from '../engine/positions';
import { comboIndex } from '../eval/combos';
import { runSpot, spotById, spotFits } from '../game/spots';
import { buttonFor } from '../review/model';
import { cryptoRng } from '../engine/rng';
import { beginHand, createSession, endHand, placeButton, seatNet, type Session } from '../engine/session';
import type { Action, HandState, LegalActions } from '../engine/types';
import { HandRunner } from '../game/handRunner';
import { assignProfiles, drawBotBuyIn, maybeChangeSeat, observerPolicy, seatPolicies } from '../game/lineup';
import { countHand, emptyCounts, type StatCounts } from '../game/stats';
import { allInAdjustedNet } from '../stats/allInEv';
import { gradeInBackground } from '../grading/client';
import { allChartOverrides } from '../ranges/charts';
import type { GradingJob, PostflopGrade } from '../grading/postflop';
import { gradePreflopDecision, type PreflopGrade, type PreflopVerdict } from '../grading/preflop';
import { fmt, messages } from '../i18n';
import { countHands, saveHand, updateHand } from '../storage/handStore';
import {
  loadSettings,
  needsRestart,
  saveSettings,
  SEAT_CHANGE_RATE,
  toLineup,
  toTableConfig,
  UNITS_PER_BB,
  type Settings,
} from './settings';

/** The hero always sits at index 0. */
export const HERO = 0;

export type Phase = 'welcome' | 'playing' | 'handOver';

export interface HistoryEntry {
  /** Unique within this visit. */
  key: number;
  id: number;
  time: number;
  hand: HandState;
  grades: PreflopGrade[];
  /** Postflop grades; null while they are being computed. */
  postflop: PostflopGrade[] | null;
  heroNet: number;
  /** Seat profiles during the hand. */
  profiles: string[];
  /** Id in device storage, once saved. */
  storedId: number | null;
  /** Grades that arrived while grading is still running. */
  partialPostflop?: PostflopGrade[];
  gradingFailed?: boolean;
}

export interface SessionStats {
  hands: number;
  /** Hero's total result in chips. */
  net: number;
  /** Preflop decisions that had a chart to grade against. */
  graded: number;
  /** Graded decisions rated best or acceptable. */
  good: number;
  /** Postflop decisions graded. */
  postflopGraded: number;
  /** Postflop decisions rated best or acceptable. */
  postflopGood: number;
  /** Total EV given up on postflop decisions, in chips. */
  evLoss: number;
  /** Hands folded automatically because folding was the only reasonable play. */
  skipped: number;
  potQuizRight: number;
  potQuizTotal: number;
}

export interface SeatInfo {
  name: string;
  profile: string;
}

export interface Notice {
  id: number;
  text: string;
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
  /** Who sits in each seat and what type of player they are. */
  seats: SeatInfo[];
  /** Statistics observed for each seat since the player sat down. */
  seatCounts: StatCounts[];
  /** Table news, such as a player leaving. */
  notice: Notice | null;
  start(): void;
  heroAct(action: Action): void;
  nextHand(): void;
  applySettings(next: Settings): void;
  dismissToast(): void;
  dismissNotice(): void;
  /** Live mode: a pending or answered pot-size question at the hero's decision. */
  potQuiz: PotQuiz | null;
  answerPotQuiz(guess: number): void;
  /** Play an earlier deal again: same seats, stacks and cards. */
  replayRecord(record: HandRecord, profiles: string[]): void;
}

export interface PotQuiz {
  answer: number;
  guess: number | null;
  correct: boolean | null;
}

const EMPTY_STATS: SessionStats = {
  hands: 0,
  net: 0,
  graded: 0,
  good: 0,
  postflopGraded: 0,
  postflopGood: 0,
  evLoss: 0,
  skipped: 0,
  potQuizRight: 0,
  potQuizTotal: 0,
};

/** Share of postflop decisions where the hero is asked to name the pot first (live mode). */
const POT_QUIZ_RATE = 0.4;
/** A pot estimate counts as right within this share of the pot (or one big blind). */
const POT_QUIZ_TOLERANCE = 0.1;
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
/** Identifies the current sitting in stored hands. */
let sessionId = Date.now();
/** Set while a hand from history is being played again. */
let replaying = false;
let replayProfiles: string[] = [];
/** Practice spot of the hand in progress, if any. */
let currentSpot: string | null = null;
/** Set when the hero's hand was folded automatically. */
let autoSkipped = false;
/** Decision for which the pot question was already considered. */
let quizKey = '';
let entryKey = 0;
let noticeId = 0;

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

  /** Patch a history entry (and the last hand, when it is the same one). */
  const updateEntry = (key: number, patch: Partial<HistoryEntry>): void => {
    set((s) => ({
      history: s.history.map((e) => (e.key === key ? { ...e, ...patch } : e)),
      lastHand: s.lastHand && s.lastHand.key === key ? { ...s.lastHand, ...patch } : s.lastHand,
    }));
  };

  const seatInfo = (s: Session): SeatInfo[] => s.seats.map((seat) => ({ name: seat.name, profile: seat.profile }));

  const deal = (): void => {
    if (!session) return;
    const { settings } = get();
    const lineup = toLineup(settings);
    if (session.handsDealt > 0) {
      const change = maybeChangeSeat(session, lineup, SEAT_CHANGE_RATE[settings.seatChanges], messages.botNames, rng);
      if (change) {
        const seatCounts = get().seatCounts.slice();
        seatCounts[change.seat] = emptyCounts();
        set({
          seatCounts,
          notice: { id: ++noticeId, text: fmt(messages.notice.seatChange, { leaving: change.leaving, joining: change.joining }) },
        });
      }
    }
    const n = session.seats.length;
    const positions = assignPositions(n, 0);
    const spot = settings.practiceSpot !== 'off' ? spotById(settings.practiceSpot) : undefined;
    const useSpot = spot && spotFits(spot, positions) ? spot : undefined;
    const locked = settings.lockPosition !== 'off' && positions.includes(settings.lockPosition) ? settings.lockPosition : null;
    if (useSpot) placeButton(session, buttonFor(n, useSpot.hero));
    else if (locked) placeButton(session, buttonFor(n, locked));
    const makeRunner = () =>
      new HandRunner(beginHand(session!, rng), {
        heroIndex: HERO,
        rng,
        policies: seatPolicies(session!, lineup),
        observer: observerPolicy(session!, lineup),
        sizing: { openSize: settings.openSizeBB },
      });
    runner = makeRunner();
    currentSpot = useSpot ? useSpot.id : null;
    if (useSpot && !runSpot(runner, useSpot, HERO, rng)) {
      currentSpot = null;
      // A stack too short for the script: deal an ordinary hand instead.
      session.handsDealt--;
      placeButton(session, buttonFor(n, useSpot.hero));
      runner = makeRunner();
    }
    autoSkipped = false;
    replaying = false;
    quizKey = '';
    set({ phase: 'playing', revealCount: 0, seats: seatInfo(session), potQuiz: null });
    publish();
    pump();
  };

  const finishHand = (): void => {
    if (!runner || !session) return;
    const hand = runner.hand;
    // A replayed deal does not change the stacks of the running table.
    if (!replaying) endHand(session, hand);
    const hole = hand.players[HERO]!.hole;
    const grades: PreflopGrade[] = [];
    if (!autoSkipped) {
      for (const decision of runner.decisions) {
        const grade = gradePreflopDecision(decision, hole);
        if (grade) grades.push(grade);
      }
    }
    const heroNet = hand.result!.net[HERO]!;
    const time = Date.now();
    const profiles = replaying ? replayProfiles : session.seats.map((s) => s.profile);
    const needsPostflop = runner.decisions.some((d) => d.street !== 'preflop');
    const entry: HistoryEntry = {
      key: ++entryKey,
      id: hand.handId,
      time,
      hand: cloneHand(hand),
      grades,
      postflop: needsPostflop ? null : [],
      heroNet,
      profiles,
      storedId: null,
    };

    const state = get();
    const seatCounts = state.seatCounts.map((c) => ({ ...c }));
    while (seatCounts.length < hand.players.length) seatCounts.push(emptyCounts());
    if (!replaying) countHand(hand, seatCounts);
    const counted = grades.filter((g) => g.verdict !== 'ungraded');
    const stats: SessionStats = {
      ...state.stats,
      hands: state.stats.hands + 1,
      skipped: state.stats.skipped + (autoSkipped ? 1 : 0),
      net: replaying ? state.stats.net : seatNet(session.seats[HERO]!),
      graded: state.stats.graded + counted.length,
      good: state.stats.good + counted.filter((g) => g.verdict === 'best' || g.verdict === 'ok').length,
    };
    const history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
    const record = toHandRecord(hand, time);

    const heroEvNet = allInAdjustedNet(hand, HERO);
    const saved = saveHand({
      time,
      heroIndex: HERO,
      heroNet,
      heroEvNet,
      record,
      preflopGrades: grades,
      profiles,
      sessionId,
      replay: replaying || undefined,
      spot: currentSpot ?? undefined,
    }).then((id) => {
      if (id !== null) {
        set((s) => ({ storedHands: (s.storedHands ?? 0) + 1 }));
        updateEntry(entry.key, { storedId: id });
      }
      return id;
    });

    if (needsPostflop) {
      const job: GradingJob = {
        record,
        heroIndex: HERO,
        profiles,
        custom: state.settings.customProfile,
        useActualTypes: state.settings.showTypes,
        sizing: { openSize: state.settings.openSizeBB },
        chartOverrides: allChartOverrides(),
      };
      const partial: PostflopGrade[] = [];
      gradeInBackground(job, (grade) => {
        partial.push(grade);
        updateEntry(entry.key, { postflop: null, partialPostflop: partial.slice() });
      })
        .then((postflop) => {
          updateEntry(entry.key, { postflop, partialPostflop: undefined });
          set((s) => ({
            stats: {
              ...s.stats,
              postflopGraded: s.stats.postflopGraded + postflop.length,
              postflopGood: s.stats.postflopGood + postflop.filter((g) => g.verdict === 'best' || g.verdict === 'ok').length,
              evLoss: s.stats.evLoss + postflop.reduce((sum, g) => sum + g.loss, 0),
            },
          }));
          void saved.then((id) => {
            if (id !== null) void updateHand(id, { postflopGrades: postflop });
          });
        })
        .catch(() => updateEntry(entry.key, { postflop: [], gradingFailed: true }));
    }

    const skipped = hand.players[HERO]!.folded && (state.settings.skipAfterFold || autoSkipped);
    if (skipped) {
      let worst: PreflopVerdict | null = null;
      for (const g of counted) {
        if (worst === null || VERDICT_RANK[g.verdict] > VERDICT_RANK[worst]) worst = g.verdict;
      }
      set({ lastHand: entry, history, stats, seatCounts, toast: { id: ++toastId, heroNet, verdict: worst } });
      deal();
      return;
    }
    set({ phase: 'handOver', lastHand: entry, history, stats, seatCounts, legal: null });
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

    if (hero.folded && (settings.skipAfterFold || autoSkipped)) {
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
    if (runner.heroToAct) {
      const strategy = runner.baselineStrategy;
      // Auto-skip: the hero's first decision, and the baseline folds this hand every time.
      if (settings.skipTrivialFolds && hand.street === 'preflop' && runner.decisions.length === 0 && strategy) {
        const fold = strategy.options.findIndex((o) => o.kind === 'fold');
        const combo = comboIndex(hero.hole[0], hero.hole[1]);
        if (fold >= 0 && strategy.probs[fold]![combo]! >= 0.999) {
          autoSkipped = true;
          runner.act({ type: 'fold' });
          pump();
          return;
        }
      }
      const key = `${hand.handId}:${hand.events.length}`;
      if (settings.potQuiz && hand.street !== 'preflop' && quizKey !== key) {
        quizKey = key;
        if (rng.next() < POT_QUIZ_RATE) set({ potQuiz: { answer: potTotal(hand), guess: null, correct: null } });
      }
      return;
    }

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
    const { settings } = get();
    const config = toTableConfig(settings);
    const lineup = toLineup(settings);
    const bots = config.numPlayers - 1;
    const names = shuffleNames(messages.botNames).slice(0, bots);
    const profiles = assignProfiles(lineup, bots, rng);
    const buyIns = profiles.map(() => drawBotBuyIn(config, lineup, rng));
    session = createSession(config, names, rng, profiles, buyIns);
    sessionId = Date.now();
    session.seats[HERO]!.name = messages.heroName;
    runner = null;
    set({
      stats: EMPTY_STATS,
      lastHand: null,
      toast: null,
      notice: null,
      hand: null,
      legal: null,
      seats: seatInfo(session),
      seatCounts: session.seats.map(() => emptyCounts()),
    });
    deal();
  };

  const shuffleNames = (names: readonly string[]): string[] => {
    const out = names.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
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
    seats: [],
    seatCounts: [],
    notice: null,

    start: () => openTable(),

    replayRecord: (record, profiles) => {
      clearTimer();
      const { settings } = get();
      if (!session) {
        openTable();
        clearTimer();
      }
      const lineup = toLineup(settings);
      const hand = createHand({
        handId: ++session!.handsDealt,
        config: record.config,
        seats: record.seats.map((s, i) => ({ ...s, name: i === HERO ? messages.heroName : s.name })),
        buttonIndex: record.buttonIndex,
        rng,
        holeCards: record.holeCards,
        board: record.runout,
      });
      const models = modelsFor(profiles, lineup.custom, HERO);
      runner = new HandRunner(hand, {
        heroIndex: HERO,
        rng,
        policies: models.policies,
        observer: models.observer,
        sizing: { openSize: settings.openSizeBB },
      });
      replaying = true;
      replayProfiles = profiles.slice();
      autoSkipped = false;
      quizKey = '';
      set({
        phase: 'playing',
        revealCount: 0,
        potQuiz: null,
        seats: hand.players.map((p, i) => ({ name: p.name, profile: profiles[i] ?? 'population' })),
      });
      publish();
      pump();
    },

    heroAct: (action) => {
      if (!runner || !runner.heroToAct) return;
      const quiz = get().potQuiz;
      if (quiz && quiz.guess === null) return;
      if (quiz) set({ potQuiz: null });
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
    dismissNotice: () => set({ notice: null }),

    potQuiz: null,
    answerPotQuiz: (guess) => {
      const quiz = get().potQuiz;
      if (!quiz || quiz.guess !== null) return;
      const correct = Math.abs(guess - quiz.answer) <= Math.max(UNITS_PER_BB, quiz.answer * POT_QUIZ_TOLERANCE);
      set((s) => ({
        potQuiz: { ...quiz, guess, correct },
        stats: { ...s.stats, potQuizRight: s.stats.potQuizRight + (correct ? 1 : 0), potQuizTotal: s.stats.potQuizTotal + 1 },
      }));
    },
  };
});
