import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, campaigns as campaignsApi, keitaro as keitaroApi, adSettings as adSettingsApi, waitAgentJob } from '../api/client.js';
import PushWizard from '../components/PushWizard.jsx';
import PushPresetsPanel from '../components/PushPresetsPanel.jsx';
import clsx from 'clsx';
import { useRole } from '../hooks/useRole.js';

const TABS = [
  { key: 'active', label: 'В работе' },
  { key: 'attention', label: 'Требуют внимания' },
  { key: 'paused', label: 'Выключены' },
  { key: 'pushes', label: 'Заливы' },
  { key: 'archive', label: 'Архив' },
];

const STATE_COLOR = {
  active: 'bg-emerald-500',
  disabled: 'bg-yellow-500',
  deleted: 'bg-red-500',
};

function DataBadge({ label, value, color }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', color)} />
      <span className="text-gray-500">{label}</span>
      <span className={value === 'нет данных' ? 'text-gray-600' : 'text-white font-medium'}>
        · {value}
      </span>
    </div>
  );
}

const stripId = (s) => (s || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

// FA names: [hash][date][buyer(id)][product(id)][GEO][template(id)][profile][BM(id)][cabinet(act_…)][page(id)]
// Older names: [Buyer] Product
function parseCampaignName(name = '') {
  const lead = name.match(/^(\[[^\]]*\])+/)?.[0] || '';
  const segs = [...lead.matchAll(/\[([^\]]*)\]/g)].map(m => m[1]);
  if (segs.length >= 6) {
    return {
      buyer: stripId(segs[2]),
      product: stripId(segs[3]),
      geo: /^[A-Z]{2}$/.test(segs[4]) ? segs[4] : '',
      template: stripId(segs[5]),
      cabinet: stripId(segs[8] || ''),
    };
  }
  return { buyer: segs[0] || '', product: name.slice(lead.length).trim(), geo: '', template: '', cabinet: '' };
}

const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'last_7_days', label: '7 дней' },
  { key: 'last_30_days', label: '30 дней' },
];

const METRIC_COLUMNS = [
  { key: 'budget', label: 'Бюджет $' },
  { key: 'spend', label: 'Расход €' },
  { key: 'clicks', label: 'Клики' },
  { key: 'offer', label: 'На оффер' },
  { key: 'sales', label: 'Продажи' },
  { key: 'revenue', label: 'Доход €' },
  { key: 'profit', label: 'Прибыль €' },
  { key: 'roi', label: 'ROI' },
];
const COLS_KEY = 'campaigns.columns';

function loadColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
    if (Array.isArray(saved)) return new Set(saved.filter(k => METRIC_COLUMNS.some(c => c.key === k)));
  } catch { /* storage unavailable */ }
  return new Set(METRIC_COLUMNS.map(c => c.key));
}

function saveColumns(set) {
  try { localStorage.setItem(COLS_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ }
}

function sumRows(rows) {
  const t = { spend: 0, clicks: 0, lp_clicks: 0, sales: 0, revenue: 0 };
  for (const c of rows) {
    t.spend += Number(c.spend || 0);
    t.clicks += Number(c.clicks || 0);
    t.lp_clicks += Number(c.lp_clicks || 0);
    t.sales += Number(c.sales || c.leads || 0);
    t.revenue += Number(c.revenue || 0);
  }
  t.profit = t.revenue - t.spend;
  t.roi = t.spend > 0 ? (t.profit / t.spend) * 100 : null;
  return t;
}

const PUSH_STATUS = {
  pending: ['В очереди', 'text-gray-400'],
  running: ['Идёт', 'text-yellow-400'],
  processing: ['Идёт', 'text-yellow-400'],
  done: ['Готово', 'text-emerald-400'],
  success: ['Готово', 'text-emerald-400'],
  failed: ['Ошибка', 'text-red-400'],
  error: ['Ошибка', 'text-red-400'],
};

function HistoryPanel({ campaignId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['campaign-history', campaignId],
    queryFn: () => campaignsApi.history(campaignId),
    retry: 1,
    staleTime: 300000,
  });

  if (isLoading) return (
    <tr><td colSpan={11} className="px-10 py-3 bg-[color:var(--c070916)]">
      <span className="text-xs text-gray-600 animate-pulse">Загрузка истории...</span>
    </td></tr>
  );
  if (error || !data?.events?.length) return (
    <tr><td colSpan={11} className="px-10 py-3 bg-[color:var(--c070916)]">
      <span className="text-xs text-gray-600">История недоступна</span>
    </td></tr>
  );
  return data.events.slice(0, 10).map((e, i) => (
    <tr key={i} className="bg-[color:var(--c070916)] border-b border-[color:var(--c141628)]">
      <td className="px-4 py-2" />
      <td colSpan={3} className="px-2 py-2">
        <div className="flex items-center gap-2 pl-6">
          <span className="text-xs text-gray-500 font-mono">{e.at ? new Date(e.at).toLocaleDateString('ru-RU') : ''}</span>
          <span className="text-xs text-gray-400">{e.action || e.type || e.event || JSON.stringify(e).slice(0, 60)}</span>
        </div>
      </td>
      <td colSpan={8} className="px-4 py-2 text-xs text-gray-600 text-right">
        {e.user || e.author || ''}
      </td>
    </tr>
  ));
}

const MODERATION_COLOR = { approved: 'text-emerald-400/80', review: 'text-yellow-400', rejected: 'text-red-400', issues: 'text-orange-400' };

