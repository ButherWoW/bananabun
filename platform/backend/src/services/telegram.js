// Telegram notifications: Bot API client, event bus, outgoing queue and periodic checks.
// Without TELEGRAM_BOT_TOKEN nothing is queued or sent and nothing fails: the bot is simply «not connected».
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { keitaroClient } from './keitaro.js';
import { buyerNamer, buyerShare, BUYER_SHARE_PCT, TRACKER_CURRENCY } from './buyers.js';

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
  spend_over: { label: 'Расход кампании за день выше порога', roles: 'all', default: true, threshold: { amount: 50 } },
  roi_below: { label: 'ROI кампании за день ниже порога', roles: 'all', default: true, threshold: { roi: -30, min_spend: 20 } },
  daily_digest: { label: 'Итог дня', roles: 'all', default: true },
  scrape_done: { label: 'Скрап готов', roles: 'all', default: false },
  scrape_failed: { label: 'Скрап упал', roles: 'all', default: true },
  creatives_done: { label: 'Креативы готовы', roles: 'all', default: false },
  creatives_failed: { label: 'Креативы упали', roles: 'all', default: true },
  agent_offline: { label: 'Агент / AdsPower не отвечает', roles: 'lead', default: true, threshold: { minutes: 15 } },
  conversion: { label: 'Конверсия (постбек Keitaro)', roles: 'all', default: true },
};

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
    if ((k === 'amount' || k === 'min_spend' || k === 'minutes') && n <= 0) throw Object.assign(new Error('Порог должен быть больше нуля'), { statusCode: 400 });
    out[k] = n;
  }
  return out;
}

/* ───── text ───── */

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Anything secret-looking is never put into a message, whatever a caller passes.
const SECRET = /(EAA[A-Za-z0-9]{10,}|bb_[A-Za-z0-9_-]{20,}|access_token=[^&\s]+|\b[A-Fa-f0-9]{32,}\b)/g;
const clean = (s) => esc(String(s ?? '').replace(SECRET, '•••').slice(0, 300));
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
      return `💸 <b>Расход выше порога</b>\n${clean(p.campaign)}\nСегодня: ${money(p.spend, p.currency)} (порог ${money(p.threshold, p.currency)})\n${link('/campaigns', 'Кампании')}`;
    case 'roi_below':
      return `📉 <b>ROI ниже порога</b>\n${clean(p.campaign)}\nСегодня: ROI ${Number(p.roi).toFixed(1)}% при расходе ${money(p.spend, p.currency)} (порог ${Number(p.threshold)}%)\n${link('/campaigns', 'Кампании')}`;
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
    case 'agent_offline':
      return `🔴 <b>Агент AdsPower не отвечает</b> ${Number(p.minutes)} мин.\nЗаливы, скрап, проверки профилей и 2FA стоят.\n${link('/accounts', 'Аккаунты')}`;
    case 'conversion': {
      const icon = { sale: '💰', lead: '🟢', rejected: '🔴', trash: '🗑' }[String(p.status || '').toLowerCase()] || '🔔';
      return `${icon} <b>Конверсия: ${clean(p.status || '—')}</b>${Number(p.payout) ? ` · ${money(p.payout, p.currency)}` : ''}\n${clean(p.campaign || 'кампания не указана')}${p.offer ? `\nОффер: ${clean(p.offer)}` : ''}${p.country ? `\nГео: ${clean(p.country)}` : ''}${p.buyer ? `\nБайер: ${clean(p.buyer)}` : ''}`;
    }
    case 'test':
      return `👋 Тестовое сообщение Bananabun. Уведомления приходят сюда.`;
    case 'broadcast':
      return `📣 <b>Сообщение команде</b>\n${clean(p.text)}`;
    default:
      return clean(p.text || event);
  }
}

