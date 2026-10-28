import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analytics, keitaro as keitaroApi } from '../api/client.js';

const RANGES = [
  { label: 'Сегодня', value: 'today' },
  { label: 'Вчера', value: 'yesterday' },
  { label: '7 дней', value: 'last_7_days' },
  { label: '30 дней', value: 'last_30_days' },
];

function toIso(d) { return d.toISOString().slice(0, 10); }

function DateRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value?.from || toIso(new Date()));
  const [to, setTo] = useState(value?.to || toIso(new Date()));
  const ref = useRef(null);

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function apply() {
    if (from && to) { onChange({ from, to }); setOpen(false); }
  }

  const label = value?.from
    ? `${value.from} — ${value.to}`
    : 'Выбрать даты';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
          value?.from ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-[color:var(--c1e2240)]'
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {label}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-50 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl shadow-xl p-4 flex flex-col gap-3 min-w-[240px]">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-500">От</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={e => setFrom(e.target.value)}
              className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/60 [color-scheme:dark]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-500">До</label>
            <input
              type="date"
              value={to}
              min={from}
              max={toIso(new Date())}
              onChange={e => setTo(e.target.value)}
              className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/60 [color-scheme:dark]"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={apply}
              disabled={!from || !to}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs py-1.5 rounded-lg transition-colors"
            >
              Применить
            </button>
            <button
              onClick={() => setOpen(false)}
              className="px-3 text-gray-500 hover:text-white text-xs transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-5">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function FunnelBar({ value, max, color }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-[color:var(--c0f1117)] rounded h-1.5 overflow-hidden">
        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

function LandingFunnelSection({ from, to }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['landing-funnel', from, to],
    queryFn: () => analytics.landingFunnel(from, to),
    enabled: !!(from && to),
    retry: 1,
  });

  if (!from || !to) return null;
  if (isLoading) return <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-5 text-sm text-gray-500 animate-pulse">Загрузка воронки лендинга...</div>;
  if (error) return null;

  const rows = data?.rows || [];
  if (!rows.length) return null;
  const maxViews = Math.max(...rows.map(r => r.views || 0), 1);

  return (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[color:var(--c2d3148)] flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-white">Воронка лендингов (наш счётчик)</div>
          <div className="text-xs text-gray-500 mt-0.5">{from} — {to}</div>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>Просмотры → Выбор → Клик Купить → Продажа</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-[color:var(--c2d3148)]">
              <th className="text-left px-5 py-2.5">Шаблон</th>
              <th className="text-right px-3 py-2.5">Просм.</th>
              <th className="text-right px-3 py-2.5">Выбор бандла</th>
              <th className="text-right px-3 py-2.5">Клик купить</th>
              <th className="text-right px-3 py-2.5">Скролл 75%</th>
              <th className="text-right px-3 py-2.5">Продажи</th>
              <th className="text-right px-3 py-2.5">Buy rate</th>
              <th className="px-5 py-2.5 min-w-[120px]">Воронка</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[color:var(--c1a1d3a)] hover:bg-[color:var(--c1a1d3a)] transition-colors">
                <td className="px-5 py-2.5 text-gray-300 font-medium">{r.name}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{(r.views || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-blue-400">{(r.bundle_pick || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-indigo-400">{(r.buy_click || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{(r.scroll_75 || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-emerald-400">{(r.sales || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-yellow-400">{r.buy_rate != null ? `${r.buy_rate}%` : '—'}</td>
                <td className="px-5 py-2.5">
                  <FunnelBar value={r.views || 0} max={maxViews} color="#6366f1" />
                </td>
              </tr>
            ))}
          </tbody>
          {data?.totals && (
            <tfoot>
              <tr className="border-t border-[color:var(--c2d3148)] bg-[color:var(--c0f1117)]">
                <td className="px-5 py-2.5 text-gray-500 font-medium">Итого</td>
                <td className="px-3 py-2.5 text-right text-white">{(data.totals.views || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-blue-400">{(data.totals.bundle_pick || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-indigo-400">{(data.totals.buy_click || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{(data.totals.scroll_75 || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-emerald-400">{(data.totals.sales || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-yellow-400">{data.totals.buy_rate != null ? `${data.totals.buy_rate}%` : '—'}</td>
                <td className="px-5 py-2.5" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function LandingBehaviorSection({ from, to }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['landing-behavior', from, to],
    queryFn: () => analytics.landingBehavior(from, to),
    enabled: !!(from && to),
    retry: 1,
  });

  if (!from || !to || isLoading || error || !data) return null;

  const base = data.base || {};
  const quiz = data.quiz || {};
  const byTime = data.by?.time || [];
  const byDevice = data.by?.device || [];
  const byPlacement = data.by?.placement || [];
  const byExit = data.by?.exit || [];
  const depth = data.by?.depth || [];

  return (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[color:var(--c2d3148)]">
        <div className="text-sm font-medium text-white">Поведение на лендинге</div>
        <div className="text-xs text-gray-500 mt-0.5">{(base.visitors || 0).toLocaleString()} посетителей · {from} — {to}</div>
      </div>
      <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-2">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Конверсия</div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Выбрали бандл</span><span className="text-blue-400">{base.pick_rate}%</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Кликнули купить</span><span className="text-indigo-400">{base.buy_rate}%</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Конверсия</span><span className="text-gray-300">{base.conv_rate != null ? `${base.conv_rate}%` : '—'}</span></div>
        </div>
        {quiz.started > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Квиз</div>
            <div className="flex justify-between text-xs"><span className="text-gray-400">Начали</span><span className="text-white">{quiz.started_pct}%</span></div>
            <div className="flex justify-between text-xs"><span className="text-gray-400">Завершили</span><span className="text-emerald-400">{quiz.completed_pct}%</span></div>
            <div className="flex justify-between text-xs"><span className="text-gray-400">Шагов</span><span className="text-gray-300">{quiz.last_step}</span></div>
          </div>
        )}
        {depth.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Скролл</div>
            {depth.map(d => (
              <div key={d.mark} className="space-y-0.5">
                <div className="flex justify-between text-xs"><span className="text-gray-400">{d.mark}%</span><span className="text-gray-300">{d.pct}%</span></div>
                <div className="bg-[color:var(--c0f1117)] rounded h-1 overflow-hidden">
                  <div className="h-full bg-indigo-500/60 rounded" style={{ width: `${d.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {byTime.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Время на странице</div>
            {byTime.map(t => (
              <div key={t.value} className="space-y-0.5">
                <div className="flex justify-between text-xs"><span className="text-gray-400">{t.value}</span><span className="text-gray-300">{t.share}%</span></div>
                <div className="bg-[color:var(--c0f1117)] rounded h-1 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${t.share}%`, background: t.buy_rate > 30 ? '#10b981' : t.buy_rate > 15 ? '#f59e0b' : '#6366f1' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {(byDevice.length > 0 || byExit.length > 0) && (
        <div className="border-t border-[color:var(--c2d3148)] p-5 grid grid-cols-2 gap-6">
          {byDevice.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">По устройствам</div>
              <div className="space-y-2">
                {byDevice.slice(0, 5).map(d => (
                  <div key={d.value} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-16">{d.value}</span>
                    <div className="flex-1 bg-[color:var(--c0f1117)] rounded h-1.5 overflow-hidden">
                      <div className="h-full bg-blue-500/70 rounded" style={{ width: `${d.share}%` }} />
                    </div>
                    <span className="text-gray-500 w-8 text-right">{d.share}%</span>
                    <span className="text-indigo-400 w-12 text-right">{d.buy_rate}% buy</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {byExit.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Выходы по блокам</div>
              <div className="space-y-2">
                {byExit.slice(0, 5).map(e => (
                  <div key={e.value} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 flex-1 truncate">{e.value}</span>
                    <div className="w-20 bg-[color:var(--c0f1117)] rounded h-1.5 overflow-hidden">
                      <div className="h-full bg-red-500/50 rounded" style={{ width: `${e.share}%` }} />
                    </div>
                    <span className="text-red-400 w-8 text-right">{e.share}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {byPlacement.length > 0 && (
        <div className="border-t border-[color:var(--c2d3148)] px-5 py-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">По площадкам FB</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {byPlacement.slice(0, 8).map(p => (
              <div key={p.value} className="flex items-center gap-2 text-xs">
                <span className="text-gray-400 flex-1 truncate">{p.value.replace('Facebook_', 'FB ').replace('Instagram_', 'IG ')}</span>
                <span className="text-gray-500">{p.share}%</span>
                <span className="text-indigo-400">{p.buy_rate}% buy</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BuyerStatsSection({ from, to }) {
  const [compare, setCompare] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['buyers', from, to, compare],
    queryFn: () => analytics.buyers(from, to, compare),
    enabled: !!(from && to),
    retry: 1,
    staleTime: 300000,
  });

  if (!from || !to || isLoading) return isLoading ? (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-5 text-sm text-gray-500 animate-pulse">Загрузка статистики байеров...</div>
  ) : null;
  if (error || !data?.rows?.length) return null;

  const fmt2 = n => (typeof n === 'number' ? n.toFixed(2) : '—');
  const fmtPct = n => (typeof n === 'number' ? `${n.toFixed(1)}%` : '—');

  return (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[color:var(--c2d3148)] flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-white">Статистика по байерам</div>
          <div className="text-xs text-gray-500 mt-0.5">{from} — {to}</div>
        </div>
        <button
          onClick={() => setCompare(c => !c)}
          className={`text-xs px-2 py-1 rounded transition-colors ${compare ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/30' : 'text-gray-600 hover:text-gray-400'}`}
        >
          {compare ? '↕ Сравнение вкл' : '↕ Сравнить'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-[color:var(--c2d3148)]">
              <th className="text-left px-5 py-2.5">Байер</th>
              <th className="text-right px-3 py-2.5">Клики</th>
              <th className="text-right px-3 py-2.5">Продажи</th>
              <th className="text-right px-3 py-2.5">Спенд</th>
              <th className="text-right px-3 py-2.5">Профит</th>
              <th className="text-right px-3 py-2.5">ROI</th>
              <th className="text-right px-5 py-2.5">CR</th>
              {data.rows.some(r => r.compare) && (
                <th className="text-right px-3 py-2.5">Δ Профит</th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="border-b border-[color:var(--c1a1d3a)] hover:bg-[color:var(--c1a1d3a)] transition-colors">
                <td className="px-5 py-2.5 text-white font-medium">{r.buyer || '—'}</td>
                <td className="px-3 py-2.5 text-right text-gray-400">{(r.clicks || 0).toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right text-emerald-400">{r.sales || 0}</td>
                <td className="px-3 py-2.5 text-right text-indigo-400">${fmt2(r.cost)}</td>
                <td className={`px-3 py-2.5 text-right ${r.profit > 0 ? 'text-emerald-400' : 'text-red-400'}`}>${fmt2(r.profit)}</td>
                <td className="px-3 py-2.5 text-right text-yellow-400">{fmtPct(r.roi)}</td>
                <td className="px-5 py-2.5 text-right text-gray-400">{fmtPct(r.cr)}</td>
                {data.rows.some(r2 => r2.compare) && (
                  <td className={`px-3 py-2.5 text-right text-xs ${r.compare?.profit_diff > 0 ? 'text-emerald-400' : r.compare?.profit_diff < 0 ? 'text-red-400' : 'text-gray-600'}`}>
                    {r.compare?.profit_diff != null
                      ? `${r.compare.profit_diff > 0 ? '+' : ''}${r.compare.profit_diff.toFixed(2)}`
                      : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BarChart({ data }) {
  if (!data?.length) return <div className="text-center text-gray-600 py-10 text-sm">Нет данных</div>;
  const maxRev = Math.max(...data.map(d => d.revenue || 0), 1);
  return (
    <svg viewBox={`0 0 ${data.length * 20} 80`} className="w-full h-48" preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = ((d.revenue || 0) / maxRev) * 70;
        const sh = ((d.cost || 0) / maxRev) * 70;
        return (
          <g key={d.date || i}>
            <rect x={i * 20 + 1} y={80 - sh} width={8} height={sh} fill="#4f46e5" opacity="0.6" rx="1" />
            <rect x={i * 20 + 10} y={80 - h} width={8} height={h} fill="#10b981" opacity="0.8" rx="1" />
          </g>
        );
      })}
    </svg>
  );
}

// Keitaro returns 'day' column name for date grouping
function rowDate(r) { return r.day || r.date || ''; }

const fmt = (n) => typeof n === 'number' ? n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
const fmtInt = (n) => typeof n === 'number' ? n.toLocaleString('fr-FR') : '0';

const DEFAULT_ROWS = 10;

export default function AnalyticsPage() {
  const [range, setRange] = useState('today');
  const [customRange, setCustomRange] = useState(null); // { from, to } or null
  const [search, setSearch] = useState('');
  const [buyerFilter, setBuyerFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy] = useState('revenue');
  const [sortDir, setSortDir] = useState('desc');
  const [landingFrom, setLandingFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return toIso(d);
  });
  const [landingTo, setLandingTo] = useState(() => toIso(new Date()));

  const activeRange = customRange || range;

  const { data: kStats, isLoading: kLoading } = useQuery({
    queryKey: ['keitaro-stats', activeRange],
    queryFn: () => keitaroApi.stats(activeRange),
    retry: 1,
  });

  const { data: kDaily } = useQuery({
    queryKey: ['keitaro-daily'],
    queryFn: () => keitaroApi.statsDaily(30),
    retry: 1,
  });

  const { data: overview } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: analytics.overview,
  });

  const allRows = kStats?.rows || [];

  // Extract buyer tags like [Angry], [Yan4ik], [Dima] from campaign names
  const buyers = ['all', ...Array.from(new Set(
    allRows
      .map(r => { const m = (r.campaign || '').match(/^\[([^\]]+)\]/); return m ? m[1] : null; })
      .filter(Boolean)
  )).sort()];

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  }

  const filtered = allRows
    .filter(r => {
      if (buyerFilter !== 'all') {
        const m = (r.campaign || '').match(/^\[([^\]]+)\]/);
        if (!m || m[1] !== buyerFilter) return false;
      }
      return !search || (r.campaign || '').toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const av = a[sortBy] ?? 0, bv = b[sortBy] ?? 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });

  const rows = showAll ? filtered : filtered.slice(0, DEFAULT_ROWS);

  // Aggregate totals from ALL filtered rows (not just visible page)
  const totals = filtered.reduce((acc, r) => ({
    clicks: acc.clicks + (r.clicks || 0),
    conversions: acc.conversions + (r.conversions || 0),
    revenue: acc.revenue + (r.revenue || 0),
    cost: acc.cost + (r.cost || 0),
    profit: acc.profit + (r.profit || 0),
  }), { clicks: 0, conversions: 0, revenue: 0, cost: 0, profit: 0 });

  const roi = totals.cost > 0 ? (totals.revenue / totals.cost).toFixed(2) : '—';

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[color:var(--c1e2240)] flex-shrink-0 flex-wrap">
        <div className="flex-shrink-0 mr-2">
          <h1 className="text-base font-semibold text-white">Аналитика</h1>
          <p className="text-xs text-gray-500 mt-0.5">Данные из Keitaro</p>
        </div>
        {/* Global search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setShowAll(true); }}
            placeholder="Поиск по кампаниям..."
            className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/60"
          />
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white text-xs">✕</button>
          )}
        </div>
        <div className="flex gap-1 items-center flex-wrap ml-auto">
          {RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => { setRange(r.value); setCustomRange(null); }}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                !customRange && range === r.value
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-[color:var(--c1e2240)]'
              }`}
            >
              {r.label}
            </button>
          ))}
          <DateRangePicker
            value={customRange}
            onChange={v => { setCustomRange(v); }}
          />
        </div>
      </div>

      <div className="flex-1 p-5 space-y-5">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Клики" value={fmtInt(totals.clicks)} color="text-white" />
          <StatCard label="Конверсии" value={fmtInt(totals.conversions)} color="text-emerald-400" />
          <StatCard label="Спенд" value={`${fmt(totals.cost)}€`} color="text-indigo-400" />
          <StatCard label="Доход" value={`${fmt(totals.revenue)}€`} color="text-emerald-400" />
          <StatCard label="ROI" value={`×${roi}`} color="text-yellow-400" sub={`Профит: ${fmt(totals.profit)}€`} />
        </div>

        {/* Chart */}
        <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-medium text-white">Доход и Спенд (30 дней)</div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded bg-indigo-500 inline-block opacity-60" /> Спенд</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded bg-emerald-500 inline-block opacity-80" /> Доход</span>
            </div>
          </div>
          <BarChart data={kDaily?.rows || []} />
        </div>

        {/* Campaigns table */}
        <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[color:var(--c2d3148)] flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-white flex-shrink-0">
                Кампании Keitaro
                {search && <span className="ml-2 text-xs text-indigo-400">«{search}»</span>}
              </span>
              {kLoading && <span className="text-xs text-gray-500 animate-pulse ml-auto">Загрузка...</span>}
            </div>
            {buyers.length > 1 && (
              <div className="flex gap-1 flex-wrap items-center">
                <span className="text-xs text-gray-600 mr-1">Группа:</span>
                {buyers.map(b => (
                  <button
                    key={b}
                    onClick={() => { setBuyerFilter(b); setShowAll(false); }}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                      buyerFilter === b
                        ? 'bg-indigo-600 text-white'
                        : 'bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] text-gray-400 hover:text-white hover:border-indigo-500/50'
                    }`}
                  >
                    {b === 'all' ? 'Все' : b}
                  </button>
                ))}
              </div>
            )}
          </div>
          {filtered.length === 0 && !kLoading ? (
            <div className="text-center text-gray-500 py-10 text-sm">
              {search ? `Нет кампаний по запросу «${search}»` : 'Нет данных за период'}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-[color:var(--c2d3148)]">
                      <th className="text-left px-5 py-3">Кампания</th>
                      {[
                        { key: 'clicks', label: 'Клики' },
                        { key: 'conversions', label: 'Конв.' },
                        { key: 'cost', label: 'Спенд' },
                        { key: 'revenue', label: 'Доход' },
                        { key: 'profit', label: 'Профит' },
                        { key: 'roi', label: 'ROI' },
                      ].map(col => (
                        <th
                          key={col.key}
                          className="text-right px-4 py-3 cursor-pointer hover:text-white transition-colors select-none"
                          onClick={() => toggleSort(col.key)}
                        >
                          {col.label}
                          {sortBy === col.key && <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const rowRoi = r.cost > 0 ? (r.revenue / r.cost).toFixed(2) : '—';
                      const profitColor = r.profit > 0 ? 'text-emerald-400' : r.profit < 0 ? 'text-red-400' : 'text-gray-400';
                      return (
                        <tr key={i} className="border-b border-[color:var(--c1a1d3a)] hover:bg-[color:var(--c1a1d3a)] transition-colors">
                          <td className="px-5 py-2.5 text-gray-300 max-w-xs truncate text-xs">{r.campaign}</td>
                          <td className="px-4 py-2.5 text-right text-gray-400">{fmtInt(r.clicks)}</td>
                          <td className="px-4 py-2.5 text-right text-emerald-400">{fmtInt(r.conversions)}</td>
                          <td className="px-4 py-2.5 text-right text-indigo-400">{fmt(r.cost)}€</td>
                          <td className="px-4 py-2.5 text-right text-emerald-400">{fmt(r.revenue)}€</td>
                          <td className={`px-4 py-2.5 text-right ${profitColor}`}>{fmt(r.profit)}€</td>
                          <td className="px-5 py-2.5 text-right text-yellow-400">×{rowRoi}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filtered.length > DEFAULT_ROWS && (
                <div className="px-5 py-3 border-t border-[color:var(--c2d3148)] flex items-center justify-between">
                  <span className="text-xs text-gray-600">
                    Показано {rows.length} из {filtered.length}
                  </span>
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    {showAll ? `Скрыть (показать ${DEFAULT_ROWS})` : `Показать все ${filtered.length}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Landing analytics */}
        <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl px-5 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-white">Лендинг аналитика</span>
          <span className="text-xs text-gray-500">Период:</span>
          <input type="date" value={landingFrom} max={landingTo} onChange={e => setLandingFrom(e.target.value)}
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded px-2 py-1 text-xs text-white focus:outline-none [color-scheme:dark]" />
          <span className="text-gray-600">—</span>
          <input type="date" value={landingTo} min={landingFrom} max={toIso(new Date())} onChange={e => setLandingTo(e.target.value)}
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded px-2 py-1 text-xs text-white focus:outline-none [color-scheme:dark]" />
        </div>
        <LandingFunnelSection from={landingFrom} to={landingTo} />
        <LandingBehaviorSection from={landingFrom} to={landingTo} />
        <ClickHeatmapSection from={landingFrom} to={landingTo} />
        <BuyerStatsSection from={landingFrom} to={landingTo} />
        <QueryBuilderSection />

        {/* Internal stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Товаров" value={overview?.products_count ?? '—'} sub={`${overview?.creatives_count ?? 0} креативов`} />
          <StatCard label="Кампаний (внутр.)" value={overview?.campaigns_count ?? '—'} />
        </div>
      </div>
    </div>
  );
}

function ClickHeatmapSection({ from, to }) {
  const { data, isLoading } = useQuery({
    queryKey: ['landing-behavior', from, to],
    queryFn: () => analytics.landingBehavior(from, to),
    staleTime: 300000,
    enabled: !!(from && to),
    retry: 1,
  });

  const raw = data?.blocks || data?.by_section || data?.by_block || data?.click_map || data?.sections || [];
  const blockArr = Array.isArray(raw) ? raw
    : Object.entries(raw).map(([id, val]) => ({
        id, name: id,
        clicks: typeof val === 'number' ? val : (val.clicks || 0),
        rage_clicks: typeof val === 'object' ? (val.rage_clicks || 0) : 0,
        dead_clicks: typeof val === 'object' ? (val.dead_clicks || 0) : 0,
      }));

  if (isLoading || !blockArr.length) return null;

  const maxClicks = Math.max(...blockArr.map(b => b.clicks || 0), 1);

  return (
    <div className="mt-6 bg-[color:var(--c0e1221)] border border-[color:var(--c1e2540)] rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-4">Клики по блокам лендинга</h3>
      <div className="space-y-2">
        {[...blockArr].sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).map((block, i) => {
          const pct = Math.round(((block.clicks || 0) / maxClicks) * 100);
          const heat = pct >= 75 ? 'bg-red-500' : pct >= 50 ? 'bg-orange-500' : pct >= 25 ? 'bg-yellow-500' : 'bg-blue-500';
          return (
            <div key={block.id || i} className="flex items-center gap-3">
              <div className="w-32 text-xs text-gray-400 truncate flex-shrink-0">{block.name || block.id || `Block ${i+1}`}</div>
              <div className="flex-1 bg-[color:var(--c141829)] rounded-full h-5 overflow-hidden relative">
                <div className={`h-full rounded-full transition-all ${heat} opacity-70`} style={{ width: `${pct}%` }} />
                <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] text-white font-mono">
                  {(block.clicks || 0).toLocaleString()}
                </span>
              </div>
              {(block.rage_clicks > 0 || block.dead_clicks > 0) && (
                <div className="flex gap-2 flex-shrink-0 text-[10px]">
                  {block.rage_clicks > 0 && <span className="text-red-400" title="Rage clicks">🤬 {block.rage_clicks}</span>}
                  {block.dead_clicks > 0 && <span className="text-gray-500" title="Dead clicks">💀 {block.dead_clicks}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QueryBuilderSection() {
  const METRICS = ['clicks','impressions','spend','revenue','leads','sales','cpc','cpm','ctr','cr','cpa','roas','roi','profit','lp_views','lp_ctr','epc'];
  const DIMS = ['date','campaign','buyer','geo','os','device','browser','language','offer','landing','adset','ad','week','month'];

  const [metrics, setMetrics] = useState(['clicks','spend','revenue','profit','roi']);
  const [dimensions, setDimensions] = useState(['date']);
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0,10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0,10));
  const [limit, setLimit] = useState(50);
  const [sortField, setSortField] = useState('spend');
  const [sortDir, setSortDir] = useState('desc');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggleMetric = (m) => setMetrics(prev =>
    prev.includes(m) ? prev.filter(x => x !== m) : prev.length < 6 ? [...prev, m] : prev
  );
  const toggleDim = (d) => setDimensions(prev =>
    prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
  );

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await analytics.query({
        from,
        to,
        metrics: metrics.slice(0, 6),
        dimensions,
        sort: { field: sortField, direction: sortDir },
        limit,
      });
      setResult(res);
    } catch (e) {
      setError(e?.error || e?.message || 'Ошибка запроса');
    } finally {
      setLoading(false);
    }
  };

  const allCols = [...dimensions, ...metrics];

  const fmtCell = (v) => {
    if (v == null) return '—';
    if (typeof v === 'number') {
      if (v > 1000000) return (v/1000000).toFixed(1) + 'M';
      if (v > 1000) return (v/1000).toFixed(1) + 'k';
      if (v < 10) return v.toFixed(2);
      return v.toFixed(0);
    }
    return String(v);
  };

  const rows = result ? (Array.isArray(result) ? result : (result.rows || result.data || result.items || [])) : [];

  return (
    <div className="mt-8 bg-[color:var(--c0e1221)] border border-[color:var(--c1e2540)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-white">Конструктор запросов</h3>
        <span className="text-[10px] text-indigo-400/60">Готов делать бабки?</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <div>
          <div className="text-xs text-gray-500 mb-2">Метрики <span className="text-gray-600">(макс 6)</span></div>
          <div className="flex flex-wrap gap-1.5">
            {METRICS.map(m => (
              <button key={m} onClick={() => toggleMetric(m)}
                className={`text-[11px] px-2 py-0.5 rounded transition-colors border ${
                  metrics.includes(m)
                    ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300'
                    : 'bg-transparent border-[color:var(--c1e2540)] text-gray-500 hover:text-gray-300'
                }`}>{m}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-2">Срезы</div>
          <div className="flex flex-wrap gap-1.5">
            {DIMS.map(d => (
              <button key={d} onClick={() => toggleDim(d)}
                className={`text-[11px] px-2 py-0.5 rounded transition-colors border ${
                  dimensions.includes(d)
                    ? 'bg-purple-600/30 border-purple-500/50 text-purple-300'
                    : 'bg-transparent border-[color:var(--c1e2540)] text-gray-500 hover:text-gray-300'
                }`}>{d}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">От</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="bg-[color:var(--c141829)] border border-[color:var(--c1e2540)] text-white text-xs px-2 py-1 rounded [color-scheme:dark]" />
          <span className="text-[11px] text-gray-500">До</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="bg-[color:var(--c141829)] border border-[color:var(--c1e2540)] text-white text-xs px-2 py-1 rounded [color-scheme:dark]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">Сорт</span>
          <select value={sortField} onChange={e => setSortField(e.target.value)}
            className="bg-[color:var(--c141829)] border border-[color:var(--c1e2540)] text-white text-xs px-2 py-1 rounded">
            {[...metrics, ...dimensions].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="text-xs px-2 py-1 bg-[color:var(--c141829)] border border-[color:var(--c1e2540)] text-gray-400 rounded hover:text-white">
            {sortDir === 'desc' ? '↓' : '↑'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500">Строк</span>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            className="bg-[color:var(--c141829)] border border-[color:var(--c1e2540)] text-white text-xs px-2 py-1 rounded">
            {[20,50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button onClick={run} disabled={loading || !metrics.length}
          className="ml-auto px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs rounded transition-colors font-medium">
          {loading ? 'Загрузка...' : '▶ Запустить'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3 mb-4">{error}</div>
      )}

      {result && rows.length === 0 && (
        <div className="text-xs text-gray-600 text-center py-6">Нет данных за период</div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[color:var(--c1e2540)]">
                {allCols.map(col => (
                  <th key={col} className="text-left py-2 px-3 text-gray-500 font-medium">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-[color:var(--c1e2540)] hover:bg-[color:var(--c141829)]">
                  {allCols.map(col => (
                    <td key={col} className={`py-2 px-3 ${
                      metrics.includes(col) ? 'text-white font-mono' : 'text-gray-400'
                    }`}>{fmtCell(row[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-gray-600 mt-2">{rows.length} строк</div>
        </div>
      )}
    </div>
  );
}
