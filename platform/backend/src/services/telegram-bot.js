// Notification settings inside the bot: inline buttons over the same personal settings as the site.
// Buttons only change what this person receives and when — nothing else can be done from the chat.
import { db } from '../db/client.js';
import {
  EVENTS, eventsFor, botApi, workspaceSettings, userWants, cleanThreshold, siteUrl, esc,
} from './telegram.js';

// Ready-made thresholds for events that have one: field, values and how a value reads.
export const THRESHOLD_PRESETS = {
  spend_over: { field: 'amount', values: [20, 50, 100, 200], label: (v) => `${v}` },
  roi_below: { field: 'roi', values: [-10, -30, -50], label: (v) => `${v}%` },
  agent_offline: { field: 'minutes', values: [10, 15, 30, 60], label: (v) => `${v} мин` },
};
export const WINDOW_PRESETS = [[null, null], [9, 21], [8, 23], [10, 20]];
export const TZ_PRESETS = ['Europe/Moscow', 'Europe/Kyiv', 'Europe/Berlin', 'Asia/Makassar', 'UTC'];
export const DIGEST_PRESETS = [20, 21, 22, 23];

const btn = (text, data) => ({ text, callback_data: data });
const urlBtn = (text, url) => ({ text, url });
const windowLabel = (from, to) => (from == null || to == null || from === to ? 'круглосуточно' : `с ${from}:00 до ${to}:00`);
const thresholdLabel = (event, t = {}) => {
  const p = THRESHOLD_PRESETS[event];
  return p && t[p.field] != null ? p.label(t[p.field]) : '';
};

async function personOf(chatId) {
  const { rows: [r] } = await db.query(`
    SELECT u.id, u.role, u.workspace_id, l.muted, l.deliver_from, l.deliver_to, l.timezone, l.digest_hour
      FROM telegram_links l JOIN users u ON u.id = l.user_id WHERE l.chat_id = $1 AND l.blocked_at IS NULL`, [chatId]);
  return r || null;
}

async function setPref(user, event, { enabled, threshold }, s) {
  const cur = await userWants(user.id, event, s);
  const { rows: [p] } = await db.query('SELECT threshold FROM telegram_prefs WHERE user_id = $1 AND event = $2', [user.id, event]);
  const nextThreshold = threshold ? { ...(p?.threshold || {}), ...cleanThreshold(event, threshold) } : p?.threshold || null;
  await db.query(`INSERT INTO telegram_prefs (user_id, event, enabled, threshold) VALUES ($1,$2,$3,$4::jsonb)
    ON CONFLICT (user_id, event) DO UPDATE SET enabled = $3, threshold = $4::jsonb`,
  [user.id, event, enabled ?? cur.enabled, nextThreshold ? JSON.stringify(nextThreshold) : null]);
}

export async function settingsView(user) {
  const s = await workspaceSettings(user.workspace_id);
  const rows = [];
  for (const [key, e] of eventsFor(user.role)) {
    const w = await userWants(user.id, key, s);
    // Buttons name the event by its key (never by position), so a later change of the list cannot flip another event.
    const row = [btn(`${w.enabled ? '✅' : '▫️'} ${e.label}`, `t:${key}`)];
    if (THRESHOLD_PRESETS[key]) row.push(btn(`⚙ ${thresholdLabel(key, w.threshold)}`, `th:${key}`));
    rows.push(row);
  }
  rows.push([btn(user.muted ? '▶️ Возобновить' : '⏸ Пауза', 'p'), btn('🕒 Время', 'tm')]);
  rows.push([btn('Готово', 'x')]);
  const tz = user.timezone || s.timezone;
  const text = [
    '⚙️ <b>Что присылать</b>',
    'Нажмите на событие: ✅ — присылать, ▫️ — нет. ⚙ — порог.',
    user.muted ? '⏸ Сейчас уведомления на паузе.' : null,
    `🕒 Доставка: ${windowLabel(user.deliver_from, user.deliver_to)}, пояс ${esc(tz)}, итог дня в ${user.digest_hour ?? s.digest_hour}:00`,
  ].filter(Boolean).join('\n');
  return { text, reply_markup: { inline_keyboard: rows } };
}

async function thresholdView(user, event) {
  const s = await workspaceSettings(user.workspace_id);
  const w = await userWants(user.id, event, s);
  const p = THRESHOLD_PRESETS[event];
  return {
    text: `⚙ <b>${esc(EVENTS[event].label)}</b>\nСейчас: ${esc(thresholdLabel(event, w.threshold) || 'по умолчанию')}\nВыберите порог:`,
    reply_markup: { inline_keyboard: [
      p.values.map((v, k) => btn(`${w.threshold[p.field] === v ? '• ' : ''}${p.label(v)}`, `tv:${event}:${k}`)),
      [urlBtn('Свой порог — на сайте', `${siteUrl()}/telegram`)],
      [btn('← Назад', 's')],
    ] },
  };
}

