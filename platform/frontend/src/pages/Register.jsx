import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth as authApi } from '../api/client.js';
import { useAuth } from '../store/auth.js';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', invite_code: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { loadMe } = useAuth();

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await authApi.register(form);
      localStorage.setItem('token', res.token);
      await loadMe();
      navigate('/products');
    } catch (err) {
      setError(err.error || 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[color:var(--c0f1117)]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl mb-2">⚡</div>
          <h1 className="text-xl font-bold text-white">AffPlatform</h1>
          <p className="text-sm text-gray-500 mt-1">Создать аккаунт</p>
        </div>

        <form onSubmit={submit} className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-6 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Имя</label>
            <input
              type="text"
              value={form.name}
              onChange={set('name')}
              required
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="Иван"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={set('email')}
              required
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Пароль</label>
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              required
              minLength={6}
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Инвайт-код</label>
            <input
              type="text"
              value={form.invite_code}
              onChange={set('invite_code')}
              required
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="Введи код доступа"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Регистрируем...' : 'Зарегистрироваться'}
          </button>

          <p className="text-center text-xs text-gray-500">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-indigo-400 hover:text-indigo-300">Войти</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
