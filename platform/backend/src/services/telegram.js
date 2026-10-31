// Telegram notifications: Bot API client, event bus, outgoing queue and periodic checks.
// Without TELEGRAM_BOT_TOKEN nothing is queued or sent and nothing fails: the bot is simply «not connected».
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { keitaroClient } from './keitaro.js';
import { buyerResolver, buyerShare, BUYER_SHARE_PCT, TRACKER_CURRENCY, NO_BUYER, userLabel } from './buyers.js';

const API = 'https://api.telegram.org';
export const botToken = () => process.env.TELEGRAM_BOT_TOKEN || '';
export const botReady = () => !!botToken();
export const siteUrl = () => (process.env.PUBLIC_BASE_URL || 'https://nespizdili.lol/banana').replace(/\/$/, '');
const publicUrl = () => (process.env.PUBLIC_URL || 'https://nespizdili.lol').replace(/\/$/, '');

/* ───── events ───── */

// key → label, who may get it, default on/off and default threshold.
export const EVENTS = {
  push_done: { label: 'Залив создан (на паузе)', roles: 'all', default: true },
  push_failed: { label: 'Залив упал', roles: 'all', default: true },
  push_retry_blocked: { label: 'Повтор залива заблокирован', roles: 'all', default: true },
  moderation_rejected: { label: 'Объявления отклонены / с проблемой', roles: 'all', default: true },
  account_problem: { label: 'Кабинет отключён, на проверке или долг по оплате', roles: 'all', default: true },
  spend_over: { label: 'Расход кампании за сегодня выше порога (по трекеру)', roles: 'all', default: true, threshold: { amount: 50 } },
  roi_below: { label: 'ROI кампании за вчера ниже порога (утром, по трекеру)', roles: 'all', default: true, threshold: { roi: -30, min_spend: 20, min_clicks: 30 } },
  daily_digest: { label: 'Итог дня', roles: 'all', default: true },
  scrape_done: { label: 'Скрап готов', roles: 'all', default: false },
  scrape_failed: { label: 'Скрап упал', roles: 'all', default: true },
  creatives_done: { label: 'Креативы готовы', roles: 'all', default: false },
  creatives_failed: { label: 'Креативы упали', roles: 'all', default: true },
  agent_offline: { label: 'Агент / AdsPower не отвечает', roles: 'lead', default: true, threshold: { minutes: 15 } },
  agent_online: { label: 'Агент снова на связи', roles: 'lead', default: true },
  conversion: { label: 'Конверсия (постбек Keitaro)', roles: 'all', default: true },
};

export const EVENT_KEYS = Object.keys(EVENTS);
export const eventsFor = (role) => Object.entries(EVENTS).filter(([, e]) => e.roles === 'all' || role !== 'buyer');

// Events owner/lead also receive for every member of the team (besides their own).
const DEFAULT_TEAM_EVENTS = ['push_failed', 'account_problem', 'agent_offline', 'conversion'];

export const DEFAULT_SETTINGS = {
  events: Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, e.default])),
  thresholds: Object.fromEntries(Object.entries(EVENTS).filter(([, e]) => e.threshold).map(([k, e]) => [k, e.threshold])),
  team_events: DEFAULT_TEAM_EVENTS,
  digest_hour: 22,
  timezone: 'UTC',
  quiet_from: null, // e.g. 23 — hour when quiet hours start (local time)
  quiet_to: null, // e.g. 8
  conversion_urgent: true, // conversions come through quiet hours
};

export async function workspaceSettings(ws) {
  const { rows: [r] } = await db.query('SELECT settings FROM telegram_settings WHERE workspace_id = $1', [ws]);
  const s = r?.settings || {};
  return {
    ...DEFAULT_SETTINGS, ...s,
    events: { ...DEFAULT_SETTINGS.events, ...(s.events || {}) },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(s.thresholds || {}) },
    team_events: Array.isArray(s.team_events) ? s.team_events.filter(e => EVENTS[e]) : DEFAULT_SETTINGS.team_events,
  };
}

export function cleanSettings(input = {}) {
  const out = {};
  if (input.events && typeof input.events === 'object') {
    out.events = Object.fromEntries(Object.keys(EVENTS).filter(k => k in input.events).map(k => [k, !!input.events[k]]));
  }
  if (input.thresholds && typeof input.thresholds === 'object') {
    out.thresholds = {};
    for (const [k, e] of Object.entries(EVENTS)) {
      if (!e.threshold || !input.thresholds[k]) continue;
      out.thresholds[k] = cleanThreshold(k, input.thresholds[k]);
    }
  }
  if (Array.isArray(input.team_events)) out.team_events = input.team_events.filter(e => EVENTS[e]);
  const hour = (v) => (v === null || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23 ? Number(v) : undefined);
  for (const k of ['digest_hour', 'quiet_from', 'quiet_to']) {
    if (!(k in input)) continue;
    const h = hour(input[k]);
    if (h === undefined) throw Object.assign(new Error('Час — от 0 до 23'), { statusCode: 400 });
    if (k === 'digest_hour' && h === null) throw Object.assign(new Error('Укажите час итога дня'), { statusCode: 400 });
    out[k] = h;
  }
  if ('conversion_urgent' in input) out.conversion_urgent = !!input.conversion_urgent;
  if ('timezone' in input) {
    const tz = String(input.timezone || '');
    try { new Intl.DateTimeFormat('ru', { timeZone: tz }); } catch { throw Object.assign(new Error('Неизвестный часовой пояс'), { statusCode: 400 }); }
    out.timezone = tz;
  }
  return out;
}

export function cleanThreshold(event, t = {}) {
  const def = EVENTS[event]?.threshold;
  if (!def) return null;
  const out = {};
  for (const k of Object.keys(def)) {
    const n = Number(t[k]);
    if (t[k] === undefined || t[k] === '' || !Number.isFinite(n)) continue;
    if ((k === 'amount' || k === 'min_spend' || k === 'minutes' || k === 'min_clicks') && n <= 0) throw Object.assign(new Error('Порог должен быть больше нуля'), { statusCode: 400 });
    out[k] = n;
  }
  return out;
}

