import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, pushes as pushesApi, pushes as pushesClient, keitaro as keitaroApi, landingTemplates } from '../api/client.js';
import clsx from 'clsx';

const pushApi = {
  options: () => api.get('/api/push/options'),
  generateTexts: (data) => api.post('/api/push/generate-texts', data),
  start: (data) => api.post('/api/push', data),
};

const GEO_FLAGS = { FR:'🇫🇷',BE:'🇧🇪',CH:'🇨🇭',LU:'🇱🇺',CA:'🇨🇦',DE:'🇩🇪',ES:'🇪🇸',IT:'🇮🇹',NL:'🇳🇱',PT:'🇵🇹',PL:'🇵🇱',AT:'🇦🇹',IE:'🇮🇪',CL:'🇨🇱',CO:'🇨🇴' };
const GEO_LANG = { FR:'fr',BE:'fr',CH:'fr',LU:'fr',CA:'fr',DE:'de',ES:'es',IT:'it',NL:'nl',PT:'pt',PL:'pl',AT:'de',IE:'en',CL:'es',CO:'es' };

const STEPS = ['Товар','Лендинг','Кабинет','Креативы','Настройки','Запуск'];

function geoFromLanding(name) {
  const n = name.toLowerCase();
  for (const code of Object.keys(GEO_FLAGS)) {
    if (n.includes(`_${code.toLowerCase()}`) || n.includes(` ${code.toLowerCase()}`) || n.endsWith(code.toLowerCase())) return code;
  }
  return null;
}

function availableGeos(landing) {
  if (!landing) return [];
  if (landing.versions?.length) return landing.versions.map(v => v.geo.toUpperCase()).filter(g => GEO_FLAGS[g]);
  const geo = geoFromLanding(landing.name);
  return geo ? [geo] : Object.keys(GEO_FLAGS);
}

// ─── Step components ─────────────────────────────────────────────────────────

function StepProduct({ opts, form, set }) {
  const [search, setSearch] = useState('');
  const filtered = (opts.products || []).filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="space-y-3">
      <div className="relative">
        <input value={search} onChange={e => setSearch(e.target.value)}
          className={inp} placeholder="Поиск товара..." />
      </div>
      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
        {filtered.map(p => (
          <button key={p.id} onClick={() => set('product', p)}
            className={clsx('w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors',
              form.product?.id === p.id ? 'border-indigo-500 bg-indigo-600/10' : 'border-[color:var(--c2d3148)] hover:border-indigo-500/40 bg-[color:var(--c0d0f1e)]'
            )}>
            {p.cover && <img src={p.cover} className="w-10 h-10 rounded object-cover flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white truncate">{p.name}</div>
              {p.photo_reviews_count > 0 && (
                <div className="text-[10px] text-emerald-400">📸 {p.photo_reviews_count} отзывов с фото</div>
              )}
            </div>
            {form.product?.id === p.id && <span className="text-indigo-400 text-sm">✓</span>}
          </button>
        ))}
        {filtered.length === 0 && <div className="text-gray-600 text-sm text-center py-8">Нет товаров</div>}
      </div>
    </div>
  );
}

