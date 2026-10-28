import React, { useEffect, useState } from 'react';

const EVENT = 'bananabun:toast';

export function toast(message, kind = 'error') {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, kind } }));
}

export function errorText(err) {
  return err?.error || err?.message || 'Что-то пошло не так';
}

export default function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let seq = 0;
    const onToast = (e) => {
      const id = ++seq;
      setItems(list => [...list.filter(t => t.message !== e.detail.message), { id, ...e.detail }].slice(-4));
      setTimeout(() => setItems(list => list.filter(t => t.id !== id)), 6000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  if (!items.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {items.map(t => (
        <div
          key={t.id}
          role="alert"
          className={t.kind === 'error'
            ? 'bg-[color:var(--c2a1215)] border border-red-500/40 text-red-200 text-sm rounded-lg px-4 py-3 shadow-lg'
            : 'bg-[color:var(--c0f2a1c)] border border-emerald-500/40 text-emerald-200 text-sm rounded-lg px-4 py-3 shadow-lg'}
        >
          <div className="flex items-start gap-3">
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              onClick={() => setItems(list => list.filter(x => x.id !== t.id))}
              className="text-current opacity-60 hover:opacity-100"
              aria-label="Закрыть"
            >×</button>
          </div>
        </div>
      ))}
    </div>
  );
}
