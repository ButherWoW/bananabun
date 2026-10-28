import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { products as productsApi, scrape as scrapeApi, presets as presetsApi, keitaro as keitaroApi, folders as foldersApi } from '../api/client.js';
import ProductSidePanel, { NewProductPanel } from '../components/ProductSidePanel.jsx';
import GenerateCreativesModal from '../components/GenerateCreativesModal.jsx';
import clsx from 'clsx';

const PLATFORMS = [
  { name: 'Amazon', ready: true },
  { name: 'Walmart', ready: true },
  { name: 'Target' },
  { name: 'Best Buy' },
  { name: 'Etsy' },
];

const inputCls = 'w-full bg-[color:var(--c141829)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500';
const emptyBundle = () => ({ old_price: '', price: '', qty: '', offer_id: '' });

function NewBundlePresetForm({ onCancel, onSaved }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [rows, setRows] = useState([emptyBundle()]);

  const { data: offers = [], isError: offersError } = useQuery({
    queryKey: ['keitaro', 'offers'],
    queryFn: () => keitaroApi.offers(),
    retry: false,
    staleTime: 60000,
  });

  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () => presetsApi.saveBundle({
      name: name.trim(),
      currency,
      config: rows.map(r => ({
        old_price: r.old_price.trim(),
        price: r.price.trim(),
        currency,
        qty: r.qty.trim(),
        offer_id: r.offer_id ? Number(r.offer_id) : null,
      })),
    }),
    onSuccess: (preset) => {
      qc.invalidateQueries({ queryKey: ['presets', 'bundles'] });
      onSaved(preset);
    },
  });

  const setRow = (i, key, val) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  const valid = name.trim() && rows.length && rows.every(r => r.price.trim() && r.qty.trim() && r.offer_id);

  return (
    <div className="mt-2 bg-[color:var(--c0a0d1f)] border border-[color:var(--c2d3148)] rounded-xl p-4 flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_96px] gap-2">
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Имя пресета</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="1 / 2+1 · EUR" className={inputCls} autoFocus />
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Валюта</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls}>
            {['EUR', 'USD', 'GBP', 'PLN', 'CHF'].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 border-t border-[color:var(--c1e2540)] pt-3 first-of-type:border-0">
          <div className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 items-end">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Старая цена</label>
              <input value={r.old_price} onChange={e => setRow(i, 'old_price', e.target.value)} placeholder="нет скидки" className={inputCls} inputMode="decimal" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Новая цена</label>
              <input value={r.price} onChange={e => setRow(i, 'price', e.target.value)} placeholder="19.99" className={inputCls} inputMode="decimal" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Количество</label>
              <input value={r.qty} onChange={e => setRow(i, 'qty', e.target.value)} placeholder="3 или 2+1" className={inputCls} />
            </div>
            <button
              type="button"
              onClick={() => setRows(rs => rs.length === 1 ? [emptyBundle()] : rs.filter((_, idx) => idx !== i))}
              className="h-[38px] text-gray-600 hover:text-gray-300 bg-[color:var(--c1a1f3a)] border border-[color:var(--c2d3148)] rounded-lg"
            >×</button>
          </div>
          <select value={r.offer_id} onChange={e => setRow(i, 'offer_id', e.target.value)} className={inputCls}>
            <option value="">Выбрать оффер</option>
            {offers.map(o => <option key={o.id} value={o.id}>{o.id} · {o.name}</option>)}
          </select>
        </div>
      ))}
      {offersError && <div className="text-xs text-red-400">Не удалось загрузить офферы из Keitaro</div>}
      <div className="text-[11px] text-gray-600">Пустая старая цена у комплекта «1» заполнится реальной ценой с Amazon после скрапинга.</div>

      <button
        type="button"
        onClick={() => setRows(rs => [...rs, emptyBundle()])}
        className="w-full border border-dashed border-[color:var(--c2d3148)] hover:border-indigo-500/50 text-gray-500 hover:text-gray-300 text-sm py-2 rounded-lg transition-colors"
      >+ Комплект</button>

      {save.error && <div className="text-xs text-red-400">{save.error.error || save.error.message || 'Не удалось сохранить пресет'}</div>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Отмена</button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!valid || save.isPending}
          title={!valid ? 'Заполни имя, новую цену, количество и оффер в каждом комплекте' : ''}
          className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg"
        >{save.isPending ? 'Сохраняю…' : 'Сохранить пресет'}</button>
      </div>
    </div>
  );
}

