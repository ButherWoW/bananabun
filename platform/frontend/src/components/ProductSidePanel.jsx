import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { products as productsApi, keitaro as keitaroApi, presets as presetsApi, scrape as scrapeApi, landings as landingsApi } from '../api/client.js';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { toast } from './Toaster.jsx';

function RetryButton({ productId, qc }) {
  const mut = useMutation({
    mutationFn: () => scrapeApi.retry(productId),
    onSuccess: () => {
      qc.invalidateQueries(['products']);
      qc.invalidateQueries(['product', productId]);
    },
  });
  return (
    <button
      onClick={e => { e.stopPropagation(); mut.mutate(); }}
      disabled={mut.isPending}
      className="text-xs px-2 py-0.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded transition-colors disabled:opacity-50"
    >
      {mut.isPending ? '…' : '↺ Повторить'}
    </button>
  );
}

const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.BASE_URL.replace(/\/$/, '');

// Raw fetch calls below: a refused request must show its reason instead of passing silently.
async function failText(r, fallback) {
  try { const d = await r.json(); return d?.error || d?.message || fallback; } catch { return fallback; }
}

const TABS = ['Карточка', 'Комплекты', 'Галерея', 'Отзывы', '✨ Похожие'];

function SimilarProductsPanel({ productId }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['similar-products', productId],
    queryFn: () => scrapeApi.similar(productId),
    enabled: !!productId,
    staleTime: 600000,
    retry: 1,
  });

  if (isLoading) return <div className="p-4 text-xs text-gray-500 animate-pulse">Поиск похожих…</div>;
  if (!data.length) return <div className="p-4 text-xs text-gray-600">Похожих товаров не найдено</div>;

  return (
    <div className="p-4 flex flex-col gap-2">
      <div className="text-xs text-gray-500 mb-1">Похожие товары</div>
      {data.slice(0, 8).map((item, i) => (
        <div key={i} className="flex items-center gap-3 p-2 bg-[color:var(--c1a1d3a)] rounded-lg">
          {item.image && (
            <img src={item.image} alt="" className="w-10 h-10 object-cover rounded flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white truncate">{item.title || item.name || 'Без названия'}</div>
            {item.price && <div className="text-[10px] text-emerald-400">{item.price}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProductSidePanel({ product, onClose, initialTab }) {
  const [tab, setTab] = useState(initialTab || 'Карточка');
  const qc = useQueryClient();

  const { data: full, isLoading } = useQuery({
    queryKey: ['product', product.id],
    queryFn: () => productsApi.get(product.id),
    initialData: product,
  });

  if (!product) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1" onClick={onClose} />

      {/* Panel */}
      <div className="w-[480px] bg-[color:var(--c0d0f1e)] border-l border-[color:var(--c2d3148)] flex flex-col h-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-[color:var(--c1e2240)] flex-shrink-0">
          <div className="flex-1 min-w-0 mr-3">
            <div className="text-xs text-gray-500 mb-1 truncate">{full?.source_url || full?.source_id}</div>
            <div className="text-sm font-medium text-white leading-snug line-clamp-2">{full?.title || '—'}</div>
            {full?.scrape_status === 'failed' && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs text-red-400">Ошибка скрапинга</span>
                <RetryButton productId={product.id} qc={qc} />
              </div>
            )}
            {full?.preset_creatives_error && (
              <div role="alert" className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <p className="font-medium">Креативы по пресету не созданы</p>
                <p className="mt-1 break-words">{full.preset_creatives_error}</p>
                <Link to={`/creatives?product_id=${encodeURIComponent(product.id)}`} className="mt-1 inline-block underline">Открыть креативы</Link>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white text-xl w-7 h-7 flex items-center justify-center flex-shrink-0">
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[color:var(--c1e2240)] flex-shrink-0">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'flex-1 py-2.5 text-xs font-medium transition-colors border-b-2',
                tab === t
                  ? 'text-white border-indigo-500'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-gray-600 text-sm">Загрузка…</div>
          ) : (
            <>
              {tab === 'Карточка' && <CardTab product={full} qc={qc} />}
              {tab === 'Комплекты' && <BundlesTab product={full} qc={qc} />}
              {tab === 'Галерея' && <GalleryTab product={full} qc={qc} />}
              {tab === 'Отзывы' && <ReviewsTab product={full} qc={qc} />}
              {tab === '✨ Похожие' && <SimilarProductsPanel productId={product.id} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


const fieldCls = 'w-full bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500';

function parseSpecs(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(x => ({ label: x.label || '', value: x.value || '' })) : [];
  } catch { return []; }
}

function SpecsEditor({ specs, onChange }) {
  const set = (i, key, val) => onChange(specs.map((s, idx) => idx === i ? { ...s, [key]: val } : s));
  return (
    <div>
      <label className="block text-xs text-gray-400 font-medium mb-1.5">Характеристики</label>
      <div className="flex flex-col gap-2">
        {specs.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.4fr_28px] gap-2">
            <input value={s.label} onChange={e => set(i, 'label', e.target.value)} placeholder="Марка" className={fieldCls} />
            <input value={s.value} onChange={e => set(i, 'value', e.target.value)} placeholder="Значение" className={fieldCls} />
            <button
              type="button"
              onClick={() => onChange(specs.filter((_, idx) => idx !== i))}
              className="text-gray-600 hover:text-gray-300 bg-[color:var(--c1a1f3a)] border border-[color:var(--c2d3148)] rounded-lg"
              aria-label="Удалить характеристику"
            >×</button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...specs, { label: '', value: '' }])}
        className="mt-2 w-full border border-dashed border-[color:var(--c2d3148)] hover:border-indigo-500/50 text-gray-500 hover:text-gray-300 text-xs py-2 rounded-lg"
      >+ Характеристика</button>
    </div>
  );
}

/* ──────────── Новая связка (ручное создание) ──────────── */
export function NewProductPanel({ folderId, onClose, onCreated }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [specs, setSpecs] = useState([]);

  const create = useMutation({
    mutationFn: () => productsApi.create({ title, description, specs, folder_id: folderId || undefined }),
    onSuccess: (product) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      onCreated(product);
    },
  });

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1" onClick={onClose} />
      <div className="w-[480px] max-w-full bg-[color:var(--c0d0f1e)] border-l border-[color:var(--c2d3148)] flex flex-col h-full shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--c1e2240)]">
          <div className="text-sm font-semibold text-white">Новая связка</div>
          <button onClick={onClose} className="text-gray-600 hover:text-white text-xl w-7 h-7" aria-label="Закрыть">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Заголовок на ленде</label>
            <textarea value={title} onChange={e => setTitle(e.target.value)} rows={3} autoFocus className={fieldCls + ' resize-none'} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Описание</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} className={fieldCls + ' resize-none'} />
          </div>
          <SpecsEditor specs={specs} onChange={setSpecs} />
          <div className="text-[11px] text-gray-600">Комплекты, фото и отзывы добавишь после сохранения.</div>
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-[color:var(--c1e2240)]">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm text-gray-400 hover:text-white border border-[color:var(--c2d3148)] rounded-xl">Отмена</button>
          <button
            onClick={() => create.mutate()}
            disabled={!title.trim() || create.isPending}
            title={!title.trim() ? 'Нужен заголовок' : ''}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl"
          >{create.isPending ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  );
}

/* ──────────── Карточка ──────────── */
function CardTab({ product, qc }) {
  const [title, setTitle] = useState(product?.title || '');
  const [description, setDescription] = useState(product?.description || '');
  const [specs, setSpecs] = useState(() => parseSpecs(product?.specs));
  const [translating, setTranslating] = useState({});

  useEffect(() => {
    setTitle(product?.title || '');
    setDescription(product?.description || '');
    setSpecs(parseSpecs(product?.specs));
  }, [product?.id]);

  const saveMutation = useMutation({
    mutationFn: (data) => productsApi.update(product.id, data),
    onSuccess: () => qc.invalidateQueries(['product', product.id]),
  });

  const [landingType, setLandingType] = React.useState('cdiscount');
  const [landingResult, setLandingResult] = React.useState(null);
  const generateMutation = useMutation({
    mutationFn: () => landingsApi.generate({ product_id: product.id, type: landingType }),
    onSuccess: (data) => setLandingResult(data),
    onError: (err) => setLandingResult({ error: err.error || err.message || 'Ошибка генерации' }),
  });

  const [translations, setTranslations] = useState({});

  async function translate(field, text) {
    if (!text.trim()) return;
    setTranslating(t => ({ ...t, [field]: true }));
    try {
      const r = await fetch(`${API_BASE}/api/products/${product.id}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token'),
        },
        body: JSON.stringify({ field, text, target: 'ru' }),
      });
      if (!r.ok) { toast(await failText(r, 'Не удалось перевести')); return; }
      const d = await r.json();
      // View-only: the translation must never replace the text that goes to the landing.
      if (d.translated) setTranslations(t => ({ ...t, [field]: d.translated }));
    } catch { toast('Не удалось перевести'); }
    finally { setTranslating(t => ({ ...t, [field]: false })); }
  }

  function save() {
    saveMutation.mutate({ title, description, specs });
  }

  return (
    <div className="p-5 space-y-5">
      {/* Source price */}
      {product?.source_price && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Цена магазина:</span>
          <span className="text-white font-medium">{product.source_price} {product.source_currency || ''}</span>
        </div>
      )}

      {/* Title */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-gray-400 font-medium">Заголовок</label>
          <button
            onClick={() => translate('title', title)}
            disabled={translating.title}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 disabled:opacity-50"
          >
            {translating.title ? '…' : '% RU'}
          </button>
        </div>
        <textarea
          value={title}
          onChange={e => setTitle(e.target.value)}
          rows={3}
          className="w-full bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
        />
        {translations.title && (
          <p className="mt-1.5 text-xs text-gray-400 bg-[color:var(--c0d0f1e)] rounded-lg px-3 py-2 whitespace-pre-wrap">
            <span className="text-gray-600">RU, только для просмотра: </span>{translations.title}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-gray-400 font-medium">Описание</label>
          <button
            onClick={() => translate('description', description)}
            disabled={translating.description}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 disabled:opacity-50"
          >
            {translating.description ? '…' : '% RU'}
          </button>
        </div>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={6}
          className="w-full bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
        />
        {translations.description && (
          <p className="mt-1.5 text-xs text-gray-400 bg-[color:var(--c0d0f1e)] rounded-lg px-3 py-2 whitespace-pre-wrap">
            <span className="text-gray-600">RU, только для просмотра: </span>{translations.description}
          </p>
        )}
      </div>

      <SpecsEditor specs={specs} onChange={setSpecs} />

      {/* Save */}
      <button
        onClick={save}
        disabled={saveMutation.isPending}
        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
      >
        {saveMutation.isPending ? 'Сохраняю…' : 'Сохранить'}
      </button>

      {/* Generate Landing */}
      <div className="border-t border-[color:var(--c2d3148)] pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={landingType}
            onChange={e => { setLandingType(e.target.value); setLandingResult(null); }}
            className="flex-1 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="cdiscount">Klein KNECT (Cdiscount)</option>
            <option value="angry">Angry Modern (опрос)</option>
          </select>
          <button
            onClick={() => { setLandingResult(null); generateMutation.mutate(); }}
            disabled={generateMutation.isPending}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
          >
            {generateMutation.isPending ? 'Генерирую…' : 'Создать лендинг'}
          </button>
        </div>
        {landingResult && (
          landingResult.error
            ? <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{landingResult.error}</p>
            : <div className="text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2 space-y-0.5">
                <p className="font-medium">{landingResult.landing_name}</p>
                <p className="text-gray-500">Лендинг ID: {landingResult.landing_id} · {landingResult.local_path}</p>
                {landingResult.campaign_id
                  ? <p className="text-emerald-300">Кампания: {landingResult.campaign_name} (ID: {landingResult.campaign_id}, alias: {landingResult.campaign_alias})</p>
                  : landingResult.campaign_skipped
                    ? <p className="text-yellow-600">{landingResult.campaign_skipped}</p>
                    : null}
              </div>
        )}
      </div>
    </div>
  );
}

/* ──────────── Комплекты ──────────── */
function BundlesTab({ product, qc }) {
  const [bundles, setBundles] = useState(() => {
    const raw = product?.bundle_config || product?.bundles;
    try {
      const parsed = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
      return parsed.map(b => ({
        qty: b.qty || String(b.quantity || '1'),
        old_price: b.old_price || '',
        price: b.price || b.new_price || '',
        currency: b.currency || 'EUR',
        offer_id: b.offer_id ? String(b.offer_id) : '',
      }));
    } catch { return []; }
  });
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [savePresetName, setSavePresetName] = useState('');
  const [showSavePreset, setShowSavePreset] = useState(false);

  useEffect(() => {
    const raw = product?.bundle_config || product?.bundles;
    try {
      const parsed = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
      setBundles(parsed.map(b => ({
        qty: b.qty || String(b.quantity || '1'),
        old_price: b.old_price || '',
        price: b.price || b.new_price || '',
        currency: b.currency || 'EUR',
        offer_id: b.offer_id ? String(b.offer_id) : '',
      })));
    } catch { setBundles([]); }
  }, [product?.id]);

  const { data: ktOffers = [] } = useQuery({
    queryKey: ['keitaro', 'offers'],
    queryFn: () => keitaroApi.offers(),
    retry: false,
    staleTime: 60000,
  });

  const { data: bundlePresets = [], refetch: refetchBundlePresets } = useQuery({
    queryKey: ['presets', 'bundles'],
    queryFn: presetsApi.bundles,
  });

  const saveMutation = useMutation({
    mutationFn: (data) => productsApi.update(product.id, data),
    onSuccess: () => qc.invalidateQueries(['product', product.id]),
  });

  const savePresetMutation = useMutation({
    mutationFn: (name) => presetsApi.saveBundle({ name, currency: 'EUR', config: bundles }),
    onSuccess: () => { refetchBundlePresets(); setShowSavePreset(false); setSavePresetName(''); },
  });

  const deletePresetMutation = useMutation({
    mutationFn: presetsApi.deleteBundle,
    onSuccess: () => refetchBundlePresets(),
  });

  function loadPreset(preset) {
    const config = typeof preset.config === 'string' ? JSON.parse(preset.config || '[]') : (preset.config || []);
    const mapped = config.map(b => ({
      qty: b.qty || String(b.quantity || '1'),
      old_price: b.old_price || '',
      price: b.price || b.new_price || '',
      currency: b.currency || 'EUR',
      offer_id: b.offer_id ? String(b.offer_id) : '',
    }));
    setBundles(mapped);
    setShowPresetMenu(false);
  }

  function addBundle() {
    setBundles(b => [...b, {
      qty: String(b.length + 1),
      old_price: product?.source_currency ? product.source_price || '' : '',
      price: '',
      currency: product?.source_currency || 'EUR',
      offer_id: '',
    }]);
  }

  function updateBundle(i, key, val) {
    setBundles(b => b.map((item, idx) => idx === i ? { ...item, [key]: val } : item));
  }

  function removeBundle(i) {
    setBundles(b => b.filter((_, idx) => idx !== i));
  }

  function save() {
    saveMutation.mutate({ bundle_config: JSON.stringify(bundles) });
  }

  const QTY_PRESETS = ['1', '2', '3', '2+1', '3+2', '4+2'];

  return (
    <div className="p-5 space-y-3">
      {/* Preset row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <button
            onClick={() => setShowPresetMenu(v => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white border border-[color:var(--c2d3148)] hover:border-[color:var(--c3d4168)] px-3 py-1.5 rounded-lg transition-colors"
          >
            📋 Загрузить пресет
            {bundlePresets.length > 0 && <span className="text-gray-600">({bundlePresets.length})</span>}
          </button>
          {showPresetMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPresetMenu(false)} />
              <div className="absolute top-full left-0 mt-1 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl z-20 shadow-xl min-w-[200px] overflow-hidden">
                {bundlePresets.length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-600">Нет сохранённых пресетов</div>
                )}
                {bundlePresets.map(p => (
                  <div key={p.id} className="flex items-center group">
                    <button
                      onClick={() => loadPreset(p)}
                      className="flex-1 px-3 py-2 text-xs text-gray-300 hover:bg-[color:var(--c1e2240)] hover:text-white text-left transition-colors"
                    >
                      {p.name}
                    </button>
                    <button
                      onClick={() => deletePresetMutation.mutate(p.id)}
                      className="px-2 py-2 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs"
                    >✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        {showSavePreset ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              autoFocus
              value={savePresetName}
              onChange={e => setSavePresetName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && savePresetName.trim()) savePresetMutation.mutate(savePresetName); if (e.key === 'Escape') setShowSavePreset(false); }}
              placeholder="Имя пресета"
              className="flex-1 px-2 py-1 text-xs border border-indigo-500 rounded-lg bg-[color:var(--c0d0f1e)] text-white placeholder-gray-600 focus:outline-none"
            />
            <button onClick={() => savePresetMutation.mutate(savePresetName)} disabled={!savePresetName.trim()} className="text-xs text-indigo-400 hover:text-indigo-300">✓</button>
            <button onClick={() => setShowSavePreset(false)} className="text-xs text-gray-600 hover:text-white">✕</button>
          </div>
        ) : (
          <button
            onClick={() => setShowSavePreset(true)}
            className="text-xs text-gray-400 hover:text-white border border-[color:var(--c2d3148)] hover:border-[color:var(--c3d4168)] px-3 py-1.5 rounded-lg transition-colors"
          >
            💾 Сохранить
          </button>
        )}
      </div>

      {bundles.length === 0 && (
        <div className="text-center py-8 text-gray-600 text-sm">Комплектов пока нет — нажми + чтобы добавить</div>
      )}
      {bundles.map((b, i) => (
        <div key={i} className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-400">Комплект {i + 1}</span>
              {b.offer_id && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  оффер {b.offer_id}
                </span>
              )}
            </div>
            <button onClick={() => removeBundle(i)} className="text-gray-600 hover:text-red-400 text-sm">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* Qty */}
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Кол-во / формат</label>
              <div className="flex gap-1 flex-wrap mb-1">
                {QTY_PRESETS.map(q => (
                  <button
                    key={q}
                    onClick={() => updateBundle(i, 'qty', q)}
                    className={clsx(
                      'text-[10px] px-1.5 py-0.5 rounded border transition-colors',
                      b.qty === q
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'border-[color:var(--c2d3148)] text-gray-500 hover:border-[color:var(--c3d4168)]'
                    )}
                  >{q}</button>
                ))}
              </div>
              <input
                type="text"
                value={b.qty}
                onChange={e => updateBundle(i, 'qty', e.target.value)}
                className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="1"
              />
            </div>
            {/* Old price */}
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Цена Amazon (зачёркнутая)</label>
              <input
                type="text"
                value={b.old_price}
                onChange={e => updateBundle(i, 'old_price', e.target.value)}
                className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder={product?.source_price || '199.99'}
              />
            </div>
            {/* Price */}
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Цена продажи (€)</label>
              <input
                type="text"
                value={b.price}
                onChange={e => updateBundle(i, 'price', e.target.value)}
                className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="19.99"
              />
            </div>
            {/* Offer */}
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Оффер Keitaro</label>
              {ktOffers.length > 0 ? (
                <select
                  value={b.offer_id}
                  onChange={e => updateBundle(i, 'offer_id', e.target.value)}
                  className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— выбрать —</option>
                  {ktOffers.map(o => (
                    <option key={o.id} value={String(o.id)}>
                      #{o.id} {o.name || o.title || ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={b.offer_id}
                  onChange={e => updateBundle(i, 'offer_id', e.target.value)}
                  className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="313"
                />
              )}
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={addBundle}
        className="w-full py-2 border border-dashed border-[color:var(--c3d4168)] text-gray-500 hover:text-white hover:border-indigo-500 rounded-xl text-sm transition-colors"
      >
        + Комплект
      </button>

      {bundles.length > 0 && (
        <button
          onClick={save}
          disabled={saveMutation.isPending}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
        >
          {saveMutation.isPending ? 'Сохраняю…' : 'Сохранить'}
        </button>
      )}
    </div>
  );
}

/* ──────────── Галерея ──────────── */
function GalleryTab({ product, qc }) {
  const inputRef = useRef();
  const [uploading, setUploading] = useState(false);
  const images = Array.isArray(product?.images) ? product.images : [];

  const deleteMutation = useMutation({
    mutationFn: (imgUrl) => productsApi.update(product.id, {
      images: JSON.stringify(images.filter(i => i !== imgUrl))
    }),
    onSuccess: () => qc.invalidateQueries(['product', product.id]),
  });

  async function uploadImages(files) {
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach(f => form.append('images', f));
      const r = await fetch(`${API_BASE}/api/products/${product.id}/images`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
        body: form,
      });
      if (r.ok) {
        qc.invalidateQueries(['product', product.id]);
        qc.invalidateQueries(['products']);
      } else toast(await failText(r, 'Не удалось загрузить фото'));
    } catch { toast('Не удалось загрузить фото'); }
    setUploading(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    uploadImages(e.dataTransfer.files);
  }

  return (
    <div className="p-5 space-y-4">
      {/* Upload zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="border border-dashed border-[color:var(--c3d4168)] rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 transition-colors"
      >
        <span className="text-2xl mb-2">📁</span>
        <span className="text-sm text-gray-500">{uploading ? 'Загружаю…' : 'Перетащи или кликни для загрузки'}</span>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => uploadImages(e.target.files)} />
      </div>

      {/* Grid */}
      {images.length === 0 ? (
        <div className="text-center text-gray-600 text-sm py-4">Фото нет</div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {images.map((url, i) => (
            <div key={i} className="relative group aspect-square bg-[color:var(--c13162b)] rounded-lg overflow-hidden border border-[color:var(--c2d3148)]">
              <img
                src={url.startsWith('/uploads') ? `${API_BASE}${url}` : url}
                alt=""
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => deleteMutation.mutate(url)}
                className="absolute top-1 right-1 w-5 h-5 bg-red-600/80 rounded-full text-white text-xs items-center justify-center hidden group-hover:flex"
              >
                ✕
              </button>
              <div className="absolute bottom-1 left-1 text-[10px] text-white/60 bg-black/40 px-1 rounded">
                {i + 1}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────── Отзывы ──────────── */
function ReviewsTab({ product, qc }) {
  const [reviews, setReviews] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newReview, setNewReview] = useState({ author: '', rating: null, text: '' });

  useEffect(() => {
    fetch(`${API_BASE}/api/products/${product.id}/reviews`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
    })
      .then(r => r.ok ? r.json() : [])
      .then(d => setReviews(Array.isArray(d) ? d : []))
      .catch(() => setReviews([]));
  }, [product?.id]);

  async function addReview() {
    if (!newReview.text.trim()) return;
    try {
      const r = await fetch(`${API_BASE}/api/products/${product.id}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('token'),
        },
        body: JSON.stringify(newReview),
      });
      if (r.ok) {
        const d = await r.json();
        setReviews(prev => [...prev, d]);
        setNewReview({ author: '', rating: null, text: '' });
        setAdding(false);
        qc.invalidateQueries(['products']);
      } else toast(await failText(r, 'Не удалось добавить отзыв'));
    } catch { toast('Не удалось добавить отзыв'); }
  }

  async function deleteReview(id) {
    const r = await fetch(`${API_BASE}/api/products/${product.id}/reviews/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
    }).catch(() => null);
    if (!r?.ok) { toast(r ? await failText(r, 'Не удалось удалить отзыв') : 'Не удалось удалить отзыв'); return; }
    setReviews(prev => prev.filter(r => r.id !== id));
    qc.invalidateQueries(['products']);
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{reviews.length} отзывов</span>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try {
                const r = await fetch(`${API_BASE}/api/products/${product.id}/reviews/scrape`, {
                  method: 'POST',
                  headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') },
                });
                if (!r.ok) { toast(await failText(r, 'Не удалось загрузить отзывы')); return; }
                const d = await r.json();
                if (d.length) setReviews(prev => [...prev, ...d]);
              } catch { toast('Не удалось загрузить отзывы'); }
            }}
            className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 border border-emerald-600/30 rounded-lg"
          >
            ↓ Amazon
          </button>
          <button
            onClick={() => setAdding(v => !v)}
            className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 border border-indigo-600/30 rounded-lg"
          >
            + Добавить
          </button>
        </div>
      </div>

      {adding && (
        <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Автор</label>
              <input
                type="text"
                value={newReview.author}
                onChange={e => setNewReview(r => ({ ...r, author: e.target.value }))}
                placeholder="Marie D."
                className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 mb-1 block">Рейтинг</label>
              <select
                value={newReview.rating ?? ''}
                onChange={e => setNewReview(r => ({ ...r, rating: e.target.value ? Number(e.target.value) : null }))}
                className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
              >
                <option value="">без оценки</option>
                {[5,4,3,2,1].map(n => <option key={n} value={n}>{'⭐'.repeat(n)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 mb-1 block">Текст</label>
            <textarea
              value={newReview.text}
              onChange={e => setNewReview(r => ({ ...r, text: e.target.value }))}
              rows={3}
              placeholder="Очень доволен покупкой!"
              className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>
          <button
            onClick={addReview}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
          >
            Добавить отзыв
          </button>
        </div>
      )}

      {reviews.length === 0 && !adding && (
        <div className="text-center py-8 text-gray-600 text-sm">Отзывов пока нет</div>
      )}

      {reviews.map(rv => (
        <div key={rv.id} className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-4 group">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-medium text-white">{rv.author || 'Аноним'}</div>
              <div className="text-yellow-400 text-xs mt-0.5">{'⭐'.repeat(rv.rating || 5)}</div>
            </div>
            <button
              onClick={() => deleteReview(rv.id)}
              className="text-gray-600 hover:text-red-400 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-gray-300 mt-2 leading-relaxed">{rv.text}</p>
          {Array.isArray(rv.images) && rv.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {rv.images.slice(0, 4).map((img, i) => (
                <a key={i} href={img} target="_blank" rel="noopener noreferrer">
                  <img src={img} alt="" className="w-16 h-16 object-cover rounded-lg border border-[color:var(--c2d3148)] hover:opacity-80 transition-opacity" />
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
