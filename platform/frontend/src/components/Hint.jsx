import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import HINTS from '../help/hints.js';

const WIDTH = 288;
const GAP = 8;

// A "?" button next to a column or field; the text lives in help/hints.js under key `k`.
export default function Hint({ k, className = '' }) {
  const hint = HINTS[k];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const pop = useRef(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const width = Math.min(WIDTH, vw - 2 * GAP);
      const left = Math.min(Math.max(GAP, r.left + r.width / 2 - width / 2), vw - width - GAP);
      const h = pop.current?.offsetHeight || 120;
      const below = r.bottom + GAP;
      const top = below + h > vh - GAP && r.top - GAP - h > GAP ? r.top - GAP - h : Math.min(below, Math.max(GAP, vh - h - GAP));
      setPos({ left, top, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!hint) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`Что это: ${hint.title}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        className={`inline-flex items-center justify-center shrink-0 w-4 h-4 ml-1 rounded-full border border-gray-500/60 text-[10px] leading-none font-semibold normal-case tracking-normal text-gray-400 hover:text-white hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 align-middle ${className}`}
      >?</button>
      {open && createPortal(
        <div
          ref={pop}
          id={id}
          role="dialog"
          aria-label={hint.title}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', zIndex: 1000, left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: pos?.width ?? WIDTH,
            background: 'var(--c13162b)', color: 'var(--page-fg)', border: '1px solid var(--c2d3148)',
          }}
          className="rounded-lg shadow-xl p-3 text-left text-xs leading-relaxed normal-case tracking-normal font-normal whitespace-normal"
        >
          <div className="font-semibold text-sm mb-1">{hint.title}</div>
          <div className="opacity-80">{hint.text}</div>
          {hint.example && <div className="mt-1.5 opacity-60">Пример: {hint.example}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
