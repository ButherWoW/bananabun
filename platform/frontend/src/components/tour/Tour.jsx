import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTour } from '../../store/tour.js';
import { TOUR_STEPS } from './steps.js';

const PAD = 6;
const CARD_W = 360;

function findTarget(key) {
  if (!key) return null;
  for (const el of document.querySelectorAll(`[data-tour="${key}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const sameRect = (a, b) => a && b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

function cardPosition(rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - 32);
  if (!rect) return { width, left: (vw - width) / 2, top: Math.max(16, vh / 2 - 140) };
  const left = Math.min(Math.max(16, rect.left), vw - width - 16);
  const below = rect.top + rect.height + PAD + 12;
  if (below + 230 < vh) return { width, left, top: below };
  const above = rect.top - PAD - 12 - 230;
  if (above > 16) return { width, left, top: above };
  // Tall element: keep the card beside it, or pinned to the bottom of the screen.
  const side = rect.left + rect.width + PAD + 12;
  if (side + width < vw - 16) return { width, left: side, top: Math.min(Math.max(16, rect.top), vh - 260) };
  return { width, left, top: vh - 260 };
}

export function TourButton() {
  const { start, index, done } = useTour();
  const resume = !done && index > 0;
  return (
    <button
      data-tour="tour-start"
      onClick={() => start()}
      className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/10 text-xs font-medium transition-colors"
      title="Пошаговый учебник по платформе"
    >
      🎓 Учебник{resume ? ` · шаг ${index + 1}` : ''}
    </button>
  );
}

function Offer() {
  const { start, dismissOffer } = useTour();
  return (
    <div className="fixed bottom-4 right-4 z-[10001] w-80 max-w-[calc(100vw-2rem)] bg-[color:var(--c13162b)] border border-yellow-500/40 rounded-xl p-4 shadow-2xl">
      <div className="text-sm font-semibold text-white mb-1">Впервые здесь?</div>
      <div className="text-xs text-gray-400 mb-3 leading-relaxed">Учебник за пару минут покажет весь путь: скрап товара, креативы, залив и переход в AdsPower.</div>
      <div className="flex gap-2">
        <button onClick={() => start(0)} className="flex-1 py-1.5 text-xs font-medium text-black bg-yellow-400 hover:bg-yellow-300 rounded-lg">Начать</button>
        <button onClick={dismissOffer} className="flex-1 py-1.5 text-xs text-gray-400 hover:text-white border border-[color:var(--c2d3148)] rounded-lg">Не сейчас</button>
      </div>
    </div>
  );
}

export default function Tour() {
  const { active, index, go, stop, finish, offered, done } = useTour();
  const navigate = useNavigate();
  const location = useLocation();
  const step = active ? TOUR_STEPS[index] : null;
  const [rect, setRect] = useState(null);
  const [missing, setMissing] = useState(false);
  const pressing = useRef(false);
  const last = index === TOUR_STEPS.length - 1;

  const next = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.target);
    if (step.clickOnNext && el) {
      pressing.current = true;
      el.click();
      setTimeout(() => { pressing.current = false; }, 0);
    }
    if (step.leave) findTarget(step.leave)?.click();
    if (last) finish(); else go(index + 1);
  }, [step, index, last, go, finish]);

  const back = useCallback(() => { if (index > 0) go(index - 1); }, [index, go]);

  useEffect(() => {
    if (step?.route && !location.pathname.startsWith(step.route)) navigate(step.route);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setRect(null);
    setMissing(false);
    if (!step?.target) return;
    const started = Date.now();
    let scrolled = false;
    const tick = () => {
      const el = findTarget(step.target);
      if (el) {
        if (!scrolled) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); scrolled = true; }
        const r = el.getBoundingClientRect();
        const box = { top: r.top, left: r.left, width: r.width, height: r.height };
        setRect(prev => (sameRect(prev, box) ? prev : box));
        setMissing(false);
      } else {
        setRect(null);
        if (Date.now() - started > 2500) setMissing(true);
      }
    };
    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [step]);

  // A real click on the highlighted button advances the tour on its own.
  useEffect(() => {
    if (!step?.waitClick) return;
    const onClick = (e) => {
      if (pressing.current) return;
      const el = findTarget(step.target);
      if (el && el.contains(e.target)) setTimeout(() => { if (step.leave) findTarget(step.leave)?.click(); go(index + 1); }, 300);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step, index, go]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      const t = e.target;
      const typing = t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (e.key === 'Escape') { e.stopPropagation(); stop(); }
      else if (typing) return;
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, next, back, stop]);

  if (!active) return !offered && !done ? <Offer /> : null;

  const hole = rect && {
    top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2,
  };
  const shade = 'fixed bg-black/60 z-[10000]';
  const pos = cardPosition(hole);
  const waiting = step.target && !rect && !missing;

  return (
    <>
      {hole ? (
        <>
          <div className={shade} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className={shade} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div className={shade} style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div className={shade} style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          <div
            className="fixed z-[10000] rounded-lg ring-2 ring-yellow-400 pointer-events-none transition-all duration-150"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height, boxShadow: '0 0 0 4px rgba(250,204,21,0.25)' }}
          />
        </>
      ) : (
        <div className={`${shade} inset-0`} />
      )}

      <div
        role="dialog"
        aria-label={step.title}
        className="fixed z-[10001] bg-[color:var(--c13162b)] border border-yellow-500/40 rounded-xl p-4 shadow-2xl"
        style={{ top: pos.top, left: pos.left, width: pos.width }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-yellow-400/80">Шаг {index + 1} из {TOUR_STEPS.length}</span>
          <button onClick={stop} className="text-gray-500 hover:text-white text-xs" title="Выйти (Esc)">Выйти ✕</button>
        </div>
        <div className="text-sm font-semibold text-white mb-1.5">{step.title}</div>
        <div className="text-xs text-gray-300 leading-relaxed whitespace-pre-line">
          {missing && step.missing ? <span className="text-yellow-200">{step.missing}</span> : step.body}
        </div>
        {waiting && <div className="text-[11px] text-gray-500 mt-2 animate-pulse">Ищу элемент на странице…</div>}
        {step.waitClick && rect && <div className="text-[11px] text-yellow-300/80 mt-2">Нажми подсвеченную кнопку или «Далее».</div>}
        <div className="mt-3 h-1 bg-[color:var(--c1e2240)] rounded-full overflow-hidden">
          <div className="h-full bg-yellow-400" style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }} />
        </div>
        <div className="flex items-center justify-between mt-3">
          <button
            onClick={back}
            disabled={index === 0}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-[color:var(--c2d3148)] rounded-lg disabled:opacity-30"
          >← Назад</button>
          <button
            onClick={next}
            className="px-4 py-1.5 text-xs font-medium text-black bg-yellow-400 hover:bg-yellow-300 rounded-lg"
          >{last ? 'Готово' : 'Далее →'}</button>
        </div>
      </div>
    </>
  );
}