// «Проверить страницу»: the server opens the compiled landing on a phone and a desktop and lists problems.
function LandingCheck({ templateId, productId, geo }) {
  const [open, setOpen] = useState(false);
  const mut = useMutation({ mutationFn: () => landingTemplates.check({ template_id: templateId, product_id: productId, geo }) });
  const r = mut.data;
  return (
    <>
      <button onClick={() => { setOpen(true); mut.mutate(); }} disabled={mut.isPending}
        className="px-3 py-1.5 rounded-lg border border-[color:var(--c2d3148)] text-gray-300 text-xs hover:border-indigo-500/40 disabled:opacity-50">
        {mut.isPending ? '⏳ Проверяю...' : '🔍 Проверить страницу'}
      </button>
      {open && (mut.data || mut.error) && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-white font-medium">Проверка страницы{r ? ` · ${r.template} · ${r.geo}` : ''}</span>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">✕</button>
            </div>
            {mut.error && <div className="text-xs text-red-400">{mut.error.error || mut.error.message}</div>}
            {r && (
              <>
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">Проблемы</div>
                  {r.problems.length ? r.problems.map((p, i) => <div key={i} className="text-xs text-amber-400">• {p}</div>)
                    : <div className="text-xs text-emerald-400">Проблем не найдено</div>}
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">Что проверено</div>
                  {r.checks.map((c, i) => <div key={i} className="text-xs text-gray-400">• {c}</div>)}
                </div>
                <div className="grid grid-cols-[1fr_2fr] gap-3 items-start">
                  {r.shots.map(s => (
                    <a key={s.view} href={s.url} target="_blank" rel="noreferrer" className="block">
                      <div className="text-[10px] text-gray-500 mb-1">{s.view === 'phone' ? 'Телефон (вся страница)' : 'Компьютер (первый экран)'}</div>
                      <img src={s.url} alt={s.view} className="w-full rounded border border-[color:var(--c2d3148)] max-h-[60vh] object-cover object-top" />
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StepLanding({ opts, form, set }) {
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const allLandings = (opts.landings || []);
  const localTemplates = allLandings.filter(l => l.source === 'local');
  const keitaroLandings = allLandings.filter(l => l.source === 'keitaro');
  const filtered = allLandings.filter(l =>
    !search || l.name.toLowerCase().includes(search.toLowerCase())
  );
  const geos = form.landing ? availableGeos(form.landing) : [];
  const domains = opts.domains || [];
  const { data: offers = [] } = useQuery({ queryKey: ['kt-offers'], queryFn: keitaroApi.offers, staleTime: 300000 });
  const { data: ktGroups = [] } = useQuery({ queryKey: ['kt-groups'], queryFn: keitaroApi.groups, staleTime: 300000 });
  const offerList = (Array.isArray(offers) ? offers : []).filter(o => o.state !== 'deleted');
  const toggleOffer = (id) => set('offer_ids', (form.offer_ids || []).includes(id) ? form.offer_ids.filter(x => x !== id) : [...(form.offer_ids || []), id]);

  const renderLanding = (l) => (
    <button key={l.id} onClick={() => { set('landing', l); set('geo', ''); set('landing_uploaded_id', null); }}
      className={clsx('w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors text-sm',
        form.landing?.id === l.id ? 'border-indigo-500 bg-indigo-600/10 text-white' : 'border-[color:var(--c2d3148)] hover:border-indigo-500/40 bg-[color:var(--c0d0f1e)] text-gray-300'
      )}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="truncate">{l.name}</span>
        {l.source === 'local' && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-600/20 text-indigo-400 flex-shrink-0">локальный</span>
        )}
        {l.store && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-600/20 text-orange-400 flex-shrink-0">{l.store}</span>
        )}
      </div>
      {form.landing?.id === l.id && <span className="text-indigo-400 flex-shrink-0">✓</span>}
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">Лендинг</label>
        <input value={search} onChange={e => setSearch(e.target.value)} className={inp} placeholder="Поиск лендинга..." />
        <div className="space-y-1.5 mt-2 max-h-44 overflow-y-auto pr-1">
          {search
            ? filtered.map(renderLanding)
            : <>
                {localTemplates.length > 0 && (
                  <>
                    <div className="text-[9px] text-gray-600 uppercase tracking-wider px-1 pt-1 pb-0.5">Шаблоны</div>
                    {localTemplates.map(renderLanding)}
                  </>
                )}
                {keitaroLandings.length > 0 && (
                  <>
                    <div className="text-[9px] text-gray-600 uppercase tracking-wider px-1 pt-2 pb-0.5">Keitaro</div>
                    {keitaroLandings.map(renderLanding)}
                  </>
                )}
              </>
          }
        </div>
      </div>

      {geos.length > 0 && (
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">Гео</label>
          <div className="flex flex-wrap gap-2">
            {geos.map(g => (
              <button key={g} onClick={() => { set('geo', g); set('landing_uploaded_id', null); }}
                className={clsx('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                  form.geo === g ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300' : 'border-[color:var(--c2d3148)] text-gray-400 hover:border-indigo-500/40'
                )}>
                {GEO_FLAGS[g] || ''} {g}
              </button>
            ))}
          </div>
        </div>
      )}

      {form.landing?.source === 'local' && form.product?.id && (
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setUploading(true); setUploadMsg('');
              try {
                const r = await pushesClient.uploadLandingKeitaro({ template_id: form.landing.id, product_id: form.product.id, geo: form.geo || 'FR' });
                setUploadMsg(`✓ Загружено: ${r.landing?.name || 'OK'}`);
                set('landing_uploaded_id', r.landing?.id);
              } catch (e) {
                setUploadMsg(`✗ ${e?.error || e?.message || 'Ошибка'}`);
              } finally { setUploading(false); }
            }}
            disabled={uploading}
            className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 text-xs hover:bg-indigo-600/30 disabled:opacity-50 transition-colors"
          >
            {uploading ? '⏳ Загрузка...' : '📤 Загрузить в Keitaro'}
          </button>
          {uploadMsg && <span className={clsx('text-xs', uploadMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400')}>{uploadMsg}</span>}
          <LandingCheck templateId={form.landing.id} productId={form.product.id} geo={form.geo || 'FR'} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">Домен</label>
          <select value={form.domain_id || ''} onChange={e => set('domain_id', e.target.value)} className={inp}>
            <option value="">Выбери домен</option>
            {domains.map(d => <option key={d.id} value={d.id}>{d.name || d.domain}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">Вайт (лендинг Keitaro)</label>
          <select value={form.white_landing_id || ''} onChange={e => set('white_landing_id', e.target.value)} className={inp}>
            <option value="">Выбери вайт</option>
            {keitaroLandings.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">Группа кампаний Keitaro</label>
          <select value={form.kt_group_id || ''} onChange={e => set('kt_group_id', e.target.value)} className={inp}>
            <option value="">Без группы</option>
            {(Array.isArray(ktGroups) ? ktGroups : []).filter(g => !g.type || g.type === 'campaigns').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">Оффер (можно несколько, доли поровну)</label>
          <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
            {offerList.map(o => (
              <label key={o.id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" checked={(form.offer_ids || []).includes(o.id)} onChange={() => toggleOffer(o.id)} />
                <span className="truncate">{o.id} · {o.name}</span>
              </label>
            ))}
            {offerList.length === 0 && <div className="text-[10px] text-gray-600">Офферы Keitaro не загрузились</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// «Где свободнее» — from the last campaign read; the human chooses.
function cabinetHint(c) {
  const parts = [];
  if (c.ready_kind && c.ready_kind !== 'ready') parts.push(c.ready_label || 'не готов');
  if (c.payment_missing) parts.push('нет оплаты');
  parts.push(`крутится объявлений: ${c.active_ads ?? 0}`);
  if (c.spent_today != null) parts.push(`сегодня ${Number(c.spent_today).toFixed(2)} ${c.currency || ''}`.trim());
  parts.push(c.daily_limit != null ? `лимит ${c.daily_limit} · осталось ${Number(c.limit_left).toFixed(2)}` : 'лимит неизвестен');
  return parts.join(' · ');
}

const cabinetReady = (c) => (!c.ready_kind || c.ready_kind === 'ready') && !c.payment_missing && (c.limit_left == null || c.limit_left > 0);

function StepCabinet({ opts, form, set }) {
  const cabinets = opts.cabinets || [];
  const selected = cabinets.find(c => c.id === form.cabinet_id);
  const pages = selected?.pages?.filter(Boolean) || [];
  const batch = form.extra_cabinets || [];
  const inBatch = (id) => batch.some(b => b.cabinet_id === id);
  const canAdd = selected && form.page_id && form.pixel_id && !inBatch(selected.id);

  // The current choice joins the batch; the form is cleared for the next cabinet.
  const addToBatch = () => {
    set('extra_cabinets', [...batch, {
      cabinet_id: selected.id, cabinet_external_id: selected.external_id, cabinet_name: selected.name,
      page_id: form.page_id, page_external_id: form.page_external_id, page_name: pages.find(p => p.id === form.page_id)?.name,
      pixel_id: form.pixel_id,
    }]);
    set('cabinet_id', null); set('cabinet_external_id', null); set('page_id', null); set('page_external_id', null); set('pixel_id', '');
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">Рекламный кабинет · сначала где свободнее</label>
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {cabinets.map(c => (
            <button key={c.id} disabled={inBatch(c.id)} onClick={() => { set('cabinet_id', c.id); set('cabinet_external_id', c.external_id); set('page_id', null); set('page_external_id', null); set('pixel_id', c.pixel_id || ''); }}
              className={clsx('w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors disabled:opacity-40',
                form.cabinet_id === c.id ? 'border-indigo-500 bg-indigo-600/10' : 'border-[color:var(--c2d3148)] hover:border-indigo-500/40 bg-[color:var(--c0d0f1e)]'
              )}>
              <div className="min-w-0">
                <div className="text-sm text-white truncate">{c.name}{c.profile ? <span className="text-gray-600 text-[10px]"> · профиль #{c.profile}</span> : null}</div>
                <div className="text-[10px] text-gray-600">{String(c.external_id).replace(/^act_/, '')}</div>
                <div className={clsx('text-[10px]', cabinetReady(c) ? 'text-gray-500' : 'text-amber-400')}>{cabinetHint(c)}</div>
              </div>
              {form.cabinet_id === c.id && <span className="text-indigo-400">✓</span>}
              {inBatch(c.id) && <span className="text-[10px] text-gray-500">в пачке</span>}
            </button>
          ))}
          {cabinets.length === 0 && <div className="text-gray-600 text-sm text-center py-8">Кабинетов нет. Добавь в разделе Аккаунты.</div>}
        </div>
        {cabinets.some(c => c.data_at) && (
          <div className="text-[10px] text-gray-600 mt-1">Цифры — с последнего чтения кампаний из FB; решаешь ты.</div>
        )}
      </div>

      {selected && (
        <>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">Страница</label>
            <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
              {pages.map(p => (
                <button key={p.id} onClick={() => { set('page_id', p.id); set('page_external_id', p.external_id); }}
                  className={clsx('w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors text-sm',
                    form.page_id === p.id ? 'border-indigo-500 bg-indigo-600/10 text-white' : 'border-[color:var(--c2d3148)] hover:border-indigo-500/40 bg-[color:var(--c0d0f1e)] text-gray-300'
                  )}>
                  {p.name}
                  {form.page_id === p.id && <span className="text-indigo-400">✓</span>}
                </button>
              ))}
              {pages.length === 0 && <div className="text-gray-600 text-xs py-2">Страниц нет в этом кабинете</div>}
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">ID пикселя</label>
            <input value={form.pixel_id || ''} onChange={e => set('pixel_id', e.target.value)}
              className={inp} placeholder="Введи ID пикселя" />
          </div>
        </>
      )}

      <div className="border-t border-[color:var(--c2d3148)] pt-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Пачка: залив в несколько кабинетов</span>
          <button onClick={addToBatch} disabled={!canAdd} className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40">
            + добавить выбранный в пачку
          </button>
        </div>
        {batch.map((b, i) => (
          <div key={b.cabinet_id} className="flex items-center justify-between text-xs text-gray-400 bg-[color:var(--c0d0f1e)] rounded px-2 py-1">
            <span className="truncate">{b.cabinet_name} · {b.page_name} · пиксель {b.pixel_id}</span>
            <button onClick={() => set('extra_cabinets', batch.filter((_, k) => k !== i))} className="text-gray-600 hover:text-red-400">✕</button>
          </div>
        ))}
        {!batch.length && <div className="text-[10px] text-gray-600">Один кабинет — просто выбери его выше. Для нескольких: выбери кабинет, страницу и пиксель, нажми «добавить в пачку», затем следующий.</div>}
      </div>
    </div>
  );
}

function StepCreatives({ opts, form, set }) {
  const lang = GEO_LANG[form.geo] || null;
  const allCreatives = (opts.creatives || []).filter(c =>
    (!form.product || c.product_id === form.product?.id) &&
    (!lang || c.language === lang || !c.language)
  );
  const selected = form.creative_ids || [];
  const toggle = (id) => set('creative_ids',
    selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
  );
  const toggleAll = () => set('creative_ids', selected.length === allCreatives.length ? [] : allCreatives.map(c => c.id));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{selected.length} / {allCreatives.length} выбрано</span>
        <button onClick={toggleAll} className="text-xs text-indigo-400 hover:text-indigo-300">
          {selected.length === allCreatives.length ? 'Снять все' : 'Выбрать все'}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto pr-1">
        {allCreatives.map(c => {
          const isSelected = selected.includes(c.id);
          return (
            <button key={c.id} onClick={() => toggle(c.id)}
              className={clsx('relative rounded-lg border overflow-hidden aspect-square transition-colors',
                isSelected ? 'border-indigo-500' : 'border-[color:var(--c2d3148)] hover:border-indigo-500/40'
              )}>
              {c.thumbnail_url || c.url
                ? <img src={c.thumbnail_url || (c.url?.startsWith('http') ? c.url : (c.url?.startsWith('/') ? `${import.meta.env.BASE_URL.replace(/\/$/, '')}${c.url}` : `${import.meta.env.BASE_URL}uploads/${c.url}`))} className="w-full h-full object-cover" />
                : <div className="w-full h-full bg-[color:var(--c1e2240)] flex items-center justify-center text-gray-600 text-xs">{c.id?.slice(-6)}</div>
              }
              {isSelected && (
                <div className="absolute inset-0 bg-indigo-600/30 flex items-center justify-center">
                  <span className="text-white text-xl">✓</span>
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-gray-300 px-1 py-0.5 truncate">
                {c.language?.toUpperCase() || ''}
              </div>
            </button>
          );
        })}
        {allCreatives.length === 0 && (
          <div className="col-span-3 text-gray-600 text-sm text-center py-8">
            Нет креативов для этого товара{lang ? ` на языке ${lang}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function StepSettings({ opts, form, set }) {
  const presets = opts.presets || [];
  const selected = presets.find(p => p.id === form.preset_id);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-2">Пресет рекламы</label>
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
          {presets.map(p => (
            <button key={p.id} onClick={() => {
              Object.entries(presetToForm(p, opts)).forEach(([k, v]) => set(k, v));
            }}
              className={clsx('w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors',
                form.preset_id === p.id ? 'border-indigo-500 bg-indigo-600/10' : 'border-[color:var(--c2d3148)] hover:border-indigo-500/40 bg-[color:var(--c0d0f1e)]'
              )}>
              <div>
                <div className="text-sm text-white">{p.name}</div>
                <div className="text-[10px] text-gray-600">{p.budget || p.daily_budget}€/д · {p.objective?.replace('OUTCOME_','')} · {p.adsets_count} адс · {p.age_min}–{p.age_max}</div>
              </div>
              {form.preset_id === p.id && <span className="text-indigo-400">✓</span>}
            </button>
          ))}
          {presets.length === 0 && <div className="text-gray-600 text-xs py-2">Нет пресетов. Создай в разделе Пресеты.</div>}
        </div>
        {form.preset_id && selected && (
          <div className="text-[10px] text-indigo-400/70 mt-1">✓ Настройки применены из пресета</div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Бюджет на адсет / день">
          <input type="number" value={form.daily_budget || ''} onChange={e => set('daily_budget', e.target.value)} className={inp} placeholder="по гео с лидом" />
        </Field>
        <Field label="Ставка (bid cap)">
          <input type="number" step="0.01" value={form.bid_amount || ''} onChange={e => set('bid_amount', e.target.value)} className={inp} placeholder="по гео с лидом" />
        </Field>
        <Field label="Adsets">
          <input type="number" value={form.adsets_count || 1} onChange={e => set('adsets_count', Number(e.target.value))} className={inp} min={1} max={20} />
        </Field>
        <Field label="Возраст">
          <div className="flex items-center gap-1">
            <input type="number" value={form.age_min || 18} onChange={e => set('age_min', Number(e.target.value))} className={inp + ' w-16'} />
            <span className="text-gray-600">—</span>
            <input type="number" value={form.age_max || 65} onChange={e => set('age_max', Number(e.target.value))} className={inp + ' w-16'} />
          </div>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
        <input type="checkbox" checked={Array.isArray(form.bid_amounts)}
          onChange={() => set('bid_amounts', Array.isArray(form.bid_amounts) ? null : Array.from({ length: Number(form.adsets_count) || 1 }, () => form.bid_amount || ''))} />
        Своя ставка у каждого адсета
      </label>
      {Array.isArray(form.bid_amounts) && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {Array.from({ length: Number(form.adsets_count) || 1 }, (_, i) => (
            <Field key={i} label={`Адсет ${i + 1}`}>
              <input type="number" step="0.01" value={form.bid_amounts[i] ?? ''} className={inp}
                onChange={e => set('bid_amounts', Array.from({ length: Number(form.adsets_count) || 1 }, (_, k) => (k === i ? e.target.value : form.bid_amounts[k] ?? '')))} />
            </Field>
          ))}
        </div>
      )}

      <div className="text-[11px] text-gray-500 space-y-0.5">
        <div>Аудитория: {audienceText(form)}</div>
        <div>Креативы: {layoutText(form)}</div>
      </div>
      {settingsProblem(form) && <div className="text-xs text-amber-400">{settingsProblem(form)}</div>}
    </div>
  );
}

function StepLaunch({ opts, form, set }) {
  const textsMut = useMutation({
    mutationFn: () => pushApi.generateTexts({
      product_id: form.product?.id,
      geo: form.geo,
      language: GEO_LANG[form.geo] || 'fr',
    }),
    onSuccess: (data) => {
      if (data.variants?.[0]) {
        set('ad_title', data.variants[0].title);
        set('ad_body', data.variants[0].body);
        set('_text_variants', data.variants);
      }
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">Тексты объявления</label>
          <button onClick={() => textsMut.mutate()} disabled={textsMut.isPending}
            className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50">
            {textsMut.isPending ? '✦ Генерирую...' : '✦ Сгенерировать'}
          </button>
        </div>

        {textsMut.error && (
          <div className="text-[11px] text-amber-400 mb-2">{textsMut.error?.error || textsMut.error?.message || 'Не удалось сгенерировать тексты'}</div>
        )}
        {form._text_variants?.length > 1 && (
          <div className="flex gap-1 mb-2">
            {form._text_variants.map((v, i) => (
              <button key={i} onClick={() => { set('ad_title', v.title); set('ad_body', v.body); }}
                className={clsx('text-[10px] px-2 py-0.5 rounded border transition-colors',
                  form.ad_title === v.title ? 'border-indigo-500 text-indigo-300' : 'border-[color:var(--c2d3148)] text-gray-500 hover:text-white'
                )}>
                Вариант {i + 1}
              </button>
            ))}
          </div>
        )}

        <Field label="Заголовок (до 40 символов)">
          <input value={form.ad_title || ''} onChange={e => set('ad_title', e.target.value)}
            className={inp} placeholder="Заголовок объявления" maxLength={40} />
          <div className="text-right text-[10px] text-gray-700 mt-0.5">{(form.ad_title || '').length}/40</div>
        </Field>
        <Field label="Текст (до 125 символов)">
          <textarea value={form.ad_body || ''} onChange={e => set('ad_body', e.target.value)}
            className={inp + ' resize-none h-16'} placeholder="Текст объявления" maxLength={125} />
          <div className="text-right text-[10px] text-gray-700 mt-0.5">{(form.ad_body || '').length}/125</div>
        </Field>
        <Field label="Ссылка (CTA)">
          <select value={form.call_to_action || 'LEARN_MORE'} onChange={e => set('call_to_action', e.target.value)} className={inp}>
            {['LEARN_MORE','SHOP_NOW','GET_OFFER','SIGN_UP','SUBSCRIBE','CONTACT_US','APPLY_NOW'].map(v =>
              <option key={v} value={v}>{v.replace(/_/g,' ')}</option>
            )}
          </select>
        </Field>
      </div>

      {/* Summary */}
      <div className="bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] rounded-lg p-3 text-xs space-y-1 text-gray-400">
        <div className="text-gray-300 font-medium mb-2">Итог залива</div>
        <Row label="Товар" val={form.product?.name} />
        <Row label="Лендинг" val={form.landing?.name} />
        <Row label="Гео" val={form.geo ? `${GEO_FLAGS[form.geo] || ''} ${form.geo}` : ''} />
        <Row label="Кабинет" val={pushTargets(form, opts.cabinets).map(t => t.name).join(', ')} />
        {pushTargets(form, opts.cabinets).length > 1 && <Row label="Заливов" val={`${pushTargets(form, opts.cabinets).length} — по одному на кабинет`} />}
        <Row label="Пресет" val={(opts.presets||[]).find(p=>p.id===form.preset_id)?.name} />
        <Row label="Креативов" val={form.creative_ids?.length} />
        <Row label="Adsets" val={form.adsets_count} />
        <Row label="Бюджет" val={form.daily_budget ? `${form.daily_budget} в день на адсет` : ''} />
        <Row label="Ставка" val={Array.isArray(form.bid_amounts) ? `по адсетам ${form.bid_amounts.join(' / ')}` : form.bid_amount ? `${form.bid_amount}` : ''} />
        <Row label="Аудитория" val={audienceText(form)} />
        <Row label="Креативы" val={layoutText(form)} />
        <Row label="Офферы" val={(form.offer_ids || []).join(', ')} />
      </div>

      <div className="text-[11px] text-gray-500">
        Всё создаётся на паузе: кампания и поток в Keitaro, кампания, адсеты и объявления в Facebook через профиль AdsPower. Запуск — отдельно, после проверки.
      </div>
    </div>
  );
}

function PushProgressPanel({ pushId, onClose }) {
  const { data, isLoading } = useQuery({
    // Our push: status and step log of the push row (Keitaro on the server, FB via the Mac agent).
    queryKey: ['push', pushId],
    queryFn: () => pushesApi.get(pushId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'done' || status === 'failed' || status === 'error') return false;
      return 2000;
    },
    staleTime: 0,
    enabled: !!pushId,
    retry: 1,
  });

  const steps = Array.isArray(data?.log) ? data.log : [];
  const status = data?.status;
  const isDone = status === 'done' || status === 'failed' || status === 'error';

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">Прогресс залива</span>
        <span className={clsx('text-[10px] px-2 py-0.5 rounded', {
          'bg-emerald-500/20 text-emerald-400': status === 'done',
          'bg-red-500/20 text-red-400': status === 'failed' || status === 'error',
          'bg-yellow-500/20 text-yellow-400 animate-pulse': !isDone,
          'bg-gray-500/20 text-gray-400': status === 'no_fa',
        })}>
          {status || (isLoading ? 'загрузка...' : 'запущен')}
        </span>
      </div>
      {data?.error && <div className="text-xs text-red-400">{data.error}</div>}

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {steps.length === 0 && (
          <div className="text-xs text-gray-600 animate-pulse">Ожидание шагов залива...</div>
        )}
        {steps.map((step, i) => (
          <div key={i} className={clsx('flex items-start gap-2 text-xs', {
            'text-emerald-400': step.status === 'done' || step.status === 'success',
            'text-red-400': step.status === 'error' || step.status === 'failed',
            'text-gray-400': !step.status || step.status === 'running',
          })}>
            <span className="flex-shrink-0 w-3">
              {step.status === 'done' || step.status === 'success' ? '✓' :
               step.status === 'error' || step.status === 'failed' ? '✗' : '·'}
            </span>
            <span className="flex-1">
              {step.name || step.step || step.message || step.action || JSON.stringify(step)}
              {step.error && <span className="text-red-400/70 ml-1">— {step.error}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-gray-600 font-mono">push_id: {pushId}</div>

      <button onClick={onClose}
        className="mt-1 px-4 py-1.5 text-xs border border-[color:var(--c2d3148)] text-gray-400 hover:text-white rounded-lg transition-colors">
        Закрыть
      </button>
    </div>
  );
}

function Row({ label, val }) {
  if (!val && val !== 0) return null;
  return <div className="flex justify-between"><span className="text-gray-600">{label}</span><span>{val}</span></div>;
}
function Field({ label, children }) {
  return <div className="mb-3"><label className="block text-[10px] text-gray-500 mb-1">{label}</label>{children}</div>;
}
const inp = 'w-full bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] text-gray-300 text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-indigo-500';

// ─── Wizard ───────────────────────────────────────────────────────────────────

const INIT = {
  product: null, landing: null, geo: '', domain_id: '', whitepage: 'none',
  cabinet_id: null, cabinet_external_id: null, page_id: null, page_external_id: null, pixel_id: '',
  creative_ids: [], preset_id: null,
  objective: 'OUTCOME_LEADS', daily_budget: '', bid_strategy: 'LOWEST_COST_WITH_BID_CAP',
  bid_amount: '', bid_amounts: null, adsets_count: 3, age_min: 25, age_max: 65, auto_placement: true,
  genders: 'all', devices: 'all', platforms: [], creo_mode: 'all-all', creo_per_adset: 3,
  pixel_event: 'LEAD', url_params: 'utm_campaign={{campaign.name}}&utm_source={{site_source_name}}&utm_placement={{placement}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&adset_name={{adset.name}}&ad_name={{ad.name}}',
  call_to_action: 'SHOP_NOW', ad_title: '', ad_body: '', run_now: false,
  white_landing_id: '', offer_ids: [], kt_group_id: '', extra_cabinets: [],
  _text_variants: [],
};

function canProceed(step, form) {
  if (step === 0) return !!form.product;
  if (step === 1) return !!form.landing && !!form.geo && !!form.domain_id && !!form.white_landing_id && form.offer_ids?.length > 0
    && (form.landing.source === 'keitaro' || !!form.landing_uploaded_id);
  if (step === 2) {
    const current = !!form.cabinet_id && !!form.page_id && !!form.pixel_id;
    const partial = !!form.cabinet_id && !current;
    return !partial && (current || (form.extra_cabinets || []).length > 0);
  }
  if (step === 3) return form.creative_ids?.length > 0;
  if (step === 4) return Number(form.daily_budget) > 0 && Number(form.bid_amount) > 0 && !settingsProblem(form);
  return true;
}

// What in the ad settings would make the push refuse, in words; '' when all is fine.
function settingsProblem(form) {
  const n = Number(form.adsets_count) || 1;
  if (Array.isArray(form.bid_amounts) && (form.bid_amounts.length !== n || form.bid_amounts.some(b => !(Number(b) > 0))))
    return `Укажите ставку у каждого из ${n} адсетов`;
  if (form.auto_placement === false && !(form.platforms || []).length)
    return 'Авто-плейсменты выключены в пресете, а площадки не выбраны';
  const per = Number(form.creo_per_adset) || 1;
  if (form.creo_mode === 'one-per' && per * n > (form.creative_ids?.length || 0))
    return `Раскладка «по ${per} на адсет» × ${n} адсетов требует ${per * n} креативов, выбрано ${form.creative_ids?.length || 0}`;
  return '';
}

const GENDER_LABEL = { all: 'все', male: 'мужчины', female: 'женщины' };
const DEVICE_LABEL = { all: 'все', mobile: 'мобильные', desktop: 'десктоп' };

function audienceText(form) {
  return [
    `${form.age_min || 18}–${form.age_max || 65}`,
    GENDER_LABEL[form.genders] || 'все',
    `устройства: ${DEVICE_LABEL[form.devices] || 'все'}`,
    form.auto_placement === false ? `площадки: ${(form.platforms || []).join(', ') || '—'}` : 'авто-плейсменты',
  ].join(' · ');
}

function layoutText(form) {
  const n = Number(form.adsets_count) || 1;
  if (form.creo_mode === 'one-per') return `свои ${form.creo_per_adset} креатива у каждого из ${n} адсетов`;
  return `все ${form.creative_ids?.length || 0} креативов в каждый из ${n} адсетов`;
}


// Ad preset → wizard fields. Accepts our saved form ({geo, cabinet_id, …}) and FA's ({geos[], cabinets[{cabinet_id,page_id,pixel_id}], product_id}).
export function presetToForm(p, opts = {}) {
  const out = {
    preset_id: p.id,
    objective: p.objective || 'OUTCOME_LEADS',
    daily_budget: p.budget || p.daily_budget || '',
    bid_strategy: p.bid_strategy || 'LOWEST_COST_WITH_BID_CAP',
    bid_amount: p.bid_amount ?? '',
    adsets_count: p.adsets_count || 3,
    age_min: p.age_min || 25,
    age_max: p.age_max || 65,
    auto_placement: p.auto_placement !== false,
    platforms: Array.isArray(p.platforms) ? p.platforms : [],
    genders: p.genders || 'all',
    devices: p.devices || 'all',
    bid_amounts: Array.isArray(p.bid_amounts) && p.bid_amounts.length ? p.bid_amounts : null,
    call_to_action: p.call_to_action || 'LEARN_MORE',
    pixel_event: p.pixel_event || 'LEAD',
    url_params: p.url_params || INIT.url_params,
  };
  if (p.creo_mode) out.creo_mode = p.creo_mode;
  if (p.creo_per_adset != null) out.creo_per_adset = p.creo_per_adset;
  if (p.all_creatives != null) out.all_creatives = p.all_creatives;

  const f = typeof p.form === 'string' ? safeJson(p.form) : p.form;
  if (f) {
    const geo = f.geo || f.geos?.[0];
    if (geo) out.geo = geo;
    if (f.domain_id) out.domain_id = f.domain_id;
    const cab = f.cabinet_id ? f : f.cabinets?.[0];
    if (cab?.cabinet_id) {
      out.cabinet_id = cab.cabinet_id;
      const cabinet = (opts.cabinets || []).find(c => c.id === cab.cabinet_id);
      if (cabinet) out.cabinet_external_id = cabinet.external_id;
      if (cab.page_id) {
        out.page_id = cab.page_id;
        const page = cabinet?.pages?.find(pg => pg.id === cab.page_id);
        if (page) out.page_external_id = page.external_id;
      }
      if (cab.pixel_id) out.pixel_id = cab.pixel_id;
    }
    if (f.creative_ids?.length) out.creative_ids = f.creative_ids;
    const productId = f.product_id || f.product_ids?.[0] || p.product_ids?.[0];
    const product = productId && (opts.products || []).find(x => x.id === productId);
    if (product) out.product = product;
  }
  return out;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Fields shared by every push of the batch; the cabinet, page and pixel come per target.
function pushBody(form) {
  return {
    product_id: form.product?.id,
    landing_id: form.landing?.id,
    landing_url: form.landing?.url,
    campaign_name: `${form.product?.name || 'Campaign'} — ${form.geo} — ${new Date().toLocaleDateString('ru')}`,
    domain_id: form.domain_id ? Number(form.domain_id) : null,
    whitepage: form.whitepage || 'none',
    cabinet_id: form.cabinet_id,
    cabinet_external_id: form.cabinet_external_id,
    page_external_id: form.page_external_id,
    pixel_id: form.pixel_id,
    creative_ids: form.creative_ids,
    preset_id: form.preset_id,
    objective: form.objective,
    daily_budget: Number(form.daily_budget),
    bid_strategy: form.bid_strategy,
    bid_amount: form.bid_amount ? Number(form.bid_amount) : null,
    optimization_goal: form.optimization_goal,
    billing_event: form.billing_event,
    pixel_event: form.pixel_event,
    countries: form.geo ? [form.geo] : [],
    age_min: form.age_min,
    age_max: form.age_max,
    auto_placement: form.auto_placement,
    platforms: form.platforms,
    genders: form.genders,
    devices: form.devices,
    bid_amounts: Array.isArray(form.bid_amounts) ? form.bid_amounts.map(Number) : null,
    creo_mode: form.creo_mode,
    creo_per_adset: form.creo_per_adset,
    adsets_count: form.adsets_count,
    call_to_action: form.call_to_action,
    ad_title: form.ad_title,
    ad_body: form.ad_body,
    kt_landing_id: form.landing?.source === 'keitaro' ? form.landing.id : form.landing_uploaded_id,
    white_landing_id: form.white_landing_id ? Number(form.white_landing_id) : null,
    offer_ids: form.offer_ids,
    kt_group_id: form.kt_group_id ? Number(form.kt_group_id) : null,
  };
}

// Cabinets of this push: the batch, plus the current choice when it is complete.
function pushTargets(form, cabinets = []) {
  const list = (form.extra_cabinets || []).map(b => ({ name: b.cabinet_name, body: {
    cabinet_id: b.cabinet_id, cabinet_external_id: b.cabinet_external_id, page_external_id: b.page_external_id, pixel_id: b.pixel_id } }));
  if (form.cabinet_id && form.page_id && form.pixel_id) list.push({ name: cabinets.find(c => c.id === form.cabinet_id)?.name || 'выбранный кабинет', body: {
    cabinet_id: form.cabinet_id, cabinet_external_id: form.cabinet_external_id, page_external_id: form.page_external_id, pixel_id: form.pixel_id } });
  return list;
}

export default function PushWizard({ onClose, onSuccess, initialPreset }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(INIT);
  const [launchedPushId, setLaunchedPushId] = useState(null);
  const [batchResults, setBatchResults] = useState([]);
  const qc = useQueryClient();
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const { data: opts = {}, isLoading } = useQuery({
    queryKey: ['push-options'],
    queryFn: pushApi.options,
    staleTime: 60000,
  });

  const [presetApplied, setPresetApplied] = useState(false);
  useEffect(() => {
    if (!initialPreset || presetApplied || isLoading) return;
    setForm(f => ({ ...f, ...presetToForm(initialPreset, opts) }));
    setPresetApplied(true);
  }, [initialPreset, presetApplied, isLoading, opts]);

  const startMut = useMutation({
    // One push per cabinet: the batch plus the current choice; one refusal does not stop the rest.
    mutationFn: async () => {
      const targets = pushTargets(form, opts.cabinets);
      const results = [];
      for (const t of targets) {
        try {
          results.push({ ...t, push: await pushApi.start({ ...pushBody(form), ...t.body }) });
        } catch (e) {
          results.push({ ...t, error: e.error || e.message || 'Ошибка' });
        }
      }
      if (results.every(r => r.error)) throw new Error(results.map(r => `${r.name}: ${r.error}`).join('; '));
      return results;
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ['pushes'] });
      const first = results.find(r => r.push?.id || r.push?.push_id)?.push;
      onSuccess?.(first);
      setBatchResults(results);
      setLaunchedPushId(first?.id || first?.push_id || null);
      if (!first) onClose();
    },
  });

  const StepComponent = [StepProduct, StepLanding, StepCabinet, StepCreatives, StepSettings, StepLaunch][step];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl w-full max-w-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--c2d3148)] flex-shrink-0">
          <h2 className="text-sm font-semibold text-white">Залить рекламу{initialPreset ? ` · ${initialPreset.name}` : ''}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        {/* Steps */}
        <div className="flex items-center gap-1 px-5 py-3 border-b border-[color:var(--c2d3148)] flex-shrink-0">
          {STEPS.map((s, i) => (
            <React.Fragment key={i}>
              <button onClick={() => i < step && setStep(i)}
                className={clsx('text-[10px] font-medium px-2 py-0.5 rounded transition-colors',
                  i === step ? 'bg-indigo-600 text-white' :
                  i < step ? 'text-indigo-400 hover:text-indigo-300 cursor-pointer' :
                  'text-gray-600'
                )}>
                {s}
              </button>
              {i < STEPS.length - 1 && <span className="text-gray-700 text-[10px]">›</span>}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {launchedPushId ? (
            <>
              {batchResults.length > 1 && (
                <div className="px-4 pt-4 space-y-1 text-xs">
                  <div className="text-gray-400">Заливы пачки (ход каждого — во вкладке «Заливы»):</div>
                  {batchResults.map((r, i) => (
                    <div key={i} className={r.error ? 'text-red-400' : 'text-emerald-400'}>
                      {r.name}: {r.error ? `не принят — ${r.error}` : `принят, залив ${r.push?.id || r.push?.push_id}`}
                    </div>
                  ))}
                </div>
              )}
              <PushProgressPanel pushId={launchedPushId} onClose={onClose} />
            </>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-48 text-gray-500 text-sm animate-pulse">Загрузка данных...</div>
          ) : (
            <StepComponent opts={opts} form={form} set={set} />
          )}
        </div>

        {/* Footer — hidden after launch */}
        {!launchedPushId && (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-t border-[color:var(--c2d3148)] flex-shrink-0">
              <button onClick={() => step > 0 ? setStep(s => s - 1) : onClose()}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-[color:var(--c2d3148)] hover:border-gray-500 rounded-lg transition-colors">
                {step === 0 ? 'Отмена' : '← Назад'}
              </button>

              {step < STEPS.length - 1 ? (
                <button onClick={() => setStep(s => s + 1)} disabled={!canProceed(step, form)}
                  className="px-5 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                  Далее →
                </button>
              ) : (
                <button onClick={() => startMut.mutate()} disabled={startMut.isPending}
                  className="px-5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium disabled:opacity-50">
                  {startMut.isPending ? '⏳ Заливаю...' : '🚀 Залить'}
                </button>
              )}
            </div>

            {startMut.error && (
              <div className="px-5 pb-3 text-xs text-red-400">
                Ошибка: {startMut.error?.message || JSON.stringify(startMut.error)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
