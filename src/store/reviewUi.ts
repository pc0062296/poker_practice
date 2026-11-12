import { create } from 'zustand';
import type { ReviewHand } from '../review/model';

export type ReviewMode = 'list' | 'edit' | 'analyze';

interface ReviewUiState {
  mode: ReviewMode;
  current: ReviewHand | null;
  open(review: ReviewHand, mode: ReviewMode): void;
  update(review: ReviewHand): void;
  close(): void;
}

/** Which review is open and in which mode; lets other screens open a hand for review. */
export const useReviewUi = create<ReviewUiState>((set) => ({
  mode: 'list',
  current: null,
  open: (review, mode) => set({ current: review, mode }),
  update: (review) => set({ current: review }),
  close: () => set({ current: null, mode: 'list' }),
}));
