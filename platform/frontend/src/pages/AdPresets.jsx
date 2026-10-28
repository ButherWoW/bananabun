import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adPresets } from '../api/client.js';
import clsx from 'clsx';

const OBJECTIVES = ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT'];
const BID_STRATEGIES = ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'MINIMUM_ROAS'];
const OPT_GOALS = ['OFFSITE_CONVERSIONS', 'LINK_CLICKS', 'LANDING_PAGE_VIEWS', 'IMPRESSIONS', 'REACH', 'VALUE'];
const BILLING_EVENTS = ['IMPRESSIONS', 'LINK_CLICKS'];

const DEFAULT_FORM = {
  name: '',
  objective: 'OUTCOME_SALES',
  daily_budget: '',
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  bid_amount: '',
  optimization_goal: 'OFFSITE_CONVERSIONS',
  billing_event: 'IMPRESSIONS',
  fb_cabinet_id: '',
  fb_page_id: '',
  fb_pixel_id: '',
  pixel_event: 'Purchase',
  countries: '',
  age_min: 18,
  age_max: 65,
};

function PresetModal({ preset, onClose, onSave }) {
  const [form, setForm] = useState(preset ? {
    ...preset,
    countries: Array.isArray(preset.countries) ? preset.countries.join(', ') : preset.countries || '',
  } : DEFAULT_FORM);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = {
      ...form,
      countries: form.countries ? form.countries.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [],
      daily_budget: form.daily_budget ? Number(form.daily_budget) : null,
      bid_amount: form.bid_amount ? Number(form.bid_amount) : null,
      age_min: Number(form.age_min),
      age_max: Number(form.age_max),
    };
    onSave(data);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--c2d3148)]">
          <h2 className="text-sm font-semibold text-white">{preset ? 'Редактировать пресет' : 'Новый пресет'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <Field label="Название">
            <input required value={form.name} onChange={e => set('name', e.target.value)} className={inp} placeholder="Мой пресет" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Цель кампании">
              <select value={form.objective} onChange={e => set('objective', e.target.value)} className={inp}>
                {OBJECTIVES.map(o => <option key={o} value={o}>{o.replace('OUTCOME_', '')}</option>)}
              </select>
            </Field>
            <Field label="Дневной бюджет ($)">
              <input type="number" value={form.daily_budget} onChange={e => set('daily_budget', e.target.value)} className={inp} placeholder="20" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Стратегия ставки">
              <select value={form.bid_strategy} onChange={e => set('bid_strategy', e.target.value)} className={inp}>
                {BID_STRATEGIES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Сумма ставки ($)">
              <input type="number" value={form.bid_amount} onChange={e => set('bid_amount', e.target.value)} className={inp} placeholder="0.50" step="0.01" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Цель оптимизации">
              <select value={form.optimization_goal} onChange={e => set('optimization_goal', e.target.value)} className={inp}>
                {OPT_GOALS.map(g => <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Billing event">
              <select value={form.billing_event} onChange={e => set('billing_event', e.target.value)} className={inp}>
                {BILLING_EVENTS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
          </div>

          <div className="border-t border-[color:var(--c2d3148)] pt-3">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Facebook</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ID кабинета">
                <input value={form.fb_cabinet_id} onChange={e => set('fb_cabinet_id', e.target.value)} className={inp} placeholder="act_123456789" />
              </Field>
              <Field label="ID страницы">
                <input value={form.fb_page_id} onChange={e => set('fb_page_id', e.target.value)} className={inp} placeholder="123456789" />
              </Field>
              <Field label="ID пикселя">
                <input value={form.fb_pixel_id} onChange={e => set('fb_pixel_id', e.target.value)} className={inp} placeholder="123456789" />
              </Field>
              <Field label="Событие пикселя">
                <input value={form.pixel_event} onChange={e => set('pixel_event', e.target.value)} className={inp} placeholder="Purchase" />
              </Field>
            </div>
          </div>

          <div className="border-t border-[color:var(--c2d3148)] pt-3">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Таргетинг</div>
            <Field label="Страны (через запятую)">
              <input value={form.countries} onChange={e => set('countries', e.target.value)} className={inp} placeholder="FR, BE, CH" />
            </Field>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="Возраст от">
                <input type="number" value={form.age_min} onChange={e => set('age_min', e.target.value)} className={inp} min={18} max={65} />
              </Field>
              <Field label="Возраст до">
                <input type="number" value={form.age_max} onChange={e => set('age_max', e.target.value)} className={inp} min={18} max={65} />
              </Field>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-[color:var(--c2d3148)] rounded-lg transition-colors">
              Отмена
            </button>
            <button type="submit" className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-medium">
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inp = 'w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-300 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500';

export default function AdPresetsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // null | 'new' | preset object

  const { data: presets = [], isLoading } = useQuery({
    queryKey: ['ad-presets'],
    queryFn: adPresets.list,
    staleTime: 30000,
  });

  const createMut = useMutation({
    mutationFn: adPresets.create,
    onSuccess: () => { qc.invalidateQueries(['ad-presets']); setModal(null); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => adPresets.update(id, data),
    onSuccess: () => { qc.invalidateQueries(['ad-presets']); setModal(null); },
  });

  const deleteMut = useMutation({
    mutationFn: adPresets.remove,
    onSuccess: () => qc.invalidateQueries(['ad-presets']),
  });

  const handleSave = (data) => {
    if (modal && modal.id) {
      updateMut.mutate({ id: modal.id, ...data });
    } else {
      createMut.mutate(data);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
        <h1 className="text-lg font-semibold text-white">Пресеты рекламы</h1>
        <button
          onClick={() => setModal('new')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors font-medium"
        >
          + Новый пресет
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-500 text-sm animate-pulse">Загрузка...</div>
        ) : presets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-gray-500 text-sm">Пресетов нет</p>
            <p className="text-gray-600 text-xs">Пресеты хранят настройки кампании Facebook для быстрого залива</p>
            <button
              onClick={() => setModal('new')}
              className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors"
            >
              Создать первый пресет
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {presets.map(p => (
              <div key={p.id} className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-4 py-3 hover:border-indigo-500/40 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">{p.name}</div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge label="Цель" value={p.objective?.replace('OUTCOME_', '')} />
                      {p.daily_budget && <Badge label="Бюджет" value={`$${p.daily_budget}/д`} />}
                      {p.countries?.length > 0 && <Badge label="Гео" value={p.countries.join(', ')} />}
                      {p.fb_pixel_id && <Badge label="Пиксель" value={p.pixel_event || 'Purchase'} />}
                      <Badge label="Стратегия" value={p.bid_strategy?.replace(/_/g, ' ').toLowerCase()} />
                      <Badge label="Возраст" value={`${p.age_min}–${p.age_max}`} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setModal(p)}
                      className="text-xs text-gray-500 hover:text-indigo-400 transition-colors px-2 py-1 border border-[color:var(--c2d3148)] hover:border-indigo-500/50 rounded"
                    >
                      Изменить
                    </button>
                    <button
                      onClick={() => { if (confirm(`Удалить «${p.name}»?`)) deleteMut.mutate(p.id); }}
                      className="text-xs text-gray-600 hover:text-red-400 transition-colors px-2 py-1 border border-[color:var(--c2d3148)] hover:border-red-500/30 rounded"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <PresetModal
          preset={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function Badge({ label, value }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--c1e2240)] text-gray-400">
      <span className="text-gray-600">{label}:</span>
      <span>{value}</span>
    </span>
  );
}
