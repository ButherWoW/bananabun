import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, pushes as pushesApi } from '../api/client.js';
import clsx from 'clsx';

const push = {
  list: (params) => api.get('/api/push', { params }),
  get: (id) => api.get(`/api/push/${id}`),
  retry: (id) => api.post(`/api/push/${id}/retry`),
};

const STATUS = {
  pending:  { label: 'Ожидает',  color: 'text-yellow-400 bg-yellow-500/10' },
  running:  { label: 'Заливается', color: 'text-blue-400 bg-blue-500/10 animate-pulse' },
  done:     { label: 'Готово',   color: 'text-emerald-400 bg-emerald-500/10' },
  failed:   { label: 'Ошибка',   color: 'text-red-400 bg-red-500/10' },
};

function LogModal({ pushId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['push', pushId],
    queryFn: () => push.get(pushId),
    // v5 passes the query, not the data.
    refetchInterval: (q) => ['pending', 'running'].includes(q.state.data?.status) ? 3000 : false,
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--c2d3148)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white">Залив #{pushId?.slice(-6)}</span>
            {data && (
              <span className={clsx('text-[10px] px-2 py-0.5 rounded font-medium', STATUS[data.status]?.color)}>
                {STATUS[data.status]?.label || data.status}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs text-gray-400 space-y-1">
          {isLoading && <div className="text-gray-600 animate-pulse">Загрузка...</div>}
          {data?.error && (
            <div className="text-red-400 bg-red-500/10 rounded p-2 mb-2">❌ {data.error}</div>
          )}
          {data?.log?.map((entry, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-gray-700 flex-shrink-0">{new Date(entry.ts).toLocaleTimeString()}</span>
              <span className={clsx(
                entry.step === 'done' ? 'text-emerald-400' :
                entry.step?.includes('error') ? 'text-red-400' : 'text-gray-400'
              )}>{entry.step}</span>
              {Object.entries(entry).filter(([k]) => !['ts', 'step'].includes(k)).map(([k, v]) => (
                <span key={k} className="text-gray-600">{k}={JSON.stringify(v)}</span>
              ))}
            </div>
          ))}
          {data?.log?.length === 0 && <div className="text-gray-700">Лог пуст</div>}
        </div>

        {data?.status === 'failed' && (
          <div className="px-5 py-3 border-t border-[color:var(--c2d3148)] flex justify-end">
            <RetryButton pushId={pushId} onClose={onClose} />
          </div>
        )}
      </div>
    </div>
  );
}

function ProblemShotPanel({ pushId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['push-trace', pushId],
    queryFn: () => pushesApi.trace(pushId),
    staleTime: 300000,
    retry: 1,
  });

  const steps = data?.steps || data?.trace || data?.log || [];
  const screenshotUrl = steps.reduce((found, step) => {
    return found || step.screenshot_url || step.screenshot || step.error_screenshot || null;
  }, null) || data?.screenshot_url || data?.screenshot;

  if (isLoading) return <div className="p-3 text-xs text-gray-500 animate-pulse">Загрузка...</div>;

  if (!screenshotUrl) {
    const errorStep = steps.filter(s => s.status === 'error' || s.status === 'failed').pop();
    return (
      <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
        <div className="text-[10px] text-red-400/80 font-mono">
          {errorStep ? (errorStep.error || errorStep.message || errorStep.name || 'Ошибка без деталей') : 'Скриншот недоступен'}
        </div>
        {steps.length > 0 && (
          <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
            {steps.slice(-5).map((s, i) => (
              <div key={i} className={`text-[9px] flex gap-1 ${s.status === 'error' ? 'text-red-400' : 'text-gray-600'}`}>
                <span>{s.status === 'error' ? '✗' : '·'}</span>
                <span>{s.name || s.step || s.message || ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-3">
      <img src={screenshotUrl} alt="Error screenshot" className="w-full max-h-64 object-contain rounded border border-[color:var(--c2d3148)]" />
    </div>
  );
}

function RetryButton({ pushId, onClose }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => push.retry(pushId),
    onSuccess: () => { qc.invalidateQueries(['pushes']); qc.invalidateQueries(['push', pushId]); },
  });
  return (
    <button onClick={() => mut.mutate()} disabled={mut.isPending}
      className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50">
      {mut.isPending ? 'Повтор...' : '↻ Повторить'}
    </button>
  );
}

export default function PushesPage() {
  const qc = useQueryClient();
  const [logId, setLogId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [showDismissed, setShowDismissed] = useState(false);
  const [problemShotId, setProblemShotId] = useState(null);

  const params = {};
  if (statusFilter) params.status = statusFilter;
  if (showDismissed) params.dismissed = 'true';

  const { data: pushes = [], isLoading } = useQuery({
    queryKey: ['pushes', statusFilter, showDismissed],
    queryFn: () => push.list(params),
    refetchInterval: 10000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id) => pushesApi.dismiss(id),
    onSuccess: () => qc.invalidateQueries(['pushes']),
  });

  const restoreMutation = useMutation({
    mutationFn: (id) => pushesApi.restore(id),
    onSuccess: () => qc.invalidateQueries(['pushes']),
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
        <h1 className="text-lg font-semibold text-white">История заливов</h1>
        <div className="flex gap-2">
          {!showDismissed && ['', 'running', 'done', 'failed'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={clsx('text-xs px-3 py-1 rounded-lg border transition-colors',
                statusFilter === s
                  ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                  : 'border-[color:var(--c2d3148)] text-gray-500 hover:text-white'
              )}>
              {s === '' ? 'Все' : STATUS[s]?.label}
            </button>
          ))}
          <button
            onClick={() => { setShowDismissed(v => !v); setStatusFilter(''); }}
            className={clsx('text-xs px-3 py-1 rounded-lg border transition-colors',
              showDismissed
                ? 'border-gray-500 bg-gray-500/10 text-gray-300'
                : 'border-[color:var(--c2d3148)] text-gray-600 hover:text-gray-400'
            )}
          >
            Убранные
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-500 text-sm animate-pulse">Загрузка...</div>
        ) : pushes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <p className="text-gray-500 text-sm">Заливов пока нет</p>
            <p className="text-gray-600 text-xs">Нажми «Залить» на странице Кампаний</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pushes.map(p => {
              const st = STATUS[p.status] || STATUS.pending;
              const params = p.params || {};
              return (
                <div key={p.id} className="rounded-lg overflow-hidden">
                <div
                  className="bg-[color:var(--c13162b)] border border-[color:var(--c2d3148)] rounded-lg px-4 py-3 flex items-center gap-4 hover:border-indigo-500/30 cursor-pointer transition-colors"
                  onClick={() => setLogId(p.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm text-white font-medium truncate">
                        {params.campaign_name || p.product_name || p.id}
                      </span>
                      {params.countries?.length > 0 && (
                        <span className="text-[10px] text-gray-500 bg-[color:var(--c1e2240)] px-1.5 py-0.5 rounded">
                          {params.countries.join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-gray-600">
                      <span>{new Date(p.created_at).toLocaleString('ru')}</span>
                      {p.kt_campaign_id && <span>Keitaro #{p.kt_campaign_id}</span>}
                      {p.fb_campaign_id && <span>FB #{p.fb_campaign_id}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {params.daily_budget && (
                      <span className="text-xs text-gray-500">{params.daily_budget}€/д</span>
                    )}
                    <span className={clsx('text-[11px] px-2 py-0.5 rounded font-medium', st.color)}>
                      {st.label}
                    </span>
                    {p.status === 'failed' && (
                      <button
                        onClick={e => { e.stopPropagation(); setProblemShotId(prev => prev === p.id ? null : p.id); }}
                        className={clsx('text-[10px] px-2 py-0.5 rounded transition-colors',
                          problemShotId === p.id
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'
                        )}
                        title="Скриншот ошибки"
                      >📸</button>
                    )}
                    {p.status === 'failed' && !showDismissed && (
                      <button
                        onClick={e => { e.stopPropagation(); dismissMutation.mutate(p.id); }}
                        className="text-xs text-gray-600 hover:text-gray-400 px-2 py-0.5 rounded hover:bg-white/5 transition-colors"
                        title="Убрать из списка"
                      >
                        Убрать
                      </button>
                    )}
                    {showDismissed && (
                      <button
                        onClick={e => { e.stopPropagation(); restoreMutation.mutate(p.id); }}
                        className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded hover:bg-indigo-500/10 transition-colors"
                        title="Восстановить"
                      >
                        ↩ Вернуть
                      </button>
                    )}
                    <span className="text-gray-600 text-xs">→</span>
                  </div>
                </div>
                {problemShotId === p.id && (
                  <div className="bg-[color:var(--c0e1221)] border border-t-0 border-[color:var(--c2d3148)] rounded-b-lg px-4 pb-3">
                    <ProblemShotPanel pushId={p.id} />
                  </div>
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {logId && <LogModal pushId={logId} onClose={() => setLogId(null)} />}
    </div>
  );
}
