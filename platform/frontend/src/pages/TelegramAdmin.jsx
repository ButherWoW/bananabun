import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { telegram } from '../api/client.js';
import Hint from '../components/Hint.jsx';
import { Box } from './Telegram.jsx';

const btn = 'text-sm px-4 py-2 rounded-lg disabled:opacity-50';
const ghost = `${btn} bg-[color:var(--c2d3148)] text-gray-300 hover:bg-[color:var(--c3a3f60)]`;
const input = 'bg-[color:var(--c0d0f1f)] border border-[color:var(--c2d3148)] rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500';
const fmt = (d) => (d ? new Date(d).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const TZ = ['UTC', 'Europe/Moscow', 'Europe/Kyiv', 'Europe/Paris', 'Europe/Madrid', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Almaty', 'Asia/Bangkok', 'Asia/Makassar', 'Asia/Singapore'];
const THRESHOLD_LABELS = { amount: 'Порог расхода', roi: 'ROI ниже, %', min_spend: 'При расходе от', minutes: 'Минут без связи' };
const STATUS = { pending: 'в очереди', sent: 'отправлено', failed: 'не ушло' };

function CopyLine({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select manually */ } };
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 break-all text-xs px-3 py-2 rounded-lg bg-[color:var(--c0d0f1f)] border border-[color:var(--c2d3148)] text-gray-300 select-all">{value}</code>
      <button onClick={copy} className="text-xs px-3 py-2 rounded-lg bg-[color:var(--c2d3148)] hover:bg-[color:var(--c3a3f60)] text-gray-300 flex-shrink-0">{copied ? 'Скопировано' : 'Копировать'}</button>
    </div>
  );
}

function StatusBox() {
  const qc = useQueryClient();
  const { data: s, isLoading } = useQuery({ queryKey: ['tg-status'], queryFn: telegram.admin.status, refetchInterval: 15000 });
  const hook = useMutation({ mutationFn: telegram.admin.setWebhook, onSuccess: () => qc.invalidateQueries({ queryKey: ['tg-status'] }) });
  if (isLoading || !s) return <Box title="Бот" hint="tg.admin.bot"><p className="text-xs text-gray-500">Загрузка…</p></Box>;
  const row = (label, value, ok) => (
    <div className="flex justify-between gap-3 text-xs"><span className="text-gray-500">{label}</span><span className={ok === false ? 'text-red-400' : ok ? 'text-emerald-400' : 'text-gray-300'}>{value}</span></div>
  );
  return (
    <Box title="Бот" hint="tg.admin.bot">
      {!s.token_set ? (
        <p className="text-xs text-amber-300">Токен бота не задан. Добавьте его в GitHub Secrets как <code>TELEGRAM_BOT_TOKEN</code> — после деплоя бот заработает.</p>
      ) : (
        <div className="space-y-1.5">
          {row('Бот', s.bot ? `@${s.bot.username}` : 'не отвечает', !!s.bot)}
          {row('Webhook', s.webhook?.ok ? 'подключён' : s.webhook?.url ? 'указан другой адрес' : 'не подключён', !!s.webhook?.ok)}
          {s.webhook?.last_error && row('Последняя ошибка Telegram', `${s.webhook.last_error} (${fmt(s.webhook.last_error_at)})`, false)}
          {row('Ждут доставки', s.queue?.pending ?? 0)}
          {row('Отправлено за сутки', s.queue?.sent_day ?? 0)}
          {row('Не ушло за сутки', s.queue?.failed_day ?? 0, s.queue?.failed_day ? false : undefined)}
          {s.error && <p className="text-xs text-red-400">{s.error}</p>}
        </div>
      )}
      {s.token_set && !s.webhook?.ok && (
        <button className={`${btn} bg-indigo-600 hover:bg-indigo-500 text-white`} onClick={() => hook.mutate()} disabled={hook.isPending}>
          {hook.isPending ? 'Подключаю…' : 'Подключить webhook'}
        </button>
      )}
      {hook.isError && <p className="text-xs text-red-400">{hook.error?.error}</p>}
      {!s.webhook_secret_set && <p className="text-xs text-amber-300">На сервере нет секрета webhook — он появится после следующего деплоя.</p>}
    </Box>
  );
}