/* ───── text ───── */

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Anything secret-looking is never put into a message, whatever a caller passes.
const SECRET = /(EAA[A-Za-z0-9]{10,}|bb_[A-Za-z0-9_-]{20,}|access_token=[^&\s]+|\b[A-Fa-f0-9]{32,}\b)/g;
const clean = (s, max = 300) => esc(String(s ?? '').replace(SECRET, '•••').slice(0, max));
const money = (n, ccy) => `${(Number(n) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy || ''}`.trim();
const link = (path, label) => `<a href="${esc(siteUrl() + path)}">${esc(label)}</a>`;

export function messageFor(event, p = {}) {
  switch (event) {
    case 'push_done':
      return `✅ <b>Залив создан</b> — всё на паузе\n${clean(p.title)}${p.cabinet ? `\nКабинет: ${clean(p.cabinet)}` : ''}${p.ads ? `\nОбъявлений: ${Number(p.ads)}` : ''}\n${link('/pushes', 'Журнал заливов')}`;
    case 'push_failed':
      return `❌ <b>Залив упал</b>\n${clean(p.title)}${p.cabinet ? `\nКабинет: ${clean(p.cabinet)}` : ''}\nПричина: ${clean(p.error || 'неизвестна')}\n${link('/pushes', 'Журнал заливов')}`;
    case 'push_retry_blocked':
      return `⛔ <b>Повтор залива заблокирован</b>\n${clean(p.reason)}\n${link('/pushes', 'Журнал заливов')}`;
    case 'moderation_rejected':
      return `🚫 <b>Модерация</b>: ${clean(p.campaign)}\nОтклонено: ${Number(p.rejected) || 0}, с проблемой: ${Number(p.issues) || 0} из ${Number(p.total) || 0}${p.reason ? `\n${clean(p.reason)}` : ''}\n${link('/campaigns', 'Кампании → Внимание')}`;
    case 'account_problem':
      return `⚠️ <b>Кабинет</b> ${clean(p.act)}: ${clean(p.status)}\n${link('/campaigns', 'Кампании → Внимание')}`;
    case 'spend_over':
      return `💸 <b>Расход выше порога</b>\n${clean(p.campaign)}${p.buyer ? `\nБайер: ${clean(p.buyer)}` : ''}\nСегодня по трекеру: ${money(p.spend, p.currency)} (порог ${money(p.threshold, p.currency)})\n${link('/analytics', 'Аналитика')}`;
    case 'roi_below':
      return `📉 <b>ROI ниже порога</b> — вчера, ${clean(p.date)}\n${clean(p.campaign)}${p.buyer ? `\nБайер: ${clean(p.buyer)}` : ''}\nROI ${Number(p.roi).toFixed(1)}% при расходе ${money(p.spend, p.currency)}, кликов ${Number(p.clicks) || 0} (порог ${Number(p.threshold)}%)\n${link('/analytics', 'Аналитика')}`;
    case 'daily_digest':
      return digestText(p);
    case 'scrape_done':
      return `📦 <b>Скрап готов</b>\n${clean(p.title)}\n${link('/products', 'Связки')}`;
    case 'scrape_failed':
      return `📦 <b>Скрап не получился</b>\n${clean(p.title || p.url)}\nПричина: ${clean(p.error)}\n${link('/products', 'Связки')}`;
    case 'creatives_done':
      return `🎨 <b>Креативы готовы</b>: ${Number(p.done)} из ${Number(p.total)}\n${clean(p.title)}\n${link(`/creatives?product_id=${encodeURIComponent(p.product_id || '')}`, 'Креативы')}`;
    case 'creatives_failed':
      return `🎨 <b>Креативы</b>: готово ${Number(p.done)} из ${Number(p.total)}, упало ${Number(p.failed)}\n${clean(p.title)}${p.error ? `\nПричина: ${clean(p.error)}` : ''}\n${link(`/creatives?product_id=${encodeURIComponent(p.product_id || '')}`, 'Креативы')}`;
    case 'agent_online':
      return `🟢 <b>Агент AdsPower снова на связи</b>${p.minutes ? ` — не отвечал ${Number(p.minutes)} мин.` : ''}\n${link('/accounts', 'Аккаунты')}`;
    case 'relinked':
      return `🔁 Аккаунт Bananabun, к которому был привязан этот чат, привязан к другому Telegram. Сюда уведомления больше не приходят. Если это сделали не вы — сообщите владельцу команды.`;
    case 'agent_offline':
      return `🔴 <b>Агент AdsPower не отвечает</b> ${Number(p.minutes)} мин.\nЗаливы, скрап, проверки профилей и 2FA стоят.\n${link('/accounts', 'Аккаунты')}`;
    case 'conversion': {
      const icon = { sale: '💰', lead: '🟢', rejected: '🔴', trash: '🗑' }[String(p.status || '').toLowerCase()] || '🔔';
      return `${icon} <b>Конверсия: ${clean(p.status || '—')}</b>${Number(p.payout) ? ` · ${money(p.payout, p.currency)}` : ''}\n${clean(p.campaign || 'кампания не указана')}${p.offer ? `\nОффер: ${clean(p.offer)}` : ''}${p.country ? `\nГео: ${clean(p.country)}` : ''}${p.buyer ? `\nБайер: ${clean(p.buyer)}` : ''}`;
    }
    case 'test':
      return `👋 Тестовое сообщение Bananabun. Уведомления приходят сюда.`;
    case 'broadcast':
      return `📣 <b>Сообщение команде</b>\n${clean(p.text, 2000)}`;
    default:
      return clean(p.text || event);
  }
}

