import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { keitaro as keitaroApi, landingTemplates } from '../api/client.js';
import { useRole } from '../hooks/useRole.js';
import clsx from 'clsx';

const GEO_FLAGS = { fr: '🇫🇷', be: '🇧🇪', ch: '🇨🇭', lu: '🇱🇺', ca: '🇨🇦', de: '🇩🇪', es: '🇪🇸', it: '🇮🇹', nl: '🇳🇱', pt: '🇵🇹', pl: '🇵🇱' };

function geoFromName(name) {
  const n = name.toLowerCase();
  for (const [code, flag] of Object.entries(GEO_FLAGS)) {
    if (n.includes(`_${code}`) || n.includes(` ${code}`) || n.endsWith(code)) return { code, flag };
  }
  return null;
}

function templateType(name) {
  const n = name.toLowerCase();
  if (n.includes('easy')) return { label: 'Easy', color: 'bg-blue-500/20 text-blue-400' };
  if (n.includes('manomano') || n.includes('mano')) return { label: 'ManoMano', color: 'bg-purple-500/20 text-purple-400' };
  if (n.includes('cdiscount') || n.includes('cds')) return { label: 'Cdiscount', color: 'bg-orange-500/20 text-orange-400' };
  if (n.includes('amazon')) return { label: 'Amazon', color: 'bg-yellow-500/20 text-yellow-400' };
  if (n.includes('white') || n.includes('вайт')) return { label: 'White', color: 'bg-gray-400/20 text-gray-400' };
  if (n.includes('form') || n.includes('форм') || n.includes('order') || n.includes('commande')) return { label: 'Form', color: 'bg-emerald-500/20 text-emerald-400' };
  return { label: 'Other', color: 'bg-gray-500/20 text-gray-400' };
}

