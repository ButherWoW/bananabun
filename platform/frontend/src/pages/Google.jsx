import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

const FEATURES = [
  { icon: '📊', title: 'Performance Max', desc: 'Автоматические кампании с AI-оптимизацией по всем плейсментам Google' },
  { icon: '🛒', title: 'Shopping Ads', desc: 'Товарные объявления в поиске и Google Shopping с фото и ценой' },
  { icon: '🎯', title: 'Search Campaigns', desc: 'Текстовые объявления по ключевым словам с точным таргетом' },
  { icon: '📺', title: 'YouTube Ads', desc: 'Видеореклама: TrueView, Bumper, Non-skippable на YouTube' },
  { icon: '🌐', title: 'Display Network', desc: 'Баннеры и ремаркетинг на 2 млн+ сайтов и приложений' },
  { icon: '📈', title: 'Smart Bidding', desc: 'Автоматические ставки: Target CPA, Target ROAS, Maximize Conversions' },
];

export default function GooglePage() {
  const [tab, setTab] = useState('accounts');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[color:var(--c1e2240)] px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center text-lg">
            🔷
          </div>
          <div>
            <div className="font-semibold text-white text-sm">Google Ads</div>
            <div className="text-[11px] text-gray-500">Управление рекламными кабинетами Google</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2.5 py-1 rounded-full font-medium">
            Скоро
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 border-b border-[color:var(--c1e2240)] flex-shrink-0">
        {[
          { id: 'accounts', label: 'Аккаунты' },
          { id: 'push', label: 'Залив' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Coming soon banner */}
        <div className="mb-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 flex items-start gap-4">
          <div className="text-3xl flex-shrink-0">🔷</div>
          <div>
            <div className="font-semibold text-white mb-1">Интеграция Google Ads в разработке</div>
            <div className="text-sm text-gray-400 leading-relaxed">
              Мы добавляем поддержку Google Ads Campaigns API. После подключения вы сможете заливать кампании
              прямо из платформы — так же, как сейчас делаете для Facebook и TikTok.
            </div>
          </div>
        </div>

        {/* Planned features */}
        <div className="mb-2 text-[11px] text-gray-500 uppercase tracking-wider font-medium">Что будет доступно</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-xl border border-[color:var(--c1e2240)] bg-[color:var(--c0d0f1e)] p-4 flex gap-3 opacity-60">
              <div className="text-2xl flex-shrink-0">{f.icon}</div>
              <div>
                <div className="text-sm font-semibold text-white mb-1">{f.title}</div>
                <div className="text-xs text-gray-500 leading-relaxed">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* What to prepare */}
        <div className="mt-6 rounded-xl border border-[color:var(--c1e2240)] bg-[color:var(--c0d0f1e)] p-5">
          <div className="font-semibold text-white mb-3 text-sm">Что подготовить заранее</div>
          <ul className="space-y-2 text-sm text-gray-400">
            <li className="flex items-start gap-2">
              <span className="text-green-400 flex-shrink-0">1.</span>
              Зарегистрировать приложение в Google Cloud Console → получить OAuth Client ID + Secret
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 flex-shrink-0">2.</span>
              Запросить доступ к Google Ads API через форму на developers.google.com/google-ads/api/docs/first-call/overview
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 flex-shrink-0">3.</span>
              Получить Developer Token (после одобрения Google, обычно 1-3 рабочих дня)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 flex-shrink-0">4.</span>
              Добавить в .env сервера: <code className="text-xs bg-black/30 px-1.5 py-0.5 rounded text-green-400">GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_DEVELOPER_TOKEN</code>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
