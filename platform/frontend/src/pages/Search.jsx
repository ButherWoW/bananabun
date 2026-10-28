import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { search as searchApi, folders as foldersApi, scrape as scrapeApi } from '../api/client.js';
import clsx from 'clsx';

export default function SearchPage() {
  const qc = useQueryClient();
  const [queries, setQueries] = useState('');
  const [marketplace, setMarketplace] = useState('fr');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [jobId, setJobId] = useState(null);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [targetFolderId, setTargetFolderId] = useState('');
  const [mode, setMode] = useState('queries'); // queries | similar
  const [geo, setGeo] = useState('FR');
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const [dayFrom, setDayFrom] = useState(weekAgo);
  const [dayTo, setDayTo] = useState(new Date().toISOString().slice(0, 10));
  const [info, setInfo] = useState(null); // { note, samples, errors } of the last search
  const [failed, setFailed] = useState('');
  const pollRef = useRef(null);

  const { data: folderList = [] } = useQuery({ queryKey: ['folders'], queryFn: foldersApi.list });

  const { data: searchHistory = [] } = useQuery({
    queryKey: ['search-history'],
    queryFn: searchApi.history,
    staleTime: 300000,
    retry: false,
  });

  const startSearch = useMutation({
    mutationFn: (data) => (mode === 'similar' ? searchApi.similar(data) : searchApi.start(data)),
    onSuccess: (res) => { setJobId(res.job_id); setResults([]); setInfo(null); setFailed(''); },
    onError: (e) => setFailed(e.error || e.message || 'Ошибка'),
  });

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    pollRef.current = setInterval(async () => {
      try {
        const job = await searchApi.status(jobId);
        if (job.status === 'done') {
          clearInterval(pollRef.current);
          const parsed = !job.result ? { items: [] } : typeof job.result === 'string' ? JSON.parse(job.result) : job.result;
          setResults(parsed.items || []);
          setInfo({ note: parsed.note, samples: parsed.samples, errors: parsed.errors });
          if (parsed.marketplace) setMarketplace(parsed.marketplace);
          setJobId(null);
        } else if (job.status === 'failed') {
          clearInterval(pollRef.current);
          setFailed(job.error || 'Поиск не удался');
          setJobId(null);
        }
      } catch { clearInterval(pollRef.current); setJobId(null); }
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  const addToFolder = useMutation({
    mutationFn: ({ asins, folder_id }) => scrapeApi.bulk({ asins, folder_id, marketplace }),
    onSuccess: () => { qc.invalidateQueries(['products']); setShowFolderModal(false); setSelected([]); },
  });

  const handleSearch = () => {
    if (mode === 'similar') {
      startSearch.mutate({ geo, day_from: dayFrom, day_to: dayTo, min_price: minPrice ? Number(minPrice) : undefined, max_price: maxPrice ? Number(maxPrice) : undefined });
      return;
    }
    const q = queries.split('\n').map(s => s.trim()).filter(Boolean);
    if (!q.length) return;
    startSearch.mutate({ queries: q, marketplace, min_price: minPrice ? Number(minPrice) : undefined, max_price: maxPrice ? Number(maxPrice) : undefined });
  };

  const toggle = (asin) => setSelected(prev => prev.includes(asin) ? prev.filter(a => a !== asin) : [...prev, asin]);
  const isSearching = !!jobId || startSearch.isPending;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Поиск на Amazon</h1>
        <p className="text-sm text-gray-500 mt-0.5">Поиск идёт через агента на Mac в профиле для скрапа; проверку на робота проходит человек</p>
      </div>

      <div className="flex gap-2 mb-3">
        {[['queries', 'По запросам'], ['similar', 'Похожие на продающие']].map(([k, label]) => (
          <button key={k} onClick={() => setMode(k)}
            className={clsx('text-xs px-3 py-1.5 rounded-lg border', mode === k ? 'border-indigo-500 text-indigo-300 bg-indigo-600/10' : 'border-[color:var(--c2d3148)] text-gray-500')}>
            {label}
          </button>
        ))}
      </div>

      {/* Search Form */}
      <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {mode === 'similar' ? (
          <div className="md:col-span-3 grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Гео залива</label>
              <input value={geo} onChange={e => setGeo(e.target.value.toUpperCase().slice(0, 2))}
                className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white" placeholder="FR" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Продажи с</label>
              <input type="date" value={dayFrom} onChange={e => setDayFrom(e.target.value)}
                className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">по</label>
              <input type="date" value={dayTo} onChange={e => setDayTo(e.target.value)}
                className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white" />
            </div>
            <div className="col-span-3 text-xs text-gray-500">Образцы — наши товары с продажами в Keitaro за период; товары с продажами в этом гео идут первыми. Витрина Amazon — страны гео.</div>
          </div>
          ) : (
          <div className="md:col-span-3">
            <label className="block text-xs text-gray-400 mb-1.5">Запросы (один на строке)</label>
            <textarea
              value={queries}
              onChange={e => setQueries(e.target.value)}
              rows={4}
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="sapin de noel artificiel&#10;guirlande lumineuse extérieur&#10;boules de noel"
            />
          </div>
          )}
          {mode === 'queries' && <div>
            <label className="block text-xs text-gray-400 mb-1.5">Маркетплейс</label>
            <select
              value={marketplace}
              onChange={e => setMarketplace(e.target.value)}
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="fr">🇫🇷 Amazon.fr</option>
              <option value="es">🇪🇸 Amazon.es</option>
              <option value="de">🇩🇪 Amazon.de</option>
              <option value="it">🇮🇹 Amazon.it</option>
              <option value="uk">🇬🇧 Amazon.co.uk</option>
              <option value="com">🇺🇸 Amazon.com</option>
            </select>
          </div>}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Мин. цена (€)</label>
            <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)}
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder="80" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Макс. цена (€)</label>
            <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder="500" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSearch}
            disabled={isSearching || (mode === 'queries' ? !queries.trim() : !(geo.length === 2 && dayFrom && dayTo))}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
          >
            {isSearching ? '🔍 Ищем...' : '🔍 Искать'}
          </button>
          {isSearching && <span className="text-sm text-gray-400 animate-pulse">Сканируем Amazon, подожди...</span>}
          {results.length > 0 && !isSearching && (
            <span className="text-sm text-gray-400">Найдено {results.length} товаров</span>
          )}
        </div>
        {failed && <div className="text-sm text-red-400 mt-3">{failed}</div>}
        {info?.note && <div className="text-sm text-amber-400 mt-3">{info.note}</div>}
        {info?.samples?.length > 0 && (
          <div className="text-xs text-gray-400 mt-3">Образцы: {info.samples.map(x => `${x.title} (продаж ${x.sales}${x.geo_sales ? `, в гео ${x.geo_sales}` : ''})`).join(' · ')}</div>
        )}
        {info?.errors?.length > 0 && <div className="text-xs text-red-400/80 mt-2">Не вышло: {info.errors.join(' · ')}</div>}
      </div>

      {/* Search history */}
      {searchHistory.length > 0 && !results.length && (
        <div className="mb-6">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Недавние поиски</div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.slice(0, 10).map((item, i) => (
              <button
                key={i}
                onClick={() => {
                  const q = item.queries?.join('\n') || item.query || '';
                  setQueries(q);
                  if (item.marketplace) setMarketplace(item.marketplace);
                }}
                className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] hover:border-indigo-500/50 rounded-lg px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors text-left"
              >
                <div className="font-medium text-gray-300 truncate max-w-[200px]">
                  {(item.queries?.[0] || item.query || '').slice(0, 40)}
                </div>
                {item.results_count != null && (
                  <div className="text-gray-600 mt-0.5">{item.results_count} результатов</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bulk actions */}
      {selected.length > 0 && (
        <div className="bg-indigo-900/30 border border-indigo-700 rounded-xl p-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-indigo-300">{selected.length} выбрано</span>
          <button
            onClick={() => setShowFolderModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
          >
            Добавить в папку →
          </button>
        </div>
      )}

      {/* Results Grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {results.map(item => (
            <div
              key={item.asin}
              onClick={() => toggle(item.asin)}
              className={clsx(
                'bg-[color:var(--c13162b)] border rounded-xl overflow-hidden cursor-pointer transition-all',
                selected.includes(item.asin)
                  ? 'border-indigo-500 ring-1 ring-indigo-500'
                  : 'border-[color:var(--c2d3148)] hover:border-[color:var(--c4a5070)]'
              )}
            >
              <div className="aspect-square bg-[color:var(--c0f1117)] relative overflow-hidden">
                {item.image ? (
                  <img src={item.image} alt="" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-700 text-2xl">📷</div>
                )}
                {selected.includes(item.asin) && (
                  <div className="absolute top-2 right-2 w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs">✓</div>
                )}
                <div className="absolute bottom-1 left-2 text-xs text-gray-600 font-mono">{item.asin}</div>
              </div>
              <div className="p-2.5">
                <div className="text-xs text-gray-300 leading-tight line-clamp-2 mb-1.5">{item.title}</div>
                {item.price && <div className="text-sm font-semibold text-white">{item.price}€</div>}
                {item.rating && (
                  <div className="text-xs text-yellow-400 mt-0.5">★ {item.rating} ({item.reviews_count})</div>
                )}
                {item.sample && <div className={clsx('text-[10px] mt-1 truncate', item.geo_sales ? 'text-emerald-400' : 'text-gray-600')} title={item.sample}>похож на: {item.sample}</div>}
                {item.sponsored && <div className="text-[10px] text-gray-600">реклама в выдаче</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-white mb-4">Добавить {selected.length} товаров в папку</h2>
            <select
              value={targetFolderId}
              onChange={e => setTargetFolderId(e.target.value)}
              className="w-full bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 mb-4"
            >
              <option value="">— Выбери папку —</option>
              {folderList.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <div className="flex gap-3">
              <button
                onClick={() => addToFolder.mutate({ asins: selected, folder_id: targetFolderId || undefined })}
                disabled={addToFolder.isPending}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {addToFolder.isPending ? 'Добавляем...' : 'Добавить в папку'}
              </button>
              <button onClick={() => setShowFolderModal(false)} className="px-4 text-gray-400 hover:text-white text-sm">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
