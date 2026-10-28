import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import clsx from 'clsx';

const adminApi = {
  users: () => api.get('/api/admin/users'),
  create: (data) => api.post('/api/admin/users', data),
  update: (id, data) => api.patch(`/api/admin/users/${id}`, data),
  remove: (id) => api.delete(`/api/admin/users/${id}`),
  resetPassword: (id, password) => api.post(`/api/admin/users/${id}/reset-password`, { password }),
};

const ROLES = {
  owner: { label: 'Владелец', color: 'text-purple-400 bg-purple-500/10' },
  lead:  { label: 'Лид',      color: 'text-blue-400 bg-blue-500/10' },
  buyer: { label: 'Байер',    color: 'text-emerald-400 bg-emerald-500/10' },
};

const inp = 'w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-300 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-indigo-500';

function CreateModal({ onClose, canCreateLead }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'buyer' });
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: () => adminApi.create(form),
    onSuccess: () => { qc.invalidateQueries(['admin-users']); onClose(); },
    onError: (e) => setErr(e?.error || e?.message || 'Ошибка'),
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--c2d3148)]">
          <h2 className="text-sm font-semibold text-white">Новый пользователь</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Имя</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} className={inp} placeholder="Иван Иванов" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inp} placeholder="ivan@example.com" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Пароль</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} className={inp} placeholder="Минимум 6 символов" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Роль</label>
            <select value={form.role} onChange={e => set('role', e.target.value)} className={inp}>
              <option value="buyer">Байер</option>
              {canCreateLead && <option value="lead">Лид</option>}
              {canCreateLead && <option value="owner">Владелец</option>}
            </select>
          </div>
          {err && <div className="text-xs text-red-400">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-xs text-gray-400 hover:text-white border border-[color:var(--c2d3148)] rounded-lg transition-colors">Отмена</button>
            <button onClick={() => mut.mutate()} disabled={mut.isPending || !form.name || !form.email || !form.password}
              className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50">
              {mut.isPending ? 'Создаю...' : 'Создать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResetModal({ user, onClose }) {
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const mut = useMutation({
    mutationFn: () => adminApi.resetPassword(user.id, pwd),
    onSuccess: () => setOk(true),
    onError: (e) => setErr(e?.error || 'Ошибка'),
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--c2d3148)]">
          <h2 className="text-sm font-semibold text-white">Сброс пароля</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-400">Новый пароль для <span className="text-white">{user.name}</span></p>
          {ok ? (
            <div className="text-emerald-400 text-sm text-center py-2">✓ Пароль обновлён</div>
          ) : (
            <>
              <input type="password" value={pwd} onChange={e => setPwd(e.target.value)} className={inp} placeholder="Новый пароль" />
              {err && <div className="text-xs text-red-400">{err}</div>}
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 text-xs text-gray-400 border border-[color:var(--c2d3148)] rounded-lg hover:text-white transition-colors">Отмена</button>
                <button onClick={() => mut.mutate()} disabled={pwd.length < 6 || mut.isPending}
                  className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50">
                  Обновить
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function KeitaroTagInput({ user }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(user.keitaro_tag || '');
  const save = useMutation({
    mutationFn: (keitaro_tag) => api.patch(`/api/admin/users/${user.id}`, { keitaro_tag }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const commit = () => { if (value.trim() !== (user.keitaro_tag || '')) save.mutate(value.trim()); };
  return (
    <input
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
      placeholder={user.role === 'buyer' ? 'izya' : '—'}
      className={clsx('w-28 bg-transparent border rounded px-2 py-0.5 text-xs font-mono text-gray-200 placeholder-gray-700 focus:outline-none',
        save.isPending ? 'border-indigo-500/50' : 'border-[color:var(--c2d3148)] focus:border-indigo-500')}
    />
  );
}

export default function AdminPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser, setResetUser] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: adminApi.users,
  });

  const deleteMut = useMutation({
    mutationFn: adminApi.remove,
    onSuccess: () => qc.invalidateQueries(['admin-users']),
  });

  const roleMut = useMutation({
    mutationFn: ({ id, role }) => adminApi.update(id, { role }),
    onSuccess: () => qc.invalidateQueries(['admin-users']),
  });

  if (!['owner', 'lead'].includes(me?.role)) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Нет доступа
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">Пользователи</h1>
          <p className="text-xs text-gray-600 mt-0.5">Регистрация закрыта — только через эту панель</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors font-medium">
          + Добавить
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-500 text-sm animate-pulse">Загрузка...</div>
        ) : (
          <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--c2d3148)]">
                  <th className="text-left px-4 py-3 text-[10px] text-gray-500 uppercase tracking-wider font-medium">Имя</th>
                  <th className="text-left px-4 py-3 text-[10px] text-gray-500 uppercase tracking-wider font-medium">Email</th>
                  <th className="text-left px-4 py-3 text-[10px] text-gray-500 uppercase tracking-wider font-medium">Роль</th>
                  <th className="text-left px-4 py-3 text-[10px] text-gray-500 uppercase tracking-wider font-medium" title="Ник байера в названиях кампаний Keitaro, например izya. Несколько — через запятую">Ник в Keitaro</th>
                  <th className="text-left px-4 py-3 text-[10px] text-gray-500 uppercase tracking-wider font-medium">Создан</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const role = ROLES[u.role] || ROLES.buyer;
                  const isMe = u.id === me?.id;
                  return (
                    <tr key={u.id} className={clsx('border-b border-[color:var(--c1e2240)] last:border-0 hover:bg-[color:var(--c1a1d35)] transition-colors', isMe && 'bg-indigo-600/5')}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-indigo-600/30 flex items-center justify-center text-xs text-indigo-300 font-medium flex-shrink-0">
                            {u.name?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div className="text-white">{u.name}</div>
                            {isMe && <div className="text-[10px] text-gray-600">это вы</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono">{u.email}</td>
                      <td className="px-4 py-3">
                        {me?.role === 'owner' && !isMe ? (
                          <select
                            value={u.role}
                            onChange={e => roleMut.mutate({ id: u.id, role: e.target.value })}
                            className={clsx('text-[11px] px-2 py-0.5 rounded font-medium border-0 cursor-pointer focus:outline-none', role.color, 'bg-transparent')}
                          >
                            <option value="buyer">Байер</option>
                            <option value="lead">Лид</option>
                            <option value="owner">Владелец</option>
                          </select>
                        ) : (
                          <span className={clsx('text-[11px] px-2 py-0.5 rounded font-medium', role.color)}>{role.label}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {me?.role === 'owner' ? (
                          <KeitaroTagInput user={u} />
                        ) : (
                          <span className="text-xs text-gray-400 font-mono">{u.keitaro_tag || '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {new Date(u.created_at).toLocaleDateString('ru')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {me?.role === 'owner' && (
                            <>
                              <button onClick={() => setResetUser(u)}
                                className="text-[11px] text-gray-600 hover:text-yellow-400 px-2 py-1 rounded border border-transparent hover:border-yellow-500/20 transition-colors">
                                Пароль
                              </button>
                              {!isMe && (
                                <button onClick={() => { if (confirm(`Удалить ${u.name}?`)) deleteMut.mutate(u.id); }}
                                  className="text-[11px] text-gray-600 hover:text-red-400 px-2 py-1 rounded border border-transparent hover:border-red-500/20 transition-colors">
                                  ✕
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {users.length === 0 && (
              <div className="text-gray-600 text-sm text-center py-12">Нет пользователей</div>
            )}
          </div>
        )}
      </div>

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} canCreateLead={me?.role === 'owner'} />}
      {resetUser && <ResetModal user={resetUser} onClose={() => setResetUser(null)} />}
    </div>
  );
}
