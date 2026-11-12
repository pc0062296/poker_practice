import { verdictFor, type PostflopGrade } from '../grading/postflop';
import type { PreflopChoice, PreflopGrade } from '../grading/preflop';
import type { StoredHand } from '../storage/handStore';

/**
 * The mistake notebook: decisions graded as clear errors come back for another try,
 * on a simple spaced-repetition schedule (Leitner boxes).
 */
export interface MistakeItem {
  key: string;
  hand: StoredHand;
  preflop?: PreflopGrade;
  postflop?: PostflopGrade;
}

export interface ScheduleEntry {
  box: number;
  due: number;
}

const STORAGE_KEY = 'poker-practice.mistakes.v1';
const DAY = 24 * 60 * 60 * 1000;
/** Days until the next review for each box after a right answer. */
const INTERVALS = [1, 3, 7, 14, 30];
const RETRY_AFTER_WRONG = 10 * 60 * 1000;

export function collectMistakes(hands: readonly StoredHand[]): MistakeItem[] {
  const out: MistakeItem[] = [];
  for (const hand of hands) {
    if (hand.id === undefined) continue;
    for (const g of hand.preflopGrades) {
      if (g.verdict === 'mistake') out.push({ key: `${hand.id}:${g.actionIndex}`, hand, preflop: g });
    }
    for (const g of hand.postflopGrades ?? []) {
      const big = g.verdict === 'mistake' || g.verdict === 'blunder' || (g.verdict === 'inaccuracy' && g.loss >= 100);
      if (big && !g.uncertain) out.push({ key: `${hand.id}:${g.actionIndex}`, hand, postflop: g });
    }
  }
  return out.sort((a, b) => b.hand.time - a.hand.time);
}

export function loadSchedule(): Record<string, ScheduleEntry> {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return text ? (JSON.parse(text) as Record<string, ScheduleEntry>) : {};
  } catch {
    return {};
  }
}

export function saveSchedule(schedule: Record<string, ScheduleEntry>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(schedule));
  } catch {
    // Not saved.
  }
}

export function isDue(item: MistakeItem, schedule: Record<string, ScheduleEntry>, now: number): boolean {
  const entry = schedule[item.key];
  return !entry || entry.due <= now;
}

export function nextSchedule(entry: ScheduleEntry | undefined, correct: boolean, now: number): ScheduleEntry {
  if (!correct) return { box: 0, due: now + RETRY_AFTER_WRONG };
  const box = Math.min(INTERVALS.length - 1, (entry?.box ?? -1) + 1);
  return { box, due: now + INTERVALS[box]! * DAY };
}

/** Whether a new answer to a preflop mistake is acceptable (the chart plays it at least sometimes). */
export function preflopAnswerOk(grade: PreflopGrade, choice: PreflopChoice): boolean {
  const best = Math.max(grade.freq.fold, grade.freq.call, grade.freq.raise);
  return grade.freq[choice] >= best - 1e-6 || grade.freq[choice] >= 0.25;
}

/** Whether a new answer to a postflop mistake is close enough to the best option. */
export function postflopAnswerOk(grade: PostflopGrade, index: number): boolean {
  const loss = grade.values[grade.bestIndex]!.ev - grade.values[index]!.ev;
  const verdict = verdictFor(loss / 100, grade.pot / 100);
  return verdict === 'best' || verdict === 'ok';
}