function ScrapeModal({ onClose, onScrape, isPending, error }) {
  const [urls, setUrls] = useState(['']);
  const [bundlePresetId, setBundlePresetId] = useState('');
  const [creativePresetId, setCreativePresetId] = useState('');
  const [showNewBundle, setShowNewBundle] = useState(false);

  const { data: bundlePresets = [] } = useQuery({ queryKey: ['presets', 'bundles'], queryFn: presetsApi.bundles, retry: false });
  const { data: creativePresets = [] } = useQuery({ queryKey: ['presets', 'creatives'], queryFn: presetsApi.creativePresets, retry: false });
  const { data: engineInfo } = useQuery({ queryKey: ['scrape-engine'], queryFn: scrapeApi.engine, retry: false, staleTime: 60000 });
  const allPlatforms = engineInfo?.engine === 'fa';

  const addUrl = () => setUrls(u => [...u, '']);
  const removeUrl = (i) => setUrls(u => u.length === 1 ? [''] : u.filter((_, idx) => idx !== i));
  const setUrl = (i, val) => setUrls(u => u.map((v, idx) => idx === i ? val : v));

  const handleScrape = () => {
    const links = urls.map(u => u.trim()).filter(Boolean);
    if (!links.length) return;
    onScrape({ links, bundle_preset_id: bundlePresetId || undefined, creative_preset_id: creativePresetId || undefined });
  };

  const hasLink = urls.some(u => u.trim());
  const canSubmit = hasLink && !isPending;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[color:var(--c0e1221)] border border-[color:var(--c1e2540)] rounded-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-8">
          <h2 className="text-xl font-bold text-white uppercase tracking-wide mb-1">Соскрапить продукт по ссылке</h2>
          <p className="text-sm text-gray-400 mb-5">Вставь ссылку на сайт с товаром.</p>

          <div className="mb-5">
            <div className="text-xs text-gray-400 mb-2">Разбор работает с площадками:</div>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => {
                const ready = p.ready || allPlatforms;
                return (
                  <span
                    key={p.name}
                    title={ready ? '' : 'Скоро'}
                    className={clsx('text-sm bg-[color:var(--c1a1f3a)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-1', ready ? 'text-gray-300' : 'text-gray-600')}
                  >{p.name}{!ready && <span className="text-[10px] ml-1">скоро</span>}</span>
                );
              })}
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-xs text-gray-400 mb-2">Ссылки</label>
            <div className="flex flex-col gap-2">
              {urls.map((url, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-4 text-right flex-shrink-0">{i + 1}</span>
                  <input
                    type="text"
                    value={url}
                    onChange={e => setUrl(i, e.target.value)}
                    placeholder="https://..."
                    autoFocus={i === 0}
                    className="flex-1 bg-[color:var(--c141829)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <button
                    onClick={() => removeUrl(i)}
                    className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-300 bg-[color:var(--c1a1f3a)] border border-[color:var(--c2d3148)] rounded-lg transition-colors flex-shrink-0"
                  >×</button>
                </div>
              ))}
            </div>
            <button
              onClick={addUrl}
              className="mt-2 w-full border border-dashed border-[color:var(--c2d3148)] hover:border-indigo-500/50 text-gray-500 hover:text-gray-300 text-sm py-2.5 rounded-lg transition-colors"
            >+ Ещё ссылка</button>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400">Пресет комплектов</label>
              {!showNewBundle && (
                <button
                  type="button"
                  onClick={() => setShowNewBundle(true)}
                  className="text-xs text-gray-500 hover:text-gray-300 border border-dashed border-[color:var(--c2d3148)] hover:border-[color:var(--c3d4168)] px-2.5 py-1 rounded-lg transition-colors"
                >+ Новый пресет</button>
              )}
            </div>
            <select
              value={bundlePresetId}
              onChange={e => setBundlePresetId(e.target.value)}
              className="w-full bg-[color:var(--c141829)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none"
            >
              <option value="">— Без пресета —</option>
              {bundlePresets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {showNewBundle && (
              <NewBundlePresetForm
                onCancel={() => setShowNewBundle(false)}
                onSaved={(preset) => { setBundlePresetId(preset.id); setShowNewBundle(false); }}
              />
            )}
          </div>

          <div className="mb-7">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400">Пресет креативов</label>
              <button className="text-xs text-gray-500 hover:text-gray-300 border border-dashed border-[color:var(--c2d3148)] hover:border-[color:var(--c3d4168)] px-2.5 py-1 rounded-lg transition-colors">+ Новый пресет</button>
            </div>
            <select
              value={creativePresetId}
              onChange={e => setCreativePresetId(e.target.value)}
              className="w-full bg-[color:var(--c141829)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none"
            >
              <option value="">— Без пресета —</option>
              {creativePresets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {error && (
            <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error.error || error.message || 'Ошибка скрапинга'}</div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button onClick={onClose} className="px-5 py-2.5 text-sm text-gray-400 hover:text-white bg-[color:var(--c1a1f3a)] hover:bg-[color:var(--c222847)] border border-[color:var(--c2d3148)] rounded-xl transition-colors">
              Отмена
            </button>
            <button
              onClick={handleScrape}
              disabled={!canSubmit}
              title={!hasLink ? 'Вставь ссылку на товар' : ''}
              className="px-6 py-2.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-xl transition-colors"
            >
              {isPending ? 'Скрапим...' : 'Соскрапить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const { folderId } = useParams();
  const targetFolder = folderId && folderId !== 'none' ? folderId : undefined;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selected, setSelected] = useState([]);
  const [activeProduct, setActiveProduct] = useState(null);
  const [initialTab, setInitialTab] = useState('Карточка');
  const [showScrape, setShowScrape] = useState(false);
  const [search, setSearch] = useState('');
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState('new');
  const [shown, setShown] = useState(24);
  const [showNew, setShowNew] = useState(false);
  const [creativesFor, setCreativesFor] = useState(null);
  const { data: folderList = [] } = useQuery({ queryKey: ['folders'], queryFn: foldersApi.list });

  const { data, isLoading } = useQuery({
    queryKey: ['products', folderId, search, sortOrder, shown],
    queryFn: () => productsApi.list({ folder_id: folderId, limit: shown, sort: sortOrder, search: search || undefined }),
    placeholderData: (prev) => prev,
    refetchInterval: (query) => {
      const items = query.state.data?.items || [];
      const hasProcessing = items.some(p => p.scrape_status === 'processing' || p.scrape_status === 'pending');
      return hasProcessing ? 3000 : false;
    },
  });

  const scrapeMutation = useMutation({
    meta: { inlineError: true },
    mutationFn: ({ links, bundle_preset_id, creative_preset_id }) =>
      scrapeApi.bulk({ links, folder_id: targetFolder, bundle_preset_id, creative_preset_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['folders'] });
      setShowScrape(false);
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id) => scrapeApi.retry(id),
    onSettled: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => productsApi.remove(ids),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['folders'] }); setSelected([]); },
  });

  const bulkEditMutation = useMutation({
    mutationFn: ({ ids, updates }) => productsApi.bulkEdit(ids, updates),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['folders'] }); setBulkEditOpen(false); setSelected([]); },
  });

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const items = data?.items || [];
  const total = data?.total || 0;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[color:var(--c1e2240)]">
        <h1 className="text-base font-semibold text-white flex items-center gap-1.5 mr-2">
          {folderId === 'none' ? 'Без папки' : folderId ? (folderList.find(f => f.id === folderId)?.name || 'Папка') : 'Все товары'}
          <span className="text-sm">👑</span>
        </h1>

        {/* Search */}
        <div className="flex-1 max-w-xs relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск"
            className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value)}
          className="bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-400 text-sm px-3 py-1.5 rounded-lg focus:outline-none"
        >
          <option value="new">Сначала новые</option>
          <option value="old">Сначала старые</option>
          <option value="name">По названию</option>
        </select>

        <div className="flex-1" />

        {selected.length > 0 && (
          <>
            <button
              onClick={() => setSelected(items.map(i => i.id))}
              className="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg border border-[color:var(--c2d3148)] hover:border-[color:var(--c3d4168)] transition-colors"
            >
              Выбрать все
            </button>
            <button
              onClick={() => setBulkEditOpen(true)}
              className="px-3 py-1.5 text-xs bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 rounded-lg transition-colors"
            >✏️ Изменить</button>
            <button
              onClick={() => { if (window.confirm(`Удалить товаров: ${selected.length}? Это нельзя отменить.`)) deleteMutation.mutate(selected); }}
              disabled={deleteMutation.isPending}
              className="bg-red-700/80 hover:bg-red-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
            >
              Удалить {selected.length}
            </button>
          </>
        )}

        <button
          onClick={() => setShowNew(true)}
          className="bg-[color:var(--c1e2240)] hover:bg-[color:var(--c2d3148)] text-gray-300 text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
        >
          Создать вручную
        </button>
        <button
          onClick={() => setShowScrape(!showScrape)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
        >
          Скрапить
        </button>
      </div>

      {showScrape && (
        <ScrapeModal
          onClose={() => { setShowScrape(false); scrapeMutation.reset(); }}
          onScrape={(data) => scrapeMutation.mutate(data)}
          isPending={scrapeMutation.isPending}
          error={scrapeMutation.error}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="text-center text-gray-500 py-20">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="text-center text-gray-500 py-20">
            <div className="text-4xl mb-3">📦</div>
            <div className="text-sm">Связок пока нет</div>
            <div className="text-xs mt-1 text-gray-600">Нажми «Соскрапить» чтобы добавить товары</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                selected={selected.includes(product.id)}
                onToggle={() => toggleSelect(product.id)}
                onDelete={() => { if (window.confirm(`Удалить товар «${(product.title || '').slice(0, 60)}»?`)) deleteMutation.mutate([product.id]); }}
                onCreatives={() => setCreativesFor(product.id)}
                onRetry={() => retryMutation.mutate(product.id)}
                retrying={retryMutation.isPending && retryMutation.variables === product.id}
                onOpen={(tab = 'Карточка') => { setActiveProduct(product); setInitialTab(tab); }}
              />
            ))}
          </div>
        )}
        {items.length < total && (
          <div className="flex justify-center py-4">
            <button
              onClick={() => setShown(n => n + 24)}
              className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-lg border border-[color:var(--c2d3148)] hover:border-[color:var(--c3d4168)]"
            >
              Показать ещё {Math.min(24, total - items.length)} из {total - items.length}
            </button>
          </div>
        )}
      </div>
      {activeProduct && (
        <ProductSidePanel
          product={activeProduct}
          onClose={() => setActiveProduct(null)}
          initialTab={initialTab}
        />
      )}
      {creativesFor && (
        <GenerateCreativesModal
          productId={creativesFor}
          onClose={() => setCreativesFor(null)}
          onDone={() => navigate(`/creatives?product_id=${creativesFor}`)}
        />
      )}
      {showNew && (
        <NewProductPanel
          folderId={targetFolder}
          onClose={() => setShowNew(false)}
          onCreated={(product) => { setShowNew(false); setActiveProduct(product); setInitialTab('Комплекты'); }}
        />
      )}
      {bulkEditOpen && (
        <BulkEditModal
          count={selected.length}
          onClose={() => setBulkEditOpen(false)}
          onApply={(updates) => bulkEditMutation.mutate({ ids: selected, updates })}
          isPending={bulkEditMutation.isPending}
        />
      )}
    </div>
  );
}

