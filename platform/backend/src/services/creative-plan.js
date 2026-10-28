export const CREATIVE_STYLES = ['clean', 'dark', 'gradient', 'bold', 'minimal'];
export function creativePlan(body = {}) {
  const bad = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  if (body.source && !['local', 'own'].includes(body.source)) {
    throw Object.assign(new Error('FA отключён. Выберите собственную генерацию.'), { statusCode: 410, code: 'FA_DISABLED' });
  }
  const count = Number(body.count ?? 3);
  if (!Number.isInteger(count) || count < 1 || count > 10) bad('Количество креативов — целое число от 1 до 10');
  const format = String(body.format || '1x1').replace(':', 'x');
  if (!['1x1', '3x2', '2x3', '4x5', '9x16'].includes(format)) bad('Неподдерживаемый формат креатива');
  const styles = body.styles;
  if (styles !== undefined && (!Array.isArray(styles) || !styles.length || styles.length > 10 || styles.some(s => !CREATIVE_STYLES.includes(s)))) bad('Выберите от 1 до 10 доступных стилей');
  return { format, styles: styles || Array.from({ length: count }, (_, i) => CREATIVE_STYLES[i % CREATIVE_STYLES.length]) };
}
