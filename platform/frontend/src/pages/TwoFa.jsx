import React, { useEffect, useState } from 'react';
import { CodeDisplay, cleanSecret, secondsLeft, totpCode, useTick } from '../components/TwoFaCode.jsx';

// One key per line: a bare key, «KEY» with spaces, or a 2FA-site link (…/KEY).
function parseLines(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 50).map(line => {
    const runs = line.toUpperCase().match(/[A-Z2-7]{4}(?: ?[A-Z2-7]{4}){3,31}/g) || [];
    const key = runs.length ? cleanSecret(runs[runs.length - 1]) : '';
    return { line, key };
  });
}

export default function TwoFaPage() {
  const [text, setText] = useState('');
  const [codes, setCodes] = useState([]);
  const now = useTick();
  const step = Math.floor(now / 30000);
  const items = parseLines(text);
  const sig = items.map(i => i.key).join(',');

  useEffect(() => {
    let alive = true;
    Promise.all(items.map(i => (i.key ? totpCode(i.key) : null))).then(c => { if (alive) setCodes(c); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, step]);

  const left = secondsLeft(now);
  const mask = (k) => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k);

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-white">Коды 2FA</h1>
        <p className="text-xs text-gray-500 mt-1">
          Вставьте ключ 2FA — по одному на строку, можно ссылкой вида 2fa.fb.tools/КЛЮЧ. Код считается прямо в браузере:
          ключ не отправляется ни на наш сервер, ни на сторонние сайты и не сохраняется. Коды для аккаунтов из AdsPower — кнопка «🔐 2FA» в разделе «Аккаунты».
        </p>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} spellCheck={false} autoComplete="off"
        placeholder="ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567"
        className="w-full rounded-xl bg-[color:var(--c0d0f1e)] border border-[color:var(--c2d3148)] px-4 py-3 text-sm text-white font-mono focus:outline-none focus:border-teal-400" />
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500 font-mono w-28 truncate">{it.key ? mask(it.key) : '—'}</span>
            {it.key && codes[i] ? <CodeDisplay code={codes[i]} left={left} />
              : <span className="text-xs text-red-400">не похоже на ключ 2FA (буквы A–Z и цифры 2–7, от 16 знаков)</span>}
          </div>
        ))}
      </div>
      {items.length > 0 && <button type="button" onClick={() => setText('')} className="text-xs text-gray-500 hover:text-gray-300">Очистить</button>}
    </div>
  );
}
