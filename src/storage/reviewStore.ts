import type { ReviewHand } from '../review/model';
import { run } from './db';

/** Save a review; returns its id, or null when storage failed. Never throws. */
export async function saveReview(review: ReviewHand): Promise<number | null> {
  try {
    const record = { ...review, updatedAt: Date.now() };
    if (record.id === undefined) delete record.id;
    return (await run('reviews', 'readwrite', (s) => s.put(record))) as number;
  } catch {
    return null;
  }
}

export async function listReviews(): Promise<ReviewHand[]> {
  try {
    const all = await run('reviews', 'readonly', (s) => s.getAll());
    return (all as ReviewHand[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function deleteReview(id: number): Promise<boolean> {
  try {
    await run('reviews', 'readwrite', (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}
