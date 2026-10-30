import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mcpTokens } from '../api/client.js';

const MCP_URL = `${window.location.origin}/api/mcp`;

function Box({ title, children }) {
  return (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {children}
    </div>
  );
}

function CopyLine({ value, secret = false }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select manually */ }
  };
  return (
    <div className="flex items-center gap-2">
      <code className={`flex-1 min-w-0 break-all text-xs px-3 py-2 rounded-lg bg-[color:var(--c0d0f1f)] border ${secret ? 'border-amber-500/50 text-amber-200' : 'border-[color:var(--c2d3148)] text-gray-300'} select-all`}>{value}</code>
      <button onClick={copy} className="text-xs px-3 py-2 rounded-lg bg-[color:var(--c2d3148)] hover:bg-[color:var(--c3a3f60)] text-gray-300 flex-shrink-0">
        {copied ? 'Скопировано' : 'Копировать'}
      </button>
    </div>
  );
}

const fmt = (d) => (d ? new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function McpPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const { data: tokens = [], isLoading } = useQuery({ queryKey: ['mcp-tokens'], queryFn: mcpTokens.list });
  const create = useMutation({
    mutationFn: () => mcpTokens.create(name.trim() || 'Claude'),
    onSuccess: (t) => { setFresh(t); setName(''); qc.invalidateQueries({ queryKey: ['mcp-tokens'] }); },
  });
  const revoke = useMutation({
    mutationFn: (id) => mcpTokens.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-tokens'] }),
  });
  const shown = fresh?.token || 'bb_ВАШ_ТОКЕН';

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-5 py-3 border-b border-[color:var(--c1e2240)] flex-shrink-0">
        <h1 className="text-base font-semibold text-white">Подключение ИИ (MCP)</h1>
        <p className="text-xs text-gray-500 mt-0.5">Claude или другой ИИ-агент видит ваши товары, креативы, заливы и аналитику — ровно то, что вы видите здесь.</p>
      </div>

      <div className="flex-1 p-5 space-y-5 max-w-2xl">
        <Box title="1. Создайте личный токен">
          <p className="text-xs text-gray-500">Токен показывается один раз. Храните его как пароль: не пересылайте в чаты и не коммитьте. Не нужен — отзовите.</p>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Название, например «Claude на ноутбуке»"
              maxLength={100}
              className="flex-1 min-w-0 bg-[color:var(--c0d0f1f)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-500 placeholder-gray-700"
            />
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 flex-shrink-0"
            >
              {create.isPending ? 'Создаю…' : 'Создать токен'}
            </button>
          </div>
          {create.isError && <p className="text-xs text-red-400">{create.error?.error || 'Не получилось'}</p>}
          {fresh && (
            <div className="space-y-1.5">
              <p className="text-xs text-amber-300">Скопируйте токен сейчас — больше он показан не будет.</p>
              <CopyLine value={fresh.token} secret />
            </div>
          )}
        </Box>

        <Box title="2. Подключите">
          <p className="text-xs text-gray-400 font-medium">Claude (сайт или приложение)</p>
          <p className="text-xs text-gray-500">Настройки → Connectors → Add custom connector. Адрес сервера:</p>
          <CopyLine value={MCP_URL} />
          <p className="text-xs text-gray-500">Заголовок авторизации: <code className="text-gray-300">Authorization: Bearer {fresh ? 'токен из шага 1' : 'bb_ВАШ_ТОКЕН'}</code></p>
          <p className="text-xs text-gray-400 font-medium pt-2">Claude Code (терминал)</p>
          <CopyLine value={`claude mcp add --transport http bananabun ${MCP_URL} --header "Authorization: Bearer ${shown}"`} secret={!!fresh} />
          <p className="text-xs text-gray-600 pt-1">Агент сам ничего не запускает: скрап, генерация креативов и залив приходят черновиком, выполняются только после вашего «да». Залив создаётся на паузе, бюджет и ставку называете вы.</p>
        </Box>

        <Box title="Ваши токены">
          {isLoading ? <p className="text-xs text-gray-500">Загрузка…</p> : !tokens.length ? (
            <p className="text-xs text-gray-500">Токенов пока нет.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 text-left">
                    <th className="py-1.5 pr-3 font-normal">Название</th>
                    <th className="py-1.5 pr-3 font-normal">Токен</th>
                    <th className="py-1.5 pr-3 font-normal">Создан</th>
                    <th className="py-1.5 pr-3 font-normal">Последний вызов</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.id} className="border-t border-[color:var(--c1e2240)] text-gray-300">
                      <td className="py-2 pr-3">{t.name}</td>
                      <td className="py-2 pr-3 font-mono text-gray-500">{t.token_hint}</td>
                      <td className="py-2 pr-3">{fmt(t.created_at)}</td>
                      <td className="py-2 pr-3">{fmt(t.last_used_at)}</td>
                      <td className="py-2 text-right">
                        {t.revoked_at ? <span className="text-gray-600">отозван</span> : (
                          <button onClick={() => revoke.mutate(t.id)} disabled={revoke.isPending} className="text-red-400 hover:text-red-300 disabled:opacity-50">Отозвать</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Box>
      </div>
    </div>
  );
}
