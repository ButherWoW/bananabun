import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { telegram } from '../api/client.js';
import Hint from '../components/Hint.jsx';

export function Box({ title, hint, children }) {
  return (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-white flex items-center">{title}{hint && <Hint k={hint} />}</h2>
      {children}
    </div>
  );
}

const btn = 'text-sm px-4 py-2 rounded-lg disabled:opacity-50';
const THRESHOLD_LABELS = { amount: 'Порог расхода', roi: 'ROI ниже, %', min_spend: 'При расходе от', minutes: 'Минут без связи' };

function ThresholdInputs({ ev, onSave }) {
  const [vals, setVals] = useState(ev.threshold || {});
  useEffect(() => { setVals(ev.threshold || {}); }, [ev.threshold]);
  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {Object.keys(ev.default_threshold || {}).map(k => (
        <label key={k} className="text-[11px] text-gray-500 flex items-center gap-1.5">
          {THRESHOLD_LABELS[k] || k}
          <input type="number" value={vals[k] ?? ''} onChange={e => setVals(v => ({ ...v, [k]: e.target.value }))}
            onBlur={() => onSave(vals)}
            className="w-20 bg-[color:var(--c0d0f1f)] border border-[color:var(--c2d3148)] rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
        </label>
      ))}
    </div>
  );
}

export default function TelegramPage() {
  const qc = useQueryClient();
  const { data: me, isLoading, error } = useQuery({ queryKey: ['telegram-me'], queryFn: telegram.me });
  const [deepLink, setDeepLink] = useState(null);
  const [qr, setQr] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['telegram-me'] });

  const link = useMutation({ mutationFn: telegram.link, onSuccess: (r) => setDeepLink(r.url) });
  const unlink = useMutation({ mutationFn: telegram.unlink, onSuccess: () => { setDeepLink(null); refresh(); } });
  const mute = useMutation({ mutationFn: telegram.mute, onSuccess: refresh });
  const setPref = useMutation({ mutationFn: telegram.setPref, onSuccess: refresh });
  const test = useMutation({ mutationFn: telegram.test });

  useEffect(() => {
    if (!deepLink) { setQr(null); return; }
    QRCode.toDataURL(deepLink, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [deepLink]);

  // While the link is open, check every few seconds whether the chat got linked.
  useEffect(() => {
    if (!deepLink || me?.linked) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [deepLink, me?.linked]);
  useEffect(() => { if (me?.linked) setDeepLink(null); }, [me?.linked]);

  if (isLoading) return <div className="p-5 text-sm text-gray-500">Загрузка…</div>;
  if (error) return <div className="p-5 text-sm text-red-400">{error.error || 'Не удалось загрузить'}</div>;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-5 py-3 border-b border-[color:var(--c1e2240)] flex-shrink-0">
        <h1 className="text-base font-semibold text-white">Уведомления в Telegram</h1>
        <p className="text-xs text-gray-500 mt-0.5">Бот пишет о ваших заливах, модерации, деньгах, скрапе, креативах и конверсиях. Вы видите только своё.</p>
      </div>

      <div className="flex-1 p-5 space-y-5 max-w-2xl">
        {!me.bot_ready && (
          <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            Бот ещё не подключён: владелец добавит токен бота, и здесь появится кнопка привязки.
          </div>
        )}

        <Box title="Привязка" hint="tg.link">
          {me.linked ? (
            <>
              <p className="text-sm text-gray-300">
                Привязан{me.username ? <> к <span className="text-white">@{me.username}</span></> : ''}.
                {me.blocked && <span className="text-red-400"> Бот заблокирован в Telegram — разблокируйте его и привяжите заново.</span>}
                {me.muted && !me.blocked && <span className="text-amber-300"> Уведомления на паузе.</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                <button className={`${btn} bg-[color:var(--c2d3148)] text-gray-300 hover:bg-[color:var(--c3a3f60)]`} onClick={() => mute.mutate(!me.muted)} disabled={mute.isPending}>
                  {me.muted ? 'Включить уведомления' : 'Поставить на паузу'}
                </button>
                <button className={`${btn} bg-[color:var(--c2d3148)] text-gray-300 hover:bg-[color:var(--c3a3f60)]`} onClick={() => test.mutate()} disabled={test.isPending || !me.bot_ready}>
                  {test.isSuccess ? 'Отправлено' : 'Прислать тестовое'}
                </button>
                <button className={`${btn} text-red-400 hover:text-red-300`} onClick={() => unlink.mutate()} disabled={unlink.isPending}>Отвязать</button>
              </div>
              {test.isError && <p className="text-xs text-red-400">{test.error?.error}</p>}
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">Нажмите кнопку, откройте бота{me.bot_username ? <> <span className="text-gray-300">@{me.bot_username}</span></> : ''} и нажмите «Start». Ссылка одноразовая и действует 15 минут.</p>
              <button className={`${btn} bg-indigo-600 hover:bg-indigo-500 text-white`} onClick={() => link.mutate()} disabled={!me.bot_ready || link.isPending}>
                {link.isPending ? 'Готовлю ссылку…' : 'Привязать Telegram'}
              </button>
              {link.isError && <p className="text-xs text-red-400">{link.error?.error}</p>}
              {deepLink && (
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  {qr && <img src={qr} alt="QR-код ссылки на бота" className="w-40 h-40 rounded-lg bg-white p-1" />}
                  <div className="space-y-2 min-w-0">
                    <a href={deepLink} target="_blank" rel="noreferrer" className="text-sm text-indigo-400 hover:text-indigo-300 break-all">Открыть бота в Telegram</a>
                    <p className="text-xs text-gray-500">С телефона — отсканируйте QR. Страница сама обновится, когда привязка пройдёт.</p>
                  </div>
                </div>
              )}
            </>
          )}
        </Box>

        <Box title="Что присылать" hint="tg.events">
          <div className="divide-y divide-[color:var(--c1e2240)]">
            {me.events.map(ev => (
              <div key={ev.key} className="py-2.5">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-300 flex-1 min-w-0">
                    <input type="checkbox" checked={ev.enabled} onChange={e => setPref.mutate({ event: ev.key, enabled: e.target.checked, threshold: ev.threshold })} />
                    <span>{ev.label}</span>
                    <Hint k={`tg.ev.${ev.key}`} />
                  </label>
                  {ev.custom && (
                    <button className="text-[11px] text-gray-500 hover:text-gray-300" onClick={() => setPref.mutate({ event: ev.key, reset: true })}>как у команды</button>
                  )}
                </div>
                {ev.default_threshold && ev.enabled && (
                  <ThresholdInputs ev={ev} onSave={(vals) => setPref.mutate({ event: ev.key, enabled: true, threshold: vals })} />
                )}
              </div>
            ))}
          </div>
          {setPref.isError && <p className="text-xs text-red-400">{setPref.error?.error}</p>}
        </Box>
      </div>
    </div>
  );
}
