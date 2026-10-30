import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adSettings as api, products as productsApi, presets as presetsApi } from '../api/client.js';
import clsx from 'clsx';
import Hint from '../components/Hint.jsx';

const DEFAULT = {
  name: 'Новый пресет',
  product_ids: [],
  age_min: 25, age_max: 65,
  genders: 'all', devices: 'all',
  adsets_count: 3,
  budget: '', // bid and budget are set per geo with the lead — never defaulted
  bid_strategy: 'LOWEST_COST_WITH_BID_CAP',
  bid_amount: '',
  objective: 'OUTCOME_LEADS',
  pixel_event: 'LEAD',
  call_to_action: 'LEARN_MORE',
  auto_placement: true,
  url_params: 'utm_campaign={{campaign.name}}&utm_source={{site_source_name}}&utm_placement={{placement}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&adset_name={{adset.name}}&ad_name={{ad.name}}',
  creo_mode: 'all-all',
  creo_per_adset: 3,
  all_creatives: false,
  platforms: [],
  bid_amounts: null,
};

const PLATFORMS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'audience_network', label: 'Audience Network' },
  { value: 'messenger', label: 'Messenger' },
];

// A separate bid for each adset (bid strategies with a cap only); off = one bid for all.
function BidsPerAdset({ form, set }) {
  const n = Math.max(Number(form.adsets_count) || 1, 1);
  const bids = Array.isArray(form.bid_amounts) ? form.bid_amounts : null;
  const toggle = () => set('bid_amounts', bids ? null : Array.from({ length: n }, () => form.bid_amount || ''));
  const setBid = (i, v) => set('bid_amounts', Array.from({ length: n }, (_, k) => (k === i ? v : bids?.[k] ?? '')));
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
        <input type="checkbox" checked={!!bids} onChange={toggle} />
        Своя ставка у каждого адсета
      </label>
      {bids && (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: n }, (_, i) => (
            <div key={i}>
              <div className="text-[10px] text-gray-600 mb-0.5">Адсет {i + 1}</div>
              <Input type="number" value={bids[i] ?? ''} onChange={v => setBid(i, v)} min={0.01} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductsMultiSelect({ value = [], onChange, products = [] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ids = Array.isArray(value) ? value : [];
  const filtered = products.filter(p => !search || p.title?.toLowerCase().includes(search.toLowerCase()));
  const toggle = (id) => {
    if (ids.includes(id)) onChange(ids.filter(x => x !== id));
    else if (ids.length < 15) onChange([...ids, id]);
  };
  const selectedNames = ids.map(id => products.find(p => p.id === id)?.title?.slice(0, 22)).filter(Boolean);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:border-indigo-500 transition-colors hover:border-indigo-500/40"
      >
        <span className="truncate text-gray-300">
          {ids.length === 0 ? <span className="text-gray-600">Не выбрано</span> : `${ids.length} товаров`}
        </span>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selectedNames.map((name, i) => (
            <span key={ids[i]} className="inline-flex items-center gap-1 bg-indigo-600/15 border border-indigo-500/30 text-indigo-300 text-[10px] px-1.5 py-0.5 rounded">
              {name}
              <button onClick={() => toggle(ids[i])} className="text-indigo-500 hover:text-red-400 leading-none">×</button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-[color:var(--c1e2240)]">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск товара..."
              className="w-full bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filtered.slice(0, 50).map(p => {
              const checked = ids.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={clsx('w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[color:var(--c13162b)] transition-colors text-left', checked ? 'text-indigo-300' : 'text-gray-400')}
                >
                  <span className={clsx('w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0', checked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600')}>
                    {checked && <span className="text-white text-[8px] leading-none">✓</span>}
                  </span>
                  <span className="truncate">{p.title || p.asin || p.id}</span>
                </button>
              );
            })}
            {filtered.length === 0 && <div className="px-3 py-3 text-xs text-gray-600">Товаров не найдено</div>}
          </div>
          <div className="px-3 py-1.5 border-t border-[color:var(--c1e2240)] text-[10px] text-gray-600">{ids.length}/15 выбрано</div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500 uppercase tracking-wide">{label}{hint && <Hint k={hint} />}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', ...props }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
      className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
      {...props}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function BundlePresetsSection() {
  const queryClient = useQueryClient();

  const { data: bundles = [], isLoading } = useQuery({
    queryKey: ['presets', 'bundles'],
    queryFn: () => presetsApi.bundles(),
    staleTime: 300000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => presetsApi.deleteBundle(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['presets', 'bundles'] }),
  });

  if (isLoading) return null;
  if (!bundles.length) return (
    <div className="mt-6 text-xs text-gray-600 text-center py-4">Нет комплектов</div>
  );

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <span>📦</span> Комплекты
        <span className="text-[10px] text-gray-500 font-normal">{bundles.length} шт.</span>
      </h2>
      <div className="space-y-2">
        {bundles.map(bundle => (
          <div key={bundle.id} className="flex items-center justify-between bg-[color:var(--c0e1221)] border border-[color:var(--c1e2540)] rounded-lg px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white">{bundle.name || bundle.id}</div>
              {bundle.products?.length > 0 && (
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {bundle.products.map((p, i) => (
                    <span key={i}>{i > 0 ? ' · ' : ''}{p.quantity}×{p.product_id?.slice(-6)}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
              <span className="text-[10px] text-gray-600 font-mono">{bundle.id}</span>
              <button
                onClick={() => { if (window.confirm('Удалить пресет?')) deleteMutation.mutate(bundle.id); }}
                disabled={deleteMutation.isPending}
                className="text-[10px] px-2 py-1 text-red-400/60 hover:text-red-400 transition-colors"
              >✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdSettingsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(DEFAULT);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['ad-settings'],
    queryFn: api.list,
  });

  const { data: usageStats = {} } = useQuery({
    queryKey: ['ad-settings-stats'],
    queryFn: api.stats,
    staleTime: 300000,
  });

  const { data: allProducts = [] } = useQuery({
    queryKey: ['products-list-small'],
    queryFn: () => productsApi.list({ limit: 100 }),
    select: (d) => Array.isArray(d) ? d : (d?.items || d?.products || []),
    staleTime: 60 * 1000,
  });

  const [saveError, setSaveError] = useState('');

  const createMutation = useMutation({
    mutationFn: api.create,
    onSuccess: () => { qc.invalidateQueries(['ad-settings']); setEditing(null); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.update(id, data),
    onSuccess: () => { qc.invalidateQueries(['ad-settings']); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: api.remove,
    onSuccess: () => qc.invalidateQueries(['ad-settings']),
  });

  function openCreate() {
    setForm(DEFAULT);
    setSaveError('');
    setEditing('new');
  }

  function openEdit(item) {
    setForm({ ...DEFAULT, ...item, platforms: item.platforms || [] });
    setSaveError('');
    setEditing(item.id);
  }

  function set(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  function handleSave() {
    // Per-adset bids follow the adset count: one bid per adset, no more, no less.
    const n = Math.max(Number(form.adsets_count) || 1, 1);
    const data = Array.isArray(form.bid_amounts)
      ? { ...form, bid_amounts: Array.from({ length: n }, (_, i) => form.bid_amounts[i] ?? '') }
      : form;
    if (Array.isArray(data.bid_amounts) && data.bid_amounts.some(b => !(Number(b) > 0))) {
      setSaveError(`Заполните ставку у каждого из ${n} адсетов`);
      return;
    }
    if (!data.auto_placement && !(data.platforms || []).length) {
      setSaveError('Авто-плейсменты выключены — выберите площадки');
      return;
    }
    setSaveError('');
    if (editing === 'new') createMutation.mutate(data);
    else updateMutation.mutate({ id: editing, data });
  }

  const objectiveOptions = [
    { value: 'OUTCOME_LEADS', label: 'Лиды' },
    { value: 'OUTCOME_SALES', label: 'Продажи' },
    { value: 'OUTCOME_TRAFFIC', label: 'Трафик' },
  ];

  const pixelEventOptions = [
    { value: 'LEAD', label: 'Lead' },
    { value: 'PURCHASE', label: 'Purchase' },
    { value: 'ADD_TO_CART', label: 'Add to Cart' },
  ];

  const ctaOptions = [
    { value: 'LEARN_MORE', label: 'Узнать больше' },
    { value: 'SHOP_NOW', label: 'Купить' },
    { value: 'SIGN_UP', label: 'Зарегистрироваться' },
  ];

  const bidOptions = [
    { value: 'LOWEST_COST_WITH_BID_CAP', label: 'Мин. цена с лимитом' },
    { value: 'LOWEST_COST_WITHOUT_CAP', label: 'Мин. цена без лимита' },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* List */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
          <h1 className="text-lg font-semibold text-white">Настройки рекламы</h1>
          <button
            onClick={openCreate}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Создать пресет
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {isLoading ? (
            <div className="text-gray-500 text-sm py-20 text-center">Загрузка...</div>
          ) : items.length === 0 && !editing ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="text-4xl">⚙️</div>
              <div className="text-gray-500 text-sm">Пресетов пока нет</div>
              <button onClick={openCreate} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                Создать первый пресет
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map(item => (
                  <div
                    key={item.id}
                    onClick={() => openEdit(item)}
                    className={clsx(
                      'bg-[color:var(--c13162b)] border rounded-xl p-4 cursor-pointer hover:border-indigo-500/50 transition-colors',
                      editing === item.id ? 'border-indigo-500' : 'border-[color:var(--c2d3148)]'
                    )}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-1.5">
                        <div className="text-sm font-semibold text-white">{item.name}</div>
                        {usageStats[item.id] > 0 && (
                          <span className="text-[10px] text-indigo-400/70 bg-indigo-600/10 border border-indigo-500/20 px-1.5 py-0.5 rounded">
                            {usageStats[item.id]} зал.
                          </span>
                        )}
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); if (window.confirm('Удалить пресет?')) deleteMutation.mutate(item.id); }}
                        className="text-gray-600 hover:text-red-400 text-xs transition-colors"
                      >✕</button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>Бюджет на адсет: <span className="text-gray-300">{item.budget}€/день</span></span>
                      <span>Ставка: <span className="text-gray-300">{item.bid_amount}€</span></span>
                      <span>Возраст: <span className="text-gray-300">{item.age_min}–{item.age_max}</span></span>
                      <span>Адсеты: <span className="text-gray-300">{item.adsets_count}</span></span>
                      <span>Цель: <span className="text-gray-300">{objectiveOptions.find(o => o.value === item.objective)?.label || item.objective}</span></span>
                      <span>CTA: <span className="text-gray-300">{ctaOptions.find(o => o.value === item.call_to_action)?.label || item.call_to_action}</span></span>
                    </div>
                  </div>
                ))}
              </div>
              <BundlePresetsSection />
            </>
          )}
        </div>
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="w-[400px] flex-shrink-0 bg-[color:var(--c0d0f1e)] border-l border-[color:var(--c2d3148)] flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--c1e2240)] flex-shrink-0">
            <span className="text-sm font-semibold text-white">{editing === 'new' ? 'Новый пресет' : 'Редактировать'}</span>
            <button onClick={() => setEditing(null)} className="text-gray-600 hover:text-white text-xl">×</button>
          </div>

          {/* Live preview */}
          <div className="px-5 pt-4 pb-3 border-b border-[color:var(--c1e2240)] flex-shrink-0">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Предпросмотр</div>
            <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg p-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-gray-600 mb-0.5">Бюджет на адсет</div>
                <div className="text-white font-semibold">{form.budget}€</div>
              </div>
              <div>
                <div className="text-gray-600 mb-0.5">Ставка</div>
                <div className="text-white font-semibold">{form.bid_amount}€</div>
              </div>
              <div>
                <div className="text-gray-600 mb-0.5">Адсеты</div>
                <div className="text-white font-semibold">×{form.adsets_count}</div>
              </div>
              <div>
                <div className="text-gray-600 mb-0.5">Возраст</div>
                <div className="text-white">{form.age_min}–{form.age_max}</div>
              </div>
              <div>
                <div className="text-gray-600 mb-0.5">Цель</div>
                <div className="text-blue-300 font-mono text-[10px]">{form.objective?.replace('OUTCOME_', '')}</div>
              </div>
              <div>
                <div className="text-gray-600 mb-0.5">Событие</div>
                <div className="text-blue-300 font-mono text-[10px]">{form.pixel_event}</div>
              </div>
            </div>
            <div className="mt-1.5 text-[10px] text-gray-700">
              Расход в день на всю кампанию: ~{form.adsets_count > 0 && form.budget ? Math.round(form.budget * form.adsets_count) : '—'}€
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            <Field label="Название">
              <Input value={form.name} onChange={v => set('name', v)} placeholder="Название пресета" />
            </Field>

            <Field label="Товары (до 15)">
              <ProductsMultiSelect
                value={form.product_ids}
                onChange={v => set('product_ids', v)}
                products={allProducts}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Возраст от" hint="as.age">
                <Input type="number" value={form.age_min} onChange={v => set('age_min', v)} min={18} max={65} />
              </Field>
              <Field label="Возраст до">
                <Input type="number" value={form.age_max} onChange={v => set('age_max', v)} min={18} max={65} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Пол" hint="as.gender">
                <Select value={form.genders} onChange={v => set('genders', v)} options={[
                  { value: 'all', label: 'Все' },
                  { value: 'male', label: 'Мужчины' },
                  { value: 'female', label: 'Женщины' },
                ]} />
              </Field>
              <Field label="Устройства" hint="as.devices">
                <Select value={form.devices} onChange={v => set('devices', v)} options={[
                  { value: 'all', label: 'Все' },
                  { value: 'mobile', label: 'Мобильные' },
                  { value: 'desktop', label: 'Десктоп' },
                ]} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Кол-во адсетов" hint="as.adsets">
                <Input type="number" value={form.adsets_count} onChange={v => set('adsets_count', v)} min={1} max={10} />
              </Field>
              <Field label="Бюджет на один адсет, € в день" hint="as.budget">
                <Input type="number" value={form.budget} onChange={v => set('budget', v)} min={1} />
              </Field>
            </div>

            <Field label="Стратегия ставки" hint="as.bidStrategy">
              <Select value={form.bid_strategy} onChange={v => set('bid_strategy', v)} options={bidOptions} />
            </Field>

            <Field label="Ставка (€)" hint="as.bid">
              <Input type="number" value={form.bid_amount} onChange={v => set('bid_amount', v)} min={1} />
            </Field>

            <BidsPerAdset form={form} set={set} />

            <Field label="Цель" hint="as.objective">
              <Select value={form.objective} onChange={v => set('objective', v)} options={objectiveOptions} />
            </Field>

            <Field label="Событие пикселя" hint="as.pixelEvent">
              <Select value={form.pixel_event} onChange={v => set('pixel_event', v)} options={pixelEventOptions} />
            </Field>

            <Field label="CTA" hint="as.cta">
              <Select value={form.call_to_action} onChange={v => set('call_to_action', v)} options={ctaOptions} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Режим креативов" hint="as.creoMode">
                <Select value={form.creo_mode} onChange={v => set('creo_mode', v)} options={[
                  { value: 'all-all', label: 'Все во все адсеты' },
                  { value: 'one-per', label: 'Свои креативы у каждого адсета' },
                ]} />
              </Field>
              <Field label={form.creo_mode === 'one-per' ? 'Креативов на адсет' : 'Креативов на адсет (только для «своих»)'}>
                <Input type="number" value={form.creo_per_adset} onChange={v => set('creo_per_adset', v)} min={1} max={10} />
              </Field>
            </div>

            <Field label="Все креативы воркспейса">
              <button
                onClick={() => set('all_creatives', !form.all_creatives)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
                  form.all_creatives
                    ? 'border-purple-500 text-purple-300 bg-purple-600/10'
                    : 'border-[color:var(--c2d3148)] text-gray-500'
                )}
              >
                <span className={clsx('w-4 h-4 rounded border flex items-center justify-center text-xs', form.all_creatives ? 'bg-purple-600 border-purple-600 text-white' : 'border-gray-600')}>
                  {form.all_creatives && '✓'}
                </span>
                {form.all_creatives ? 'Включено' : 'Выключено'}
              </button>
            </Field>

            <Field label="Авто-плейсменты" hint="as.autoPlacement">
              <button
                onClick={() => set('auto_placement', !form.auto_placement)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
                  form.auto_placement
                    ? 'border-indigo-500 text-indigo-300 bg-indigo-600/10'
                    : 'border-[color:var(--c2d3148)] text-gray-500'
                )}
              >
                <span className={clsx('w-4 h-4 rounded border flex items-center justify-center text-xs', form.auto_placement ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-600')}>
                  {form.auto_placement && '✓'}
                </span>
                {form.auto_placement ? 'Включены' : 'Выключены'}
              </button>
            </Field>

            {!form.auto_placement && (
              <Field label="Площадки" hint="as.platforms">
                <div className="flex flex-wrap gap-1.5">
                  {PLATFORMS.map(p => {
                    const on = (form.platforms || []).includes(p.value);
                    return (
                      <button key={p.value} type="button"
                        onClick={() => set('platforms', on ? form.platforms.filter(x => x !== p.value) : [...(form.platforms || []), p.value])}
                        className={clsx('px-2.5 py-1 rounded border text-xs', on ? 'border-indigo-500 text-indigo-300 bg-indigo-600/10' : 'border-[color:var(--c2d3148)] text-gray-500')}>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}

            <Field label="URL параметры" hint="as.urlParams">
              <textarea
                value={form.url_params}
                onChange={e => set('url_params', e.target.value)}
                rows={3}
                className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-xs text-gray-300 font-mono focus:outline-none focus:border-indigo-500 resize-none"
              />
            </Field>
          </div>

          {(saveError || createMutation.error || updateMutation.error) && (
            <div className="px-5 pt-3 text-xs text-red-400">
              {saveError || (createMutation.error || updateMutation.error)?.error || (createMutation.error || updateMutation.error)?.message}
            </div>
          )}
          <div className="px-5 py-4 border-t border-[color:var(--c1e2240)] flex-shrink-0 flex gap-2">
            <button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {createMutation.isPending || updateMutation.isPending ? 'Сохраняю...' : 'Сохранить'}
            </button>
            <button onClick={() => setEditing(null)} className="px-4 py-2 border border-[color:var(--c2d3148)] text-gray-400 hover:text-white text-sm rounded-lg transition-colors">
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