// Adsets and ads of our own FB list: every edit goes to the profile through the Mac agent.
function FbAdsetsPanel({ campaign }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(null); // { id, field, value } — inline number/name edit
  const [tgt, setTgt] = useState(null);   // { adset_id, age_min, age_max, genders, countries }
  const [presetFor, setPresetFor] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const { data: presets = [] } = useQuery({ queryKey: ['ad-settings'], queryFn: adSettingsApi.list, enabled: !!presetFor });

  const run = (call, okText) => ({
    mutationFn: async (data) => waitAgentJob((await call(data)).job_id, { timeoutMs: 600000 }),
    onMutate: () => { setErr(''); setNote('Агент выполняет в профиле…'); },
    onSuccess: () => {
      setEdit(null); setTgt(null); setPresetFor(null); setNote(okText);
      qc.invalidateQueries({ queryKey: ['campaigns', 'fb'] });
      qc.invalidateQueries({ queryKey: ['fb-history', campaign.id] });
    },
    onError: (e) => { setNote(''); setErr(e.error || e.message || 'Ошибка'); },
  });
  const mut = useMutation(run((d) => campaignsApi.fbEdit(campaign.id, d), 'Готово'));
  const dup = useMutation(run((d) => campaignsApi.fbDuplicate(campaign.id, d), 'Копия создана на паузе — появится после обновления из FB'));
  const preset = useMutation(run((d) => campaignsApi.fbApplyPreset(campaign.id, d), 'Пресет применён'));
  const busy = mut.isPending || dup.isPending || preset.isPending;

  const setStatus = (key, row, on, kind) => {
    if (on && !window.confirm(`Включить ${kind} «${row.name}»? Реклама начнёт открутку.`)) return;
    mut.mutate({ [key]: row.id, status: on ? 'ACTIVE' : 'PAUSED', confirm: on || undefined });
  };
  const duplicate = (level, row) => {
    const n = Number(window.prompt(`Сколько копий ${level === 'ad' ? 'объявления' : 'адсета'} «${row.name}»? Копии будут на паузе.`, '1'));
    if (n >= 1 && n <= 10) dup.mutate({ level, row_id: row.id, copies: n });
  };
  const inline = (row, field, payload, show, type = 'number') => edit?.id === row.id && edit.field === field ? (
    <form onSubmit={e => { e.preventDefault(); mut.mutate(payload(edit.value)); }} className="inline-flex items-center gap-1">
      <input autoFocus type={type} step="0.01" value={edit.value} onChange={e => setEdit({ ...edit, value: e.target.value })}
        className={clsx(type === 'number' ? 'w-20' : 'w-56', 'bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-200 text-xs px-1.5 py-0.5 rounded')} />
      <button type="submit" disabled={busy} className="text-indigo-400 text-xs">{busy ? '…' : 'OK'}</button>
      <button type="button" onClick={() => setEdit(null)} className="text-gray-600 text-xs">✕</button>
    </form>
  ) : (
    <button onClick={() => setEdit({ id: row.id, field, value: row[field] ?? '' })} className="text-gray-300 hover:text-indigo-300 text-left">{show}</button>
  );
  const money = (v) => (v != null ? `${v} ${campaign.currency || ''}` : '—');
  const linkBtn = 'text-[10px] text-gray-500 hover:text-indigo-300';
  const aud = (a) => a.audience ? `${a.audience.age_min ?? '?'}–${a.audience.age_max ?? '?'} · ${GENDER_RU[a.audience.genders] || 'все'} · ${(a.audience.countries || []).join(',') || '—'}` : null;

  return (
    <tr><td colSpan={20} className="px-10 py-2 bg-[color:var(--c070916)]">
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 mb-2">
        <span>Лимит трат кампании: {inline(campaign, 'spend_cap', (v) => ({ spend_cap: Number(v) }), money(campaign.spend_cap))}</span>
        {campaign.spend_cap != null && <button className={linkBtn} disabled={busy} onClick={() => window.confirm('Снять лимит трат кампании?') && mut.mutate({ spend_cap_clear: true })}>снять</button>}
        {note && <span className="text-indigo-300">{note}</span>}
        {err && <span className="text-red-400">{err}</span>}
      </div>
      {(campaign.adsets || []).length === 0 ? <span className="text-xs text-gray-600">Адсетов нет</span> : (
        <table className="w-full text-xs">
          <thead><tr className="text-gray-600"><th className="text-left py-1">Адсет / объявление</th><th className="text-left">Статус</th><th className="text-right">Бюджет/день</th><th className="text-right">Ставка</th><th className="text-right">Действия</th></tr></thead>
          <tbody>
            {campaign.adsets.map(a => (
              <React.Fragment key={a.id}>
                <tr className="border-t border-[color:var(--c1a1d3a)]">
                  <td className="py-1.5 text-gray-300">
                    {inline(a, 'name', (v) => ({ adset_id: a.id, name: v }), a.name, 'text')}
                    <div className="text-[10px] text-gray-600 font-mono">{a.id}{aud(a) && <span className="font-sans"> · {aud(a)}</span>}</div>
                    {a.moderation && <div className={clsx('text-[10px]', a.moderation.rejected || a.moderation.issues ? 'text-red-400' : 'text-gray-600')}>{a.moderation.label}</div>}
                  </td>
                  <td><Toggle on={a.status === 'ACTIVE'} onChange={(on) => setStatus('adset_id', a, on, 'адсет')} /> <span className="text-gray-600 ml-1">{a.effective_status}</span></td>
                  <td className="text-right">{inline(a, 'daily_budget', (v) => ({ adset_id: a.id, daily_budget: Number(v) }), money(a.daily_budget))}</td>
                  <td className="text-right">{inline(a, 'bid_amount', (v) => ({ adset_id: a.id, bid_amount: Number(v) }), money(a.bid_amount))}</td>
                  <td className="text-right whitespace-nowrap space-x-2">
                    <button className={linkBtn} disabled={busy} onClick={() => setTgt({ adset_id: a.id, age_min: a.audience?.age_min ?? 18, age_max: a.audience?.age_max ?? 65, genders: a.audience?.genders || 'all', countries: (a.audience?.countries || []).join(',') })}>таргетинг</button>
                    <button className={linkBtn} disabled={busy} onClick={() => setPresetFor(a.id)}>пресет</button>
                    <button className={linkBtn} disabled={busy} onClick={() => duplicate('adset', a)}>дубль</button>
                  </td>
                </tr>
                {tgt?.adset_id === a.id && (
                  <tr><td colSpan={5} className="py-1.5">
                    <form className="flex flex-wrap items-center gap-2" onSubmit={e => {
                      e.preventDefault();
                      if (!window.confirm('Правка таргетинга отправит адсет на проверку и заново в обучение. Продолжить?')) return;
                      mut.mutate({ adset_id: a.id, targeting: { age_min: Number(tgt.age_min), age_max: Number(tgt.age_max), genders: tgt.genders, countries: tgt.countries } });
                    }}>
                      <span className="text-gray-500">Возраст</span>
                      <input type="number" min={13} max={65} value={tgt.age_min} onChange={e => setTgt({ ...tgt, age_min: e.target.value })} className={tinyInp} />
                      <input type="number" min={13} max={65} value={tgt.age_max} onChange={e => setTgt({ ...tgt, age_max: e.target.value })} className={tinyInp} />
                      <select value={tgt.genders} onChange={e => setTgt({ ...tgt, genders: e.target.value })} className={tinyInp + ' w-auto'}>
                        <option value="all">все</option><option value="male">мужчины</option><option value="female">женщины</option>
                      </select>
                      <span className="text-gray-500">Страны</span>
                      <input value={tgt.countries} onChange={e => setTgt({ ...tgt, countries: e.target.value })} placeholder="FR,BE" className={tinyInp + ' w-24'} />
                      <button type="submit" disabled={busy} className="text-indigo-400">Сохранить</button>
                      <button type="button" onClick={() => setTgt(null)} className="text-gray-600">Отмена</button>
                    </form>
                  </td></tr>
                )}
                {presetFor === a.id && (
                  <tr><td colSpan={5} className="py-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-gray-500">Пресет на этот адсет (возраст, пол, бюджет, ставка):</span>
                      {presets.map(p => (
                        <button key={p.id} disabled={busy} className="px-2 py-0.5 rounded border border-[color:var(--c2d3148)] text-gray-300 hover:border-indigo-500"
                          onClick={() => window.confirm(`Применить пресет «${p.name}» к адсету «${a.name}»? Адсет уйдёт на проверку и в обучение.`) && preset.mutate({ adset_id: a.id, preset_id: p.id })}>
                          {p.name}
                        </button>
                      ))}
                      {presets.length === 0 && <span className="text-gray-600">Пресетов нет</span>}
                      <button onClick={() => setPresetFor(null)} className="text-gray-600">Отмена</button>
                    </div>
                  </td></tr>
                )}
                {(a.ads || []).map(ad => (
                  <tr key={ad.id} className="text-[11px]">
                    <td className="py-0.5 pl-4 text-gray-500 max-w-[320px]">↳ {inline(ad, 'name', (v) => ({ ad_id: ad.id, name: v }), ad.name, 'text')}</td>
                    <td colSpan={3} className={clsx('py-0.5', MODERATION_COLOR[ad.moderation?.code] || 'text-gray-500')}>
                      <Toggle on={ad.status === 'ACTIVE'} onChange={(on) => setStatus('ad_id', ad, on, 'объявление')} />{' '}
                      {ad.moderation?.label || ad.effective_status}
                      {ad.moderation?.reason && <span className="text-gray-500"> — {ad.moderation.reason}</span>}
                    </td>
                    <td className="text-right"><button className={linkBtn} disabled={busy} onClick={() => duplicate('ad', ad)}>дубль</button></td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </td></tr>
  );
}

const GENDER_RU = { all: 'все', male: 'мужчины', female: 'женщины' };
const tinyInp = 'w-14 bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-200 text-xs px-1.5 py-0.5 rounded';
const EVENT_RESULT = { queued: ['в очереди', 'text-yellow-400'], done: ['готово', 'text-emerald-400'], failed: ['не вышло', 'text-red-400'] };

// Our own campaign history: the push and every edit made here, with its result.
const money = (v) => (v == null ? '—' : Number(v).toFixed(2));
const pctTxt = (v) => (v == null ? '—' : `${Number(v).toFixed(0)}%`);

function useFbSummary(campaignId) {
  return useQuery({ queryKey: ['fb-summary', campaignId], queryFn: () => campaignsApi.fbSummary(campaignId), staleTime: 60000 });
}

function FbSummaryPanel({ campaignId }) {
  const { data: s, isLoading, error } = useFbSummary(campaignId);
  return (
    <tr><td colSpan={20} className="px-10 py-3 bg-[color:var(--c070916)]">
      {isLoading ? <span className="text-xs text-gray-600 animate-pulse">Загрузка сводки...</span>
        : error ? <span className="text-xs text-red-400">{error.error || 'Не удалось загрузить сводку'}</span> : (
        <div className="space-y-3 text-xs">
          {s.attention?.length > 0 && (
            <div className="text-amber-400">⚠ {s.attention.join(' · ')}</div>
          )}
          <table className="w-full max-w-3xl">
            <thead><tr className="text-gray-600">
              <th className="text-left py-1">Период</th><th className="text-right">Расход FB</th><th className="text-right">Клики</th>
              <th className="text-right">LP клики</th><th className="text-right">Продажи</th><th className="text-right">Доход</th>
              <th className="text-right">Профит</th><th className="text-right">ROI</th><th className="text-right">CPC</th>
            </tr></thead>
            <tbody>{s.periods.map(p => (
              <tr key={p.period} className="text-gray-300 border-t border-[color:var(--c1a1d3a)]">
                <td className="py-1">{p.label}</td><td className="text-right">{money(p.spend)}</td><td className="text-right">{p.clicks}</td>
                <td className="text-right">{p.lp_clicks}</td><td className="text-right text-emerald-400">{p.sales}</td><td className="text-right">{money(p.revenue)}</td>
                <td className={clsx('text-right', p.profit > 0 ? 'text-emerald-400' : p.profit < 0 ? 'text-red-400' : '')}>{money(p.profit)}</td>
                <td className="text-right">{pctTxt(p.roi)}</td><td className="text-right">{money(p.cpc)}</td>
              </tr>
            ))}</tbody>
          </table>
          {s.keitaro_error && <div className="text-red-400/80">Keitaro: {s.keitaro_error}</div>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-gray-400 max-w-3xl">
            <div>Кабинет: <span className="text-gray-300">{s.act_name || s.act_id}</span></div>
            <div>Профиль: <span className="text-gray-300">#{s.profile}</span>{s.buyer ? ` · ${s.buyer}` : ''}</div>
            <div>Адсеты: <span className="text-gray-300">{s.composition.adsets_active}/{s.composition.adsets}</span> активны</div>
            <div>Объявления: <span className="text-gray-300">{s.composition.ads_active}/{s.composition.ads}</span> активны</div>
            {s.composition.moderation && <div>Модерация: <span className="text-gray-300">отклонено {s.composition.moderation.rejected || 0}, с проблемой {s.composition.moderation.issues || 0}</span></div>}
            <div>Бюджет: <span className="text-gray-300">{s.daily_budget != null ? `${money(s.daily_budget)} ${s.currency || ''}` : 'на адсетах'}</span></div>
            <div>Лимит трат: <span className="text-gray-300">{s.spend_cap != null ? money(s.spend_cap) : 'нет'}</span></div>
            <div>Создана: <span className="text-gray-300">{s.created_time ? new Date(s.created_time).toLocaleDateString('ru-RU') : '—'}</span></div>
          </div>
          {s.push ? (
            <div className="text-gray-400">
              Залита платформой {new Date(s.push.created_at).toLocaleDateString('ru-RU')}{s.push.author ? ` (${s.push.author})` : ''}:
              {' '}<span className="text-gray-300">{s.push.product_title || 'товар'}</span>
              {s.push.geo && ` · ${s.push.geo}`}{s.push.template && ` · шаблон ${s.push.template}`}
              {s.push.bid != null && ` · ставка ${s.push.bid}`}{s.push.daily_budget != null && ` · бюджет ${s.push.daily_budget}`}
              {s.push.offer_ids?.length > 0 && ` · оффер ${s.push.offer_ids.join(', ')}`}
            </div>
          ) : <div className="text-gray-600">Кампания создана не через платформу — товара и шаблона в базе нет</div>}
          <div className="text-gray-600">FB прочитан {s.synced_at ? new Date(s.synced_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</div>
        </div>
      )}
    </td></tr>
  );
}

function FbLandingPanel({ campaignId }) {
  const { data: s, isLoading } = useFbSummary(campaignId);
  const l = s?.landing;
  return (
    <tr><td colSpan={20} className="px-10 py-3 bg-[color:var(--c070916)]">
      {isLoading ? <span className="text-xs text-gray-600 animate-pulse">Загрузка...</span>
        : !l || !l.totals?.views ? <span className="text-xs text-gray-600">За 7 дней наш счётчик не видел посетителей этой кампании (он стоит только на лендингах, собранных платформой)</span> : (
        <div className="text-xs space-y-2">
          <div className="text-gray-500">{l.period.from} — {l.period.to}</div>
          <div className="flex flex-wrap gap-6 text-gray-300">
            <div>Просмотры <b>{l.totals.views}</b></div>
            <div>Скролл 75% <b>{l.totals.scroll_75}</b></div>
            <div>Выбрали комплект <b>{l.totals.bundle_pick}</b> ({l.totals.pick_rate}%)</div>
            <div>Нажали «купить» <b>{l.totals.buy_click}</b> ({l.totals.buy_rate}%)</div>
            {l.totals.sales != null && <div className="text-emerald-400">Продажи Keitaro <b>{l.totals.sales}</b></div>}
          </div>
          {l.rows.length > 1 && l.rows.map(r => (
            <div key={r.key || 'none'} className="text-gray-500">{r.name}: {r.views} просмотров · {r.buy_rate}% купить</div>
          ))}
        </div>
      )}
    </td></tr>
  );
}

function FbHistoryPanel({ campaignId }) {
  const { data, isLoading } = useQuery({ queryKey: ['fb-history', campaignId], queryFn: () => campaignsApi.fbHistory(campaignId) });
  const events = data?.events || [];
  return (
    <tr><td colSpan={20} className="px-10 py-2 bg-[color:var(--c070916)]">
      {isLoading ? <span className="text-xs text-gray-600 animate-pulse">Загрузка истории...</span>
        : !events.length ? <span className="text-xs text-gray-600">Правок через платформу ещё не было</span> : (
        <div className="space-y-1">
          {events.map((e, i) => (
            <div key={i} className="flex gap-3 text-xs">
              <span className="text-gray-600 font-mono whitespace-nowrap">{new Date(e.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-gray-300 flex-1">{e.text}{e.error && <span className="text-red-400/80"> — {e.error}</span>}</span>
              {e.result && <span className={EVENT_RESULT[e.result]?.[1]}>{EVENT_RESULT[e.result]?.[0]}</span>}
              <span className="text-gray-600 whitespace-nowrap">{e.user_name || ''}</span>
            </div>
          ))}
        </div>
      )}
    </td></tr>
  );
}

function AdsetsPanel({ campaignId }) {
  const [renaming, setRenaming] = useState(null);
  const [budgetEdit, setBudgetEdit] = useState(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['campaign-ads', campaignId],
    queryFn: () => campaignsApi.ads(campaignId),
    retry: 1,
    staleTime: 120000,
  });

  const renameMutation = useMutation({
    mutationFn: ({ adsetId, name }) => campaignsApi.renameAdset(campaignId, { adset_id: adsetId, name }),
    onSuccess: () => {
      setRenaming(null);
      queryClient.invalidateQueries({ queryKey: ['campaign-ads', campaignId] });
    },
  });

  const budgetMutation = useMutation({
    mutationFn: ({ adsetId, budget }) => campaignsApi.setBudget(campaignId, { adset_id: adsetId, budget: Number(budget) }),
    onSuccess: () => {
      setBudgetEdit(null);
      queryClient.invalidateQueries({ queryKey: ['campaign-ads', campaignId] });
    },
  });

  if (isLoading) return (
    <tr><td colSpan={11} className="px-10 py-3 bg-[color:var(--c070916)]">
      <span className="text-xs text-gray-600 animate-pulse">Загрузка адсетов...</span>
    </td></tr>
  );
  if (error || !data) return (
    <tr><td colSpan={11} className="px-10 py-3 bg-[color:var(--c070916)]">
      <span className="text-xs text-gray-600">Данные Facebook недоступны</span>
    </td></tr>
  );

  const adsets = Array.isArray(data) ? data : (data.adsets || data.data || []);
  if (!adsets.length) return (
    <tr><td colSpan={11} className="px-10 py-3 bg-[color:var(--c070916)]">
      <span className="text-xs text-gray-600">Адсетов нет</span>
    </td></tr>
  );

  return adsets.map((as, i) => {
    const ads = Array.isArray(as.ads) ? as.ads : [];
    const spend = Number(as.spend || as.amount_spent || 0);
    const impressions = Number(as.impressions || 0);
    const clicks = Number(as.clicks || 0);
    const leads = Number(as.leads || as.actions?.find?.(a => a.action_type === 'lead')?.value || 0);
    const isRenaming = renaming?.adsetId === as.id;
    const isBudgetEdit = budgetEdit?.adsetId === as.id;
    return (
      <React.Fragment key={as.id || i}>
        <tr className="bg-[color:var(--c070916)] border-b border-[color:var(--c141628)]">
          <td className="px-4 py-2" />
          <td colSpan={2} className="px-2 py-2">
            <div className="flex items-center gap-2 pl-6">
              <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0',
                as.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-yellow-500'
              )} />
              {isRenaming ? (
                <form onSubmit={(e) => { e.preventDefault(); renameMutation.mutate({ adsetId: as.id, name: renaming.name }); }}
                      className="flex gap-1 flex-1">
                  <input autoFocus value={renaming.name}
                    onChange={e => setRenaming(r => ({ ...r, name: e.target.value }))}
                    className="flex-1 min-w-0 bg-[color:var(--c0e1221)] border border-indigo-500/40 rounded px-2 py-0.5 text-xs text-white"
                  />
                  <button type="submit" disabled={renameMutation.isPending}
                    className="text-[10px] px-1.5 py-0.5 bg-indigo-600/40 text-indigo-300 rounded flex-shrink-0">
                    {renameMutation.isPending ? '…' : '✓'}
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className="text-[10px] px-1 text-gray-500 flex-shrink-0">✕</button>
                </form>
              ) : (
                <>
                  <span className="text-xs text-gray-300 font-medium truncate max-w-[180px]">{as.name || `Adset ${as.id}`}</span>
                  {ads.length > 0 && <span className="text-[10px] text-gray-600">{ads.length} объяв.</span>}
                  {as.id && (
                    <button onClick={() => setRenaming({ adsetId: as.id, name: as.name || '' })}
                      className="text-[10px] text-gray-700 hover:text-gray-400 flex-shrink-0 ml-0.5" title="Переименовать">✎</button>
                  )}
                </>
              )}
            </div>
          </td>
          <td className="px-4 py-2 text-right text-xs text-gray-400">{spend > 0 ? `${spend.toFixed(2)}€` : '—'}</td>
          <td className="px-4 py-2 text-right text-xs text-gray-600">{impressions > 0 ? impressions.toLocaleString() : '—'}</td>
          <td className="px-4 py-2 text-right text-xs text-gray-600">{clicks > 0 ? clicks : '—'}</td>
          <td className="px-4 py-2 text-right text-xs text-blue-400">{leads > 0 ? leads : '—'}</td>
          <td colSpan={5} className="px-4 py-2 text-right">
            {isBudgetEdit ? (
              <form onSubmit={(e) => { e.preventDefault(); budgetMutation.mutate({ adsetId: as.id, budget: budgetEdit.budget }); }}
                    className="flex gap-1 justify-end">
                <input autoFocus type="number" min="1" value={budgetEdit.budget}
                  onChange={e => setBudgetEdit(b => ({ ...b, budget: e.target.value }))}
                  className="w-20 bg-[color:var(--c0e1221)] border border-indigo-500/40 rounded px-2 py-0.5 text-xs text-white text-right"
                />
                <button type="submit" disabled={budgetMutation.isPending}
                  className="text-[10px] px-1.5 py-0.5 bg-indigo-600/40 text-indigo-300 rounded">
                  {budgetMutation.isPending ? '…' : '✓'}
                </button>
                <button type="button" onClick={() => setBudgetEdit(null)} className="text-[10px] px-1 text-gray-500">✕</button>
              </form>
            ) : (
              <div className="flex items-center gap-1.5 justify-end">
                {as.id && (
                  <button onClick={() => setBudgetEdit({ adsetId: as.id, budget: as.budget || as.daily_budget || '' })}
                    className="text-[10px] text-gray-700 hover:text-emerald-400 transition-colors" title="Бюджет">💰</button>
                )}
                <span className={clsx('text-[10px] px-1.5 py-0.5 rounded',
                  as.status === 'ACTIVE' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-800 text-gray-500'
                )}>
                  {as.status === 'ACTIVE' ? 'вкл' : (as.status || 'выкл').toLowerCase()}
                </span>
              </div>
            )}
          </td>
        </tr>
        {ads.map((ad, j) => (
          <tr key={ad.id || j} className="bg-[color:var(--c060813)] border-b border-[color:var(--c0f1225)]">
            <td className="px-4 py-1.5" />
            <td colSpan={2} className="px-2 py-1.5">
              <div className="flex items-center gap-2 pl-12">
                <span className={clsx('w-1 h-1 rounded-full flex-shrink-0',
                  ad.status === 'ACTIVE' ? 'bg-emerald-600' : 'bg-gray-700'
                )} />
                <span className="text-[11px] text-gray-500 truncate max-w-[180px]">{ad.name || `Ad ${ad.id}`}</span>
              </div>
            </td>
            <td className="px-4 py-1.5 text-right text-[11px] text-gray-600">{Number(ad.spend || 0) > 0 ? `${Number(ad.spend).toFixed(2)}€` : ''}</td>
            <td colSpan={8} className="px-4 py-1.5 text-right">
              <span className={clsx('text-[10px] px-1 py-0.5 rounded',
                ad.status === 'ACTIVE' ? 'bg-emerald-900/30 text-emerald-500' : 'bg-gray-800/60 text-gray-600'
              )}>
                {ad.status === 'ACTIVE' ? 'вкл' : (ad.status || 'выкл').toLowerCase()}
              </span>
            </td>
          </tr>
        ))}
      </React.Fragment>
    );
  });
}

function StreamRows({ campaignId }) {
  const { data: streams = [], isLoading } = useQuery({
    queryKey: ['keitaro', 'streams', campaignId],
    queryFn: () => keitaroApi.campaignStreams(campaignId),
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={11} className="px-10 py-3 bg-[color:var(--c070916)]">
          <span className="text-xs text-gray-600 animate-pulse">Загрузка стримов...</span>
        </td>
      </tr>
    );
  }

  if (!streams.length) {
    return (
      <tr>
        <td colSpan={11} className="px-10 py-3 bg-[color:var(--c070916)]">
          <span className="text-xs text-gray-600">Нет стримов</span>
        </td>
      </tr>
    );
  }

  return streams.map(s => (
    <tr key={s.id} className="bg-[color:var(--c070916)] border-b border-[color:var(--c141628)]">
      <td className="px-4 py-2" />
      <td className="px-2 py-2">
        <div className="flex items-center gap-2 pl-6">
          <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', STATE_COLOR[s.state] || 'bg-gray-600')} />
          <span className="text-xs text-gray-400 truncate max-w-[220px]">{s.name || `Стрим #${s.id}`}</span>
          {s.type && <span className="text-xs text-gray-600 font-mono">{s.type}</span>}
        </div>
      </td>
      <td className="px-4 py-2 text-xs text-gray-600" />
      <td className="px-4 py-2 text-xs text-gray-600 truncate max-w-xs">
        {s.schema === 'offer_calls' ? (
          <span className="text-indigo-400">Offer calls</span>
        ) : s.offers?.length ? (
          <span className="text-gray-500">{s.offers.length} офер(ов)</span>
        ) : null}
      </td>
      <td className="px-4 py-2 text-right text-xs text-gray-700">{s.weight != null ? `w: ${s.weight}` : '—'}</td>
      <td colSpan={7} className="px-4 py-2 text-right text-xs text-gray-700">
        <span className={clsx('px-1.5 py-0.5 rounded text-xs', s.state === 'active' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-800 text-gray-500')}>
          {s.state === 'active' ? 'вкл' : 'выкл'}
        </span>
      </td>
    </tr>
  ));
}

const GEO_COLORS = ['bg-blue-900/60 text-blue-300','bg-purple-900/60 text-purple-300','bg-green-900/60 text-green-300','bg-orange-900/60 text-orange-300','bg-pink-900/60 text-pink-300','bg-cyan-900/60 text-cyan-300'];
function geoColor(geo) { const i = (geo || '').charCodeAt(0) % GEO_COLORS.length; return GEO_COLORS[i]; }

const BUYER_COLORS = ['bg-indigo-900/60 text-indigo-300','bg-violet-900/60 text-violet-300','bg-teal-900/60 text-teal-300','bg-rose-900/60 text-rose-300','bg-amber-900/60 text-amber-300'];
const buyerColorMap = {};
let buyerColorIdx = 0;
function buyerColor(name) {
  if (!name) return 'bg-gray-800 text-gray-500';
  if (!buyerColorMap[name]) { buyerColorMap[name] = BUYER_COLORS[buyerColorIdx++ % BUYER_COLORS.length]; }
  return buyerColorMap[name];
}

const EMPTY_TEXT = {
  active: 'Рабочих кампаний пока нет',
  attention: 'Кампаний, требующих внимания, нет — нет активных с расходом без дохода или с ROI ниже −30%',
  paused: 'Выключенных кампаний нет',
  archive: 'В архиве пусто',
};

function PushesTable({ pushes, isLoading, search, onNew }) {
  const q = search.trim().toLowerCase();
  const rows = q
    ? pushes.filter(p => [p.product_name, p.status, p.params?.geo, p.id].some(v => String(v || '').toLowerCase().includes(q)))
    : pushes;
  if (isLoading) return <div className="flex items-center justify-center h-48 text-gray-500 text-sm">Загрузка...</div>;
  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-4">
        <p className="text-gray-500 text-sm">Заливов пока нет</p>
        <button onClick={onNew} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">Залить рекламу</button>
      </div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-600 uppercase border-b border-[color:var(--c1e2240)] sticky top-0 bg-[color:var(--c0a0c18)]">
          <th className="text-left px-6 py-3 font-medium">Товар</th>
          <th className="text-left px-4 py-3 font-medium">Гео</th>
          <th className="text-left px-4 py-3 font-medium">Статус</th>
          <th className="text-left px-4 py-3 font-medium">Запуск</th>
          <th className="text-left px-4 py-3 font-medium">Создан</th>
          <th className="text-left px-4 py-3 font-medium">Ошибка</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(p => {
          const params = typeof p.params === 'string' ? (() => { try { return JSON.parse(p.params); } catch { return {}; } })() : (p.params || {});
          const [label, cls] = PUSH_STATUS[p.status] || [p.status || '—', 'text-gray-400'];
          return (
            <tr key={p.id} className="border-b border-[color:var(--c1a1d3a)] hover:bg-[color:var(--c0f1128)]">
              <td className="px-6 py-3 text-gray-200 truncate max-w-[280px]">{p.product_name || p.product_id || '—'}</td>
              <td className="px-4 py-3">
                {params.geo || params.country
                  ? <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold', geoColor(params.geo || params.country))}>{String(params.geo || params.country).toUpperCase()}</span>
                  : <span className="text-gray-600">—</span>}
              </td>
              <td className={clsx('px-4 py-3 text-xs font-medium', cls)}>{label}</td>
              <td className="px-4 py-3 text-xs text-gray-400">{params.run_now ? 'Сразу' : 'На паузе'}</td>
              <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{p.created_at ? new Date(p.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
              <td className="px-4 py-3 text-xs text-red-400 truncate max-w-[260px]" title={p.error || ''}>{p.error || ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const FILTER_CLS = 'bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-400 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500 hover:border-[color:var(--c3d4168)] transition-colors';

// A filter with no values in the data is hidden instead of rendering an empty dropdown.
function FilterSelect({ label, value, onChange, options }) {
  if (!options.length && !value) return null;
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={clsx(FILTER_CLS, value && 'border-indigo-500/60 text-white')}>
      <option value="">{label}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={e => { e.stopPropagation(); onChange(!on); }}
      className={clsx('relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none',
        on ? 'bg-emerald-500' : 'bg-gray-700'
      )}>
      <span className={clsx('pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out',
        on ? 'translate-x-4' : 'translate-x-0'
      )} />
    </button>
  );
}

export default function CampaignsPage() {
  const { role } = useRole();
  const qc = useQueryClient();
  const [tab, setTab] = useState('active');
  const [showWizard, setShowWizard] = useState(false);
  const [wizardPreset, setWizardPreset] = useState(undefined);
  const [selectedGeo, setSelectedGeo] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedCabinet, setSelectedCabinet] = useState('');
  const [period, setPeriod] = useState('today');
  const [groupBy, setGroupBy] = useState('');
  const [visibleCols, setVisibleCols] = useState(loadColumns);
  const [showColumns, setShowColumns] = useState(false);
  const [selectedBuyer, setSelectedBuyer] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [expandTab, setExpandTab] = useState('streams');

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: campaignsApi.list,
  });

  const fbPeriod = ['today', 'yesterday', 'last_7_days'].includes(period) ? period : 'today';
  const { data: fbData } = useQuery({
    queryKey: ['campaigns', 'fb', fbPeriod],
    queryFn: () => campaignsApi.fbList(fbPeriod),
    retry: false,
    placeholderData: (prev) => prev,
  });
  const [fbRefreshing, setFbRefreshing] = useState('');
  const refreshFromFb = async () => {
    if (!window.confirm('Обновить кампании из Facebook? Агент на Mac откроет профили AdsPower с кабинетами.')) return;
    setFbRefreshing('…');
    try {
      const { job_ids } = await campaignsApi.fbRefresh();
      let done = 0;
      await Promise.all(job_ids.map(id => waitAgentJob(id, { timeoutMs: 300000 }).then(() => setFbRefreshing(`${++done}/${job_ids.length}`)).catch(() => {})));
      qc.invalidateQueries({ queryKey: ['campaigns', 'fb'] });
    } finally { setFbRefreshing(''); }
  };

  const { data: ktLive = [] } = useQuery({
    queryKey: ['keitaro', 'campaigns'],
    queryFn: () => keitaroApi.campaigns(),
    retry: false,
  });
  const { data: ktDeleted = [] } = useQuery({
    queryKey: ['keitaro', 'campaigns', 'deleted'],
    queryFn: () => keitaroApi.deletedCampaigns(),
    retry: false,
    staleTime: 300000,
  });
  const ktCampaigns = useMemo(() => {
    const live = Array.isArray(ktLive) ? ktLive : [];
    const seen = new Set(live.map(c => String(c.id)));
    return [...live, ...(Array.isArray(ktDeleted) ? ktDeleted : []).filter(c => !seen.has(String(c.id)))];
  }, [ktLive, ktDeleted]);

  const { data: ktStats, dataUpdatedAt: ktUpdatedAt } = useQuery({
    queryKey: ['keitaro', 'stats', period],
    queryFn: () => keitaroApi.stats(period),
    retry: false,
    placeholderData: (prev) => prev,
  });

  const { data: pushes = [], isLoading: pushesLoading } = useQuery({
    queryKey: ['pushes', 'campaigns-tab'],
    queryFn: () => api.get('/api/push', { params: { limit: 200 } }),
    retry: false,
  });

  function toggleColumn(key) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveColumns(next);
      return next;
    });
  }
  const show = (key) => visibleCols.has(key);

  const statusMutation = useMutation({
    mutationFn: async ({ id, status, source }) => {
      if (source === 'fb') {
        if (status === 'active' && !window.confirm('Включить кампанию в Facebook? Реклама начнёт открутку.')) return;
        const { job_id } = await campaignsApi.fbEdit(id, { status: status === 'active' ? 'ACTIVE' : 'PAUSED', confirm: status === 'active' || undefined });
        await waitAgentJob(job_id);
        qc.invalidateQueries({ queryKey: ['campaigns', 'fb'] });
        return;
      }
      const ktState = status === 'active' ? 'active' : 'disabled';
      if (source === 'keitaro') return keitaroApi.setCampaignState(id, ktState);
      return campaignsApi.update(id, { status });
    },
    onSuccess: () => {
      qc.invalidateQueries(['campaigns']);
      qc.invalidateQueries(['keitaro', 'campaigns']);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, source }) => {
      if (source === 'keitaro') return keitaroApi.setCampaignState(id, 'deleted');
      return campaignsApi.remove(id);
    },
    onSuccess: () => {
      qc.invalidateQueries(['campaigns']);
      qc.invalidateQueries(['keitaro', 'campaigns']);
    },
  });

  const [hints, setHints] = useState({});

  const loadHint = async (campaignId) => {
    if (hints[campaignId] !== undefined) return;
    setHints(h => ({ ...h, [campaignId]: 'loading' }));
    try {
      const data = await campaignsApi.history(campaignId);
      const events = Array.isArray(data) ? data : (data.events || data.history || []);
      const latest = events[0];
      setHints(h => ({ ...h, [campaignId]: latest?.event || latest?.action || latest?.description || 'Нет данных' }));
    } catch {
      setHints(h => ({ ...h, [campaignId]: null }));
    }
  };

  const [editingBudget, setEditingBudget] = useState(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameInput, setRenameInput] = useState('');
  const [targetingId, setTargetingId] = useState(null);
  const [targetingForm, setTargetingForm] = useState({ age_min: 25, age_max: 65, genders: 'all', countries: '' });
  const [applyPresetId, setApplyPresetId] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState('');

  const setBudgetMutation = useMutation({
    mutationFn: ({ id, budget }) => campaignsApi.setBudget(id, budget),
    onSuccess: () => {
      setEditingBudget(null);
      qc.invalidateQueries(['campaigns']);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (id) => campaignsApi.duplicate(id),
    onSuccess: () => qc.invalidateQueries(['campaigns']),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }) => {
      const row = allCampaigns.find(c => c.id === id);
      if (row?.source === 'fb') {
        await waitAgentJob((await campaignsApi.fbEdit(id, { name })).job_id);
        return qc.invalidateQueries({ queryKey: ['campaigns', 'fb'] });
      }
      return campaignsApi.rename(id, name);
    },
    onSuccess: () => {
      setRenamingId(null);
      qc.invalidateQueries(['campaigns']);
    },
  });

  const setTargetingMutation = useMutation({
    mutationFn: ({ id, targeting }) => campaignsApi.setTargeting(id, targeting),
    onSuccess: () => { setTargetingId(null); qc.invalidateQueries(['campaigns']); },
  });

  // Our FB rows go to the profiles through the agent (one job per profile); the rest keeps the old route.
  const bulkEditMutation = useMutation({
    mutationFn: async ({ ids, action, value }) => {
      const byId = new Map(allCampaigns.map(c => [c.id, c]));
      if (ids.every(id => byId.get(id)?.source === 'fb')) {
        if (!window.confirm(`Бюджет адсетов ${value > 0 ? '+' : ''}${value} % у ${ids.length} кампаний?`)) return;
        const { job_ids } = await campaignsApi.fbBulk({ ids, action, value });
        await Promise.all(job_ids.map(id => waitAgentJob(id, { timeoutMs: 600000 })));
        qc.invalidateQueries({ queryKey: ['campaigns', 'fb'] });
        return;
      }
      return campaignsApi.bulkEdit(ids, action, value);
    },
    onSuccess: () => { setSelectedIds(new Set()); qc.invalidateQueries(['campaigns']); },
    onError: (e) => window.alert(e.error || e.message || 'Ошибка'),
  });

  const applyAdSettingsMutation = useMutation({
    mutationFn: ({ id, preset }) => campaignsApi.applyAdSettings(id, preset),
    onSuccess: () => { setApplyPresetId(null); setSelectedPreset(''); },
  });

  const { data: adPresetsList = [] } = useQuery({
    queryKey: ['ad-settings'],
    queryFn: adSettingsApi.list,
    staleTime: 60000,
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }) => {
      const ktState = status === 'active' ? 'active' : 'disabled';
      if (status === 'active' && !window.confirm(`Включить ${ids.length} кампаний? Реклама начнёт открутку.`)) return;
      const byId = new Map(allCampaigns.map(c => [c.id, c]));
      if (ids.every(id => byId.get(id)?.source === 'fb')) {
        const { job_ids } = await campaignsApi.fbBulk({ ids, action: status === 'active' ? 'on' : 'off', confirm: status === 'active' || undefined });
        await Promise.all(job_ids.map(id => waitAgentJob(id, { timeoutMs: 600000 })));
        qc.invalidateQueries({ queryKey: ['campaigns', 'fb'] });
        return;
      }
      await Promise.all(ids.map(async (id) => {
        const source = byId.get(id)?.source;
        if (source === 'fb') {
          const { job_id } = await campaignsApi.fbEdit(id, { status: status === 'active' ? 'ACTIVE' : 'PAUSED', confirm: status === 'active' || undefined });
          return waitAgentJob(job_id);
        }
        return source === 'keitaro' ? keitaroApi.setCampaignState(id, ktState) : campaignsApi.update(id, { status });
      }));
      qc.invalidateQueries({ queryKey: ['campaigns', 'fb'] });
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      qc.invalidateQueries(['campaigns']);
      qc.invalidateQueries(['keitaro', 'campaigns']);
    },
  });

  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['campaigns', 'fb'] });
    qc.invalidateQueries(['campaigns']);
    qc.invalidateQueries(['keitaro', 'campaigns']);
    qc.invalidateQueries(['keitaro', 'stats']);
  }, [qc]);

  const statsById = useMemo(() => {
    const map = new Map();
    for (const r of ktStats?.rows || []) {
      if (r.campaign_id != null) map.set(String(r.campaign_id), r);
    }
    return map;
  }, [ktStats]);

  // Keitaro campaigns (with stats for the chosen period) or, without Keitaro, our local rows.
  const allCampaigns = useMemo(() => {
    const fbRows = fbData?.campaigns || [];
    if (fbRows.length > 0) {
      return fbRows.map(c => {
        const meta = parseCampaignName(c.name || '');
        return {
          ...c,
          display: meta.product || c.name,
          status: c.effective_status === 'ACTIVE' ? 'active' : c.status === 'PAUSED' || c.effective_status === 'WITH_ISSUES' || c.effective_status === 'IN_PROCESS' ? 'paused' : 'archive',
          geo: meta.geo,
          group: c.buyer || meta.buyer,
          product: meta.product,
          template: meta.template,
          cabinet: c.act_name || c.act_id,
          fb_campaign_id: c.id,
          clicks: Number(c.lp_clicks || 0),
          sales: Number(c.leads || 0),
          source: 'fb',
        };
      });
    }
    if (ktCampaigns.length > 0) {
      return ktCampaigns.map(c => {
        const name = c.name || c.alias || `ID ${c.id}`;
        const meta = parseCampaignName(name);
        const st = statsById.get(String(c.id)) || {};
        return {
          id: String(c.id),
          name,
          display: meta.product || name,
          status: c.state === 'active' ? 'active' : c.state === 'disabled' ? 'paused' : 'archive',
          geo: c.country || meta.geo,
          group: meta.buyer,
          product: meta.product,
          template: meta.template,
          cabinet: meta.cabinet,
          fb_campaign_id: c.alias || '',
          clicks: Number(st.clicks || 0),
          lp_clicks: Number(st.lp_clicks || 0),
          sales: Number(st.sales || 0),
          leads: Number(st.leads || 0),
          revenue: Number(st.revenue || 0),
          spend: Number(st.cost || 0),
          spend_source: st.spend_source || 'keitaro',
          fb_synced_at: st.fb_synced_at || null,
          source: 'keitaro',
        };
      });
    }
    return list.map(c => ({
      ...c,
      display: c.name,
      group: c.buyer || c.author_name || '',
      product: c.product_title || '',
      template: c.template || '',
      cabinet: c.cabinet || '',
    }));
  }, [fbData, ktCampaigns, list, statsById]);

  const attentionCampaigns = useMemo(() => {
    return allCampaigns.filter(c => {
      // Our FB list: the server names the reasons (moderation, blocked cabinet, money).
      if (c.source === 'fb') return c.status !== 'archive' && (c.attention || []).length > 0;
      if (c.status !== 'active') return false;
      if (Number(c.spend || 0) > 0 && Number(c.revenue || 0) === 0) return true;
      if (Number(c.spend || 0) > 0) {
        const roi = (Number(c.revenue || 0) - Number(c.spend || 0)) / Number(c.spend);
        if (roi < -0.3) return true;
      }
      return false;
    });
  }, [allCampaigns]);

  const tabCounts = {
    active: allCampaigns.filter(c => c.status === 'active').length,
    attention: attentionCampaigns.length,
    paused: allCampaigns.filter(c => c.status === 'paused').length,
    pushes: pushes.length,
    archive: allCampaigns.filter(c => c.status === 'archive').length,
  };

  const uniq = (key) => [...new Set(allCampaigns.map(c => c[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const buyers = useMemo(() => uniq('group'), [allCampaigns]);
  const geos = useMemo(() => uniq('geo'), [allCampaigns]);
  const productOptions = useMemo(() => uniq('product'), [allCampaigns]);
  const templates = useMemo(() => uniq('template'), [allCampaigns]);
  const cabinets = useMemo(() => uniq('cabinet'), [allCampaigns]);

  const filteredList = useMemo(() => {
    let base = {
      active: allCampaigns.filter(c => c.status === 'active'),
      attention: attentionCampaigns,
      paused: allCampaigns.filter(c => c.status === 'paused'),
      pushes: [],
      archive: allCampaigns.filter(c => c.status === 'archive'),
    }[tab] || [];

    if (selectedBuyer) base = base.filter(c => c.group === selectedBuyer);
    if (selectedGeo) base = base.filter(c => c.geo === selectedGeo);
    if (selectedProduct) base = base.filter(c => c.product === selectedProduct);
    if (selectedTemplate) base = base.filter(c => c.template === selectedTemplate);
    if (selectedCabinet) base = base.filter(c => c.cabinet === selectedCabinet);
    if (selectedStatus) base = base.filter(c => c.status === selectedStatus);
    if (search) {
      const q = search.toLowerCase();
      base = base.filter(c => [c.name, c.id, c.fb_campaign_id, c.cabinet].some(v => String(v || '').toLowerCase().includes(q)));
    }
    return base;
  }, [allCampaigns, tab, selectedBuyer, selectedGeo, selectedProduct, selectedTemplate, selectedCabinet, selectedStatus, search, attentionCampaigns]);

  const groupedList = useMemo(() => {
    if (!groupBy) return null;
    const field = { buyer: 'group', geo: 'geo', product: 'product' }[groupBy];
    const map = new Map();
    for (const c of filteredList) {
      const k = c[field] || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(c);
    }
    return [...map.entries()].sort((a, b) => sumRows(b[1]).revenue - sumRows(a[1]).revenue);
  }, [filteredList, groupBy]);

  const ktTotalClicks = (ktStats?.rows || []).reduce((s, r) => s + Number(r.clicks || 0), 0);
  const ktClicks = ktStats?.rows ? `${ktTotalClicks} кликов` : 'нет данных';
  const ktAge = ktUpdatedAt ? (() => {
    const mins = Math.round((Date.now() - ktUpdatedAt) / 60000);
    return mins < 1 ? 'только что' : mins < 60 ? `${mins}м назад` : `${Math.floor(mins/60)}ч назад`;
  })() : null;

  const allSelected = filteredList.length > 0 && filteredList.every(c => selectedIds.has(c.id));
  const someSelected = selectedIds.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredList.map(c => c.id)));
    }
  }

  function toggleOne(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpand(id) {
    setExpandedId(prev => {
      if (prev === id) return null;
      setExpandTab('streams');
      return id;
    });
  }

  const metricCells = (t, strong) => (
    <>
      {show('budget') && <td />}
      {show('spend') && <td className={clsx('px-4 py-2 text-right text-sm', strong ? 'font-semibold text-white' : 'text-gray-300')}>{t.spend.toFixed(2)}</td>}
      {show('clicks') && <td className="px-4 py-2 text-right text-sm text-gray-400">{t.clicks}</td>}
      {show('offer') && <td className="px-4 py-2 text-right text-sm text-gray-400">{t.lp_clicks}</td>}
      {show('sales') && <td className="px-4 py-2 text-right text-sm text-gray-400">{t.sales}</td>}
      {show('revenue') && <td className="px-4 py-2 text-right text-sm font-semibold text-emerald-400">{t.revenue.toFixed(2)}</td>}
      {show('profit') && <td className="px-4 py-2 text-right text-sm font-semibold"><span className={t.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t.profit.toFixed(2)}</span></td>}
      {show('roi') && <td className="px-4 py-2 text-right text-sm">{t.roi == null ? <span className="text-gray-600">—</span> : <span className={t.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t.roi.toFixed(0)}%</span>}</td>}
    </>
  );

  const renderGroupRow = (g, rows) => (
    <tr key={`group-${g}`} className="bg-[color:var(--c0d0f1e)] border-y border-[color:var(--c2d3148)]">
      <td className="px-4 py-2" />
      <td className="px-2 py-2 text-xs font-semibold text-indigo-300" colSpan={2}>{g} <span className="text-gray-600 font-normal">· {rows.length}</span></td>
      {metricCells(sumRows(rows), false)}
      <td />
    </tr>
  );

  const renderRow = (c) => {
            const roi = c.spend > 0 ? ((c.revenue - c.spend) / c.spend * 100).toFixed(0) : null;
            const offerPct = c.clicks > 0 && c.lp_clicks > 0 ? (c.lp_clicks / c.clicks * 100).toFixed(0) : null;
            const isExpanded = expandedId === c.id;
            const isSelected = selectedIds.has(c.id);
            return (
              <React.Fragment key={c.id}>
                <tr
                  className={clsx(
                    'border-b border-[color:var(--c1a1d3a)] transition-colors',
                    isSelected ? 'bg-indigo-900/10' : 'hover:bg-[color:var(--c0f1128)]',
                    isExpanded && 'bg-[color:var(--c0d0f20)]'
                  )}
                >
                  <td className="px-4 py-3 w-8" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(c.id)}
                      className="rounded border-gray-600 bg-transparent accent-indigo-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-2 py-3 cursor-pointer" onClick={() => renamingId !== c.id && toggleExpand(c.id)}>
                    <div className="flex items-center gap-2.5">
                      {c.status === 'archive' ? <span className="text-[10px] text-gray-600 w-8">архив</span> : (
                        <Toggle
                          on={c.status === 'active'}
                          onChange={(on) => statusMutation.mutate({ id: c.id, status: on ? 'active' : 'paused', source: c.source })}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        {renamingId === c.id ? (
                          <form onSubmit={e => { e.preventDefault(); e.stopPropagation(); renameMutation.mutate({ id: c.id, name: renameInput }); }} onClick={e => e.stopPropagation()} className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={renameInput}
                              onChange={e => setRenameInput(e.target.value)}
                              className="bg-[color:var(--c0d0f1e)] border border-indigo-500 rounded px-2 py-0.5 text-sm text-white focus:outline-none w-56"
                            />
                            <button type="submit" disabled={renameMutation.isPending} className="text-emerald-400 hover:text-emerald-300 text-xs px-1">✓</button>
                            <button type="button" onClick={e => { e.stopPropagation(); setRenamingId(null); }} className="text-gray-600 hover:text-gray-400 text-xs px-1">✕</button>
                          </form>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap group/name">
                            <div className="text-sm text-gray-200 font-medium truncate max-w-[260px]" title={c.name}>{c.display || c.name}</div>
                            {c.geo && <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold', geoColor(c.geo))}>{c.geo.toUpperCase()}</span>}
                            {c.group && <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', buyerColor(c.group))}>{c.group}</span>}
                            <button
                              onClick={e => { e.stopPropagation(); setRenameInput(c.name); setRenamingId(c.id); }}
                              className="opacity-0 group-hover/name:opacity-100 text-gray-600 hover:text-gray-400 text-[10px] transition-opacity"
                              title="Переименовать"
                            >✏</button>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 mt-0.5"
                          onMouseEnter={() => loadHint(c.id)}>
                          <span className="text-xs text-gray-600 truncate max-w-[220px]">{c.fb_campaign_id || '—'}</span>
                          {hints[c.id] && hints[c.id] !== 'loading' && (
                            <div className="relative group/hint inline-flex items-center">
                              <span className="text-xs text-gray-600 truncate max-w-[180px] cursor-default" title={hints[c.id]}>
                                · {hints[c.id]}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={clsx('flex items-center gap-1 text-xs font-medium whitespace-nowrap',
                      c.status === 'active' ? 'text-emerald-400' : c.status === 'paused' ? 'text-gray-500' : 'text-gray-600'
                    )}>
                      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0',
                        c.status === 'active' ? 'bg-emerald-400' : c.status === 'paused' ? 'bg-gray-600' : 'bg-gray-700'
                      )} />
                      {c.status === 'active' ? 'Крутится' : c.status === 'paused' ? 'Выключена' : 'Архив'}
                    </span>
                    {(c.attention || []).length > 0 && (
                      <div className="text-[10px] text-amber-400/80 mt-0.5 max-w-[180px] truncate" title={c.attention.join('\n')}>
                        ⚠ {c.attention.join(' · ')}
                      </div>
                    )}
                  </td>
                  {show('budget') && (
                  <td className="px-4 py-3 text-right group/budget">
                    {/* Budgets live on adsets: edit them in the expanded row («FB Адсеты»). */}
                    <span className="text-sm text-gray-400" title={c.source === 'fb' ? 'Сумма бюджетов адсетов; меняется в раскрытой строке' : undefined}>
                      {(() => {
                        const sum = c.source === 'fb' ? (c.adsets || []).reduce((t, a) => t + (Number(a.daily_budget) || 0), 0) : Number(c.daily_budget) || 0;
                        return sum ? sum.toFixed(0) : '—';
                      })()}
                    </span>
                  </td>
                  )}
                  {show('spend') && <td className="px-4 py-3 text-right text-sm text-gray-300"
                    title={c.spend_source === 'fb' ? 'Расход из кабинета Facebook' : c.source === 'keitaro' ? 'Оценка Keitaro: кампания не связана с FB или период без данных FB' : undefined}>
                    {Number(c.spend || 0) > 0 ? Number(c.spend).toFixed(2) : '—'}
                    {c.source === 'keitaro' && Number(c.spend || 0) > 0 && (
                      <span className={`ml-1 text-[9px] ${c.spend_source === 'fb' ? 'text-blue-400' : 'text-orange-400/70'}`}>{c.spend_source === 'fb' ? 'FB' : 'KT'}</span>
                    )}
                  </td>}
                  {show('clicks') && <td className="px-4 py-3 text-right text-sm text-gray-400">{c.clicks || 0}</td>}
                  {show('offer') && (
                    <td className="px-4 py-3 text-right text-sm text-gray-400">
                      {c.lp_clicks || 0}
                      {offerPct && <span className="text-blue-400 text-xs ml-1">{offerPct}%</span>}
                    </td>
                  )}
                  {show('sales') && <td className="px-4 py-3 text-right text-sm text-gray-400">{c.sales || c.leads || 0}</td>}
                  {show('revenue') && <td className="px-4 py-3 text-right text-sm text-emerald-400">{Number(c.revenue || 0).toFixed(2)}</td>}
                  {show('profit') && (
                    <td className="px-4 py-3 text-right text-sm">
                      {(() => { const profit = Number(c.revenue || 0) - Number(c.spend || 0); return <span className={profit > 0 ? 'text-emerald-400' : profit < 0 ? 'text-red-400' : 'text-gray-600'}>{profit.toFixed(2)}</span>; })()}
                    </td>
                  )}
                  {show('roi') && (
                    <td className="px-4 py-3 text-right">
                      {roi !== null ? (
                        <span className={clsx('text-sm font-medium', Number(roi) > 0 ? 'text-emerald-400' : 'text-red-400')}>{roi}%</span>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {c.status === 'active' && (
                        <button
                          onClick={() => statusMutation.mutate({ id: c.id, status: 'paused', source: c.source })}
                          className="text-xs text-yellow-400 hover:text-yellow-300 px-2 py-1 rounded hover:bg-yellow-400/10 transition-colors"
                          title="Поставить на паузу"
                        >⏸</button>
                      )}
                      {c.status === 'paused' && (
                        <button
                          onClick={() => statusMutation.mutate({ id: c.id, status: 'active', source: c.source })}
                          className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded hover:bg-emerald-400/10 transition-colors"
                          title="Запустить"
                        >▶</button>
                      )}
                      {c.source === 'keitaro' && c.status !== 'archive' && (
                        <button
                          onClick={() => { if (window.confirm(`Удалить кампанию Keitaro «${c.name}»? Трафик по ней перестанет идти.`)) deleteMutation.mutate({ id: c.id, source: c.source }); }}
                          className="text-xs text-gray-600 hover:text-red-400 px-2 py-1 rounded hover:bg-red-400/10 transition-colors"
                          title="Удалить в Keitaro"
                        >✕</button>
                      )}
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <>
                    <tr className="bg-[color:var(--c070916)]">
                      <td colSpan={4 + visibleCols.size} className="px-10 py-1">
                        <div className="flex gap-2 mt-1">
                          {(c.source === 'fb' ? ['summary', 'adsets', 'landing', 'history'] : ['streams', 'adsets', 'history']).map(t => {
                            const fbTab = ['summary', 'adsets', 'landing', 'history'].includes(expandTab) ? expandTab : 'summary';
                            const active = c.source === 'fb' ? fbTab === t : expandTab === t;
                            return (
                              <button key={t} onClick={() => setExpandTab(t)}
                                className={clsx('text-xs px-2.5 py-1 rounded transition-colors',
                                  active ? 'bg-indigo-600/30 text-indigo-300' : 'text-gray-600 hover:text-gray-400'
                                )}>
                                {{ summary: 'Сводка', streams: 'Стримы', adsets: c.source === 'fb' ? 'Состав' : 'FB Адсеты', landing: 'Лендинг', history: 'История' }[t]}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                    {c.source === 'fb' ? (
                      expandTab === 'history' ? <FbHistoryPanel campaignId={c.id} />
                        : expandTab === 'adsets' ? <FbAdsetsPanel campaign={c} />
                        : expandTab === 'landing' ? <FbLandingPanel campaignId={c.id} />
                        : <FbSummaryPanel campaignId={c.id} />)
                      : expandTab === 'streams' ? <StreamRows campaignId={c.id} /> : expandTab === 'adsets' ? <AdsetsPanel campaignId={c.id} /> : <HistoryPanel campaignId={c.id} />}
                  </>
                )}
              </React.Fragment>
            );
  };

  const selectedCampaigns = filteredList.filter(c => selectedIds.has(c.id));
  const bulkSource = selectedCampaigns[0]?.source || 'keitaro';
  const selectedIdsArr = [...selectedIds];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          Кампании
          <span className="text-base">👑</span>
        </h1>
        <div className="flex items-center gap-4">
          <DataBadge
            label={`Facebook${fbData?.campaigns?.[0]?.synced_at ? ` · ${new Date(Math.max(...fbData.campaigns.map(c => +new Date(c.synced_at)))).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
            value={fbData?.campaigns?.length ? `${fbData.campaigns.length} кампаний` : 'нет данных'} color="bg-blue-500" />
          <button
            onClick={refreshFromFb}
            disabled={!!fbRefreshing}
            className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1.5 rounded hover:bg-white/5 transition-colors disabled:opacity-60"
            title="Перечитать кампании из Facebook через профили AdsPower"
          >
            {fbRefreshing ? `FB ${fbRefreshing}` : 'Обновить из FB'}
          </button>
          <DataBadge label={`Keitaro${ktAge ? ` · ${ktAge}` : ''}`} value={ktClicks} color="bg-orange-500" />
          <DataBadge label="Лендинги" value="свой счётчик" color="bg-yellow-500" />
          <button
            onClick={handleRefresh}
            className="text-gray-500 hover:text-gray-300 text-sm px-2 py-1.5 rounded hover:bg-white/5 transition-colors"
            title="Обновить данные"
          >
            ↺
          </button>
          <button onClick={() => setShowWizard(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            + Залить рекламу
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 px-6 border-b border-[color:var(--c1e2240)] flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px',
              tab === t.key
                ? 'border-indigo-500 text-white font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {t.label}
            <span className={clsx(
              'text-xs px-1.5 py-0.5 rounded-full',
              tab === t.key ? 'bg-indigo-600/30 text-indigo-300' : 'bg-[color:var(--c1e2240)] text-gray-600'
            )}>
              {tabCounts[t.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Bulk actions bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-6 py-2 bg-indigo-900/20 border-b border-indigo-800/40 flex-shrink-0">
          <span className="text-xs text-indigo-300 font-medium">
            Выбрано: {selectedIds.size}
          </span>
          <button
            onClick={() => bulkStatusMutation.mutate({ ids: selectedIdsArr, status: 'active', source: bulkSource })}
            disabled={bulkStatusMutation.isPending}
            className="text-xs bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-300 px-3 py-1 rounded transition-colors disabled:opacity-50"
          >
            ▶ Включить
          </button>
          <button
            onClick={() => bulkStatusMutation.mutate({ ids: selectedIdsArr, status: 'paused', source: bulkSource })}
            disabled={bulkStatusMutation.isPending}
            className="text-xs bg-yellow-700/30 hover:bg-yellow-700/50 text-yellow-300 px-3 py-1 rounded transition-colors disabled:opacity-50"
          >
            ⏸ Выключить
          </button>
          <button
            onClick={() => bulkEditMutation.mutate({ ids: selectedIdsArr, action: 'budget_pct', value: 20 })}
            disabled={bulkEditMutation.isPending}
            className="text-xs bg-blue-700/30 hover:bg-blue-700/50 text-blue-300 px-3 py-1 rounded transition-colors disabled:opacity-50"
            title="Увеличить бюджет на 20%"
          >
            📈 +20% бюджет
          </button>
          <button
            onClick={() => bulkEditMutation.mutate({ ids: selectedIdsArr, action: 'budget_pct', value: -20 })}
            disabled={bulkEditMutation.isPending}
            className="text-xs bg-orange-700/30 hover:bg-orange-700/50 text-orange-300 px-3 py-1 rounded transition-colors disabled:opacity-50"
            title="Уменьшить бюджет на 20%"
          >
            📉 -20% бюджет
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Сбросить
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 flex-shrink-0 border-b border-[color:var(--c1e2240)]">
        <div className="relative flex-shrink-0">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 text-xs">🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-300 text-xs pl-7 pr-3 py-1.5 rounded-lg w-56 focus:outline-none focus:border-indigo-500 placeholder-gray-600"
            placeholder="Товар, номер, хеш, кабинет..."
          />
        </div>
        <FilterSelect label="Байер" value={selectedBuyer} onChange={setSelectedBuyer} options={buyers} />
        <FilterSelect label="Гео" value={selectedGeo} onChange={setSelectedGeo} options={geos} />
        <FilterSelect label="Товар" value={selectedProduct} onChange={setSelectedProduct} options={productOptions} />
        <FilterSelect label="Шаблон" value={selectedTemplate} onChange={setSelectedTemplate} options={templates} />
        <FilterSelect label="Кабинет" value={selectedCabinet} onChange={setSelectedCabinet} options={cabinets} />
        <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)} className={FILTER_CLS}>
          <option value="">Статус</option>
          <option value="active">Крутится</option>
          <option value="paused">Выключена</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <select value={period} onChange={e => setPeriod(e.target.value)} className={FILTER_CLS} title="Период статистики Keitaro">
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className={FILTER_CLS} title="Группировать">
            <option value="">Без группировки</option>
            <option value="buyer">По байеру</option>
            <option value="geo">По гео</option>
            <option value="product">По товару</option>
          </select>
          <div className="relative">
            <button onClick={() => setShowColumns(v => !v)} className={clsx(FILTER_CLS, showColumns && 'border-indigo-500 text-white')}>
              Столбцы
            </button>
            {showColumns && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowColumns(false)} />
                <div className="absolute right-0 top-full mt-1 z-30 bg-[color:var(--c0e1221)] border border-[color:var(--c2d3148)] rounded-lg p-2 w-44 shadow-xl">
                  {METRIC_COLUMNS.map(col => (
                    <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-300 rounded hover:bg-white/5 cursor-pointer">
                      <input type="checkbox" checked={show(col.key)} onChange={() => toggleColumn(col.key)} className="accent-indigo-500" />
                      {col.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'pushes' ? (
          <PushesTable pushes={pushes} isLoading={pushesLoading} search={search} onNew={() => setShowWizard(true)} />
        ) : isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-500 text-sm">Загрузка...</div>
        ) : filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-4">
            <p className="text-gray-500 text-sm">{EMPTY_TEXT[tab] || 'Кампаний нет'}</p>
            {role === 'buyer' && (
              <p className="text-gray-600 text-xs max-w-sm text-center">Ты видишь только свои кампании Keitaro — по нику в названии. Если их здесь нет, попроси владельца указать твой ник в разделе «Команда».</p>
            )}
            {tab === 'active' && (
              <button onClick={() => setShowWizard(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
                Залить рекламу
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-600 uppercase border-b border-[color:var(--c1e2240)] sticky top-0 bg-[color:var(--c0a0c18)]">
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-600 bg-transparent accent-indigo-500 cursor-pointer"
                  />
                </th>
                <th className="text-left px-2 py-3 font-medium">Кампания</th>
                <th className="text-left px-3 py-3 font-medium">Статус</th>
                {METRIC_COLUMNS.filter(col => show(col.key)).map(col => (
                  <th key={col.key} className="text-right px-4 py-3 font-medium whitespace-nowrap">{col.label}</th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {groupedList
                ? groupedList.flatMap(([g, rows]) => [renderGroupRow(g, rows), ...rows.map(renderRow)])
                : filteredList.map(renderRow)}
            </tbody>
            {filteredList.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[color:var(--c2d3148)] bg-[color:var(--c0d0f1e)]">
                  <td className="px-4 py-2" />
                  <td className="px-2 py-2 text-xs text-gray-500 font-medium" colSpan={2}>Итого · {filteredList.length} кампаний</td>
                  {metricCells(sumRows(filteredList), true)}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {showWizard && (
        <PushPresetsPanel
          onClose={() => setShowWizard(false)}
          onPick={(preset) => { setShowWizard(false); setWizardPreset(preset); }}
        />
      )}
      {wizardPreset !== undefined && (
        <PushWizard initialPreset={wizardPreset || undefined} onClose={() => setWizardPreset(undefined)} />
      )}

      {applyPresetId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setApplyPresetId(null)}>
          <div className="bg-[color:var(--c0e1221)] border border-[color:var(--c2d3148)] rounded-xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="text-sm font-semibold text-white">Применить пресет</div>
              <button onClick={() => setApplyPresetId(null)} className="text-gray-600 hover:text-white">✕</button>
            </div>
            <div className="flex flex-col gap-4">
              <select
                value={selectedPreset}
                onChange={e => setSelectedPreset(e.target.value)}
                className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Выбери пресет...</option>
                {adPresetsList.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {selectedPreset && adPresetsList.find(p => p.id === selectedPreset) && (() => {
                const p = adPresetsList.find(x => x.id === selectedPreset);
                return (
                  <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg p-3 text-xs text-gray-400 grid grid-cols-2 gap-1">
                    <span>Бюджет: <b className="text-white">{p.budget}€</b></span>
                    <span>Ставка: <b className="text-white">{p.bid_amount}€</b></span>
                    <span>Возраст: <b className="text-white">{p.age_min}–{p.age_max}</b></span>
                    <span>Адсеты: <b className="text-white">×{p.adsets_count}</b></span>
                  </div>
                );
              })()}
              <button
                onClick={() => applyAdSettingsMutation.mutate({ id: applyPresetId, preset: selectedPreset })}
                disabled={!selectedPreset || applyAdSettingsMutation.isPending}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {applyAdSettingsMutation.isPending ? 'Применяю...' : 'Применить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {targetingId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setTargetingId(null)}>
          <div className="bg-[color:var(--c0e1221)] border border-[color:var(--c2d3148)] rounded-xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="text-sm font-semibold text-white">Таргетинг кампании</div>
              <button onClick={() => setTargetingId(null)} className="text-gray-600 hover:text-white">✕</button>
            </div>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-500 uppercase tracking-wide">Возраст от</label>
                  <input type="number" value={targetingForm.age_min} onChange={e => setTargetingForm(f => ({ ...f, age_min: Number(e.target.value) }))}
                    className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" min={18} max={65} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-500 uppercase tracking-wide">Возраст до</label>
                  <input type="number" value={targetingForm.age_max} onChange={e => setTargetingForm(f => ({ ...f, age_max: Number(e.target.value) }))}
                    className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" min={18} max={65} />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500 uppercase tracking-wide">Пол</label>
                <select value={targetingForm.genders} onChange={e => setTargetingForm(f => ({ ...f, genders: e.target.value }))}
                  className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                  <option value="all">Все</option>
                  <option value="male">Мужчины</option>
                  <option value="female">Женщины</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500 uppercase tracking-wide">Страны (через запятую)</label>
                <input type="text" value={targetingForm.countries} onChange={e => setTargetingForm(f => ({ ...f, countries: e.target.value }))}
                  placeholder="FR, BE, CH"
                  className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 placeholder-gray-600" />
              </div>
              <button
                onClick={() => setTargetingMutation.mutate({ id: targetingId, targeting: { ...targetingForm, countries: targetingForm.countries.split(',').map(s => s.trim()).filter(Boolean) } })}
                disabled={setTargetingMutation.isPending}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {setTargetingMutation.isPending ? 'Применяю...' : 'Применить таргетинг'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