const totalLine = (t, ccy) => `расход ${money(t.cost, ccy)}, доход ${money(t.revenue, ccy)}, профит ${money(t.profit, ccy)}${t.roi != null ? `, ROI ${t.roi.toFixed(1)}%` : ''}`;
// The tracker's day is the period: «today from 00:00 to HH:MM tracker time», plus yesterday in full.
function digestText(p) {
  const head = p.team ? '📊 <b>Итог дня по команде</b>' : '📊 <b>Итог дня</b>';
  const rows = (p.rows || []).map(r => `• ${clean(r.label)}: расход ${money(r.cost, p.currency)}, доход ${money(r.revenue, p.currency)}, профит ${money(r.profit, p.currency)}${r.share > 0 ? `, байеру ${money(r.share, p.currency)}` : ''}`);
  const t = p.total || {};
  const y = p.yesterday;
  return [head,
    `Сегодня ${clean(p.date)}, с 00:00 до ${clean(p.until)} (время трекера, ${clean(p.tz)})`,
    ...rows,
    `Итого: ${totalLine(t, p.currency)}`,
    ...(p.team ? [] : [`Байеру ${BUYER_SHARE_PCT}%: ${money(t.share, p.currency)}`]),
    ...(y ? [`Вчера целиком: ${totalLine(y, p.currency)}${p.team ? '' : `, байеру ${money(y.share, p.currency)}`}`] : []),
    link('/analytics', 'Аналитика')].join('\n');
}

/* ───── Bot API ───── */

export async function botApi(method, params = {}) {
  const token = botToken();
  if (!token) throw Object.assign(new Error('Бот не подключён: нет TELEGRAM_BOT_TOKEN'), { code: 'NO_TOKEN' });
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  });
  let body;
  try { body = await res.json(); } catch { body = { ok: false, description: `HTTP ${res.status}` }; }
  if (!body.ok) {
    throw Object.assign(new Error(String(body.description || `HTTP ${res.status}`).replace(token, '•••')), {
      status: body.error_code || res.status, retryAfter: body.parameters?.retry_after,
    });
  }
  return body.result;
}

let meCache = null;
export async function botInfo() {
  if (!botReady()) return null;
  if (meCache && meCache.token === botToken()) return meCache.me;
  const me = await botApi('getMe');
  meCache = { token: botToken(), me };
  return me;
}

export const sendText = (chatId, text, markup) => botApi('sendMessage', {
  chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}),
});
// Under every notification: one tap to the settings menu.
export const SETTINGS_BUTTON = { inline_keyboard: [[{ text: '⚙️ Настройки', callback_data: 's' }]] };

/* ───── linking ───── */

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export async function createLinkCode(userId) {
  const code = crypto.randomBytes(12).toString('base64url');
  await db.query(`DELETE FROM telegram_link_codes WHERE user_id = $1 OR expires_at < NOW()`, [userId]);
  await db.query(`INSERT INTO telegram_link_codes (code_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`, [hash(code), userId]);
  return code;
}

// One-time, unexpired code → links this chat to the user (a chat used by someone else moves to this user).
export async function redeemLinkCode(code, chatId, username) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(code || ''))) return null;
  const { rows: [c] } = await db.query(
    `UPDATE telegram_link_codes SET used_at = NOW() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id`,
    [hash(code)]);
  if (!c) return null;
  const { rows: [prev] } = await db.query('SELECT chat_id FROM telegram_links WHERE user_id = $1', [c.user_id]);
  await db.query('DELETE FROM telegram_links WHERE chat_id = $1 AND user_id <> $2', [chatId, c.user_id]);
  await db.query(`INSERT INTO telegram_links (user_id, chat_id, username, linked_at, muted, blocked_at) VALUES ($1, $2, $3, NOW(), false, NULL)
    ON CONFLICT (user_id) DO UPDATE SET chat_id = $2, username = $3, linked_at = NOW(), muted = false, blocked_at = NULL`,
  [c.user_id, chatId, username ? String(username).slice(0, 64) : null]);
  // The account moved to another Telegram: the old chat is told (and the delivery log shows it).
  if (prev && String(prev.chat_id) !== String(chatId)) {
    const { rows: [u] } = await db.query('SELECT workspace_id FROM users WHERE id = $1', [c.user_id]);
    await notify('relinked', { workspace_id: u?.workspace_id, only: [{ user_id: c.user_id, chat_id: prev.chat_id }], urgent: true });
  }
  return c.user_id;
}

/* ───── event bus ───── */

function localHour(tz, date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(date));
}
function inQuiet(s, date = new Date()) {
  if (s.quiet_from == null || s.quiet_to == null || s.quiet_from === s.quiet_to) return false;
  const h = localHour(s.timezone, date);
  return s.quiet_from < s.quiet_to ? h >= s.quiet_from && h < s.quiet_to : h >= s.quiet_from || h < s.quiet_to;
}
// Personal delivery window «from … to …» in the person's zone (team zone by default); empty = around the clock.
export function inWindow(sched = {}, teamTz = 'UTC', date = new Date()) {
  const { from, to } = sched || {};
  if (from == null || to == null || from === to) return true;
  const h = localHour((sched && sched.timezone) || teamTz, date);
  return from < to ? h >= from && h < to : h >= from || h < to;
}
// First moment a non-urgent message may go out: outside team quiet hours and inside the personal window.
export function nextAllowed(s, sched = {}, date = new Date()) {
  let t = new Date(date);
  if (!inQuiet(s, t) && inWindow(sched, s.timezone, t)) return t;
  t = new Date(Math.ceil(t.getTime() / (15 * 60000)) * 15 * 60000);
  for (let i = 0; i < 24 * 4 * 2 && (inQuiet(s, t) || !inWindow(sched, s.timezone, t)); i++) t = new Date(t.getTime() + 15 * 60000);
  return t;
}
export async function userSchedules(userIds) {
  if (!userIds.length) return new Map();
  const { rows } = await db.query(`SELECT user_id, deliver_from, deliver_to, timezone, digest_hour FROM telegram_links WHERE user_id = ANY($1)`, [userIds]);
  return new Map(rows.map(r => [r.user_id, { from: r.deliver_from, to: r.deliver_to, timezone: r.timezone, digest_hour: r.digest_hour }]));
}

// Effective personal setting for one user and event: personal override, else the team default.
export async function userWants(userId, event, s) {
  const { rows: [p] } = await db.query('SELECT enabled, threshold FROM telegram_prefs WHERE user_id = $1 AND event = $2', [userId, event]);
  return {
    enabled: p ? p.enabled : !!s.events[event],
    threshold: { ...(s.thresholds[event] || {}), ...(p?.threshold || {}) },
  };
}

