import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adspower, waitAgentJob } from '../api/client.js';

function StatusDot({ active }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${active ? 'bg-emerald-400' : 'bg-gray-600'}`} />
  );
}

export default function AdsPowerPage() {
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState('');

  const { data: profilesData, isLoading } = useQuery({
    queryKey: ['adspower-profiles', groupId],
    queryFn: () => adspower.profiles({ page: 1, page_size: 50, ...(groupId ? { group_id: groupId } : {}) }),
    retry: 1,
  });

  const { data: groupsData } = useQuery({
    queryKey: ['adspower-groups'],
    queryFn: adspower.groups,
    retry: 1,
  });

  const openMutation = useMutation({
    mutationFn: async (userId) => waitAgentJob((await adspower.openBrowser(userId)).job_id),
    onSuccess: () => qc.invalidateQueries(['adspower-profiles']),
  });

  const closeMutation = useMutation({
    mutationFn: async (userId) => waitAgentJob((await adspower.closeBrowser(userId)).job_id),
    onSuccess: () => qc.invalidateQueries(['adspower-profiles']),
  });

  const profiles = profilesData?.list || [];
  const groups = groupsData?.list || [];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--c1e2240)] flex-shrink-0">
        <div>
          <h1 className="text-base font-semibold text-white">AdsPower</h1>
          <p className="text-xs text-gray-500 mt-0.5">Профили браузера</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="text-xs bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-gray-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Все группы</option>
            {groups.map((g) => (
              <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
            ))}
          </select>
          <span className="text-xs text-gray-500">{profiles.length} профилей</span>
        </div>
      </div>

      <div className="flex-1 p-5">
        {(openMutation.error || closeMutation.error) && (
          <div className="mb-3 px-4 py-2 bg-red-900/20 border border-red-800/30 rounded-lg text-xs text-red-400">
            {(openMutation.error || closeMutation.error).error || (openMutation.error || closeMutation.error).message || 'Ошибка'}
          </div>
        )}
        {isLoading ? (
          <div className="text-center text-gray-500 py-20 text-sm animate-pulse">Загрузка профилей...</div>
        ) : profiles.length === 0 ? (
          <div className="text-center text-gray-600 py-20 text-sm">Профили не найдены</div>
        ) : (
          <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-[color:var(--c2d3148)]">
                  <th className="text-left px-5 py-3">#</th>
                  <th className="text-left px-4 py-3">Аккаунт</th>
                  <th className="text-left px-4 py-3">Группа</th>
                  <th className="text-left px-4 py-3">Страна</th>
                  <th className="text-right px-5 py-3">Действия</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p, i) => {
                  const isOpen = openMutation.variables === p.user_id && openMutation.isPending;
                  const isClosing = closeMutation.variables === p.user_id && closeMutation.isPending;
                  return (
                    <tr key={p.user_id} className="border-b border-[color:var(--c1a1d3a)] hover:bg-[color:var(--c1a1d3a)] transition-colors">
                      <td className="px-5 py-2.5 text-gray-500 text-xs">{p.serial_number || i + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-gray-300 text-xs truncate max-w-[180px]">
                          {p.name || p.user_id}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-400">{p.group_name || '—'}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {p.ip_country ? (
                          <span className="uppercase text-indigo-400">{p.ip_country}</span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <button
                          onClick={() => openMutation.mutate(p.user_id)}
                          disabled={isOpen}
                          className="text-xs px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 mr-2"
                        >
                          {isOpen ? '...' : 'Открыть'}
                        </button>
                        <button
                          onClick={() => closeMutation.mutate(p.user_id)}
                          disabled={isClosing}
                          className="text-xs px-3 py-1 rounded-lg bg-[color:var(--c2d3148)] hover:bg-[color:var(--c3a3f60)] text-gray-300 transition-colors disabled:opacity-50"
                        >
                          {isClosing ? '...' : 'Закрыть'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
