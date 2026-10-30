import { create } from 'zustand';

const KEY = 'bb_tour_v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode or blocked storage */ }
}

const saved = load();

export const useTour = create((set, get) => ({
  active: false,
  index: Number.isInteger(saved.index) ? saved.index : 0,
  done: !!saved.done,
  offered: !!saved.offered,
  persist() {
    const { index, done, offered } = get();
    save({ index, done, offered });
  },
  start(fromIndex) {
    const index = Number.isInteger(fromIndex) ? fromIndex : (get().done ? 0 : get().index);
    set({ active: true, index, offered: true });
    get().persist();
  },
  go(index) {
    set({ index });
    get().persist();
  },
  stop() {
    set({ active: false });
    get().persist();
  },
  finish() {
    set({ active: false, done: true, index: 0 });
    get().persist();
  },
  dismissOffer() {
    set({ offered: true });
    get().persist();
  },
}));