function LandingPreviewDrawer({ landing, onClose }) {
  if (!landing) return null;
  const url = landing.domain ? `https://${landing.domain}` : null;
  const geo = geoFromName(landing.name);
  const type = templateType(landing.name);
  return (
    <div className="w-80 flex-shrink-0 border-l border-[color:var(--c1e2240)] bg-[color:var(--c0d0f1e)] flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--c1e2240)]">
        <span className="text-sm font-medium text-white truncate max-w-[220px]">{landing.name}</span>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-lg leading-none ml-2">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">ID</span>
            <span className="text-gray-300 font-mono">#{landing.id}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Тип</span>
            <span className={clsx('px-1.5 py-0.5 rounded text-[11px] font-medium', type.color)}>{type.label}</span>
          </div>
          {geo && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Гео</span>
              <span className="text-gray-300">{geo.flag} {geo.code.toUpperCase()}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Статус</span>
            <span className={clsx('px-1.5 py-0.5 rounded text-[10px]',
              landing.state === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/50 text-gray-600'
            )}>{landing.state === 'active' ? 'активен' : landing.state || 'неизв.'}</span>
          </div>
          {landing.domain && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Домен</span>
              <span className="text-gray-400 font-mono truncate ml-2 max-w-[180px]">{landing.domain}</span>
            </div>
          )}
        </div>
        {url && (
          <div>
            <div className="text-xs text-gray-500 mb-2">Превью</div>
            <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg overflow-hidden h-40 flex items-center justify-center">
              <iframe
                src={url}
                title="preview"
                className="w-full h-full"
                sandbox="allow-scripts"
                loading="lazy"
              />
            </div>
          </div>
        )}
        {url && (
          <div className="flex flex-col gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-center bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
            >
              Открыть лендинг
            </a>
            <button
              onClick={() => { navigator.clipboard.writeText(url); }}
              className="w-full text-center bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] hover:border-indigo-500/40 text-gray-300 text-xs px-3 py-2 rounded-lg transition-colors"
            >
              Скопировать URL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const GEO_FLAGS_UPPER = { AT: '🇦🇹', BE: '🇧🇪', CL: '🇨🇱', CO: '🇨🇴', DE: '🇩🇪', ES: '🇪🇸', FR: '🇫🇷', IE: '🇮🇪', IT: '🇮🇹', LU: '🇱🇺', NL: '🇳🇱', PT: '🇵🇹' };

const STORE_BADGE = {
  Cdiscount: { label: 'Cdiscount', bg: 'bg-orange-500/20', text: 'text-orange-400' },
  ManoMano:  { label: 'ManoMano',  bg: 'bg-purple-500/20', text: 'text-purple-400' },
  Easy:      { label: 'Easy',      bg: 'bg-blue-500/20',   text: 'text-blue-400' },
};

function TemplateCard({ t }) {
  const [expanded, setExpanded] = useState(false);
  let versions = [];
  try { versions = Array.isArray(t.versions) ? t.versions : JSON.parse(t.versions || '[]'); } catch { /* */ }
  let geos = [];
  try { geos = Array.isArray(t.geos) ? t.geos : JSON.parse(t.geos || '[]'); } catch { /* */ }

  const storeName = t.store || t.name;
  const badge = STORE_BADGE[storeName] || STORE_BADGE[Object.keys(STORE_BADGE).find(k => t.name?.includes(k))] || null;
  const syncedAt = t.synced_at ? new Date(t.synced_at).toLocaleDateString('ru-RU') : null;

  return (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-[color:var(--c161928)] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-100">{t.name}</span>
            {badge && (
              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', badge.bg, badge.text)}>
                {badge.label}
              </span>
            )}
            <span className={clsx(
              'text-[10px] px-1.5 py-0.5 rounded',
              t.state === 'ready' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-700/50 text-gray-500'
            )}>
              {t.state || 'ready'}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
            <span>{geos.length} гео</span>
            {versions.length > 0 && <span>· {versions.length} версий</span>}
            {syncedAt && <span>· синхр. {syncedAt}</span>}
            {t.fa_id && <span className="font-mono truncate max-w-[160px]" title={t.fa_id}>· {t.fa_id.slice(0, 20)}…</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex gap-0.5">
            {geos.slice(0, 6).map(g => (
              <span key={g} className="text-sm" title={g}>{GEO_FLAGS_UPPER[g] || g}</span>
            ))}
            {geos.length > 6 && <span className="text-xs text-gray-600 ml-1">+{geos.length - 6}</span>}
          </div>
          <span className="text-gray-600 text-sm ml-2">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && versions.length > 0 && (
        <div className="border-t border-[color:var(--c1e2240)] px-4 py-3">
          <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Гео версии</div>
          <div className="grid grid-cols-3 gap-1.5">
            {versions.map(v => (
              <div key={v.geo} className="bg-[color:var(--c0d0f1e)] border border-[color:var(--c1e2240)] rounded-lg px-2.5 py-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">{GEO_FLAGS_UPPER[v.geo] || '🌍'}</span>
                  <span className="text-xs font-medium text-gray-300">{v.geo}</span>
                  <span className="text-[10px] text-gray-600 ml-auto">v{v.version}</span>
                </div>
                <div className="text-[10px] text-gray-600">
                  {v.language?.toUpperCase()} · {v.files_count} файл{v.files_count === 1 ? '' : 'а'}
                  {v.size_bytes && ` · ${(v.size_bytes / 1024).toFixed(0)}кб`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplatesTab() {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['landing-templates'],
    queryFn: landingTemplates.list,
  });

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6">
      <div className="flex items-center justify-between mb-4 pt-4">
        <span className="text-sm text-gray-400">{templates.length} шаблонов · {templates.reduce((s, t) => {
          try { return s + (Array.isArray(t.geos) ? t.geos : JSON.parse(t.geos || '[]')).length; } catch { return s; }
        }, 0)} версий</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-gray-500 text-sm animate-pulse">Загрузка...</div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
          <div className="text-gray-600 text-sm">Шаблонов нет</div>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => <TemplateCard key={t.id} t={t} />)}
        </div>
      )}
    </div>
  );
}

export default function LandingsPage() {
  const qc = useQueryClient();
  const { role } = useRole();
  const isAdmin = role === 'owner' || role === 'lead';
  const [tab, setTab] = useState('templates');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterGeo, setFilterGeo] = useState('');
  const [selected, setSelected] = useState(null);

  const uploadRef = useRef(null);

  const uploadHtmlMutation = useMutation({
    mutationFn: (file) => landingTemplates.uploadHtml(file),
    onSuccess: () => qc.invalidateQueries(['landing-templates']),
  });

  const createWhitePageMutation = useMutation({
    mutationFn: (name) => landingTemplates.createWhitePage(name),
    onSuccess: () => qc.invalidateQueries(['landing-templates']),
  });

  const createFormPageMutation = useMutation({
    mutationFn: (data) => landingTemplates.createFormPage(data),
    onSuccess: () => { qc.invalidateQueries(['landing-templates']); setTab('templates'); },
  });

  const createStoreMutation = useMutation({
    mutationFn: (store) => landingTemplates.createStore({ store }),
    onSuccess: () => { qc.invalidateQueries(['landing-templates']); setTab('templates'); },
    onError: (e) => window.alert?.(e?.error || 'Не удалось создать шаблон'),
  });

  const { data: landings = [], isLoading, error } = useQuery({
    queryKey: ['keitaro', 'landings'],
    queryFn: keitaroApi.landings,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const types = [...new Set(landings.map(l => templateType(l.name).label))].sort();
  const geos = [...new Set(landings.map(l => geoFromName(l.name)?.code).filter(Boolean))].sort();

  const filtered = landings.filter(l => {
    if (search && !l.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType && templateType(l.name).label !== filterType) return false;
    if (filterGeo && geoFromName(l.name)?.code !== filterGeo) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
        <h1 className="text-lg font-semibold text-white">Лендинги</h1>
        <div className="flex items-center gap-2">
          {tab === 'keitaro' && <div className="text-xs text-gray-600">{filtered.length} / {landings.length}</div>}
          <input
            ref={uploadRef}
            type="file"
            accept=".html,.htm"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) { uploadHtmlMutation.mutate(file); e.target.value = ''; }
            }}
          />
          <button
            onClick={() => uploadRef.current?.click()}
            disabled={uploadHtmlMutation.isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-[color:var(--c1e2240)] hover:bg-indigo-600/40 text-gray-400 hover:text-indigo-300 transition-colors disabled:opacity-50"
            title="Загрузить HTML шаблон"
          >
            {uploadHtmlMutation.isPending ? '...' : '⬆ HTML'}
          </button>
          <button
            onClick={() => {
              const store = window.prompt('Название вашего магазина (будет в шапке лендинга, чужие бренды нельзя):', '');
              if (store?.trim()) createStoreMutation.mutate(store.trim());
            }}
            disabled={createStoreMutation.isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-[color:var(--c1e2240)] hover:bg-teal-600/40 text-gray-400 hover:text-teal-300 transition-colors disabled:opacity-50"
            title="Свой шаблон товара на 12 гео: только реальные данные товара, ссылка на оффер как на лендингах Keitaro"
          >
            {createStoreMutation.isPending ? '...' : '🛍 Витрина'}
          </button>
          <button
            onClick={() => {
              const name = window.prompt('Название вайт-страницы:', 'White Page');
              if (name) createWhitePageMutation.mutate(name);
            }}
            disabled={createWhitePageMutation.isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-[color:var(--c1e2240)] hover:bg-indigo-600/40 text-gray-400 hover:text-indigo-300 transition-colors disabled:opacity-50"
            title="Создать белую страницу"
          >
            {createWhitePageMutation.isPending ? '...' : '⬜ Вайт'}
          </button>
          <button
            onClick={() => {
              const name = window.prompt('Название форм-страницы:', 'Form Page FR');
              if (!name) return;
              createFormPageMutation.mutate({ name, geo: 'FR' });
            }}
            disabled={createFormPageMutation.isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-[color:var(--c1e2240)] hover:bg-emerald-600/40 text-gray-400 hover:text-emerald-300 transition-colors disabled:opacity-50"
            title="Создать форм-страницу (лид-форма заказа)"
          >
            {createFormPageMutation.isPending ? '...' : '📋 Форм'}
          </button>

        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 px-6 border-b border-[color:var(--c1e2240)] flex-shrink-0">
        {[
          { key: 'keitaro', label: 'Keitaro' },
          { key: 'templates', label: 'Шаблоны' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px',
              tab === t.key
                ? 'border-indigo-500 text-white font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'templates' ? (
        <TemplatesTab />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Main list */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Filters */}
            <div className="flex items-center gap-2 px-6 py-3 flex-shrink-0">
              <div className="relative flex-1 max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-xs">🔍</span>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-300 text-xs pl-8 pr-3 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500 placeholder-gray-600"
                  placeholder="Поиск лендинга..."
                />
              </div>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-400 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500"
              >
                <option value="">Все типы</option>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                value={filterGeo}
                onChange={e => setFilterGeo(e.target.value)}
                className="bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-400 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500"
              >
                <option value="">Все гео</option>
                {geos.map(g => <option key={g} value={g}>{GEO_FLAGS[g] || ''} {g.toUpperCase()}</option>)}
              </select>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {isLoading ? (
                <div className="flex items-center justify-center h-48 text-gray-500 text-sm animate-pulse">Загрузка из Keitaro...</div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-48 gap-2">
                  <p className="text-red-400 text-sm">Ошибка подключения к Keitaro</p>
                  <p className="text-gray-600 text-xs">
                    {isAdmin ? 'Проверь настройки API в разделе Настройки' : 'Обратись к администратору для настройки подключения'}
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
                  {landings.length === 0 ? 'Лендингов в Keitaro нет' : 'Ничего не найдено'}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {filtered.map(l => {
                    const type = templateType(l.name);
                    const geo = geoFromName(l.name);
                    const isActive = selected?.id === l.id;
                    return (
                      <div
                        key={l.id}
                        onClick={() => setSelected(isActive ? null : l)}
                        className={clsx(
                          'bg-[color:var(--c13162b)] border rounded-lg px-4 py-3 flex items-center gap-4 cursor-pointer transition-colors',
                          isActive ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-[color:var(--c2d3148)] hover:border-indigo-500/40'
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-200 font-medium truncate">{l.name}</div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
                            <span className="font-mono">#{l.id}</span>
                            {l.domain && <span>· {l.domain}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {geo && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color:var(--c1e2240)] text-gray-400 font-mono uppercase">
                              {geo.flag} {geo.code}
                            </span>
                          )}
                          <span className={clsx('text-[11px] px-1.5 py-0.5 rounded font-medium', type.color)}>
                            {type.label}
                          </span>
                          <span className={clsx(
                            'text-[10px] px-1.5 py-0.5 rounded',
                            l.state === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/50 text-gray-600'
                          )}>
                            {l.state === 'active' ? 'активен' : l.state || 'неизв.'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Side preview */}
          {selected && (
            <LandingPreviewDrawer landing={selected} onClose={() => setSelected(null)} />
          )}
        </div>
      )}
    </div>
  );
}
