import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { keitaro as keitaroApi, adspower as adspowerApi, agent as agentApi, waitAgentJob } from '../api/client.js';

function SettingsSection({ title, children }) {
  return (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[color:var(--c0d0f1f)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-500 placeholder-gray-700"
      />
    </div>
  );
}

function StatusBadge({ status }) {
  if (!status) return null;
  const ok = status.ok;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${ok ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
      {ok ? `✓ Подключено${status.extra ? ` · ${status.extra}` : ''}` : `✗ ${status.error}`}
    </span>
  );
}

export default function SettingsPage() {
  const [kUrl, setKUrl] = useState('');
  const [kKey, setKKey] = useState('');
  const [kStatus, setKStatus] = useState(null);

  const [apStatus, setApStatus] = useState(null);

  // react-query v5 has no onSuccess on useQuery: seed the form from data. The key comes back
  // masked ('***'); an empty field means "keep the saved key".
  const { data: kSettings } = useQuery({ queryKey: ['keitaro-settings'], queryFn: keitaroApi.settings });
  useEffect(() => { if (kSettings) setKUrl(kSettings.keitaro_url || ''); }, [kSettings]);
  const keyPayload = () => (kKey && kKey !== '***' ? { keitaro_api_key: kKey } : {});

  const { data: agentSt } = useQuery({ queryKey: ['agent-status'], queryFn: agentApi.status, refetchInterval: 30000 });

  const kSave = useMutation({
    mutationFn: () => keitaroApi.saveSettings({ keitaro_url: kUrl, ...keyPayload() }),
  });

  const kTest = useMutation({
    mutationFn: () => keitaroApi.test({ keitaro_url: kUrl, ...keyPayload() }),
    onSuccess: (d) => setKStatus({ ok: true, extra: `${d.campaigns_count} кампаний` }),
    onError: (e) => setKStatus({ ok: false, error: e.error || e.message || 'Ошибка' }),
  });

  // AdsPower lives on the Mac: the agent re-reads it and reports the profile count.
  const apTest = useMutation({
    mutationFn: async () => waitAgentJob((await adspowerApi.test()).job_id, { timeoutMs: 60000 }),
    onSuccess: (d) => setApStatus({ ok: true, extra: `${d.total} профилей` }),
    onError: (e) => setApStatus({ ok: false, error: e.error || e.message || 'Ошибка' }),
  });

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-5 py-3 border-b border-[color:var(--c1e2240)] flex-shrink-0">
        <h1 className="text-base font-semibold text-white">Настройки</h1>
        <p className="text-xs text-gray-500 mt-0.5">Интеграции и подключения</p>
      </div>

      <div className="flex-1 p-5 space-y-5 max-w-2xl">
        <SettingsSection title="Keitaro">
          <Field label="URL трекера" value={kUrl} onChange={setKUrl} placeholder="https://your-tracker.com" />
          <Field label="API ключ" value={kKey} onChange={setKKey} type="password" placeholder={kSettings?.keitaro_api_key ? "сохранён — оставьте пустым, чтобы не менять" : "••••••••"} />
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => kSave.mutate()}
              disabled={kSave.isPending}
              className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
            >
              {kSave.isPending ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button
              onClick={() => kTest.mutate()}
              disabled={kTest.isPending}
              className="text-sm px-4 py-2 rounded-lg bg-[color:var(--c2d3148)] hover:bg-[color:var(--c3a3f60)] text-gray-300 transition-colors disabled:opacity-50"
            >
              {kTest.isPending ? 'Проверка...' : 'Проверить'}
            </button>
            {kSave.isSuccess && <span className="text-xs text-emerald-400">Сохранено</span>}
            <StatusBadge status={kStatus} />
          </div>
        </SettingsSection>

        <SettingsSection title="AdsPower">
          <p className="text-xs text-gray-400 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${agentSt?.online ? 'bg-emerald-400' : 'bg-gray-600'}`} />
            Агент на Mac: {agentSt?.online ? 'на связи' : agentSt?.configured ? 'не на связи' : 'не подключён'}
          </p>
          <p className="text-xs text-gray-600">AdsPower работает на Mac. Сервер видит его через агента, ключ AdsPower хранится только на Mac.</p>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => apTest.mutate()}
              disabled={apTest.isPending}
              className="text-sm px-4 py-2 rounded-lg bg-[color:var(--c2d3148)] hover:bg-[color:var(--c3a3f60)] text-gray-300 transition-colors disabled:opacity-50"
            >
              {apTest.isPending ? 'Проверка...' : 'Проверить'}
            </button>
            <StatusBadge status={apStatus} />
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
