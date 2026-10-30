import { create } from 'zustand';
import { auth as authApi } from '../api/client.js';

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
    window.location.href = `${import.meta.env.BASE_URL}login`;
  },

  loadMe: async () => {
    const token = localStorage.getItem('token');
    if (!token) { set({ loading: false }); return; }
    try {
      const res = await authApi.me();
      set({ user: res.user, workspace: res.workspace, loading: false });
    } catch {
      localStorage.removeItem('token');
      set({ loading: false });
    }
  },
}));
