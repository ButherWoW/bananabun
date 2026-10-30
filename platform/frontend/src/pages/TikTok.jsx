import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tiktok } from '../api/client.js';
import GenerateLandingModal from '../components/GenerateLandingModal.jsx';
import { toast } from '../components/Toaster.jsx';

function AccountCard({ account, onRemove, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name || '');

  return (
    <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            {editing ? (
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={() => { onUpdate(account.id, { name }); setEditing(false); }}
                onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                className="bg-[color:var(--c0f1117)] border border-indigo-500/50 rounded px-2 py-0.5 text-sm text-white focus:outline-none"
                autoFocus
              />
            ) : (
              <span onClick={() => setEditing(true)} className="cursor-text hover:text-indigo-300 transition-colors">
                {account.name || 'TikTok Ads'}
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              account.status === 'active' ? 'bg-green-500/20 text-green-400' :
              account.status === 'paused' ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-red-500/20 text-red-400'
            }`}>{account.status}</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">ID: {account.advertiser_id}</div>
        </div>
        <button
          onClick={() => onRemove(account.id)}
          className="text-gray-600 hover:text-red-400 transition-colors text-sm"
          title="Удалить"
        >✕</button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
        {account.currency && <div><span className="text-gray-600">Валюта:</span> {account.currency}</div>}
        {account.timezone && <div><span className="text-gray-600">TZ:</span> {account.timezone}</div>}
        {account.pixel_id && <div className="col-span-2"><span className="text-gray-600">Pixel:</span> {account.pixel_id}</div>}
      </div>
    </div>
  );
}

function AddAccountModal({ onClose, onAdded }) {
  const [advertiser_id, setAdvertiserId] = useState('');
  const [access_token, setToken] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  const add = useMutation({
    mutationFn: () => tiktok.addAccount({ advertiser_id: advertiser_id.trim(), access_token: access_token.trim(), name: name.trim() }),
    onSuccess: () => { onAdded(); onClose(); },
    onError: (e) => setErr(e?.error || e?.message || 'Ошибка'),
  });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl p-6 w-full max-w-md flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Добавить TikTok аккаунт</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400">
          Advertiser ID
          <input value={advertiser_id} onChange={e => setAdvertiserId(e.target.value)}
            placeholder="12345678901234567"
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400">
          Access Token
          <input value={access_token} onChange={e => setToken(e.target.value)} type="password"
            placeholder="••••••••"
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400">
          Название (необязательно)
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="Мой TikTok кабинет"
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </label>
        {err && <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{err}</div>}
        <button
          onClick={() => add.mutate()}
          disabled={!advertiser_id.trim() || !access_token.trim() || add.isPending}
          className="w-full py-2.5 rounded-lg bg-[#00f2ea] hover:bg-[#00d9d2] text-black font-semibold text-sm transition-colors disabled:opacity-40"
        >
          {add.isPending ? 'Добавляем...' : 'Добавить аккаунт'}
        </button>
      </div>
    </div>
  );
}

function PushTab({ accounts }) {
  const [form, setForm] = useState({
    account_id: '',
    product_id: '',
    video_url: '',
    headline: '',
    budget_daily: '20',
    geo: 'FR',
    age_min: '18',
    age_max: '55',
  });
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [showLandingModal, setShowLandingModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [launchErr, setLaunchErr] = useState('');

  const launchCampaign = async () => {
    if (!result?.campaign_id || !result?.advertiser_id) return;
    setLaunching(true); setLaunchErr('');
    try {
      await tiktok.setCampaignStatus(result.campaign_id, result.advertiser_id, 'ENABLE');
      setLaunched(true);
    } catch (e) { setLaunchErr(e?.error || e?.message || 'Error'); }
    finally { setLaunching(false); }
  };

  const push = useMutation({
    mutationFn: () => tiktok.push({
      account_id: form.account_id,
      product_id: form.product_id,
      video_url: form.video_url,
      headline: form.headline,
      budget_daily: parseFloat(form.budget_daily),
      geo: form.geo,
      age_min: parseInt(form.age_min),
      age_max: parseInt(form.age_max),
    }),
    onSuccess: (r) => { setResult(r); setErr(''); setLaunched(false); setLaunchErr(''); },
    onError: (e) => setErr(e?.error || e?.message || 'Ошибка залива'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const generateVideo = async () => {
    if (!form.product_id) { setGenMsg('Введите Product ID'); return; }
    setGenerating(true);
    setGenMsg('');
    try {
      const res = await tiktok.generateVideo(form.product_id);
      if (res?.fallback) {
        setGenMsg('ffmpeg не установлен на сервере — вставьте URL вручную');
      } else if (res?.video_url) {
        set('video_url', res.video_url);
        setGenMsg('✅ Видео готово!');
      }
    } catch (e) {
      setGenMsg(e?.error || e?.message || 'Ошибка генерации');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-xl flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-gray-400 col-span-2">
          TikTok аккаунт
          <select value={form.account_id} onChange={e => set('account_id', e.target.value)}
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="">— выберите аккаунт —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name || a.advertiser_id}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400 col-span-2">
          Product ID (из платформы)
          <input value={form.product_id} onChange={e => set('product_id', e.target.value)}
            placeholder="prod_abc123"
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400 col-span-2">
          URL лендинга
          <div className="flex gap-2">
            <input value={form.landing_page_url || ''} onChange={e => set('landing_page_url', e.target.value)}
              placeholder="https://your-landing.com"
              className="flex-1 bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            <button type="button" onClick={() => setShowLandingModal(true)} disabled={!form.product_id}
              className="px-3 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 text-xs font-medium border border-indigo-500/30 transition-colors disabled:opacity-40 whitespace-nowrap"
              title="Generate landing in Keitaro and paste URL">🌐 Landing
            </button>
          </div>
          {form.landing_page_url && <span className="text-xs text-green-400">URL set</span>}
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400 col-span-2">
          Link to video
          <div className="flex gap-2">
            <input value={form.video_url} onChange={e => set('video_url', e.target.value)}
              placeholder="https://example.com/video.mp4"
              className="flex-1 bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            <button
              type="button"
              onClick={generateVideo}
              disabled={generating || !form.product_id}
              className="px-3 py-2 rounded-lg bg-[#00f2ea]/10 hover:bg-[#00f2ea]/20 text-[#00f2ea] text-xs font-medium border border-[#00f2ea]/30 transition-colors disabled:opacity-40 whitespace-nowrap"
              title="Сгенерировать слайдшоу из фото товара"
            >
              {generating ? '⏳ ...' : '🎬 Из фото'}
            </button>
          </div>
          {genMsg && (
            <span className={`text-xs ${genMsg.startsWith('✅') ? 'text-green-400' : 'text-yellow-400'}`}>
              {genMsg}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400 col-span-2">
          Заголовок объявления
          <input value={form.headline} onChange={e => set('headline', e.target.value)}
            placeholder="Лучшая цена на Amazon!"
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400">
          Гео
          <select value={form.geo} onChange={e => set('geo', e.target.value)}
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
            {['FR','BE','DE','NL','ES','IT','PL','PT','SE','NO','DK','FI','AT','CH','GB','US','CA'].map(g =>
              <option key={g} value={g}>{g}</option>
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400">
          Дневной бюджет ($)
          <input type="number" value={form.budget_daily} onChange={e => set('budget_daily', e.target.value)} min="1"
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400">
          Возраст от
          <input type="number" value={form.age_min} onChange={e => set('age_min', e.target.value)} min="18" max="55"
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-gray-400">
          Возраст до
          <input type="number" value={form.age_max} onChange={e => set('age_max', e.target.value)} min="18" max="55"
            className="bg-[color:var(--c0f1117)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
        </label>
      </div>
      {err && <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{err}</div>}
      {result && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 flex flex-col gap-3">
          <div className="text-xs text-green-400 font-medium">OK</div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            <span className="text-gray-500">Campaign:</span><code className="text-green-300">{result.campaign_id}</code>
            <span className="text-gray-500">AdGroup:</span><code className="text-green-300">{result.adgroup_id}</code>
          </div>
          {launched ? (
            <div className="text-xs text-green-400">Running</div>
          ) : (
            <button onClick={launchCampaign} disabled={launching}
              className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold text-sm transition-colors disabled:opacity-50">
              {launching ? 'Starting...' : 'Start campaign'}
            </button>
          )}
          {launchErr && <div className="text-xs text-red-400">{launchErr}</div>}
        </div>
      )}
      <button
        onClick={() => push.mutate()}
        disabled={!form.account_id || !form.video_url || push.isPending}
        className="w-full py-3 rounded-lg bg-[#00f2ea] hover:bg-[#00d9d2] text-black font-bold text-sm transition-colors disabled:opacity-40"
      >
        {push.isPending ? 'Заливаем...' : '🚀 Залить в TikTok'}
      </button>
      <p className="text-xs text-gray-600">Кампания создаётся в статусе DISABLED — активируйте вручную в TikTok Ads Manager после проверки.</p>
    </div>
  );
}

export default function TikTokPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('accounts');
  const [showAdd, setShowAdd] = useState(false);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['tiktok-accounts'],
    queryFn: tiktok.accounts,
  });

  const removeMutation = useMutation({
    mutationFn: (id) => tiktok.removeAccount(id),
    onSuccess: () => qc.invalidateQueries(['tiktok-accounts']),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => tiktok.updateAccount(id, data),
    onSuccess: () => qc.invalidateQueries(['tiktok-accounts']),
  });

  const connectOAuth = async () => {
    try {
      const res = await tiktok.oauthUrl();
      if (res?.url) window.location.href = res.url;
    } catch (e) {
      toast(e?.error || 'OAuth не настроен. Установите TIKTOK_APP_ID и TIKTOK_APP_SECRET на сервере.');
    }
  };

  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);

  const doRefreshTokens = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const res = await tiktok.refreshTokens();
      setRefreshResult(res);
      qc.invalidateQueries(['tiktok-accounts']);
    } catch (e) {
      setRefreshResult({ error: e?.error || e?.message || 'Ошибка обновления' });
      toast(e?.error || e?.message || 'Ошибка обновления');
    } finally {
      setRefreshing(false);
    }
  };


  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-[color:var(--c1e2240)] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎵</span>
          <span className="font-semibold text-white">TikTok Ads</span>
        </div>
        <div className="flex items-center gap-1 bg-[color:var(--c13162b)] rounded-lg p-1 border border-[color:var(--c2d3148)]">
          {['accounts', 'push'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
              }`}>
              {t === 'accounts' ? 'Аккаунты' : 'Залив'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={connectOAuth}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00f2ea]/10 hover:bg-[#00f2ea]/20 text-[#00f2ea] text-xs font-medium transition-colors border border-[#00f2ea]/30">
            🔗 Подключить OAuth
          </button>
          <button onClick={doRefreshTokens} disabled={refreshing}
            title={refreshResult?.error || (refreshResult?.refreshed != null ? 'Готово' : 'Обновить истекающие токены')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border disabled:opacity-50 ${
              refreshResult?.error ? 'bg-red-500/10 text-red-400 border-red-500/30' :
              refreshResult?.refreshed != null ? 'bg-green-500/10 text-green-400 border-green-500/30' :
              'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30'
            }`}>
            {refreshing ? '⏳ Обновляем...' : refreshResult?.refreshed != null ? `✅ ${refreshResult.refreshed}/${refreshResult.total}` : '🔄 Токены'}
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors">
            + Добавить вручную
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'accounts' && (
          <div>
            {isLoading ? (
              <div className="text-gray-500 text-sm">Загрузка...</div>
            ) : accounts.length === 0 ? (
              <div className="text-center py-16 flex flex-col items-center gap-4">
                <div className="text-5xl">🎵</div>
                <div className="text-gray-400 text-sm">Нет подключённых TikTok аккаунтов</div>
                <div className="flex gap-2">
                  <button onClick={connectOAuth}
                    className="px-4 py-2 rounded-lg bg-[#00f2ea]/10 hover:bg-[#00f2ea]/20 text-[#00f2ea] text-sm font-medium border border-[#00f2ea]/30">
                    🔗 Подключить через OAuth
                  </button>
                  <button onClick={() => setShowAdd(true)}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium">
                    + Добавить вручную
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {accounts.map(a => (
                  <AccountCard key={a.id} account={a}
                    onRemove={(id) => removeMutation.mutate(id)}
                    onUpdate={(id, data) => updateMutation.mutate({ id, data })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'push' && (
          <PushTab accounts={accounts} />
        )}
      </div>

      {showAdd && (
        <AddAccountModal
          onClose={() => setShowAdd(false)}
          onAdded={() => qc.invalidateQueries(['tiktok-accounts'])}
        />
      )}
    </div>
  );
}
