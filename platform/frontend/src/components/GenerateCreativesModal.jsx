import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { products as productsApi, creatives as creativesApi } from '../api/client.js';
import clsx from 'clsx';
import Hint from './Hint.jsx';

const STYLES = [
  { key: 'clean', label: 'Чистый', desc: 'Белый фон, минимализм' },
  { key: 'dark', label: 'Тёмный', desc: 'Тёмный фон, золотые акценты' },
  { key: 'gradient', label: 'Градиент', desc: 'Фиолетовый градиент' },
  { key: 'bold', label: 'Дерзкий', desc: 'Красный фон, яркий' },
  { key: 'minimal', label: 'Минимал', desc: 'Серый фон, синие акценты' },
];

const LANGUAGES = [
  { code: 'fr', flag: '🇫🇷', label: 'Французский' },
  { code: 'es', flag: '🇪🇸', label: 'Испанский' },
  { code: 'en', flag: '🇬🇧', label: 'Английский' },
  { code: 'de', flag: '🇩🇪', label: 'Немецкий' },
  { code: 'pt', flag: '🇵🇹', label: 'Португальский' },
];

const FORMATS = [
  { key: '1x1', label: '1:1', desc: 'Квадрат (Лента)' },
  { key: '4x5', label: '4:5', desc: 'Портрет (Лента)' },
  { key: '9x16', label: '9:16', desc: 'Сторис' },
];

export default function GenerateCreativesModal({ productId, onClose, onDone }) {
  const qc = useQueryClient();

  const [form, setForm] = useState({
    product_id: productId || '',
    language: 'fr',
    landing_price: '',
    styles: ['clean', 'dark', 'gradient'],
    format: '1x1',
  });

  const { data: productList = [] } = useQuery({
    queryKey: ['products-for-creatives'],
    queryFn: () => productsApi.list({ limit: 100, scrape_status: 'done' }),
    select: d => d.items || d,
    enabled: !productId,
  });

  const generate = useMutation({
    mutationFn: (data) => creativesApi.generate(data),
    onSuccess: () => {
      qc.invalidateQueries(['creatives']);
      onDone?.();
      onClose();
    },
  });

  function toggleStyle(key) {
    setForm(f => ({
      ...f,
      styles: f.styles.includes(key)
        ? f.styles.filter(s => s !== key)
        : [...f.styles, key],
    }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.product_id) return;
    generate.mutate({
      ...form,
      landing_price: form.landing_price ? parseFloat(form.landing_price) : undefined,
      count: form.styles.length,
    });
  }

  const { data: fixedProduct } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => productsApi.get(productId),
    enabled: !!productId,
  });
  const selectedProduct = productId ? fixedProduct : productList.find(p => p.id === form.product_id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[color:var(--c2d3148)]">
          <div>
            <h2 className="text-white font-semibold">Генерация креативов</h2>
            <p className="text-xs text-gray-500 mt-0.5">Создаёт изображения через HTML-шаблоны</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {/* Product */}
          {!productId && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Товар</label>
              <select
                value={form.product_id}
                onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}
                className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                required
              >
                <option value="">Выбрать товар...</option>
                {productList.map(p => (
                  <option key={p.id} value={p.id}>{p.title || p.name}</option>
                ))}
              </select>
            </div>
          )}

          {(selectedProduct || productId) && (
            <div className="bg-[color:var(--c0f1117)] rounded-lg px-3 py-2.5 text-sm">
              <span className="text-gray-400">Цена Amazon: </span>
              <span className="text-white font-mono">
                {selectedProduct?.source_price ? `${selectedProduct.source_price} €` : '—'}
              </span>
              <span className="text-xs text-gray-600 ml-2">(будет зачёркнута)</span>
            </div>
          )}

          {/* Landing price */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Цена на лендинге (€)<Hint k="gcm.landingPrice" /></label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.landing_price}
              onChange={e => setForm(f => ({ ...f, landing_price: e.target.value }))}
              placeholder="19.99"
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Language */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Язык<Hint k="gcm.language" /></label>
            <div className="flex gap-2 flex-wrap">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, language: lang.code }))}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors border',
                    form.language === lang.code
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                      : 'bg-[color:var(--c0f1117)] border-[color:var(--c2d3148)] text-gray-400 hover:text-white'
                  )}
                >
                  <span>{lang.flag}</span>
                  <span>{lang.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Формат<Hint k="gcm.format" /></label>
            <div className="flex gap-2">
              {FORMATS.map(fmt => (
                <button
                  key={fmt.key}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, format: fmt.key }))}
                  className={clsx(
                    'flex-1 py-2 rounded-lg text-sm transition-colors border',
                    form.format === fmt.key
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                      : 'bg-[color:var(--c0f1117)] border-[color:var(--c2d3148)] text-gray-400 hover:text-white'
                  )}
                >
                  <div className="font-semibold">{fmt.label}</div>
                  <div className="text-xs opacity-70">{fmt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Styles */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              Стили <span className="text-gray-600">({form.styles.length} выбрано)</span><Hint k="gcm.styles" />
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {STYLES.map(style => (
                <button
                  key={style.key}
                  type="button"
                  onClick={() => toggleStyle(style.key)}
                  className={clsx(
                    'flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors border text-left',
                    form.styles.includes(style.key)
                      ? 'bg-indigo-600/20 border-indigo-500'
                      : 'bg-[color:var(--c0f1117)] border-[color:var(--c2d3148)] hover:border-[color:var(--c3d4168)]'
                  )}
                >
                  <div>
                    <span className={form.styles.includes(style.key) ? 'text-indigo-300 font-medium' : 'text-gray-300'}>
                      {style.label}
                    </span>
                    <span className="text-xs text-gray-500 ml-2">{style.desc}</span>
                  </div>
                  {form.styles.includes(style.key) && <span className="text-indigo-400 text-xs">✓</span>}
                </button>
              ))}
            </div>
          </div>

          {generate.error && (
            <div className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">
              {generate.error?.error || 'Ошибка генерации'}
            </div>
          )}

          <button
            type="submit"
            disabled={!form.product_id || !form.styles.length || generate.isPending}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/40 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
          >
            {generate.isPending
              ? `Генерирую ${form.styles.length} креатив(ов)…`
              : `Сгенерировать ${form.styles.length} креатив(ов)`}
          </button>
        </form>
      </div>
    </div>
  );
}