function digestText(p) {
  const head = p.team ? '📊 <b>Итог дня по команде</b>' : '📊 <b>Итог дня</b>';
  const rows = (p.rows || []).map(r => `• ${clean(r.buyer)}: расход ${money(r.cost, p.currency)}, доход ${money(r.revenue, p.currency)}, профит ${money(r.profit, p.currency)}${r.share > 0 ? `, байеру ${money(r.share, p.currency)}` : ''}`);
  const t = p.total || {};
  return [head, `${clean(p.date)}`, ...rows,
    `Итого: расход ${money(t.cost, p.currency)}, доход ${money(t.revenue, p.currency)}, профит ${money(t.profit, p.currency)}${t.roi != null ? `, ROI ${t.roi.toFixed(1)}%` : ''}`,
    ...(p.team ? [] : [`Байеру ${BUYER_SHARE_PCT}%: ${money(t.share, p.currency)}`]),
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

export const sendText = (chatId, text) => botApi('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });

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
  await db.query('DELETE FROM telegram_links WHERE chat_id = $1 AND user_id <> $2', [chatId, c.user_id]);
  await db.query(`INSERT INTO telegram_links (user_id, chat_id, username, linked_at, muted, blocked_at) VALUES ($1, $2, $3, NOW(), false, NULL)
    ON CONFLICT (user_id) DO UPDATE SET chat_id = $2, username = $3, linked_at = NOW(), muted = false, blocked_at = NULL`,
  [c.user_id, chatId, username ? String(username).slice(0, 64) : null]);
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
function quietEnd(s, date = new Date()) {
  let t = new Date(date);
  for (let i = 0; i < 24 * 4 && inQuiet(s, t); i++) t = new Date(t.getTime() + 15 * 60000);
  return t;
}

// Effective personal setting for one user and event: personal override, else the team default.
async function userWants(userId, event, s) {
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
    if (!botReady() || !workspace_id || !EVENTS[event] && event !== 'test' && event !== 'broadcast') return 0;
    const list = only ? only : await recipients(event, { workspace_id, owner_user_id });
    if (!list.length) return 0;
    const s = await workspaceSettings(workspace_id);
    const text = messageFor(event, payload);
    const key = dedupe_key || `${event}:${crypto.randomUUID()}`;
    let n = 0;
    for (const r of list) {
      const next = !urgent && inQuiet(s) ? quietEnd(s) : new Date();
      const { rowCount } = await db.query(`
        INSERT INTO telegram_outbox (workspace_id, user_id, chat_id, event, text, dedupe_key, urgent, next_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (dedupe_key) DO NOTHING`,
      [workspace_id, r.user_id, r.chat_id, event, text, `${key}:${r.user_id}`.slice(0, 200), !!urgent, next]);
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

/* ───── queue ───── */

const MAX_PER_SECOND = 25;
const MAX_ATTEMPTS = 5;
const lastByChat = new Map();

// Sends due messages: ~25/s in total, 1/s per chat; 429 waits retry_after; 403 (bot blocked) unlinks the chat.
export async function processOutbox({ now = Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!botReady()) return 0;
  const { rows } = await db.query(`
    SELECT * FROM telegram_outbox WHERE status = 'pending' AND next_at <= $1
     ORDER BY urgent DESC, next_at, id LIMIT ${MAX_PER_SECOND * 2}`, [new Date(now)]);
  let sent = 0;
  const started = Date.now();
  for (const m of rows) {
    if (sent >= MAX_PER_SECOND) break;
    const chat = String(m.chat_id);
    if (now - (lastByChat.get(chat) || 0) < 1000) continue;
    const { rowCount } = await db.query(`UPDATE telegram_outbox SET attempts = attempts + 1 WHERE id = $1 AND status = 'pending' AND attempts = $2`, [m.id, m.attempts]);
    if (!rowCount) continue;
    lastByChat.set(chat, now);
    try {
      await sendText(m.chat_id, m.text);
      await db.query(`UPDATE telegram_outbox SET status = 'sent', sent_at = NOW(), error = NULL WHERE id = $1`, [m.id]);
      sent++;
    } catch (e) {
      if (e.status === 429) {
        const wait = (Number(e.retryAfter) || 5) * 1000;
        await db.query(`UPDATE telegram_outbox SET next_at = $2, error = $3, attempts = attempts - 1 WHERE id = $1`, [m.id, new Date(now + wait), String(e.message).slice(0, 300)]);
      } else if (e.status === 403) {
        await db.query(`UPDATE telegram_outbox SET status = 'failed', error = $2 WHERE id = $1`, [m.id, 'Бот заблокирован пользователем — привязка отключена']);
        await db.query(`UPDATE telegram_links SET blocked_at = NOW() WHERE chat_id = $1`, [m.chat_id]);
      } else {
        const done = m.attempts + 1 >= MAX_ATTEMPTS;
        await db.query(`UPDATE telegram_outbox SET status = $2, next_at = $3, error = $4 WHERE id = $1`,
          [m.id, done ? 'failed' : 'pending', new Date(now + 5000 * 2 ** m.attempts), String(e.message).slice(0, 300)]);
      }
    }
  }
  if (Date.now() - started < 1000 && sent >= MAX_PER_SECOND) await sleep(1000);
  return sent;
}

/* ───── periodic checks ───── */

const RAW = ['clicks', 'lp_clicks', 'sales', 'leads', 'revenue', 'cost'];
const ACCOUNT_STATUS = { 2: 'кабинет отключён', 3: 'долг по оплате в кабинете', 7: 'кабинет на проверке рисков', 8: 'кабинет ждёт расчёта', 9: 'кабинет в льготном периоде', 100: 'кабинет ждёт закрытия', 101: 'кабинет закрыт' };
export const accountStatusLabel = (s) => ACCOUNT_STATUS[s] || null;
const dayIn = (tz, date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(date);

// Today's numbers per buyer label from the tracker, the way analytics shows them.
export async function buyerDay(ws, client) {
  const data = await client.stats('today', ['sub_id_2', 'campaign', 'campaign_group'], RAW);
  const rows = data?.rows || [];
  const who = await buyerNamer(ws, rows);
  const map = new Map();
  for (const r of rows) {
    const b = who(r);
    const acc = map.get(b) || { buyer: b, revenue: 0, cost: 0 };
    acc.revenue += Number(r.revenue) || 0;
    acc.cost += Number(r.cost) || 0;
    map.set(b, acc);
  }
  return [...map.values()].map(r => ({ ...r, profit: r.revenue - r.cost, share: buyerShare(r.revenue - r.cost) }))
    .sort((a, b) => b.profit - a.profit);
}

const userLabel = (u) => u.name || u.email?.split('@')[0] || '?';
function digestFor(user, all, date) {
  const team = user.role !== 'buyer';
  const rows = team ? all : all.filter(r => r.buyer === userLabel(user));
  const t = rows.reduce((a, r) => ({ cost: a.cost + r.cost, revenue: a.revenue + r.revenue }), { cost: 0, revenue: 0 });
  const profit = t.revenue - t.cost;
  return { team, date, rows, currency: TRACKER_CURRENCY, total: { ...t, profit, roi: t.cost > 0 ? profit / t.cost * 100 : null, share: buyerShare(profit) } };
}

// Text for /status: today's numbers, a buyer sees only their own.
export async function statusText(userId) {
  const { rows: [u] } = await db.query('SELECT id, name, email, role, workspace_id FROM users WHERE id = $1', [userId]);
  if (!u) return 'Аккаунт не найден.';
  const ws = await db.findOne('workspaces', { id: u.workspace_id });
  if (!ws?.keitaro_url || !ws?.keitaro_api_key) return 'Трекер не настроен — цифр пока нет.';
  try {
    const all = await buyerDay(u.workspace_id, keitaroClient(ws.keitaro_url, ws.keitaro_api_key));
    return digestText(digestFor(u, all, dayIn((await workspaceSettings(u.workspace_id)).timezone))).replace('Итог дня', 'Сегодня');
  } catch {
    return 'Трекер не ответил — попробуйте позже.';
  }
}

async function checkAgent(ws, s) {
  const { rows: [w] } = await db.query('SELECT agent_seen_at, agent_key_hash IS NOT NULL AS configured FROM workspaces WHERE id = $1', [ws]);
  if (!w?.configured || !w.agent_seen_at) return;
  const limit = Number(s.thresholds.agent_offline?.minutes) || 15;
  const minutes = Math.floor((Date.now() - new Date(w.agent_seen_at).getTime()) / 60000);
  if (minutes < limit) return;
  await notify('agent_offline', { workspace_id: ws, payload: { minutes }, urgent: true, dedupe_key: `agent_offline:${ws}:${new Date(w.agent_seen_at).toISOString()}` });
}

// Owner of an FB campaign: the author of our push for it, else the member whose email names the AdsPower group.
const FB_OWNER_SQL = `
  SELECT fc.id, fc.name, fc.currency, fc.spend_today, fc.effective_status,
         COALESCE((SELECT p.created_by FROM pushes p WHERE p.workspace_id = fc.workspace_id AND p.fb_campaign_id = fc.id ORDER BY p.created_at DESC LIMIT 1),
                  (SELECT u.id FROM users u WHERE u.workspace_id = fc.workspace_id AND LOWER(u.email) = LOWER(ap.group_name) LIMIT 1)) AS owner_id
    FROM fb_campaigns fc
    LEFT JOIN fb_accounts fa ON fa.id = fc.fb_account_id
    LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
   WHERE fc.workspace_id = $1`;

async function checkMoney(ws, s, client) {
  const { rows: camps } = await db.query(`${FB_OWNER_SQL} AND fc.archived_at IS NULL AND COALESCE(fc.spend_today, 0) > 0`, [ws]);
  if (!camps.length) return;
  const date = dayIn(s.timezone);
  let revenue = new Map();
  if (client) {
    try {
      const data = await client.stats('today', ['sub_id_2'], ['revenue']);
      revenue = new Map((data?.rows || []).map(r => [String(r.sub_id_2), Number(r.revenue) || 0]));
    } catch { revenue = null; }
  }
  for (const c of camps) {
    const spend = Number(c.spend_today) || 0;
    for (const r of await recipients('spend_over', { workspace_id: ws, owner_user_id: c.owner_id })) {
      if (spend > (Number(r.threshold.amount) || Infinity)) {
        await notify('spend_over', { workspace_id: ws, only: [r], dedupe_key: `spend_over:${c.id}:${date}`,
          payload: { campaign: c.name, spend, currency: c.currency, threshold: r.threshold.amount } });
      }
    }
    if (!revenue) continue;
    const roi = ((revenue.get(String(c.id)) || 0) - spend) / spend * 100;
    for (const r of await recipients('roi_below', { workspace_id: ws, owner_user_id: c.owner_id })) {
      const min = Number(r.threshold.min_spend) || 0;
      if (spend >= min && roi < Number(r.threshold.roi)) {
        await notify('roi_below', { workspace_id: ws, only: [r], dedupe_key: `roi_below:${c.id}:${date}`,
          payload: { campaign: c.name, roi, spend, currency: c.currency, threshold: r.threshold.roi } });
      }
    }
  }
}

async function checkDigest(ws, s, client) {
  if (!client || localHour(s.timezone) !== Number(s.digest_hour)) return;
  const date = dayIn(s.timezone);
  const { rows: users } = await db.query(`
    SELECT u.id, u.name, u.email, u.role, l.chat_id FROM telegram_links l JOIN users u ON u.id = l.user_id
     WHERE u.workspace_id = $1 AND l.muted = false AND l.blocked_at IS NULL`, [ws]);
  if (!users.length) return;
  // Runs every 5 minutes during the digest hour; the per-user dedupe key keeps it to one message a day.
  let all;
  try { all = await buyerDay(ws, client); } catch { return; }
  for (const u of users) {
    const w = await userWants(u.id, 'daily_digest', s);
    if (!w.enabled) continue;
    await notify('daily_digest', { workspace_id: ws, only: [{ user_id: u.id, chat_id: u.chat_id }], dedupe_key: `daily_digest:${ws}:${date}`,
      payload: digestFor(u, all, date) });
  }
}

export async function runChecks() {
  if (!botReady()) return;
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

/* ───── object hooks (called where the things happen) ───── */

// FB snapshot replaced: new rejections and new account problems, compared with the previous snapshot.
export async function moderationChanges(ws, before, after) {
  for (const c of after) {
    const prev = before.get(String(c.id));
    const m = c.moderation || {};
    const bad = (Number(m.rejected) || 0) + (Number(m.issues) || 0);
    const prevBad = prev ? (Number(prev.moderation?.rejected) || 0) + (Number(prev.moderation?.issues) || 0) : 0;
    if (bad > prevBad) {
      emit('moderation_rejected', { workspace_id: ws, owner_user_id: c.owner_id, dedupe_key: `moderation:${c.id}:${m.rejected || 0}:${m.issues || 0}`,
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
  const key = `creatives:${record.product_id}:${new Date(record.created_at).getTime()}`;
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
export function startTelegramWorker() {
  if (timer) return () => {};
  timer = setInterval(tick, 1000); timer.unref?.();
  checkTimer = setInterval(() => runChecks().catch(() => {}), 5 * 60 * 1000); checkTimer.unref?.();
  return () => { clearInterval(timer); clearInterval(checkTimer); timer = null; };
}

/* ───── Keitaro postbacks ───── */

export const postbackSecret = () => process.env.KEITARO_POSTBACK_SECRET || '';
export function secretMatches(given, want = postbackSecret()) {
  if (!want || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}
// Keitaro macros: {status} {revenue} {currency} {campaign_id} {campaign_name} {offer_name} {country} {sub_id_2} {subid}.
export const postbackUrl = (ws) => `${publicUrl()}/api/telegram/keitaro-postback/${postbackSecret() || 'СЕКРЕТ_НЕ_ЗАДАН'}?ws=${encodeURIComponent(ws)}`
  + '&status={status}&payout={revenue}&currency={currency}&campaign_id={campaign_id}&campaign_name={campaign_name}'
  + '&offer={offer_name}&country={country}&sub_id_2={sub_id_2}&click_id={subid}';

const str = (v, n = 300) => (v == null || v === '' ? null : String(v).slice(0, n));

// One conversion postback: stored, then one message per recipient (dedupe by click_id + status).
// Buyer: the same rule as analytics (our push for sub_id_2 → nickname in the campaign name → Keitaro group).
export async function acceptPostback(q = {}) {
  let ws = str(q.ws, 30);
  if (!ws) {
    const { rows } = await db.query('SELECT id FROM workspaces LIMIT 2');
    if (rows.length === 1) ws = rows[0].id;
  }
  if (!ws || !(await db.findOne('workspaces', { id: ws }))) return { ok: false };
  const p = {
    status: str(q.status, 30) || 'conversion',
    payout: Number.isFinite(Number(q.payout ?? q.revenue)) && (q.payout ?? q.revenue) !== '' ? Number(q.payout ?? q.revenue) : null,
    currency: str(q.currency, 10),
    campaign: str(q.campaign_name || q.campaign || q.campaign_id),
    offer: str(q.offer || q.offer_name),
    country: str(q.country, 10),
    click_id: str(q.click_id || q.subid || q.sub_id, 200),
    sub_id_2: str(q.sub_id_2, 60),
  };
  const row = { sub_id_2: p.sub_id_2, campaign: p.campaign, campaign_group: q.campaign_group };
  const buyer = (await buyerNamer(ws, [row]))(row);
  const { rows: users } = await db.query('SELECT id, name, email FROM users WHERE workspace_id = $1', [ws]);
  const owner = buyer === 'без метки' ? null : users.find(u => userLabel(u) === buyer)?.id || null;
  const shownBuyer = buyer === 'без метки' ? null : buyer;
  const vals = [ws, p.status, p.payout, p.currency, p.campaign, p.offer, p.country, shownBuyer, p.click_id];
  // Atomic: of two identical postbacks arriving together exactly one is the first (partial unique index).
  const { rowCount } = await db.query(`INSERT INTO telegram_postbacks (workspace_id, status, payout, currency, campaign, offer, country, buyer, click_id, duplicate)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
    ON CONFLICT (workspace_id, click_id, status) WHERE NOT duplicate AND click_id IS NOT NULL DO NOTHING`, vals);
  const duplicate = rowCount === 0;
  if (duplicate) {
    await db.query(`INSERT INTO telegram_postbacks (workspace_id, status, payout, currency, campaign, offer, country, buyer, click_id, duplicate)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`, vals);
  }
  if (!duplicate) {
    const s = await workspaceSettings(ws);
    await notify('conversion', { workspace_id: ws, owner_user_id: owner, urgent: s.conversion_urgent !== false,
      dedupe_key: p.click_id ? `conversion:${ws}:${p.click_id}:${p.status}` : undefined, payload: { ...p, buyer: shownBuyer } });
  }
  return { ok: true, duplicate };
}

export const maskChat = (id) => { const s = String(id || ''); return s.length > 4 ? `•••${s.slice(-4)}` : '•••'; };
export const webhookUrl = () => `${publicUrl()}/api/telegram/webhook`;