function PostbackBox() {
  const { data: p } = useQuery({ queryKey: ['tg-postbacks'], queryFn: telegram.admin.postbacks, refetchInterval: 20000 });
  if (!p) return null;
  return (
    <Box title="Конверсии из Keitaro" hint="tg.admin.postback">
      {p.url ? <CopyLine value={p.url} /> : <p className="text-xs text-amber-300">Секрет постбека появится на сервере после следующего деплоя.</p>}
      <p className="text-xs text-gray-500">Получено всего: <span className="text-gray-300">{p.counts?.total ?? 0}</span>, за сутки: <span className="text-gray-300">{p.counts?.day ?? 0}</span>, повторов: <span className="text-gray-300">{p.counts?.duplicates ?? 0}</span></p>
      {p.last?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 text-left">
              {['Когда', 'Статус', 'Выплата', 'Кампания', 'Оффер', 'Гео', 'Байер'].map(h => <th key={h} className="py-1.5 pr-3 font-normal">{h}</th>)}
            </tr></thead>
            <tbody>
              {p.last.map((r, i) => (
                <tr key={i} className={`border-t border-[color:var(--c1e2240)] ${r.duplicate ? 'text-gray-600' : 'text-gray-300'}`}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmt(r.received_at)}</td>
                  <td className="py-1.5 pr-3">{r.status}{r.duplicate ? ' (повтор)' : ''}</td>
                  <td className="py-1.5 pr-3">{r.payout != null ? `${r.payout} ${r.currency || ''}` : '—'}</td>
                  <td className="py-1.5 pr-3 max-w-[16rem] truncate">{r.campaign || '—'}</td>
                  <td className="py-1.5 pr-3">{r.offer || '—'}</td>
                  <td className="py-1.5 pr-3">{r.country || '—'}</td>
                  <td className="py-1.5 pr-3">{r.buyer || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Box>
  );
}

function SettingsBox() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['tg-settings'], queryFn: telegram.admin.settings });
  const [s, setS] = useState(null);
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  const save = useMutation({ mutationFn: () => telegram.admin.saveSettings(s), onSuccess: (r) => { setS(r.settings); qc.invalidateQueries({ queryKey: ['tg-settings'] }); } });
  if (!data || !s) return null;
  const toggle = (key, field) => setS(v => field === 'team'
    ? { ...v, team_events: v.team_events.includes(key) ? v.team_events.filter(e => e !== key) : [...v.team_events, key] }
    : { ...v, events: { ...v.events, [key]: !v.events[key] } });
  const setThr = (key, k, val) => setS(v => ({ ...v, thresholds: { ...v.thresholds, [key]: { ...(v.thresholds[key] || {}), [k]: val } } }));
  const hour = (k) => (
    <select value={s[k] ?? ''} onChange={e => setS(v => ({ ...v, [k]: e.target.value === '' ? null : Number(e.target.value) }))} className={input}>
      {k !== 'digest_hour' && <option value="">нет</option>}
      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
    </select>
  );
  return (
    <Box title="Настройки команды" hint="tg.admin.settings">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500 text-left">
            <th className="py-1.5 pr-3 font-normal">Событие</th>
            <th className="py-1.5 pr-3 font-normal">Включено<Hint k="tg.admin.default" /></th>
            <th className="py-1.5 pr-3 font-normal">Копия лидам<Hint k="tg.admin.team" /></th>
            <th className="py-1.5 font-normal">Порог</th>
          </tr></thead>
          <tbody>
            {data.events.map(ev => (
              <tr key={ev.key} className="border-t border-[color:var(--c1e2240)] text-gray-300 align-top">
                <td className="py-2 pr-3">{ev.label}{ev.leads_only && <span className="text-gray-600"> · только лидам</span>}</td>
                <td className="py-2 pr-3"><input type="checkbox" checked={!!s.events[ev.key]} onChange={() => toggle(ev.key)} /></td>
                <td className="py-2 pr-3">{ev.leads_only ? '—' : <input type="checkbox" checked={s.team_events.includes(ev.key)} onChange={() => toggle(ev.key, 'team')} />}</td>
                <td className="py-2">
                  {ev.threshold && Object.keys(ev.threshold).map(k => (
                    <label key={k} className="flex items-center gap-1.5 text-gray-500 mb-1">{THRESHOLD_LABELS[k] || k}
                      <input type="number" value={s.thresholds[ev.key]?.[k] ?? ''} onChange={e => setThr(ev.key, k, e.target.value)} className={`${input} w-20`} />
                    </label>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-1">
        <label className="flex items-center gap-2">Итог дня в {hour('digest_hour')}<Hint k="tg.admin.digest" /></label>
        <label className="flex items-center gap-2">Часовой пояс
          <select value={s.timezone} onChange={e => setS(v => ({ ...v, timezone: e.target.value }))} className={input}>
            {[...new Set([s.timezone, ...TZ])].map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">Тихие часы с {hour('quiet_from')} до {hour('quiet_to')}<Hint k="tg.admin.quiet" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.conversion_urgent !== false} onChange={e => setS(v => ({ ...v, conversion_urgent: e.target.checked }))} />Конверсии и ночью</label>
      </div>
      <button className={`${btn} bg-indigo-600 hover:bg-indigo-500 text-white`} onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Сохраняю…' : save.isSuccess ? 'Сохранено' : 'Сохранить'}</button>
      {save.isError && <p className="text-xs text-red-400">{save.error?.error}</p>}
    </Box>
  );
}

function MembersBox() {
  const { data: members = [] } = useQuery({ queryKey: ['tg-members'], queryFn: telegram.admin.members });
  const test = useMutation({ mutationFn: telegram.admin.test });
  return (
    <Box title="Кто подключил бота" hint="tg.admin.members">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500 text-left">
            {['Участник', 'Роль', 'Telegram', 'Привязан', ''].map((h, i) => <th key={i} className="py-1.5 pr-3 font-normal">{h}</th>)}
          </tr></thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} className="border-t border-[color:var(--c1e2240)] text-gray-300">
                <td className="py-2 pr-3">{m.name || m.email}</td>
                <td className="py-2 pr-3 text-gray-500">{m.role}</td>
                <td className="py-2 pr-3">{m.linked ? `${m.username ? '@' + m.username : m.chat}${m.blocked_at ? ' · бот заблокирован' : m.muted ? ' · пауза' : ''}` : <span className="text-gray-600">не привязан</span>}</td>
                <td className="py-2 pr-3">{fmt(m.linked_at)}</td>
                <td className="py-2 text-right">{m.linked && !m.blocked_at && (
                  <button className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50" disabled={test.isPending} onClick={() => test.mutate(m.id)}>Тест</button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {test.isError && <p className="text-xs text-red-400">{test.error?.error}</p>}
      {test.isSuccess && <p className="text-xs text-emerald-400">Тестовое сообщение в очереди.</p>}
    </Box>
  );
}

function LogBox() {
  const [status, setStatus] = useState('');
  const [event, setEvent] = useState('');
  const { data: rows = [] } = useQuery({ queryKey: ['tg-log', status, event], queryFn: () => telegram.admin.log({ status: status || undefined, event: event || undefined, limit: 100 }), refetchInterval: 15000 });
  const { data: settings } = useQuery({ queryKey: ['tg-settings'], queryFn: telegram.admin.settings });
  return (
    <Box title="Журнал отправок" hint="tg.admin.log">
      <div className="flex flex-wrap gap-2">
        <select value={status} onChange={e => setStatus(e.target.value)} className={input}>
          <option value="">все статусы</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={event} onChange={e => setEvent(e.target.value)} className={input}>
          <option value="">все события</option>
          {(settings?.events || []).map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>
      </div>
      {!rows.length ? <p className="text-xs text-gray-500">Пока пусто.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500 text-left">
              {['Когда', 'Кому', 'Событие', 'Статус', 'Ошибка'].map(h => <th key={h} className="py-1.5 pr-3 font-normal">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-[color:var(--c1e2240)] text-gray-300">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmt(r.sent_at || r.created_at)}</td>
                  <td className="py-1.5 pr-3">{r.user_name || r.user_email || '—'}</td>
                  <td className="py-1.5 pr-3">{settings?.events?.find(e => e.key === r.event)?.label || r.event}</td>
                  <td className={`py-1.5 pr-3 ${r.status === 'failed' ? 'text-red-400' : r.status === 'sent' ? 'text-emerald-400' : 'text-amber-300'}`}>{STATUS[r.status] || r.status}</td>
                  <td className="py-1.5 pr-3 text-gray-500 max-w-[18rem] truncate" title={r.error || ''}>{r.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Box>
  );
}

function BroadcastBox() {
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const send = useMutation({ mutationFn: () => telegram.admin.broadcast(text.trim()), onSuccess: () => { setText(''); setConfirming(false); } });
  return (
    <Box title="Сообщение команде" hint="tg.admin.broadcast">
      <textarea value={text} onChange={e => { setText(e.target.value); setConfirming(false); }} rows={3} maxLength={2000}
        placeholder="Например: сегодня в 18:00 созвон по новым гео"
        className="w-full bg-[color:var(--c0d0f1f)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-500 placeholder-gray-700" />
      {!confirming ? (
        <button className={ghost} disabled={!text.trim()} onClick={() => setConfirming(true)}>Отправить всем…</button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-amber-300">Отправить всем, кто подключил бота?</span>
          <button className={`${btn} bg-indigo-600 hover:bg-indigo-500 text-white`} disabled={send.isPending} onClick={() => send.mutate()}>Да, отправить</button>
          <button className={ghost} onClick={() => setConfirming(false)}>Отмена</button>
        </div>
      )}
      {send.isSuccess && <p className="text-xs text-emerald-400">В очереди: {send.data?.queued ?? 0}</p>}
      {send.isError && <p className="text-xs text-red-400">{send.error?.error}</p>}
    </Box>
  );
}

export default function TelegramAdminPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-5 py-3 border-b border-[color:var(--c1e2240)] flex-shrink-0">
        <h1 className="text-base font-semibold text-white">Telegram-бот</h1>
        <p className="text-xs text-gray-500 mt-0.5">Подключение бота, что и кому он присылает, конверсии из Keitaro и журнал доставки.</p>
      </div>
      <div className="flex-1 p-5 space-y-5 max-w-4xl">
        <StatusBox />
        <PostbackBox />
        <SettingsBox />
        <MembersBox />
        <LogBox />
        <BroadcastBox />
      </div>
    </div>
  );
}
