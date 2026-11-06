import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accounts as accountsApi, agent as agentApi, waitAgentJob } from '../api/client.js';
import { useRole } from '../hooks/useRole.js';
import clsx from 'clsx';
import { AccountTwoFa } from '../components/TwoFaCode.jsx';
import Hint from '../components/Hint.jsx';


function StatusDot({ status }) {
  return (
    <span className={clsx(
      'w-2 h-2 rounded-full flex-shrink-0',
      status === 'active' ? 'bg-emerald-400' : status === 'blocked' ? 'bg-red-400' : 'bg-gray-600'
    )} />
  );
}

const FB_SESSION_HINT = 'Открой профиль в AdsPower на Маке, проверь, что Ads Manager открывается, и закрой профиль — сессия уйдёт на сервер. Потом нажми «Проверить».';

function FbSessionBadge({ account }) {
  const s = account.fb_session;
  if (!s) return null;
  if (s === 'ok') return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex-shrink-0 whitespace-nowrap">
      FB вход есть
    </span>
  );
  if (s === 'logged_out') return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20 flex-shrink-0 whitespace-nowrap flex items-center gap-1 cursor-help" title={FB_SESSION_HINT}>
      Не залогинен на сервере <span className="opacity-60">?</span>
    </span>
  );
  if (s === 'checkpoint') return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/20 flex-shrink-0 whitespace-nowrap">
      Чекпоинт
    </span>
  );
  return null;
}