async function timeView(user) {
  const s = await workspaceSettings(user.workspace_id);
  const tz = user.timezone || s.timezone;
  const dh = user.digest_hour ?? s.digest_hour;
  return {
    text: [
      '🕒 <b>Время доставки</b>',
      `Присылать: ${windowLabel(user.deliver_from, user.deliver_to)}. Вне этого времени уведомления копятся и приходят одним сообщением; конверсии и «агент не отвечает» — сразу.`,
      `Часовой пояс: ${esc(tz)}${user.timezone ? '' : ' (как у команды)'}`,
      `Итог дня: в ${dh}:00${user.digest_hour == null ? ' (как у команды)' : ''}`,
    ].join('\n'),
    reply_markup: { inline_keyboard: [
      WINDOW_PRESETS.map(([f, t], k) => btn(`${f === user.deliver_from && t === user.deliver_to ? '• ' : ''}${f == null ? 'Всегда' : `${f}–${t}`}`, `w:${k}`)),
      TZ_PRESETS.slice(0, 3).map((z, k) => btn(`${z === user.timezone ? '• ' : ''}${z.split('/').pop()}`, `z:${k}`)),
      [...TZ_PRESETS.slice(3).map((z, k) => btn(`${z === user.timezone ? '• ' : ''}${z.split('/').pop()}`, `z:${k + 3}`)), btn('Как у команды', 'z:-')],
      DIGEST_PRESETS.map((h, k) => btn(`${h === user.digest_hour ? '• ' : ''}Итог ${h}:00`, `d:${k}`)),
      [urlBtn('Другое — на сайте', `${siteUrl()}/telegram`), btn('← Назад', 's')],
    ] },
  };
}

// One button press. Only the chat linked to a person may change that person's settings.
export async function handleCallback(cb) {
  const chat = cb?.message?.chat;
  const answer = (text, alert = false) => botApi('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: alert }).catch(() => {});
  if (!chat || chat.type !== 'private' || String(cb.from?.id) !== String(chat.id)) return answer('Кнопки работают только в личном чате с ботом.', true);
  let user = await personOf(chat.id);
  if (!user) return answer('Этот чат не привязан к Bananabun. Привяжите Telegram на сайте.', true);
  const data = String(cb.data || '');
  const s = await workspaceSettings(user.workspace_id);
  const allowed = new Set(eventsFor(user.role).map(([k]) => k));
  const eventAt = (k) => (EVENTS[k] && allowed.has(k) ? k : null);
  let view = null, note = '';
  let m;
  if (data === 's') {
    view = await settingsView(user);
  } else if ((m = /^t:([a-z_]{2,40})$/.exec(data))) {
    const ev = eventAt(m[1]);
    if (!ev) return answer('Кнопка устарела — откройте /settings заново.');
    const on = !(await userWants(user.id, ev, s)).enabled;
    await setPref(user, ev, { enabled: on }, s);
    note = on ? 'Включено' : 'Выключено';
    view = await settingsView(user);
  } else if ((m = /^th:([a-z_]{2,40})$/.exec(data))) {
    const ev = eventAt(m[1]);
    if (!ev || !THRESHOLD_PRESETS[ev]) return answer('Кнопка устарела — откройте /settings заново.');
    view = await thresholdView(user, ev);
  } else if ((m = /^tv:([a-z_]{2,40}):(\d)$/.exec(data))) {
    const ev = eventAt(m[1]);
    const p = ev && THRESHOLD_PRESETS[ev];
    const v = p?.values[Number(m[2])];
    if (v === undefined) return answer('Кнопка устарела — откройте /settings заново.');
    await setPref(user, ev, { threshold: { [p.field]: v } }, s);
    note = `Порог: ${p.label(v)}`;
    view = await thresholdView(user, ev);
  } else if (data === 'p') {
    await db.query('UPDATE telegram_links SET muted = NOT muted WHERE chat_id = $1', [chat.id]);
    user = await personOf(chat.id);
    note = user.muted ? 'Пауза' : 'Уведомления включены';
    view = await settingsView(user);
  } else if (data === 'tm') {
    view = await timeView(user);
  } else if ((m = /^w:(\d)$/.exec(data)) && WINDOW_PRESETS[Number(m[1])]) {
    const [f, t] = WINDOW_PRESETS[Number(m[1])];
    await db.query('UPDATE telegram_links SET deliver_from = $2, deliver_to = $3 WHERE chat_id = $1', [chat.id, f, t]);
    note = `Доставка: ${windowLabel(f, t)}`;
  } else if ((m = /^z:(\d|-)$/.exec(data)) && (m[1] === '-' || TZ_PRESETS[Number(m[1])])) {
    const tz = m[1] === '-' ? null : TZ_PRESETS[Number(m[1])];
    await db.query('UPDATE telegram_links SET timezone = $2 WHERE chat_id = $1', [chat.id, tz]);
    note = `Пояс: ${tz || 'как у команды'}`;
  } else if ((m = /^d:(\d)$/.exec(data)) && DIGEST_PRESETS[Number(m[1])] !== undefined) {
    const h = DIGEST_PRESETS[Number(m[1])];
    await db.query('UPDATE telegram_links SET digest_hour = $2 WHERE chat_id = $1', [chat.id, h]);
    note = `Итог дня в ${h}:00`;
  } else if (data === 'x') {
    await botApi('editMessageText', { chat_id: chat.id, message_id: cb.message.message_id, text: 'Настройки сохранены. /settings — открыть снова.' }).catch(() => {});
    return answer('Сохранено');
  } else {
    return answer('Кнопка устарела — откройте /settings заново.');
  }
  if (!view) { user = await personOf(chat.id); view = await timeView(user); }
  await botApi('editMessageText', {
    chat_id: chat.id, message_id: cb.message.message_id, text: view.text, parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: view.reply_markup,
  }).catch(e => { if (!/not modified/i.test(e.message)) throw e; });
  return answer(note);
}

// The settings menu as a new message (for /settings and the button under /start).
export async function sendSettings(chatId) {
  const user = await personOf(chatId);
  if (!user) return false;
  const view = await settingsView(user);
  await botApi('sendMessage', { chat_id: chatId, text: view.text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: view.reply_markup });
  return true;
}
