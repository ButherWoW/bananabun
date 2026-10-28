const KEY = 'bananabun-theme';

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage unavailable */ }
  return 'dark';
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('light', theme === 'light');
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable */ }
  applyTheme(theme);
}
