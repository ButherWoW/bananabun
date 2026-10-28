import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { team as teamApi } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import { useRole } from '../hooks/useRole.js';
import clsx from 'clsx';

const ROLE_STYLES = {
  owner: 'bg-purple-900/40 text-purple-400 border-purple-800',
  lead: 'bg-blue-900/40 text-blue-400 border-blue-800',
  buyer: 'bg-gray-800 text-gray-400 border-gray-700',
};

export default function TeamPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { canInvite, canManageTeam } = useRole();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'buyer', password: '' });
  const [error, setError] = useState('');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: teamApi.members,
  });

  const inviteMutation = useMutation({
    mutationFn: teamApi.invite,
    onSuccess: () => { qc.invalidateQueries(['team']); setShowModal(false); setForm({ email: '', name: '', role: 'buyer', password: '' }); setError(''); },
    onError: (err) => setError(err.error || 'Failed to invite'),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }) => teamApi.update(id, { role }),
    onSuccess: () => qc.invalidateQueries(['team']),
  });

  const deleteMutation = useMutation({
    mutationFn: teamApi.remove,
    onSuccess: () => qc.invalidateQueries(['team']),
  });

  const fmtDate = (d) => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Команда</h1>
          <p className="text-sm text-gray-500 mt-0.5">{members.length} участников</p>
        </div>
        {canInvite && (
          <button
            onClick={() => setShowModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Пригласить
          </button>
        )}
      </div>

      <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="text-center text-gray-500 py-16">Загрузка...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-[color:var(--c2d3148)]">
                <th className="text-left px-5 py-3">Имя</th>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Роль</th>
                <th className="text-left px-5 py-3">Добавлен</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {members.map(member => (
                <tr key={member.id} className="border-b border-[color:var(--c1a1d3a)] hover:bg-[color:var(--c1a1d3a)] transition-colors">
                  <td className="px-5 py-3 text-gray-200 font-medium">
                    {member.name}
                    {member.id === me?.id && <span className="ml-2 text-xs text-gray-600">(вы)</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-400">{member.email}</td>
                  <td className="px-5 py-3">
                    <select
                      value={member.role}
                      disabled={member.id === me?.id || !canManageTeam}
                      onChange={e => roleMutation.mutate({ id: member.id, role: e.target.value })}
                      className={clsx(
                        'text-xs px-2 py-0.5 rounded border bg-transparent focus:outline-none',
                        canManageTeam && member.id !== me?.id ? 'cursor-pointer' : 'cursor-default opacity-60',
                        ROLE_STYLES[member.role] || ROLE_STYLES.buyer
                      )}
                    >
                      <option value="owner">owner — владелец</option>
                      <option value="lead">lead — лид</option>
                      <option value="buyer">buyer — байер</option>
                    </select>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">{fmtDate(member.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    {member.id !== me?.id && (
                      <button
                        onClick={() => { if (window.confirm(`Удалить ${member.name || member.email} из команды?`)) deleteMutation.mutate(member.id); }}
                        className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                      >
                        Удалить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-base font-semibold text-white mb-5">Пригласить участника</h2>
            {error && (
              <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg p-3 mb-4">{error}</div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Имя</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="Иван Петров" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="ivan@example.com" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Пароль</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="••••••••" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Роль</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="buyer">buyer — медиабайер</option>
                  <option value="lead">lead — тимлид</option>
                  <option value="owner">owner — полный доступ</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => inviteMutation.mutate(form)}
                disabled={!form.name || !form.email || !form.password || inviteMutation.isPending}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {inviteMutation.isPending ? 'Приглашаем...' : 'Пригласить'}
              </button>
              <button onClick={() => { setShowModal(false); setError(''); }} className="px-4 text-gray-400 hover:text-white text-sm">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