// Recipients: the author of the object (if the event is on for them) and owner/lead for the team events.
// A buyer only ever gets events about their own objects. Returns [{ user_id, chat_id, threshold }].
export async function recipients(event, { workspace_id, owner_user_id }) {
  const e = EVENTS[event];
  if (!e) return [];
  const s = await workspaceSettings(workspace_id);
  const { rows } = await db.query(`
    SELECT u.id, u.role, l.chat_id FROM telegram_links l JOIN users u ON u.id = l.user_id
     WHERE u.workspace_id = $1 AND l.muted = false AND l.blocked_at IS NULL`, [workspace_id]);
  const out = [];
  for (const u of rows) {
    const lead = u.role === 'owner' || u.role === 'lead';
    if (e.roles === 'lead' && !lead) continue;
    const own = owner_user_id && u.id === owner_user_id;
    const teamCopy = lead && (e.roles === 'lead' || owner_user_id == null || s.team_events.includes(event));
    if (!own && !teamCopy) continue;
    const w = await userWants(u.id, event, s);
    if (w.enabled) out.push({ user_id: u.id, chat_id: u.chat_id, threshold: w.threshold });
  }
  return out;
}

// Queues one message per recipient; the same dedupe_key never produces a second message for that recipient.
// Never throws to the caller: notifications must not break pushes, scrapes or renders.
export async function notify(event, { workspace_id, owner_user_id = null, payload = {}, dedupe_key, urgent = false, only = null } = {}) {
  try {
    if (!botReady() || !workspace_id || !EVENTS[event] && !SYSTEM_EVENTS.has(event)) return 0;
    const list = only ? only : await recipients(event, { workspace_id, owner_user_id });
    if (!list.length) return 0;
    const s = await workspaceSettings(workspace_id);
    const text = messageFor(event, payload);
    const raw = dedupe_key || `${event}:${crypto.randomUUID()}`;
    // Long keys (a long click_id) are hashed, so the recipient id at the end is never cut off.
    const key = raw.length > 150 ? `${event}:h:${hash(raw).slice(0, 48)}` : raw;
    const scheds = await userSchedules(list.map(r => r.user_id));
    const now = new Date();
    let n = 0;
    for (const r of list) {
      const next = urgent ? now : nextAllowed(s, scheds.get(r.user_id), now);
      const held = next.getTime() > now.getTime();
      const { rowCount } = await db.query(`
        INSERT INTO telegram_outbox (workspace_id, user_id, chat_id, event, text, dedupe_key, urgent, next_at, held)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (dedupe_key) DO NOTHING`,
      [workspace_id, r.user_id, r.chat_id, event, text, `${key}:${r.user_id}`, !!urgent, next, held]);
      n += rowCount;
    }
    if (n) wakeTelegram();
    return n;
  } catch (e) {
    console.error('[telegram] notify', event, e.message);
    return 0;
  }
}
export const emit = (event, opts) => { notify(event, opts).catch(() => {}); };
// Messages about the bot itself. test/relinked go to the given chat even when it is paused or no longer linked.
const SYSTEM_EVENTS = new Set(['test', 'broadcast', 'relinked']);
const UNCONDITIONAL = new Set(['test', 'relinked']);

/* ───── queue ───── */

const MAX_PER_SECOND = 25;
const RETRY_MAX_MS = 60 * 60 * 1000; // network trouble: retry with a growing pause up to an hour…
const GIVE_UP_MS = 24 * 60 * 60 * 1000; // …for a day; only a bad request (400) fails at once
const STALE_SENDING_MS = 5 * 60 * 1000;
const lastByChat = new Map();

// Sends due messages: ~25/s in total, 1/s per chat; 429 waits retry_after; 403 (bot blocked) unlinks the chat;
// network errors and 5xx retry for up to a day. Rows are claimed atomically ('sending'), so two workers never send
// the same row; a row stuck in 'sending' (crash mid-send) returns to the queue after 5 minutes.
// Messages held outside a person's delivery window go out together as one summary when the window opens.
const MAX_TEXT = 3900;
export function batchText(texts) {
  let out = `🕒 <b>Накопилось, пока было не время доставки: ${texts.length}</b>`, used = 0;
  for (const t of texts) {
    const next = `${out}\n\n— — —\n${t}`;
    if (next.length > MAX_TEXT) break;
    out = next; used++;
  }
  return used < texts.length ? `${out}\n\n…и ещё ${texts.length - used}. Подробности — на сайте.` : out;
}
export const retryDelay = (attempts) => Math.min(5000 * 2 ** Math.max(attempts - 1, 0), RETRY_MAX_MS);

