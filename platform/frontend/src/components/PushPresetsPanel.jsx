import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { adSettings as adSettingsApi } from '../api/client.js';

const SORTS = {
  new: { label: 'Сначала новые', fn: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  used: { label: 'Чаще используемые', fn: (a, b, uses) => (uses[b.id] || 0) - (uses[a.id] || 0) },
  name: { label: 'По имени', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
};

function formOf(p) {
  if (!p.form) return {};
  if (typeof p.form === 'string') {
    try { return JSON.parse(p.form); } catch { return {}; }
  }
  return p.form;
}

function summary(p) {
  const f = formOf(p);
  const geos = f.geos || (f.geo ? [f.geo] : []);
  const products = f.product_ids?.length || p.product_ids?.length || (f.product_id ? 1 : 0);
  return [
    p.budget ? `${Number(p.budget)}/д` : null,
    p.objective ? p.objective.replace('OUTCOME_', '') : null,
    p.adsets_count ? `${p.adsets_count} адс` : null,
    p.age_min && p.age_max ? `${p.age_min}–${p.age_max}` : null,
    geos.length ? geos.join(', ') : null,
    products ? `${products} товар.` : null,
  ].filter(Boolean).join(' · ');
}

// The original starts a push from an ad preset: the preset carries the whole push form.
export default function PushPresetsPanel({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('new');

  const { data: presets = [], isLoading } = useQuery({ queryKey: ['ad-settings'], queryFn: adSettingsApi.list });
  const { data: uses = {} } = useQuery({ queryKey: ['ad-settings', 'stats'], queryFn: adSettingsApi.stats });

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return presets
      .filter(p => !needle || (p.name || '').toLowerCase().includes(needle))
      .sort((a, b) => SORTS[sort].fn(a, b, uses));
  }, [presets, q, sort, uses]);

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[440px] max-w-full bg-[color:var(--c0d0f1e)] border-l border-[color:var(--c2d3148)] flex flex-col h-full shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--c1e2240)]">
          <div className="text-sm font-semibold text-white">Пресеты</div>
          <button onClick={onClose} className="text-gray-600 hover:text-white text-xl w-7 h-7" aria-label="Закрыть">×</button>
        </div>

        <div className="flex gap-2 px-5 py-3 border-b border-[color:var(--c1e2240)]">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Поиск"
            className="flex-1 min-w-0 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
          >
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-2">
          {isLoading && <div className="text-sm text-gray-500 py-8 text-center">Загрузка…</div>}
          {!isLoading && !list.length && (
            <div className="text-sm text-gray-500 py-8 text-center">
              {presets.length ? 'Ничего не найдено' : 'Пресетов пока нет — создай первый или залей без пресета'}
            </div>
          )}
          {list.map(p => (
            <div key={p.id} className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{p.name || 'Без имени'}</div>
                <div className="text-[11px] text-gray-500 truncate">{summary(p)}</div>
                {uses[p.id] ? <div className="text-[10px] text-indigo-400/80 mt-0.5">{uses[p.id]} зал.</div> : null}
              </div>
              <button
                onClick={() => onPick(p)}
                className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg flex-shrink-0"
              >Залить</button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-[color:var(--c1e2240)]">
          <Link
            to="/ad-settings"
            onClick={onClose}
            className="flex-1 py-2 text-center text-sm text-gray-300 hover:text-white border border-dashed border-[color:var(--c2d3148)] hover:border-indigo-500/50 rounded-xl"
          >+ Новый пресет</Link>
          <button
            onClick={() => onPick(null)}
            className="flex-1 py-2 text-sm text-gray-300 hover:text-white border border-[color:var(--c2d3148)] rounded-xl"
          >Без пресета</button>
        </div>
      </div>
    </div>
  );
}
