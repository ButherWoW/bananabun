import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { products as productsApi, creatives as creativesApi, presets as presetsApi, keitaro as keitaroApi } from '../api/client.js';
import clsx from 'clsx';

const LANGUAGES = [
  { code: 'fr', label: 'Французский', flag: '🇫🇷' },
  { code: 'en', label: 'Английский', flag: '🇬🇧' },
  { code: 'es', label: 'Испанский', flag: '🇪🇸' },
  { code: 'de', label: 'Немецкий', flag: '🇩🇪' },
  { code: 'pt', label: 'Португальский', flag: '🇵🇹' },
  { code: 'it', label: 'Итальянский', flag: '🇮🇹' },
  { code: 'nl', label: 'Нидерландский', flag: '🇳🇱' },
];

const FORMATS = ['1:1', '3:2', '2:3'];
const COUNTS = [1, 2, 4, 8, 10];
const STATUS_COLOR = { done: 'text-green-400', processing: 'text-yellow-400', failed: 'text-red-400', pending: 'text-gray-400' };
const STATUS_LABEL = { done: 'Готов', processing: 'Генерация…', failed: 'Ошибка', pending: 'Ожидание' };

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function CreativesPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const productIdFilter = searchParams.get('product_id') || '';

  // Generation form state
  const [idea, setIdea] = useState('');
  const [language, setLanguage] = useState('fr');
  const [format, setFormat] = useState('1:1');
  const [count, setCount] = useState(1);
  const [diversify, setDiversify] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [references, setReferences] = useState([]); // max 4
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showFmtMenu, setShowFmtMenu] = useState(false);
  const [showCountMenu, setShowCountMenu] = useState(false);
  const [showLandingMenu, setShowLandingMenu] = useState(false);
  const [landingTemplateId, setLandingTemplateId] = useState('');
  const [landing, setLanding] = useState('Лендинг');

  // List state
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [kindFilter, setKindFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [preview, setPreview] = useState(null);

  const refFileRef = useRef();
  const logoFileRef = useRef();
  const [showPresetSave, setShowPresetSave] = useState(false);
  const [presetName, setPresetName] = useState('');

  // Keitaro landing templates
  const { data: landingTemplatesList = [] } = useQuery({
    queryKey: ['keitaro', 'landings'],
    queryFn: keitaroApi.landings,
    staleTime: 300000,
    select: d => Array.isArray(d) ? d : [],
  });

  // Load creative presets
  const { data: creativePresets = [], refetch: refetchPresets } = useQuery({
    queryKey: ['presets', 'creatives'],
    queryFn: presetsApi.creativePresets,
    select: d => d?.items || d || [],
  });

  const [savedLogoKey, setSavedLogoKey] = useState(null);

  const savePresetMutation = useMutation({
    mutationFn: async (name) => {
      let logo_key = savedLogoKey;
      if (logoFile) {
        const fd = new FormData();
        fd.append('file', logoFile);
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/api/creatives/upload-logo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (res.ok) { const d = await res.json(); logo_key = d.key; }
      }
      return presetsApi.saveCreativePreset({ name, params: { idea, language, format, count: String(count), diversify, logo_key, landing_template_id: landingTemplateId || undefined } });
    },
    onSuccess: () => { refetchPresets(); setShowPresetSave(false); setPresetName(''); },
  });

  function loadPreset(preset) {
    let p = preset.params || preset.template || {};
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
    if (p.idea !== undefined) setIdea(p.idea);
    if (p.language) setLanguage(p.language);
    if (p.format) setFormat(p.format);
    if (p.count) setCount(Number(p.count));
    if (p.diversify !== undefined) setDiversify(Boolean(p.diversify));
    if (p.logo_key) {
      setSavedLogoKey(p.logo_key);
      setLogoPreview(`${API_BASE}${p.logo_key}`);
      setLogoFile(null);
    }
    if (p.landing_template_id) {
      setLandingTemplateId(p.landing_template_id);
      const tpl = landingTemplatesList.find(t => String(t.id) === String(p.landing_template_id));
      if (tpl) setLanding(tpl.name || tpl.title || String(tpl.id));
    }
  }

  // Load product list for selector
  const { data: productList = [] } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => productsApi.list({ limit: 200 }),
    select: d => d.items || [],
  });

  const selectedProduct = productList.find(p => p.id === productIdFilter);

  const { data: allCreatives = [], isLoading } = useQuery({
    queryKey: ['creatives', productIdFilter],
    queryFn: () => creativesApi.list(productIdFilter ? { product_id: productIdFilter } : {}),
    refetchInterval: (query) => {
      const rows = query?.state?.data;
      return Array.isArray(rows) && rows.some(c => c.status === 'processing') ? 3000 : false;
    },
  });

  const { data: spendData } = useQuery({
    queryKey: ['creatives', 'spend'],
    queryFn: creativesApi.spend,
    staleTime: 300000,
  });

  // Filter + sort
  const filtered = allCreatives
    .filter(c => !search || (c.format || '').includes(search) || (c.metadata?.language || '').includes(search))
    .filter(c => !onlyFavorites || c.favorite)
    .filter(c => !kindFilter || (c.type || c.kind || c.metadata?.kind || 'image') === kindFilter)
    .sort((a, b) => sort === 'newest'
      ? new Date(b.created_at) - new Date(a.created_at)
      : new Date(a.created_at) - new Date(b.created_at)
    );

  const favoritesCount = allCreatives.filter(c => c.favorite).length;

  const done = allCreatives.filter(c => c.status === 'done');
  const processing = allCreatives.filter(c => c.status === 'processing');

  const generateMutation = useMutation({
    meta: { inlineError: true },
    mutationFn: (data) => creativesApi.generate(data),
    onSuccess: () => qc.invalidateQueries(['creatives']),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => creativesApi.remove(ids),
    onSuccess: () => { qc.invalidateQueries(['creatives']); setSelected(new Set()); },
  });

  const favoriteMutation = useMutation({
    mutationFn: (id) => creativesApi.toggleFavorite(id),
    onSuccess: () => qc.invalidateQueries(['creatives']),
  });

  const retryMutation = useMutation({
    mutationFn: (id) => creativesApi.retry(id),
    onSuccess: () => qc.invalidateQueries(['creatives']),
  });

  async function handleGenerate() {
    if (!productIdFilter) return;
    let logo_key;
    if (logoFile) {
      const fd = new FormData();
      fd.append('file', logoFile);
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/creatives/upload-logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.ok) {
        const data = await res.json();
        logo_key = data.key;
      }
    }
    const reference_keys = [];
    for (const r of references) {
      const fd = new FormData();
      fd.append('file', r.file);
      const res = await fetch(`${API_BASE}/api/creatives/upload-reference`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: fd,
      });
      if (res.ok) reference_keys.push((await res.json()).key);
    }
    generateMutation.mutate({
      source: 'local',
      product_id: productIdFilter,
      language,
      format: format.replace(':', 'x'),
      count,
      idea: idea.trim() || undefined,
      diversify,
      logo_key,
      landing_template_id: landingTemplateId || undefined,
      reference_keys: reference_keys.length ? reference_keys : undefined,
    });
  }

  function handleReset() {
    setIdea('');
    setLanguage('fr');
    setFormat('1:1');
    setCount(1);
    setDiversify(false);
    setLogoFile(null);
    setLogoPreview(null);
    setSavedLogoKey(null);
    setLandingTemplateId('');
    setLanding('Лендинг');
    setReferences([]);
  }

  function handleLogoChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  }

  function handleRefChange(e) {
    const files = Array.from(e.target.files || []);
    const remaining = 4 - references.length;
    const toAdd = files.slice(0, remaining).map(f => ({ file: f, url: URL.createObjectURL(f) }));
    setReferences(prev => [...prev, ...toAdd]);
  }

  function removeRef(i) {
    setReferences(prev => prev.filter((_, idx) => idx !== i));
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function selectAll() {
    setSelected(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(c => c.id)));
  }

  const langObj = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Product selector bar (if no product_id) */}
      {!productIdFilter && (
        <div className="flex items-center gap-3 px-6 py-3 border-b border-[color:var(--c1e2240)] bg-[color:var(--c0d0f1e)]">
          <span className="text-sm text-gray-400">Связка:</span>
          <select
            value={productIdFilter}
            onChange={e => setSearchParams(e.target.value ? { product_id: e.target.value } : {})}
            className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] text-white text-sm px-3 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500 max-w-xs"
          >
            <option value="">— выбери товар —</option>
            {productList.map(p => (
              <option key={p.id} value={p.id}>{p.title || p.source_id}</option>
            ))}
          </select>
        </div>
      )}

      {/* Generation panel */}
      <div className="border-b border-[color:var(--c1e2240)] bg-[color:var(--c0d0f1e)] flex-shrink-0">
        {/* Header with product name */}
        {selectedProduct && (
          <div className="px-6 pt-3 pb-1 flex items-center gap-2">
            <button
              onClick={() => setSearchParams({})}
              className="text-gray-500 hover:text-white text-sm transition-colors"
            >
              ←
            </button>
            <span className="text-sm text-gray-300 truncate max-w-md">{selectedProduct.title || selectedProduct.source_id}</span>
          </div>
        )}

        <p className="px-4 pt-3 text-xs text-gray-400">Собственные шаблоны: фото товара, язык, формат и референсы. Идея, логотип и выбранный лендинг пока не влияют на результат.</p>
        {/* Idea textarea */}
        <div className="px-4 pt-3">
          <textarea
            value={idea}
            onChange={e => setIdea(e.target.value)}
            placeholder="Идея креатива: композиция, тон, акцент"
            rows={3}
            maxLength={200}
            className="w-full bg-transparent text-white text-sm placeholder-gray-600 focus:outline-none resize-none leading-relaxed"
          />
          {idea.length > 0 && (
            <div className={`text-right text-[10px] -mt-1 ${idea.length > 180 ? 'text-red-400' : 'text-gray-600'}`}>
              {idea.length}/200
            </div>
          )}
        </div>

        {/* Logo row */}
        <div className="px-4 pb-2 flex items-center gap-3">
          <span className="text-xs text-gray-500">Логотип</span>
          <button
            onClick={() => logoFileRef.current?.click()}
            className="w-28 h-28 border border-dashed border-[color:var(--c3d4168)] rounded-xl flex items-center justify-center hover:border-indigo-500 transition-colors overflow-hidden flex-shrink-0"
          >
            {logoPreview
              ? <img src={logoPreview} className="w-full h-full object-contain p-1" alt="" />
              : <svg className="w-8 h-8 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="1.5"/><circle cx="8.5" cy="8.5" r="1.5" strokeWidth="1.5"/><path d="M21 15l-5-5L5 21" strokeWidth="1.5"/></svg>
            }
          </button>
          <input ref={logoFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleLogoChange} />
          {logoPreview && (
            <button onClick={() => { setLogoFile(null); setLogoPreview(null); setSavedLogoKey(null); }} className="text-xs text-gray-600 hover:text-red-400">✕</button>
          )}
        </div>

        {/* Toolbar */}
        <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
          {/* References */}
          <div className="relative">
            <button
              onClick={() => references.length < 4 && refFileRef.current?.click()}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors',
                references.length > 0
                  ? 'border-indigo-500 text-indigo-300 bg-indigo-600/10'
                  : 'border-[color:var(--c2d3148)] text-gray-400 hover:text-white hover:border-[color:var(--c3d4168)]'
              )}
            >
              <span>📎</span>
              <span>Референсы {references.length}/4</span>
            </button>
            <input
              ref={refFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={handleRefChange}
            />
            {references.length > 0 && (
              <div className="absolute top-full left-0 mt-1 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-2 flex gap-1.5 z-20">
                {references.map((r, i) => (
                  <div key={i} className="relative group">
                    <img src={r.url} className="w-12 h-12 object-cover rounded-lg" alt="" />
                    <button
                      onClick={() => removeRef(i)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-white text-[10px] items-center justify-center hidden group-hover:flex"
                    >✕</button>
                  </div>
                ))}
                {references.length < 4 && (
                  <button
                    onClick={() => refFileRef.current?.click()}
                    className="w-12 h-12 border border-dashed border-[color:var(--c3d4168)] rounded-lg flex items-center justify-center text-gray-600 hover:border-indigo-500 text-xl"
                  >+</button>
                )}
              </div>
            )}
          </div>

          {/* Language */}
          <div className="relative">
            <button
              onClick={() => { setShowLangMenu(v => !v); setShowFmtMenu(false); setShowCountMenu(false); setShowLandingMenu(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-[color:var(--c2d3148)] text-gray-300 hover:text-white hover:border-[color:var(--c3d4168)] transition-colors font-medium"
            >
              {langObj.flag} {langObj.label}
            </button>
            {showLangMenu && (
              <div className="absolute top-full left-0 mt-1 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden z-20 min-w-[150px] shadow-xl">
                {LANGUAGES.map(l => (
                  <button
                    key={l.code}
                    onClick={() => { setLanguage(l.code); setShowLangMenu(false); }}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[color:var(--c1e2240)] transition-colors text-left',
                      language === l.code ? 'text-indigo-300' : 'text-gray-300'
                    )}
                  >
                    <span>{l.flag}</span> {l.label}
                    {language === l.code && <span className="ml-auto text-indigo-400">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Landing */}
          <div className="relative">
            <button
              onClick={() => { setShowLandingMenu(v => !v); setShowLangMenu(false); setShowFmtMenu(false); setShowCountMenu(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-[color:var(--c2d3148)] text-gray-300 hover:text-white hover:border-[color:var(--c3d4168)] transition-colors"
            >
              <span>📋</span> {landing}
            </button>
            {showLandingMenu && (
              <div className="absolute top-full left-0 mt-1 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden z-20 min-w-[200px] shadow-xl max-h-56 overflow-y-auto">
                <button
                  onClick={() => { setLandingTemplateId(''); setLanding('Лендинг'); setShowLandingMenu(false); }}
                  className={clsx('w-full px-3 py-2 text-xs hover:bg-[color:var(--c1e2240)] transition-colors text-left', !landingTemplateId ? 'text-indigo-300' : 'text-gray-300')}
                >
                  Без лендинга {!landingTemplateId && '✓'}
                </button>
                {landingTemplatesList.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setLandingTemplateId(String(t.id)); setLanding(t.name || t.title || String(t.id)); setShowLandingMenu(false); }}
                    className={clsx(
                      'w-full px-3 py-2 text-xs hover:bg-[color:var(--c1e2240)] transition-colors text-left',
                      String(landingTemplateId) === String(t.id) ? 'text-indigo-300' : 'text-gray-300'
                    )}
                  >
                    {t.name || t.title || t.id} {String(landingTemplateId) === String(t.id) && '✓'}
                  </button>
                ))}
                {landingTemplatesList.length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-600">Нет шаблонов из Keitaro</div>
                )}
              </div>
            )}
          </div>

          {/* Format */}
          <div className="relative">
            <button
              onClick={() => { setShowFmtMenu(v => !v); setShowLangMenu(false); setShowCountMenu(false); setShowLandingMenu(false); }}
              className="px-3 py-1.5 rounded-full text-xs border border-[color:var(--c2d3148)] text-gray-300 hover:text-white hover:border-[color:var(--c3d4168)] transition-colors font-mono"
            >
              {format}
            </button>
            {showFmtMenu && (
              <div className="absolute top-full left-0 mt-1 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden z-20 shadow-xl">
                {FORMATS.map(f => (
                  <button
                    key={f}
                    onClick={() => { setFormat(f); setShowFmtMenu(false); }}
                    className={clsx(
                      'w-full px-4 py-2 text-xs hover:bg-[color:var(--c1e2240)] transition-colors text-left font-mono',
                      format === f ? 'text-indigo-300' : 'text-gray-300'
                    )}
                  >
                    {f} {format === f && '✓'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Count */}
          <div className="relative">
            <button
              onClick={() => { setShowCountMenu(v => !v); setShowLangMenu(false); setShowFmtMenu(false); setShowLandingMenu(false); }}
              className="px-3 py-1.5 rounded-full text-xs border border-[color:var(--c2d3148)] text-gray-300 hover:text-white hover:border-[color:var(--c3d4168)] transition-colors"
            >
              ×{count}
            </button>
            {showCountMenu && (
              <div className="absolute top-full left-0 mt-1 bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden z-20 shadow-xl">
                {COUNTS.map(n => (
                  <button
                    key={n}
                    onClick={() => { setCount(n); setShowCountMenu(false); }}
                    className={clsx(
                      'w-full px-4 py-2 text-xs hover:bg-[color:var(--c1e2240)] transition-colors text-left',
                      count === n ? 'text-indigo-300' : 'text-gray-300'
                    )}
                  >
                    ×{n} {count === n && '✓'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Diversify */}
          <button
            onClick={() => setDiversify(v => !v)}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs border transition-colors',
              diversify
                ? 'border-indigo-500 text-indigo-300 bg-indigo-600/10'
                : 'border-[color:var(--c2d3148)] text-gray-500 hover:text-gray-300 hover:border-[color:var(--c3d4168)]'
            )}
          >
            Разнообразить
          </button>

          <div className="flex-1" />

          {/* Load preset */}
          {creativePresets.length > 0 && (
            <select
              onChange={e => { const p = creativePresets.find(x => x.id === e.target.value); if (p) loadPreset(p); e.target.value = ''; }}
              className="px-2 py-1 rounded-full text-xs border border-[color:var(--c2d3148)] text-gray-400 bg-[color:var(--c0d0f1e)] hover:border-[color:var(--c3d4168)] transition-colors focus:outline-none"
              defaultValue=""
            >
              <option value="" disabled>Пресет</option>
              {creativePresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}

          {/* Save preset */}
          {showPresetSave ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') savePresetMutation.mutate(presetName); if (e.key === 'Escape') setShowPresetSave(false); }}
                placeholder="Имя пресета"
                className="px-2 py-1 text-xs border border-indigo-500 rounded-full bg-[color:var(--c0d0f1e)] text-white placeholder-gray-600 focus:outline-none w-28"
              />
              <button onClick={() => savePresetMutation.mutate(presetName)} disabled={!presetName.trim()} className="text-xs text-indigo-400 hover:text-indigo-300">✓</button>
              <button onClick={() => setShowPresetSave(false)} className="text-xs text-gray-600 hover:text-white">✕</button>
            </div>
          ) : (
            <button onClick={() => setShowPresetSave(true)} className="px-3 py-1.5 rounded-full text-xs border border-[color:var(--c2d3148)] text-gray-400 hover:text-white hover:border-[color:var(--c3d4168)] transition-colors">
              💾 Сохранить
            </button>
          )}

          {/* Reset */}
          <button
            onClick={handleReset}
            className="px-4 py-1.5 rounded-full text-xs border border-[color:var(--c2d3148)] text-gray-400 hover:text-white hover:border-[color:var(--c3d4168)] transition-colors"
          >
            Сбросить
          </button>

          {/* Generate */}
          <div className="flex flex-col items-end">
            <button
              onClick={handleGenerate}
              disabled={!productIdFilter || generateMutation.isPending || idea.length > 200}
              title={!productIdFilter ? 'Сначала выбери товар наверху страницы' : idea.length > 200 ? 'Идея слишком длинная (макс 200 символов)' : ''}
              className="px-5 py-1.5 rounded-full text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/40 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              {generateMutation.isPending ? 'Генерирую…' : 'Сгенерировать'}
            </button>
            {!productIdFilter && <div className="text-[10px] text-yellow-600 mt-1">↑ выбери товар</div>}
            {productIdFilter && <div className="text-[10px] text-gray-600 mt-1">Сегодня: {allCreatives.filter(c => new Date(c.created_at).toDateString() === new Date().toDateString()).length}</div>}
          </div>
        </div>

        {/* Error */}
        {generateMutation.error && (
          <div className="px-4 pb-3 text-xs text-red-400">
            {generateMutation.error?.error || generateMutation.error?.message || 'Ошибка генерации'}
          </div>
        )}
      </div>

      {/* Creatives list */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Section header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[color:var(--c1e2240)]">
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-semibold tracking-widest text-gray-500 uppercase">Креативы</span>
            {selected.size > 0 && (
              <button
                onClick={() => { if (window.confirm(`Удалить креативов: ${selected.size ?? selected.length}?`)) deleteMutation.mutate([...selected]); }}
                disabled={deleteMutation.isPending}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 border border-red-500/30 rounded-md transition-colors"
              >
                Удалить {selected.size}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 text-xs">🔍</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск"
                className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg pl-7 pr-3 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-40"
              />
            </div>

            {/* Favorites filter */}
            <button
              onClick={() => setOnlyFavorites(v => !v)}
              className={clsx(
                'flex items-center gap-1 px-3 py-1 text-xs rounded-lg border transition-colors',
                onlyFavorites
                  ? 'border-yellow-500/60 bg-yellow-500/10 text-yellow-300'
                  : 'border-[color:var(--c2d3148)] text-gray-500 hover:text-yellow-400'
              )}
              title="Только избранные"
            >
              ★ {favoritesCount > 0 && <span>{favoritesCount}</span>}
            </button>

            {/* Video filter */}
            <button
              onClick={() => setKindFilter(kindFilter === 'video' ? '' : 'video')}
              className={clsx(
                'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                kindFilter === 'video'
                  ? 'border-purple-500 bg-purple-500/10 text-purple-300'
                  : 'border-[color:var(--c2d3148)] text-gray-500 hover:text-white'
              )}
            >
              🎬 Видео
            </button>

            {/* Select all */}
            {filtered.length > 0 && (
              <button
                onClick={selectAll}
                className="px-3 py-1 text-xs border border-[color:var(--c2d3148)] text-gray-400 hover:text-white rounded-lg transition-colors"
              >
                {selected.size === filtered.length && filtered.length > 0 ? 'Снять всё' : 'Выбрать все'}
              </button>
            )}

            {/* Sort */}
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] text-gray-400 text-xs px-3 py-1 rounded-lg focus:outline-none"
            >
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
            </select>

            <span className="text-xs text-gray-600">{allCreatives.length}</span>
            {spendData?.total_usd != null && (
              <span className="text-xs text-gray-500">
                ${spendData.total_usd.toFixed(2)} · {spendData.count} ген.
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-6">
          {isLoading ? (
            <div className="text-center text-gray-600 py-20 text-sm">Загрузка…</div>
          ) : filtered.length === 0 ? (
            <div className="border border-dashed border-[color:var(--c2d3148)] rounded-2xl flex items-center justify-center py-16 text-sm text-gray-600">
              У этой связки пока нет креативов
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {filtered.map(creative => {
                const isSelected = selected.has(creative.id);
                const lang = LANGUAGES.find(l => l.code === creative.metadata?.language);

                return (
                  <div
                    key={creative.id}
                    onClick={() => creative.status === 'done' ? setPreview(creative) : toggleSelect(creative.id)}
                    className={clsx(
                      'bg-[color:var(--c13162b)] rounded-xl overflow-hidden border transition-all cursor-pointer group',
                      isSelected ? 'border-indigo-500 ring-1 ring-indigo-500/40' : 'border-[color:var(--c1e2240)] hover:border-[color:var(--c3d4168)]'
                    )}
                  >
                    <div className="aspect-square bg-[color:var(--c0a0c18)] relative overflow-hidden">
                      {creative.status === 'processing' ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                          <span className="text-[10px] text-gray-600">Генерация…</span>
                        </div>
                      ) : creative.thumbnail_url || creative.file_url ? (
                        <img
                          src={`${API_BASE}${creative.thumbnail_url || creative.file_url}`}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      ) : creative.metadata?.image_pending ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-3 text-center">
                          <span className="text-xs font-semibold text-indigo-300">Нет файла изображения</span>
                          <span className="text-[10px] text-gray-500 leading-snug">Повторите сборку собственным движком из фото товара</span>
                        </div>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                          <span className="text-gray-700 text-3xl">{creative.status === 'failed' ? '❌' : '🎨'}</span>
                          {creative.status === 'failed' && creative.metadata?.error && (
                            <span className="text-[10px] text-gray-500 px-3 text-center line-clamp-3">{creative.metadata.error}</span>
                          )}
                          {creative.status === 'failed' && (
                            <button
                              onClick={e => { e.stopPropagation(); retryMutation.mutate(creative.id); }}
                              className="text-xs px-2 py-0.5 bg-orange-500/20 hover:bg-orange-500/40 text-orange-400 rounded transition-colors z-10"
                            >↺ Повторить</button>
                          )}
                        </div>
                      )}

                      {/* Select overlay */}
                      <div
                        onClick={e => { e.stopPropagation(); toggleSelect(creative.id); }}
                        className={clsx(
                          'absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity',
                          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-20'
                        )}
                      >
                        {isSelected && (
                          <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs">✓</div>
                        )}
                      </div>

                      {/* Favorite button */}
                      <button
                        onClick={e => { e.stopPropagation(); favoriteMutation.mutate(creative.id); }}
                        className={clsx(
                          'absolute top-1.5 left-1.5 w-6 h-6 text-sm rounded-full items-center justify-center transition-colors z-10',
                          creative.favorite
                            ? 'flex text-yellow-400'
                            : 'hidden group-hover:flex text-gray-600 hover:text-yellow-400 bg-black/60'
                        )}
                        title={creative.favorite ? 'Убрать из избранного' : 'В избранное'}
                      >★</button>

                      {/* Quick delete */}
                      <button
                        onClick={e => { e.stopPropagation(); if (window.confirm('Удалить креатив?')) deleteMutation.mutate([creative.id]); }}
                        className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/70 hover:bg-red-600 text-white text-xs rounded-full items-center justify-center hidden group-hover:flex transition-colors z-10"
                        title="Удалить"
                      >✕</button>

                      {lang && !creative.favorite && (
                        <div className="absolute top-1.5 left-1.5 text-sm leading-none pointer-events-none">{lang.flag}</div>
                      )}
                    </div>

                    <div className="px-2 py-1.5">
                      <div className="flex items-center justify-between">
                        <span className={clsx('text-[10px] font-medium', STATUS_COLOR[creative.status] || 'text-gray-500')}>
                          {STATUS_LABEL[creative.status] || creative.status}
                        </span>
                        <span className="text-[10px] text-gray-600 font-mono">{creative.format || ''}</span>
                      </div>
                      {creative.metadata?.name && (
                        <div className="text-[10px] text-gray-600 truncate mt-0.5" title={creative.metadata.name}>
                          {creative.metadata.name}
                          {creative.metadata?.cost_usd != null && (
                            <span className="ml-1 text-indigo-500/70">${creative.metadata.cost_usd.toFixed(2)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setPreview(null)}
        >
          <img
            src={`${API_BASE}${preview.file_url}`}
            alt=""
            className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-xl bg-black/50 w-9 h-9 rounded-full hover:bg-black/80 transition-colors flex items-center justify-center"
            onClick={() => setPreview(null)}
          >
            ×
          </button>
          <div className="absolute bottom-4 right-4 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { if (!window.confirm('Удалить креатив?')) return; deleteMutation.mutate([preview.id]); setPreview(null); }}
              className="text-xs text-red-400 hover:text-red-300 bg-black/60 hover:bg-black/80 px-3 py-1.5 rounded-full transition-colors"
            >
              🗑 Удалить
            </button>
            <a
              href={`${API_BASE}${preview.file_url}`}
              download
              className="text-xs text-gray-400 hover:text-white bg-black/50 px-3 py-1.5 rounded-full transition-colors"
            >
              ⬇ Скачать
            </a>
          </div>
          {/* Creative info */}
          <div className="absolute bottom-4 left-4 text-xs text-gray-500 bg-black/50 px-3 py-1.5 rounded-full" onClick={e => e.stopPropagation()}>
            {LANGUAGES.find(l => l.code === preview.metadata?.language)?.flag} {preview.format} · {new Date(preview.created_at).toLocaleDateString('ru-RU')}
          </div>
        </div>
      )}

      {/* Click outside to close dropdowns */}
      {(showLangMenu || showFmtMenu || showCountMenu || showLandingMenu) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => { setShowLangMenu(false); setShowFmtMenu(false); setShowCountMenu(false); setShowLandingMenu(false); }}
        />
      )}
    </div>
  );
}
