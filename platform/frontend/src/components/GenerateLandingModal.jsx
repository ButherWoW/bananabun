import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { landingTemplates, landings } from '../api/client.js';

const GEO_OPTIONS = [
  { code: 'FR', flag: '🇫🇷', label: 'France' },
  { code: 'BE', flag: '🇧🇪', label: 'Belgique' },
  { code: 'CH', flag: '🇨🇭', label: 'Suisse' },
  { code: 'DE', flag: '🇩🇪', label: 'Deutschland' },
  { code: 'ES', flag: '🇪🇸', label: 'España' },
  { code: 'IT', flag: '🇮🇹', label: 'Italia' },
  { code: 'NL', flag: '🇳🇱', label: 'Nederland' },
];

const STEPS = ['Компилирую...', 'Загружаю в Keitaro...', 'Создаю кампанию...'];

export default function GenerateLandingModal({ productId, productTitle, onClose, onUrlReady }) {
  const [templateId, setTemplateId] = useState('');
  const [geo, setGeo] = useState('FR');
  const [campaignName, setCampaignName] = useState(`[BB] ${productTitle || ''} [${geo}]`);
  const [stepIdx, setStepIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const updateGeo = (code) => {
    setGeo(code);
    setCampaignName(`[BB] ${productTitle || ''} [${code}]`);
  };

  const { data: templates = [], isLoading: tmplLoading } = useQuery({
    queryKey: ['landing-templates'],
    queryFn: landingTemplates.list,
    retry: false,
  });

  const storeTemplates = templates.filter(t => t.type === 'store');

  const generate = useMutation({
    mutationFn: () => landings.generate({
      product_id: productId,
      template_id: templateId,
      geo,
      name: campaignName.trim() || undefined,
    }),
    onMutate: () => {
      setStepIdx(0);
      const timer1 = setTimeout(() => setStepIdx(1), 1800);
      const timer2 = setTimeout(() => setStepIdx(2), 3600);
      generate._timers = [timer1, timer2];
    },
    onSuccess: (data) => {
      if (generate._timers) generate._timers.forEach(clearTimeout);
      setResult(data);
      if (onUrlReady && data?.campaign_alias) { onUrlReady(data.campaign_alias); onClose(); }
    },
    onError: () => {
      if (generate._timers) generate._timers.forEach(clearTimeout);
    },
  });

  const copyUrl = (url) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const canSubmit = templateId && !generate.isPending;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[color:var(--c0e1221)] border border-[color:var(--c1e2540)] rounded-2xl w-full max-w-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold text-white">🚀 Залить лендинг</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
          </div>

          {productTitle && (
            <div className="text-xs text-gray-500 mb-4 truncate" title={productTitle}>{productTitle}</div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4 mb-4">
              <div className="text-sm font-semibold text-green-400 mb-2">✅ Готово!</div>
              {result.landing_name && (
                <div className="text-xs text-gray-400 mb-1">Лендинг: <span className="text-white">{result.landing_name}</span></div>
              )}
              {result.campaign_alias && (
                <div className="flex items-center gap-2 mt-2">
                  <code className="flex-1 text-xs bg-black/30 rounded px-2 py-1.5 text-indigo-300 truncate">
                    {result.campaign_alias}
                  </code>
                  <button
                    onClick={() => copyUrl(result.campaign_alias)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 transition-colors flex-shrink-0"
                  >
                    {copied ? '✓ Скопировано' : 'Копировать'}
                  </button>
                </div>
              )}
              {result.campaign_name && (
                <div className="text-xs text-gray-500 mt-1">Кампания: {result.campaign_name}</div>
              )}
              {result.campaign_skipped && (
                <div className="text-xs text-yellow-400 mt-1">⚠ {result.campaign_skipped}</div>
              )}
              <button
                onClick={onClose}
                className="mt-3 w-full py-2 text-sm text-gray-400 hover:text-white border border-[color:var(--c2d3148)] rounded-lg transition-colors"
              >
                Закрыть
              </button>
            </div>
          )}

          {!result && (
            <>
              {/* Template */}
              <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-2">Шаблон</label>
                {tmplLoading ? (
                  <div className="text-xs text-gray-500">Загрузка шаблонов...</div>
                ) : storeTemplates.length === 0 ? (
                  <div className="text-xs text-yellow-500">
                    Нет шаблонов типа «store». Создай шаблон на странице Лендинги → кнопки cDiscount / ManoMano / Easy.
                  </div>
                ) : (
                  <select
                    value={templateId}
                    onChange={e => setTemplateId(e.target.value)}
                    className="w-full bg-[color:var(--c141829)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 appearance-none"
                  >
                    <option value="">— Выбрать шаблон —</option>
                    {storeTemplates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Geo */}
              <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-2">Страна</label>
                <div className="flex flex-wrap gap-2">
                  {GEO_OPTIONS.map(g => (
                    <button
                      key={g.code}
                      type="button"
                      onClick={() => updateGeo(g.code)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        geo === g.code
                          ? 'border-indigo-500 bg-indigo-600/30 text-white'
                          : 'border-[color:var(--c2d3148)] text-gray-400 hover:border-[color:var(--c3d4168)] hover:text-gray-200'
                      }`}
                    >
                      {g.flag} {g.code}
                    </button>
                  ))}
                </div>
              </div>

              {/* Campaign name */}
              <div className="mb-5">
                <label className="block text-xs text-gray-400 mb-2">Название кампании (опционально)</label>
                <input
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  placeholder="[BB] Название [FR]"
                  className="w-full bg-[color:var(--c141829)] border border-[color:var(--c2d3148)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Progress */}
              {generate.isPending && (
                <div className="mb-4 flex items-center gap-3 text-sm text-indigo-300">
                  <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  {STEPS[stepIdx]}
                </div>
              )}

              {/* Error */}
              {generate.error && (
                <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {generate.error.error || generate.error.message || 'Ошибка при генерации лендинга'}
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 text-sm text-gray-400 hover:text-white bg-[color:var(--c1a1f3a)] border border-[color:var(--c2d3148)] rounded-xl transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={() => generate.mutate()}
                  disabled={!canSubmit}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl transition-colors"
                >
                  {generate.isPending ? 'Заливаю...' : 'Залить в Keitaro'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