function BulkEditModal({ count, onClose, onApply, isPending }) {
  const [status, setStatus] = useState('');
  const [tags, setTags] = useState('');

  const handleApply = () => {
    const updates = {};
    if (status) updates.status = status;
    if (tags.trim()) updates.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (!Object.keys(updates).length) return;
    onApply(updates);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[color:var(--c0e1221)] border border-[color:var(--c1e2540)] rounded-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Массовое редактирование</h3>
          <span className="text-[10px] text-gray-500">{count} товаров</span>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Статус (пусто = не менять)</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-full bg-[color:var(--c141829)] border border-[color:var(--c1e2540)] text-white text-xs px-3 py-2 rounded"
            >
              <option value="">— не менять —</option>
              <option value="ready">ready</option>
              <option value="draft">draft</option>
              <option value="no_offer">no_offer</option>
              <option value="archived">archived</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Теги через запятую (пусто = не менять)</label>
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="cdiscount, winner, fr"
              className="w-full bg-[color:var(--c141829)] border border-[color:var(--c1e2540)] text-white text-xs px-3 py-2 rounded placeholder-gray-600"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 text-xs text-gray-500 hover:text-gray-300 border border-[color:var(--c1e2540)] rounded transition-colors">
            Отмена
          </button>
          <button
            onClick={handleApply}
            disabled={isPending || (!status && !tags.trim())}
            className="flex-1 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded transition-colors"
          >
            {isPending ? 'Сохранение...' : 'Применить'}
          </button>
        </div>
      </div>
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_URL || '';

function resolveImage(url) {
  if (!url) return null;
  if (url.startsWith('/uploads')) return `${API_BASE}${url}`;
  return url;
}

function getProductState(product) {
  if (product.scrape_status !== 'done') return 'draft';
  try {
    const bundles = product.bundle_config
      ? (typeof product.bundle_config === 'string' ? JSON.parse(product.bundle_config) : product.bundle_config)
      : [];
    if (Array.isArray(bundles) && bundles.length > 0) return 'ready';
  } catch { /* ignore */ }
  return 'no_offer';
}

const STATE_CONFIG = {
  ready:    { label: 'ready',    bg: 'rgba(34,197,94,0.15)',  border: '#22c55e50', color: '#22c55e' },
  no_offer: { label: 'no offer', bg: 'rgba(239,68,68,0.12)',  border: '#ef444450', color: '#ef4444' },
  draft:    { label: 'draft',    bg: 'rgba(107,114,128,0.15)', border: '#6b728050', color: '#9ca3af' },
};

function ProductCard({ product, selected, onToggle, onDelete, onCreatives, onOpen, onRetry, retrying }) {
  let images = [];
  try {
    if (Array.isArray(product.images)) images = product.images;
    else images = product.images ? JSON.parse(product.images) : [];
  } catch { images = []; }

  const scrapeOk = product.scrape_status === 'done';
  const statusColor = { done: '#22c55e', processing: '#f59e0b', failed: '#ef4444', pending: '#6b7280' }[product.scrape_status] || '#6b7280';
  const state = getProductState(product);
  const stateConf = STATE_CONFIG[state];

  const date = product.created_at ? new Date(product.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '';

  return (
    <div
      onClick={() => onOpen()}
      className={clsx(
        'bg-[color:var(--c13162b)] border rounded-xl overflow-hidden cursor-pointer transition-all hover:border-[color:var(--c4a5080)] group',
        selected ? 'border-indigo-500 ring-1 ring-indigo-500/50' : 'border-[color:var(--c1e2240)]'
      )}
    >
      {/* Image */}
      <div className="aspect-square bg-[color:var(--c0d0f1e)] relative overflow-hidden">
        {images[0] ? (
          <img src={resolveImage(images[0])} alt="" className="w-full h-full object-contain p-2" />
        ) : product.scrape_status === 'processing' || product.scrape_status === 'pending' ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] text-yellow-500 animate-pulse">Скрапим...</span>
          </div>
        ) : product.scrape_status === 'failed' ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-3 text-center">
            <span className="text-xs font-semibold text-red-400">Ошибка скрапинга</span>
            {product.scrape_error && <span className="text-[10px] text-gray-500 leading-snug line-clamp-3">{product.scrape_error}</span>}
            <button
              onClick={e => { e.stopPropagation(); onRetry(); }}
              disabled={retrying}
              className="text-xs px-3 py-1 rounded-lg bg-[color:var(--c1e2240)] hover:bg-indigo-600 text-gray-300 hover:text-white disabled:opacity-50"
            >{retrying ? '...' : 'Ещё раз'}</button>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700 text-3xl">📷</div>
        )}
        {/* Select checkbox */}
        <button
          onClick={e => { e.stopPropagation(); onToggle(); }}
          className={clsx(
            'absolute top-2 left-2 w-5 h-5 rounded border transition-all',
            selected
              ? 'bg-indigo-600 border-indigo-600 flex items-center justify-center text-white text-xs'
              : 'border-white/20 bg-black/30 hidden group-hover:flex'
          )}
        >
          {selected && '✓'}
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="absolute top-2 right-2 w-5 h-5 bg-red-700/80 rounded-full items-center justify-center text-white text-xs hidden group-hover:flex transition-all"
        >✕</button>
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: statusColor }} />
        </div>
        {date && (
          <div className="absolute bottom-1.5 right-2 text-[10px] text-gray-500">{date}</div>
        )}
        {/* State badge */}
        <div
          className="absolute bottom-1.5 left-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-md"
          style={{ background: stateConf.bg, border: `1px solid ${stateConf.border}`, color: stateConf.color }}
        >
          {stateConf.label}
        </div>
      </div>

      {/* Title */}
      <div className="px-2.5 pt-2 pb-1.5">
        <div className="text-xs text-gray-200 leading-tight line-clamp-2 min-h-[2.5rem]">
          {product.title || product.source_id}
        </div>
      </div>

      {/* Офферы row */}
      <div className="px-2.5 pb-1.5 flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-gray-500">Офферы:</span>
        <Tag label="+ Оффер" active={scrapeOk} onClick={e => { e.stopPropagation(); onOpen('Комплекты'); }} />
      </div>

      {/* Content tags */}
      <div className="px-2.5 pb-1.5 flex flex-wrap gap-1">
        <Tag label="+ Комплекты" active={scrapeOk} onClick={e => { e.stopPropagation(); onOpen('Комплекты'); }} />
        <Tag label="Заголовок" active={!!product.title} onClick={e => { e.stopPropagation(); onOpen('Карточка'); }} />
        <Tag label="Описание" active={!!product.description} onClick={e => { e.stopPropagation(); onOpen('Карточка'); }} />
        <Tag label="Характеристики" active={scrapeOk} onClick={e => { e.stopPropagation(); onOpen('Карточка'); }} />
        {product.images_count > 0
          ? <Tag label={`Фото ${product.images_count}`} active onClick={e => { e.stopPropagation(); onOpen('Галерея'); }} />
          : <Tag label="Фото 0" active={false} onClick={e => { e.stopPropagation(); onOpen('Галерея'); }} />
        }
        {product.reviews_count > 0
          ? <Tag label={`Отзывы ${product.reviews_count}`} active onClick={e => { e.stopPropagation(); onOpen('Отзывы'); }} />
          : <Tag label="Отзывы 0" active={false} onClick={e => { e.stopPropagation(); onOpen('Отзывы'); }} />
        }
      </div>

      {/* Bottom: URL + Креативы */}
      <div className="px-2.5 pb-2.5 flex items-center justify-between gap-2 mt-0.5">
        {product.source_url ? (
          <span className="text-[10px] text-gray-600 truncate flex-1 max-w-[120px]" title={product.source_url}>
            {product.source_url.replace('https://www.', '').replace('https://', '').slice(0, 30)}
          </span>
        ) : <span />}
        <button
          onClick={e => { e.stopPropagation(); onCreatives(); }}
          className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 hover:text-indigo-200 transition-colors border border-indigo-600/30"
        >
          🎨 Креативы
        </button>
      </div>
    </div>
  );
}

function Tag({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'text-[10px] px-1.5 py-0.5 rounded-md border font-medium transition-colors',
        active
          ? 'border-indigo-500/40 text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 hover:border-indigo-400/60'
          : 'border-[color:var(--c2d3148)] text-gray-600 bg-transparent hover:border-[color:var(--c3d4168)] hover:text-gray-400'
      )}
    >
      {label}
    </button>
  );
}