export async function processOutbox({ now = Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!botReady()) return 0;
  await db.query(`UPDATE telegram_outbox SET status = 'pending', locked_at = NULL
    WHERE status = 'sending' AND locked_at < $1`, [new Date(now - STALE_SENDING_MS)]);
  const { rows } = await db.query(`
    UPDATE telegram_outbox o SET status = 'sending', locked_at = $1, attempts = o.attempts + 1
      FROM (SELECT id FROM telegram_outbox WHERE status = 'pending' AND next_at <= $1
             ORDER BY urgent DESC, next_at, id LIMIT ${MAX_PER_SECOND * 4} FOR UPDATE SKIP LOCKED) due
     WHERE o.id = due.id
     RETURNING o.*`, [new Date(now)]);
  if (!rows.length) return 0;
  rows.sort((a, b) => (b.urgent - a.urgent) || (new Date(a.next_at) - new Date(b.next_at)) || (Number(a.id) - Number(b.id)));

  // Who may still receive: the chat must be the person's current link, not paused, not blocked.
  const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  const { rows: links } = userIds.length
    ? await db.query('SELECT user_id, chat_id, muted, blocked_at FROM telegram_links WHERE user_id = ANY($1)', [userIds])
    : { rows: [] };
  const linkOf = new Map(links.map(l => [l.user_id, l]));
  const deliverable = (m) => {
    if (UNCONDITIONAL.has(m.event)) return true;
    const l = linkOf.get(m.user_id);
    return !!l && String(l.chat_id) === String(m.chat_id) && !l.muted && !l.blocked_at;
  };
  const skip = rows.filter(m => !deliverable(m));
  if (skip.length) {
    await db.query(`UPDATE telegram_outbox SET status = 'skipped', locked_at = NULL, error = 'Получатель отвязал Telegram или поставил на паузу'
      WHERE id = ANY($1)`, [skip.map(m => m.id)]);
  }

  const live = rows.filter(deliverable);
  const heldByChat = new Map();
  for (const m of live) if (m.held && !m.urgent) heldByChat.set(String(m.chat_id), [...(heldByChat.get(String(m.chat_id)) || []), m]);
  const done = new Set();
  const untouched = [];
  let sent = 0;
  const started = Date.now();
  for (const m of live) {
    if (done.has(m.id)) continue;
    const chat = String(m.chat_id);
    if (sent >= MAX_PER_SECOND || now - (lastByChat.get(chat) || 0) < 1000) { untouched.push(m.id); continue; }
    const group = m.held && !m.urgent && (heldByChat.get(chat) || []).length > 1 ? heldByChat.get(chat) : [m];
    group.forEach(g => done.add(g.id));
    const ids = group.map(g => g.id);
    lastByChat.set(chat, now);
    try {
      const texts = group.map(g => g.text);
      await sendText(m.chat_id, texts.length > 1 ? batchText(texts) : texts[0], SETTINGS_BUTTON);
      await db.query(`UPDATE telegram_outbox SET status = 'sent', sent_at = NOW(), locked_at = NULL, error = NULL WHERE id = ANY($1)`, [ids]);
      sent++;
    } catch (e) {
      const err = String(e.message).slice(0, 300);
      if (e.status === 429) {
        const wait = (Number(e.retryAfter) || 5) * 1000;
        await db.query(`UPDATE telegram_outbox SET status = 'pending', locked_at = NULL, next_at = $2, error = $3, attempts = attempts - 1
          WHERE id = ANY($1)`, [ids, new Date(now + wait), err]);
      } else if (e.status === 403) {
        await db.query(`UPDATE telegram_outbox SET status = 'failed', locked_at = NULL, error = $2 WHERE id = ANY($1)`, [ids, 'Бот заблокирован пользователем — привязка отключена']);
        await db.query(`UPDATE telegram_links SET blocked_at = NOW() WHERE chat_id = $1`, [m.chat_id]);
      } else if (e.status === 400) {
        await db.query(`UPDATE telegram_outbox SET status = 'failed', locked_at = NULL, error = $2 WHERE id = ANY($1)`, [ids, err]);
      } else {
        // Network, timeout, 5xx: keep trying for a day with a growing pause.
        const tries = Math.max(...group.map(g => g.attempts));
        const oldest = Math.min(...group.map(g => new Date(g.created_at).getTime()));
        const giveUp = now - oldest > GIVE_UP_MS;
        await db.query(`UPDATE telegram_outbox SET status = $2, locked_at = NULL, next_at = $3, error = $4 WHERE id = ANY($1)`,
          [ids, giveUp ? 'failed' : 'pending', new Date(now + retryDelay(tries)), giveUp ? `Не доставлено за сутки: ${err}`.slice(0, 300) : err]);
      }
    }
  }
  // Claimed but not sent this round (per-chat or per-second limit): back to the queue as they were.
  if (untouched.length) {
    await db.query(`UPDATE telegram_outbox SET status = 'pending', locked_at = NULL, attempts = attempts - 1
      WHERE id = ANY($1) AND status = 'sending'`, [untouched]);
  }
  if (Date.now() - started < 1000 && sent >= MAX_PER_SECOND) await sleep(1000);
  return sent;
}

// Old delivery records and postbacks are not kept forever.
export async function cleanupOld(days = 90) {
  await db.query(`DELETE FROM telegram_outbox WHERE status IN ('sent', 'failed', 'skipped') AND created_at < NOW() - make_interval(days => $1)`, [days]);
  await db.query(`DELETE FROM telegram_postbacks WHERE received_at < NOW() - make_interval(days => $1)`, [days]);
  await db.query(`DELETE FROM telegram_link_codes WHERE expires_at < NOW() - INTERVAL '1 day'`);
}

/* ───── periodic checks ───── */