function AccountRow({ account, onOpen, onEditBM }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [bmEdit, setBmEdit] = useState(false);
  const [bmId, setBmId] = useState(account.bm_id || '');
  const [pixelIds, setPixelIds] = useState((account.pixel_ids || []).join(', '));
  const allCabs = account.bms?.flatMap(b => b.cabinets?.filter(Boolean) || []) || [];

  async function handleCheck(e) {
    e.stopPropagation();
    setChecking(true);
    try {
      const { job_id } = await accountsApi.checkProfile(account.id);
      // The agent may start the profile and read every ad account: a few minutes is normal.
      const data = await waitAgentJob(job_id, { timeoutMs: 600000 });
      const cabs = data.bms.flatMap(b => b.cabinets);
      const ready = cabs.filter(c => c.ready?.kind === 'ready').length;
      const pages = data.bms.reduce((n, b) => n + b.pages.length, 0);
      setCheckResult({ message: `${data.user.name}: БМ ${data.bms.length}, кабинетов ${cabs.length} (готовы к заливу ${ready}), страниц ${pages}` });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (err) {
      setCheckResult({ error: err.error || err.message || 'Ошибка' });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="border-b border-[color:var(--c1e2240)] last:border-0">
      <div
        className="flex items-center gap-4 px-6 py-4 hover:bg-[color:var(--c0f1128)] transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-indigo-700/50 flex items-center justify-center text-xs font-bold text-indigo-300 flex-shrink-0">
          {(account.name || account.email || '?')[0].toUpperCase()}
        </div>

        {/* Name + status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={account.status} />
            <span className="text-sm text-white font-medium truncate">{account.name || account.email || `Profile ${account.serial_number}`}</span>
            {account.geo && (
              <span className="text-[11px] text-indigo-400 uppercase font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded">{account.geo}</span>
            )}
            <FbSessionBadge account={account} />
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600">
            {account.email && <span>{account.email}</span>}
            {account.ap_name && <span>AdsPower: {account.ap_name}</span>}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 text-center flex-shrink-0">
          <div>
            <div className="text-sm font-medium text-white">{account.bms?.length || account.bms_count || 0}</div>
            <div className="text-[10px] text-gray-600">БМ</div>
          </div>
          <div>
            <div className="text-sm font-medium text-white">{allCabs.length || account.cabinets_count || 0}</div>
            <div className="text-[10px] text-gray-600">Кабинеты</div>
          </div>
          <div>
            <div className="text-sm font-medium text-white">{account.pages_count || 0}</div>
            <div className="text-[10px] text-gray-600">Страницы</div>
          </div>
        </div>

        {/* Actions */}
        <div data-tour="account-actions" className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onOpen(account.id)}
            className="text-xs px-3 py-1.5 rounded-lg bg-[color:var(--c1e2240)] hover:bg-indigo-600 text-gray-300 hover:text-white transition-colors"
          >
            Открыть
          </button>
          <button
            onClick={handleCheck}
            disabled={checking}
            className="text-xs px-3 py-1.5 rounded-lg bg-[color:var(--c1e2240)] hover:bg-emerald-700/40 text-gray-300 hover:text-emerald-300 transition-colors disabled:opacity-50"
            title="Проверить профиль через агента на Mac"
          >
            {checking ? 'Проверяю через агента, до 5 мин…' : '⚡ Проверить'}
          </button>
          <AccountTwoFa request={() => accountsApi.twoFa(account.id)} />
          <button
            onClick={e => { e.stopPropagation(); setBmEdit(v => !v); }}
            className="text-xs px-3 py-1.5 rounded-lg bg-[color:var(--c1e2240)] hover:bg-indigo-700/40 text-gray-300 hover:text-indigo-300 transition-colors"
            title="Привязать BM и пиксели"
          >⚙️ BM</button>
          <span className="text-gray-700 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {bmEdit && (
        <div className="px-6 py-3 bg-[color:var(--c0a0d1f)] border-t border-[color:var(--c1e2240)] flex flex-col gap-2" onClick={e => e.stopPropagation()}>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 mb-1">Business Manager ID<Hint k="ac.bm" /></label>
              <input
                value={bmId}
                onChange={e => setBmId(e.target.value)}
                placeholder="123456789"
                className="w-full bg-[color:var(--c141829)] border border-[color:var(--c1e2540)] text-white text-xs px-2 py-1.5 rounded font-mono"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 mb-1">Pixel IDs (через запятую)<Hint k="ac.pixels" /></label>
              <input
                value={pixelIds}
                onChange={e => setPixelIds(e.target.value)}
                placeholder="111222333, 444555666"
                className="w-full bg-[color:var(--c141829)] border border-[color:var(--c1e2540)] text-white text-xs px-2 py-1.5 rounded font-mono"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setBmEdit(false)} className="text-xs px-3 py-1 text-gray-500 hover:text-gray-300">Отмена</button>
            <button
              onClick={() => onEditBM(account.id, { bm_id: bmId, pixel_ids: pixelIds.split(',').map(s => s.trim()).filter(Boolean) }, () => setBmEdit(false))}
              className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
            >Сохранить</button>
          </div>
        </div>
      )}

      {checkResult && (
        <div className={`px-6 py-2 text-xs border-t border-[color:var(--c1e2240)] ${checkResult.error ? 'text-red-400 bg-red-500/5' : 'text-emerald-400 bg-emerald-500/5'}`}>
          {checkResult.error ? `Ошибка: ${checkResult.error}` : checkResult.message || JSON.stringify(checkResult).slice(0, 120)}
        </div>
      )}

      {/* Expanded BMs */}
      {expanded && account.bms?.length > 0 && (
        <div className="bg-[color:var(--c090b16)] border-t border-[color:var(--c1e2240)]">
          {account.bms.map(bm => (
            <div key={bm.id} className="px-10 py-3 border-b border-[color:var(--c1a1d3a)] last:border-0">
              <div className="flex items-center gap-2 mb-2">
                <StatusDot status={bm.status} />
                <span className="text-xs text-gray-400 font-medium">{bm.name}</span>
                <span className="text-[10px] text-gray-600 bg-[color:var(--c1e2240)] px-1.5 py-0.5 rounded">БМ</span>
              </div>
              {bm.cabinets?.filter(Boolean).map(cab => {
                const readyKind = cab.ready?.kind;
                const readyLabel = cab.ready?.label;
                const readyClass = readyKind === 'ready'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : readyKind === 'partial'
                  ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                  : 'bg-red-500/20 text-red-400 border-red-500/30';
                const capiPixel = cab.pixels?.find(p => p.capi);
                return (
                  <div key={cab.id} className="ml-4 flex items-center gap-2 py-1.5">
                    <span className="text-gray-700 text-xs">💰</span>
                    <span className="text-xs text-gray-400 flex-1">{cab.name}</span>
                    {capiPixel && (
                      <span className="flex items-center gap-1 text-[10px] text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                        CAPI
                      </span>
                    )}
                    {cab.payment_missing && (
                      <span title="Карта не привязана" className="text-[10px] text-orange-400">💳</span>
                    )}
                    {readyLabel && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${readyClass}`}>{readyLabel}</span>
                    )}
                  </div>
                );
              })}
              {bm.pages?.filter(Boolean).map(pg => (
                <div key={pg.id} className="ml-4 flex items-center gap-2 py-1.5">
                  <span className="text-gray-700 text-xs">📄</span>
                  <span className="text-xs text-gray-400 flex-1">{pg.name}</span>
                  {(pg.ads_running != null || pg.ads_limit != null) && (
                    <span className="text-[10px] text-gray-600 font-mono">
                      {pg.ads_running ?? 0}/{pg.ads_limit ?? '?'} реклам
                    </span>
                  )}
                  <StatusDot status={pg.status} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {expanded && (!account.bms || account.bms.length === 0) && (
        <div className="bg-[color:var(--c090b16)] border-t border-[color:var(--c1e2240)] px-10 py-4 text-xs text-gray-600">
          Нет данных о БМ — нажмите «Открыть» для проверки аккаунта
        </div>
      )}
    </div>
  );
}

function AgentPanel({ isAdmin }) {
  const [key, setKey] = useState('');
  const { data: st } = useQuery({ queryKey: ['agent-status'], queryFn: agentApi.status, refetchInterval: 30000 });
  const keyMutation = useMutation({ mutationFn: agentApi.newKey, onSuccess: d => setKey(d.key) });
  if (!st) return null;
  const seen = st.seen_at ? new Date(st.seen_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="mx-6 mb-3 px-4 py-2 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg text-xs text-gray-400 flex flex-wrap items-center gap-3">
      <span className={clsx('w-2 h-2 rounded-full', st.online ? 'bg-emerald-400' : 'bg-gray-600')} />
      <span>
        Агент AdsPower на Mac: {st.online ? 'на связи' : st.configured ? 'не на связи' : 'не подключён'}
        {seen && !st.online && ` · был в ${seen}`}
      </span>
      {isAdmin && !key && (
        <button
          onClick={() => keyMutation.mutate()}
          disabled={keyMutation.isPending}
          className="ml-auto text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
        >
          {st.configured ? 'Новый ключ агента' : 'Получить ключ агента'}
        </button>
      )}
      {key && (
        <div className="w-full flex flex-col gap-1">
          <span>Ключ показывается один раз. Положите его на Mac в <code>~/scripts/.bananabun_agent_key</code> (права 600):</span>
          <code className="select-all break-all text-gray-300 bg-[color:var(--c0d0f1e)] px-2 py-1 rounded">{key}</code>
        </div>
      )}
    </div>
  );
}

export default function AccountsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const { role } = useRole();
  const isAdmin = role === 'owner' || role === 'lead';

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    retry: 1,
  });

  const syncMutation = useMutation({
    mutationFn: async () => waitAgentJob((await accountsApi.sync()).job_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => accountsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  function handleEditBM(id, data, onDone) {
    updateMutation.mutate({ id, data }, { onSuccess: onDone });
  }

  const openMutation = useMutation({
    mutationFn: async (id) => waitAgentJob((await accountsApi.open(id)).job_id, { timeoutMs: 120000 }),
  });

  const cabCount = a => a.bms?.flatMap(b => b.cabinets?.filter(Boolean) || []).length || a.cabinets_count || 0;
  const filtered = accounts.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q);
  }).sort((a, b) => {
    if (sortBy === 'status') return (a.status || '').localeCompare(b.status || '');
    if (sortBy === 'cabs') return cabCount(b) - cabCount(a);
    return (a.name || a.email || '').localeCompare(b.name || b.email || '');
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          Мои аккаунты
          <span className="text-base">👑</span>
        </h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 pb-4 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-xs">🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-300 text-sm pl-8 pr-3 py-2 rounded-lg focus:outline-none focus:border-indigo-500 placeholder-gray-600"
            placeholder="Поиск"
          />
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-400 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-indigo-500"
        >
          <option value="name">По названию</option>
          <option value="status">По статусу</option>
          <option value="cabs">По кабинетам</option>
        </select>
        <button
          data-tour="accounts-sync"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          title="Синхронизировать с AdsPower"
          className="p-2 rounded-lg border border-[color:var(--c2d3148)] text-gray-400 hover:text-white hover:border-[color:var(--c3d4168)] transition-colors disabled:opacity-50"
        >
          {syncMutation.isPending ? (
            <span className="inline-block animate-spin text-sm">↻</span>
          ) : (
            <span className="text-sm">↻</span>
          )}
        </button>
      </div>

      {/* Sync result */}
      <AgentPanel isAdmin={isAdmin} />

      {syncMutation.isSuccess && syncMutation.data && (
        <div className="mx-6 mb-3 px-4 py-2 bg-emerald-900/20 border border-emerald-800/30 rounded-lg text-xs text-emerald-400">
          Синхронизировано {syncMutation.data.synced} из {syncMutation.data.total} профилей
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-500 text-sm animate-pulse">Загрузка аккаунтов...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center px-8">
            <p className="text-gray-500 text-sm">
              {accounts.length === 0
                ? isAdmin ? 'Профилей в AdsPower пока нет.' : 'Профилей в группе AdsPower с вашей почтой пока нет.'
                : 'Ничего не найдено'}
            </p>
            {accounts.length === 0 && (
              <p className="text-gray-600 text-xs max-w-sm leading-relaxed">
                {isAdmin
                  ? 'Убедись что AdsPower настроен в Настройках и в нём есть профили.'
                  : 'Профиль появится здесь, когда он лежит в группе AdsPower, названной почтой держателя. Платформа перечитывает AdsPower раз в 5 минут.'}
              </p>
            )}
          </div>
        ) : (
          <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl mx-6 mb-6 overflow-hidden">
            {filtered.map(acc => (
              <AccountRow
                key={acc.id}
                account={acc}
                onOpen={(id) => openMutation.mutate(id)}
                onEditBM={handleEditBM}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
