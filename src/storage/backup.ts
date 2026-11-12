import type { ReviewHand } from '../review/model';
import { listHands, saveHand, type StoredHand } from './handStore';
import { listReviews, saveReview } from './reviewStore';

/** Everything the app keeps on the device, in one file. */
export interface Backup {
  format: 'poker-practice-backup';
  version: 1;
  createdAt: number;
  hands: StoredHand[];
  reviews: ReviewHand[];
  /** The app's own localStorage entries (settings, charts, drill records, schedules). */
  local: Record<string, string>;
}

const PREFIX = 'poker-practice.';

export async function exportBackup(): Promise<string> {
  const local: Record<string, string> = {};
  try {
    const storage = globalThis.localStorage;
    for (let i = 0; storage && i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(PREFIX)) local[key] = storage.getItem(key) ?? '';
    }
  } catch {
    // Storage unavailable.
  }
  const backup: Backup = {
    format: 'poker-practice-backup',
    version: 1,
    createdAt: Date.now(),
    hands: await listHands(Number.MAX_SAFE_INTEGER),
    reviews: await listReviews(),
    local,
  };
  return JSON.stringify(backup);
}

export interface ImportResult {
  hands: number;
  reviews: number;
  settings: number;
}

/**
 * Add the hands and reviews from a backup (duplicates by time are skipped) and restore the
 * app's settings and saved charts.
 */
export async function importBackup(text: string): Promise<ImportResult> {
  const data = JSON.parse(text) as Partial<Backup>;
  if (data.format !== 'poker-practice-backup') throw new Error('Not a backup file');
  const existingHands = new Set((await listHands(Number.MAX_SAFE_INTEGER)).map((h) => `${h.time}:${h.record.handId}`));
  const existingReviews = new Set((await listReviews()).map((r) => `${r.createdAt}:${r.title}`));
  let hands = 0;
  let reviews = 0;
  for (const h of data.hands ?? []) {
    if (!h?.record || existingHands.has(`${h.time}:${h.record.handId}`)) continue;
    const { id: _id, ...rest } = h;
    void _id;
    if ((await saveHand(rest)) !== null) hands++;
  }
  for (const r of data.reviews ?? []) {
    if (!r || existingReviews.has(`${r.createdAt}:${r.title}`)) continue;
    const { id: _id, ...rest } = r;
    void _id;
    if ((await saveReview(rest as ReviewHand)) !== null) reviews++;
  }
  let settings = 0;
  try {
    for (const [key, value] of Object.entries(data.local ?? {})) {
      if (!key.startsWith(PREFIX) || typeof value !== 'string') continue;
      globalThis.localStorage?.setItem(key, value);
      settings++;
    }
  } catch {
    // Storage unavailable.
  }
  return { hands, reviews, settings };
}