const RAW = ['clicks', 'lp_clicks', 'sales', 'leads', 'revenue', 'cost'];
const ACCOUNT_STATUS = { 2: 'кабинет отключён', 3: 'долг по оплате в кабинете', 7: 'кабинет на проверке рисков', 8: 'кабинет ждёт расчёта', 9: 'кабинет в льготном периоде', 100: 'кабинет ждёт закрытия', 101: 'кабинет закрыт' };
export const accountStatusLabel = (s) => ACCOUNT_STATUS[s] || null;
const dayIn = (tz, date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(date);
const timeIn = (tz, date = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
// Keitaro's «today»/«yesterday» are days in the tracker's own time zone; its API does not report it, so it is configured.
export const trackerTz = () => process.env.KEITARO_TIMEZONE || 'UTC';
export const ROI_CHECK_HOUR = 10; // «ROI below» looks at yesterday once, at 10:00 in each person's zone

const totalsOf = (rows) => {
  const t = rows.reduce((a, r) => ({ cost: a.cost + r.cost, revenue: a.revenue + r.revenue }), { cost: 0, revenue: 0 });
  const profit = t.revenue - t.cost;
  return { ...t, profit, roi: t.cost > 0 ? profit / t.cost * 100 : null, share: buyerShare(profit) };
};

// A tracker period per buyer, the buyer being a member (by id) when one owns the traffic, else just the tag.
export async function buyerPeriod(ws, client, range) {
  const data = await client.stats(range, ['sub_id_2', 'campaign', 'campaign_group'], RAW);
  const rows = data?.rows || [];
  const who = await buyerResolver(ws, rows);
  const map = new Map();
  for (const r of rows) {
    const b = who(r);
    const k = b.userId ? `u:${b.userId}` : `t:${b.label}`;
    const acc = map.get(k) || { userId: b.userId, label: b.label, revenue: 0, cost: 0 };
    acc.revenue += Number(r.revenue) || 0;
    acc.cost += Number(r.cost) || 0;
    map.set(k, acc);
  }
  return [...map.values()].map(r => ({ ...r, profit: r.revenue - r.cost, share: buyerShare(r.revenue - r.cost) }))
    .sort((a, b) => b.profit - a.profit);
}

// A tracker period per campaign with its owner (member id or null).
export async function campaignPeriod(ws, client, range) {
  const data = await client.stats(range, ['campaign_id', 'campaign', 'campaign_group', 'sub_id_2'], RAW);
  const byId = new Map();
  for (const r of data?.rows || []) {
    const id = String(r.campaign_id ?? r.campaign ?? '');
    const c = byId.get(id) || { campaign_id: id, campaign: r.campaign, campaign_group: r.campaign_group, subs: new Set(), cost: 0, revenue: 0, clicks: 0 };
    if (r.sub_id_2) c.subs.add(String(r.sub_id_2));
    c.cost += Number(r.cost) || 0;
    c.revenue += Number(r.revenue) || 0;
    c.clicks += Number(r.clicks) || 0;
    byId.set(id, c);
  }
  const camps = [...byId.values()];
  const who = await buyerResolver(ws, camps, (c) => [...c.subs]);
  return camps.map(c => ({ ...c, ...who(c) }));
}

export function digestFor(user, today, yesterday, date) {
  const team = user.role !== 'buyer';
  const mine = (rows) => (team ? rows : rows.filter(r => r.userId === user.id));
  const rows = mine(today || []);
  return {
    team, date, until: timeIn(trackerTz()), tz: trackerTz(), rows, currency: TRACKER_CURRENCY,
    total: totalsOf(rows), yesterday: yesterday ? totalsOf(mine(yesterday)) : null,
  };
}

// Text for /status: today's numbers, a buyer sees only their own (matched by member id, never by name).
export async function statusText(userId) {
  const { rows: [u] } = await db.query('SELECT id, name, email, role, workspace_id FROM users WHERE id = $1', [userId]);
  if (!u) return 'Аккаунт не найден.';
  const ws = await db.findOne('workspaces', { id: u.workspace_id });
  if (!ws?.keitaro_url || !ws?.keitaro_api_key) return 'Трекер не настроен — цифр пока нет.';
  try {
    const today = await buyerPeriod(u.workspace_id, keitaroClient(ws.keitaro_url, ws.keitaro_api_key), 'today');
    return digestText(digestFor(u, today, null, dayIn(trackerTz()))).replace('Итог дня', 'Сегодня');
  } catch {
    return 'Трекер не ответил — попробуйте позже.';
  }
}

export async function checkAgent(ws, s) {
  const { rows: [w] } = await db.query('SELECT agent_seen_at, agent_key_hash IS NOT NULL AS configured FROM workspaces WHERE id = $1', [ws]);
  if (!w?.configured || !w.agent_seen_at) return;
  const seen = new Date(w.agent_seen_at);
  const limit = Number(s.thresholds.agent_offline?.minutes) || 15;
  const minutes = Math.floor((Date.now() - seen.getTime()) / 60000);
  if (minutes >= limit) {
    await notify('agent_offline', { workspace_id: ws, payload: { minutes }, urgent: true, dedupe_key: `agent_offline:${ws}:${seen.getTime()}` });
    return;
  }
  // Back again after an episode we reported: one «снова на связи» per episode.
  const { rows: [last] } = await db.query(`SELECT MAX(created_at) AS at FROM telegram_outbox WHERE workspace_id = $1 AND event = 'agent_offline'`, [ws]);
  if (!last?.at || seen <= new Date(last.at)) return;
  await notify('agent_online', { workspace_id: ws, urgent: true, dedupe_key: `agent_online:${ws}:${new Date(last.at).getTime()}`, payload: {} });
}

// Money alerts come from the tracker (the FB cabinet numbers are not trusted) and only for campaigns owned by a member.
export async function checkMoney(ws, s, client) {
  if (!client) return;
  const tz = trackerTz();
  let today;
  try { today = await campaignPeriod(ws, client, 'today'); } catch { return; }
  const date = dayIn(tz);
  for (const c of today) {
    if (!c.userId || !(c.cost > 0)) continue;
    for (const r of await recipients('spend_over', { workspace_id: ws, owner_user_id: c.userId })) {
      if (c.cost > (Number(r.threshold.amount) || Infinity)) {
        await notify('spend_over', { workspace_id: ws, only: [r], dedupe_key: `spend_over:${ws}:${c.campaign_id}:${date}`,
          payload: { campaign: c.campaign, buyer: c.label, spend: c.cost, currency: TRACKER_CURRENCY, threshold: r.threshold.amount } });
      }
    }
  }
  // ROI: yesterday's full tracker day (late revenue has arrived), once a day at 10:00 in each person's zone.
  const { rows: links } = await db.query(`SELECT l.user_id, l.timezone FROM telegram_links l JOIN users u ON u.id = l.user_id
    WHERE u.workspace_id = $1 AND l.muted = false AND l.blocked_at IS NULL`, [ws]);
  const morning = new Set(links.filter(l => localHour(l.timezone || s.timezone) === ROI_CHECK_HOUR).map(l => l.user_id));
  if (!morning.size) return;
  let yday;
  try { yday = await campaignPeriod(ws, client, 'yesterday'); } catch { return; }
  const ydate = dayIn(tz, new Date(Date.now() - 24 * 3600 * 1000));
  for (const c of yday) {
    if (!c.userId || !(c.cost > 0)) continue;
    const roi = (c.revenue - c.cost) / c.cost * 100;
    for (const r of await recipients('roi_below', { workspace_id: ws, owner_user_id: c.userId })) {
      if (!morning.has(r.user_id)) continue;
      const t = r.threshold;
      if (c.cost >= (Number(t.min_spend) || 0) && c.clicks >= (Number(t.min_clicks) || 0) && roi < Number(t.roi)) {
        await notify('roi_below', { workspace_id: ws, only: [r], dedupe_key: `roi_below:${ws}:${c.campaign_id}:${ydate}`,
          payload: { campaign: c.campaign, buyer: c.label, roi, spend: c.cost, clicks: c.clicks, currency: TRACKER_CURRENCY, threshold: t.roi, date: ydate } });
      }
    }
  }
}

// Each person gets the digest at their own hour in their own zone (the team's by default).
export function digestDue(link, s, date = new Date()) {
  const tz = link.timezone || s.timezone;
  const hour = link.digest_hour ?? s.digest_hour;
  return localHour(tz, date) === Number(hour) ? dayIn(tz, date) : null;
}
async function checkDigest(ws, s, client) {
  if (!client) return;
  const { rows: users } = await db.query(`
    SELECT u.id, u.name, u.email, u.role, l.chat_id, l.timezone, l.digest_hour FROM telegram_links l JOIN users u ON u.id = l.user_id
     WHERE u.workspace_id = $1 AND l.muted = false AND l.blocked_at IS NULL`, [ws]);
  // Runs every 5 minutes; during a person's digest hour the per-user dedupe key keeps it to one message a day.
  let today = null, yesterday = null;
  for (const u of users) {
    const date = digestDue(u, s);
    if (!date) continue;
    const w = await userWants(u.id, 'daily_digest', s);
    if (!w.enabled) continue;
    if (!today) {
      try { [today, yesterday] = await Promise.all([buyerPeriod(ws, client, 'today'), buyerPeriod(ws, client, 'yesterday')]); } catch { return; }
    }
    await notify('daily_digest', { workspace_id: ws, only: [{ user_id: u.id, chat_id: u.chat_id }], dedupe_key: `daily_digest:${ws}:${date}`,
      payload: digestFor(u, today, yesterday, dayIn(trackerTz())) });
  }
}

let lastCleanup = 0;
export async function runChecks() {
  if (!botReady()) return;
  if (Date.now() - lastCleanup > 6 * 3600 * 1000) {
    lastCleanup = Date.now();
    await cleanupOld().catch(e => console.error('[telegram] cleanup', e.message));
  }
  const { rows: wss } = await db.query(`SELECT DISTINCT u.workspace_id FROM telegram_links l JOIN users u ON u.id = l.user_id WHERE l.blocked_at IS NULL`);
  for (const { workspace_id: ws } of wss) {
    try {
      const s = await workspaceSettings(ws);
      const w = await db.findOne('workspaces', { id: ws });
      const client = w?.keitaro_url && w?.keitaro_api_key ? keitaroClient(w.keitaro_url, w.keitaro_api_key) : null;
      await checkAgent(ws, s);
      await checkMoney(ws, s, client);
      await checkDigest(ws, s, client);
    } catch (e) { console.error('[telegram] checks', ws, e.message); }
  }
}

// Owner of an FB campaign (moderation alerts): the author of our push for it, else the member whose email names the AdsPower group.
const FB_OWNER_SQL = `
  SELECT fc.id, fc.name, fc.currency, fc.spend_today, fc.effective_status,
         COALESCE((SELECT p.created_by FROM pushes p WHERE p.workspace_id = fc.workspace_id AND p.fb_campaign_id = fc.id ORDER BY p.created_at DESC LIMIT 1),
                  (SELECT u.id FROM users u WHERE u.workspace_id = fc.workspace_id AND LOWER(u.email) = LOWER(ap.group_name) LIMIT 1)) AS owner_id
    FROM fb_campaigns fc
    LEFT JOIN fb_accounts fa ON fa.id = fc.fb_account_id
    LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
   WHERE fc.workspace_id = $1`;

/* ───── object hooks (called where the things happen) ───── */

// FB snapshot replaced: new rejections and new account problems, compared with the previous snapshot.
export async function moderationChanges(ws, before, after) {
  for (const c of after) {
    const prev = before.get(String(c.id));
    const m = c.moderation || {};
    const bad = (Number(m.rejected) || 0) + (Number(m.issues) || 0);
    const prevBad = prev ? (Number(prev.moderation?.rejected) || 0) + (Number(prev.moderation?.issues) || 0) : 0;
    if (bad > prevBad) {
      // The date keeps a later repeat of the same counts (a week on) from being swallowed as a duplicate.
      emit('moderation_rejected', { workspace_id: ws, owner_user_id: c.owner_id, dedupe_key: `moderation:${c.id}:${m.rejected || 0}:${m.issues || 0}:${dayIn('UTC')}`,
        payload: { campaign: c.name, rejected: m.rejected, issues: m.issues, total: m.total } });
    }
    const label = accountStatusLabel(c.account_status);
    if (label && (!prev || prev.account_status !== c.account_status)) {
      emit('account_problem', { workspace_id: ws, owner_user_id: c.owner_id, urgent: true, dedupe_key: `account:${c.act_id}:${c.account_status}:${dayIn('UTC')}`,
        payload: { act: c.act_name || c.act_id, status: label } });
    }
  }
}
export async function fbSnapshot(ws, ids) {
  if (!ids.length) return new Map();
  const { rows } = await db.query(`${FB_OWNER_SQL} AND fc.id = ANY($2)`.replace('fc.spend_today, fc.effective_status', 'fc.spend_today, fc.effective_status, fc.moderation, fc.account_status, fc.act_id, fc.act_name'), [ws, ids]);
  return new Map(rows.map(r => [String(r.id), r]));
}

// A render batch (one insert: same product, author and created_at) is reported once, when nothing in it is left.
export async function creativeBatchFinished(record) {
  if (!botReady()) return;
  const { rows: [b] } = await db.query(`
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='done')::int AS done, COUNT(*) FILTER (WHERE status='failed')::int AS failed,
           COUNT(*) FILTER (WHERE status IN ('pending','processing'))::int AS open,
           MAX(metadata->>'error') FILTER (WHERE status='failed') AS error
      FROM creatives WHERE workspace_id=$1 AND product_id=$2 AND created_by IS NOT DISTINCT FROM $3 AND created_at=$4`,
  [record.workspace_id, record.product_id, record.created_by, record.created_at]);
  if (!b || b.open) return;
  const { rows: [p] } = await db.query('SELECT title FROM products WHERE id = $1', [record.product_id]);
  // The outcome is part of the key: after a retry of the failed ones «now all done» is a new message.
  const key = `creatives:${record.product_id}:${new Date(record.created_at).getTime()}:${b.done}:${b.failed}`;
  emit(b.failed ? 'creatives_failed' : 'creatives_done', { workspace_id: record.workspace_id, owner_user_id: record.created_by, dedupe_key: key,
    payload: { ...b, title: p?.title, product_id: record.product_id } });
}

/* ───── worker ───── */

let timer = null, checkTimer = null, busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try { await processOutbox(); } catch (e) { console.error('[telegram] outbox', e.message); } finally { busy = false; }
}
export function wakeTelegram() { if (timer) queueMicrotask(tick); }
export const ALLOWED_UPDATES = ['message', 'callback_query'];
// The webhook already points at us but was set without button presses: set it again, so nobody has to press anything.
export async function ensureWebhookUpdates() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!botReady() || !secret) return false;
  const w = await botApi('getWebhookInfo');
  if (w.url !== webhookUrl() || !Array.isArray(w.allowed_updates) || w.allowed_updates.includes('callback_query')) return false;
  await botApi('setWebhook', { url: webhookUrl(), secret_token: secret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false });
  return true;
}
export function startTelegramWorker() {
  if (timer) return () => {};
  ensureWebhookUpdates().catch(e => console.error('[telegram] webhook check', e.message));
  timer = setInterval(tick, 1000); timer.unref?.();
  checkTimer = setInterval(() => runChecks().catch(() => {}), 5 * 60 * 1000); checkTimer.unref?.();
  return () => { clearInterval(timer); clearInterval(checkTimer); timer = null; };
}

