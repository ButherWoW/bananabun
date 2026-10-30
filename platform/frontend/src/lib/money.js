// Amount with the currency sign from the data (ISO code). No conversion: unknown code → plain number + code.
export function money(n, currency, decimals = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const ccy = String(currency || '').toUpperCase();
  try {
    if (/^[A-Z]{3}$/.test(ccy)) {
      return Number(n).toLocaleString('ru-RU', { style: 'currency', currency: ccy, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
  } catch { /* unknown code */ }
  return `${Number(n).toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${ccy ? ' ' + ccy : ''}`;
}

// «50 $, 12 €» for amounts kept apart because they are in another currency.
export function otherCurrencies(map) {
  const parts = Object.entries(map || {}).filter(([, v]) => Number(v)).map(([c, v]) => money(v, c));
  return parts.join(', ');
}
