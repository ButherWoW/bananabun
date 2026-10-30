import { create } from 'zustand';
import { auth as authApi } from '../api/client.js';

// The public demo has no accounts: it is always "logged in" as the made-up owner.
const DEMO = import.meta.env.MODE === 'demo';

export const useAuth = create((set) => ({
  user: null,
  workspace: null,
  loading: true,

  login: async (email, password) => {
    const res = await authApi.login({ email, password });
    localStorage.setItem('token', res.token);
    set({ user: res.user });
    return res;
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null, workspace: null });
    window.location.href = DEMO ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}login`;
  },

  loadMe: async () => {
    const token = DEMO || localStorage.getItem('token');
    if (!token) { set({ loading: false }); return; }
    try {
      const res = await authApi.me();
      set({ user: res.user, workspace: res.workspace, loading: false });
    } catch {
      if (!DEMO) localStorage.removeItem('token');
      set({ loading: false });
    }
  },
}));
