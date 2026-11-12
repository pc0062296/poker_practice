import { create } from 'zustand';

export type View = 'table' | 'drill' | 'ranges' | 'tools' | 'review' | 'records';

export const VIEWS: View[] = ['table', 'drill', 'ranges', 'tools', 'review', 'records'];

interface NavState {
  view: View;
  setView(view: View): void;
}

export const useNav = create<NavState>((set) => ({
  view: 'table',
  setView: (view) => set({ view }),
}));