/* ───── Keitaro postbacks ───── */

// Constant-time comparison of two secrets (both hashed first, so lengths never leak).
export function secretMatches(given, want) {
  if (!want || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(want)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Each team has its own postback secret; the team of a postback is known only from its secret.
export async function postbackSecretFor(ws, { rotate = false } = {}) {
  if (!rotate) {
    const { rows: [r] } = await db.query('SELECT secret FROM telegram_postback_secrets WHERE workspace_id = $1', [ws]);
    if (r) return r.secret;
  }
  const secret = crypto.randomBytes(24).toString('base64url');
  await db.query(`INSERT INTO telegram_postback_secrets (workspace_id, secret, secret_hash) VALUES ($1, $2, $3)
    ON CONFLICT (workspace_id) DO UPDATE SET secret = $2, secret_hash = $3, created_at = NOW()`, [ws, secret, hash(secret)]);
  return secret;
}
export async function workspaceForPostbackSecret(given) {
  if (typeof given !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(given)) return null;
  const { rows: [r] } = await db.query('SELECT workspace_id, secret FROM telegram_postback_secrets WHERE secret_hash = $1', [hash(given)]);
  return r && secretMatches(given, r.secret) ? r.workspace_id : null;
}

// Keitaro macros: {status} {revenue} {currency} {campaign_id} {campaign_name} {offer_name} {country} {sub_id_2} {subid}.
export const postbackUrl = (secret) => `${publicUrl()}/api/telegram/keitaro-postback/${secret}`
  + '?status={status}&payout={revenue}&currency={currency}&campaign_id={campaign_id}&campaign_name={campaign_name}'
  + '&offer={offer_name}&country={country}&sub_id_2={sub_id_2}&click_id={subid}';

// At most N postbacks a second per team (in memory): a leaked secret cannot flood the queue.
const POSTBACKS_PER_SECOND = 30;
const pbWindow = new Map();
export function postbackAllowed(ws, now = Date.now()) {
  const sec = Math.floor(now / 1000);
  const w = pbWindow.get(ws);
  if (!w || w.sec !== sec) { pbWindow.set(ws, { sec, n: 1 }); return true; }
  w.n++;
  return w.n <= POSTBACKS_PER_SECOND;
}

const str = (v, n = 300) => (v == null || v === '' ? null : String(v).slice(0, n));
export const postbackClickId = (q = {}) => {
  const id = q.click_id || q.subid || q.sub_id;
  if (id == null || id === '') return null;
  const s = String(id);
  return s.length > 120 ? `h:${hash(s).slice(0, 64)}` : s;
};

// One conversion postback of a team: stored, then one message per recipient (dedupe by click_id + status).
// Buyer: the same rule as analytics (our push for sub_id_2 → nickname in the campaign name → Keitaro group), by member id.
export async function acceptPostback(ws, q = {}) {
  const clickId = postbackClickId(q);
  if (!ws || !clickId) return { ok: false };
  const p = {
    status: str(q.status, 30) || 'conversion',
    payout: Number.isFinite(Number(q.payout ?? q.revenue)) && (q.payout ?? q.revenue) !== '' ? Number(q.payout ?? q.revenue) : null,
    currency: str(q.currency, 10),
    campaign: str(q.campaign_name || q.campaign || q.campaign_id),
    offer: str(q.offer || q.offer_name),
    country: str(q.country, 10),
    click_id: clickId,
    sub_id_2: str(q.sub_id_2, 60),
  };
  const row = { sub_id_2: p.sub_id_2, campaign: p.campaign, campaign_group: q.campaign_group };
  const buyer = (await buyerResolver(ws, [row]))(row);
  const shownBuyer = buyer.label === NO_BUYER ? null : buyer.label;
  const vals = [ws, p.status, p.payout, p.currency, p.campaign, p.offer, p.country, shownBuyer, p.click_id];
  // Atomic: of two identical postbacks arriving together exactly one is the first (partial unique index).
  const { rowCount } = await db.query(`INSERT INTO telegram_postbacks (workspace_id, status, payout, currency, campaign, offer, country, buyer, click_id, duplicate)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
    ON CONFLICT (workspace_id, click_id, status) WHERE NOT duplicate AND click_id IS NOT NULL DO NOTHING`, vals);
  const duplicate = rowCount === 0;
  if (duplicate) {
    await db.query(`INSERT INTO telegram_postbacks (workspace_id, status, payout, currency, campaign, offer, country, buyer, click_id, duplicate)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`, vals);
  } else {
    const s = await workspaceSettings(ws);
    await notify('conversion', { workspace_id: ws, owner_user_id: buyer.userId, urgent: s.conversion_urgent !== false,
      dedupe_key: `conversion:${ws}:${p.click_id}:${p.status}`, payload: { ...p, buyer: shownBuyer } });
  }
  return { ok: true, duplicate };
}

export const maskChat = (id) => { const s = String(id || ''); return s.length > 4 ? `•••${s.slice(-4)}` : '•••'; };
export const webhookUrl = () => `${publicUrl()}/api/telegram/webhook`;
