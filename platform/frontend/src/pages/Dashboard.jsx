import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analytics } from '../api/client.js';

const RANGES = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'last_7_days', label: '7 дней' },
  { key: 'last_30_days', label: '30 дней' },
];

function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtEur(n) {
  if (n == null || isNaN(n)) return '—';
  return '€' + fmt(n, 2);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return fmt(n, 1) + '%';
}

function Skeleton() {
  return <div className="animate-pulse h-8 rounded bg-[color:var(--c1e2240)] w-3/4" />;
}

function KpiCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-[color:var(--c0d0f1e)] border border-[color:var(--c1e2240)] rounded-xl p-5 flex flex-col gap-2">
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

function PlatformRow({ icon, name, color, metrics, loading, notConnected }) {
  return (
    <div className="bg-[color:var(--c0d0f1e)] border border-[color:var(--c1e2240)] rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{icon}</span>
        <span className={`font-semibold ${color}`}>{name}</span>
        {notConnected && <span className="ml-2 text-xs text-gray-600 italic">Нет данных</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map(m => (
          <div key={m.label} className="flex flex-col gap-1">
            <div className="text-[11px] text-gray-500 uppercase tracking-wide">{m.label}</div>
            <div className="text-lg font-bold text-white">
              {loading ? <Skeleton /> : m.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState('today');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard', range],
    queryFn: () => analytics.dashboard(range),
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const keitaro = data?.keitaro || {};
  const fb = data?.fb || {};
  const tt = data?.tiktok || {};
  const totals = data?.totals || {};

  const profitColor = totals.profit > 0 ? 'text-green-400' : totals.profit < 0 ? 'text-red-400' : 'text-white';
  const roiColor = (totals.roi ?? 0) > 0 ? 'text-green-400' : (totals.roi ?? 0) < 0 ? 'text-red-400' : 'text-white';

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Дашборд</h1>
          {data?.period && (
            <div className="text-xs text-gray-500 mt-0.5">
              {data.period.from === data.period.to ? data.period.from : `${data.period.from} — ${data.period.to}`}
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                range === r.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[color:var(--c1a1d35)] text-gray-400 hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isError && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-800/50 text-red-300 text-sm">
          Ошибка загрузки данных. Проверьте соединение.
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Расход"
          value={isLoading ? <Skeleton /> : fmtEur(totals.spend)}
          color="text-orange-400"
        />
        <KpiCard
          label="Доход"
          value={isLoading ? <Skeleton /> : fmtEur(totals.revenue)}
          color="text-blue-400"
        />
        <KpiCard
          label="Профит"
          value={isLoading ? <Skeleton /> : fmtEur(totals.profit)}
          color={profitColor}
        />
        <KpiCard
          label="ROI"
          value={isLoading ? <Skeleton /> : fmtPct(totals.roi)}
          color={roiColor}
        />
      </div>

      {/* Platform rows */}
      <div className="flex flex-col gap-4">
        <PlatformRow
          icon="🔵"
          name="Facebook Ads"
          color="text-blue-400"
          loading={isLoading}
          notConnected={!isLoading && !fb.spend && !fb.clicks && !fb.impressions && !fb.leads}
          metrics={[
            { label: 'Расход', value: fmtEur(fb.spend) },
            { label: 'Клики', value: fmt(fb.clicks) },
            { label: 'Показы', value: fmt(fb.impressions) },
            { label: 'Лиды', value: fmt(fb.leads) },
          ]}
        />

        <PlatformRow
          icon="🎵"
          name="TikTok Ads"
          color="text-pink-400"
          loading={isLoading}
          notConnected={!isLoading && !tt.spend && !tt.clicks && !tt.impressions && !tt.conversions}
          metrics={[
            { label: 'Расход', value: fmtEur(tt.spend) },
            { label: 'Клики', value: fmt(tt.clicks) },
            { label: 'Показы', value: fmt(tt.impressions) },
            { label: 'Конверсии', value: fmt(tt.conversions) },
          ]}
        />

        <PlatformRow
          icon="📊"
          name="Keitaro"
          color="text-green-400"
          loading={isLoading}
          notConnected={!isLoading && !keitaro.clicks && !keitaro.conversions && !keitaro.revenue && !keitaro.cost}
          metrics={[
            { label: 'Клики', value: fmt(keitaro.clicks) },
            { label: 'Конверсии', value: fmt(keitaro.conversions) },
            { label: 'Доход', value: fmtEur(keitaro.revenue) },
            { label: 'EPC', value: fmtEur(keitaro.clicks > 0 ? keitaro.revenue / keitaro.clicks : null) },
          ]}
        />
      </div>
    </div>
  );
}
