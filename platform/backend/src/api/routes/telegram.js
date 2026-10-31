import { db } from '../../db/client.js';
import { adminOnly } from '../../middleware/access.js';
import {
  EVENTS, botReady, botInfo, botApi, createLinkCode, redeemLinkCode, workspaceSettings, cleanSettings, cleanThreshold,
  notify, statusText, siteUrl, maskChat, webhookUrl, secretMatches, postbackSecret, postbackUrl, acceptPostback, wakeTelegram,
} from '../../services/telegram.js';

const HELP = [
  'Я присылаю уведомления Bananabun: заливы, модерация, деньги, скрап, креативы, конверсии.',
  '/status — мои цифры за сегодня',
  '/stop — поставить уведомления на паузу, /start — снова включить',
  '/settings — что присылать',
  '/help — это сообщение',
].join('\n');

const eventsFor = (role) => Object.entries(EVENTS).filter(([, e]) => e.roles === 'all' || role !== 'buyer');

export async function telegramRoutes(app) {
  const auth = { onRequest: [app.authenticate] };
  const lead = adminOnly(app);
  // Keitaro may POST postbacks as a form; only inside this plugin.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16384 },
    (req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));

  /* ───── Telegram → us ───── */

  // Bot updates. Telegram sends the secret in a header; without the right secret nothing is read.
  app.post('/webhook', async (req, reply) => {
    const want = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    if (!secretMatches(String(req.headers['x-telegram-bot-api-secret-token'] || ''), want)) return reply.status(401).send({ ok: false });
    const msg = req.body?.message;
    const chatId = msg?.chat?.id;
    const text = String(msg?.text || '').trim();
    if (!chatId || !text.startsWith('/') || msg.chat.type !== 'private') return { ok: true };
    const [cmdRaw, arg] = text.split(/\s+/, 2);
    const cmd = cmdRaw.split('@')[0].toLowerCase();
    const say = (t) => botApi('sendMessage', { chat_id: chatId, text: t, parse_mode: 'HTML', disable_web_page_preview: true }).catch(e => req.log.warn({ err: e.message }, 'telegram reply'));
    const { rows: [linked] } = await db.query('SELECT user_id, muted FROM telegram_links WHERE chat_id = $1', [chatId]);

    if (cmd === '/start' && arg) {
      const userId = await redeemLinkCode(arg, chatId, msg.from?.username);
      await say(userId ? `Готово, Telegram привязан. Настройки: ${siteUrl()}/telegram\n\n${HELP}` : 'Код не подошёл: он одноразовый и живёт 15 минут. Создайте новый на сайте: меню профиля → «Telegram».');
    } else if (cmd === '/start') {
      if (linked) { await db.query('UPDATE telegram_links SET muted = false, blocked_at = NULL WHERE chat_id = $1', [chatId]); await say('Уведомления снова включены.'); }
      else await say(`Чтобы получать уведомления, привяжите Telegram на сайте: ${siteUrl()}/telegram`);
    } else if (cmd === '/stop') {
      if (linked) { await db.query('UPDATE telegram_links SET muted = true WHERE chat_id = $1', [chatId]); await say('Уведомления на паузе. /start — включить снова.'); }
      else await say('Этот чат не привязан.');
    } else if (cmd === '/status') {
      await say(linked ? await statusText(linked.user_id) : 'Этот чат не привязан.');
    } else if (cmd === '/settings') {
      await say(`Что присылать — на сайте: ${siteUrl()}/telegram`);
    } else {
      await say(HELP);
    }
    return { ok: true };
  });

  // Keitaro conversion postbacks: the secret is part of the path, the answer is immediate, sending goes through the queue.
  const postback = async (req, reply) => {
    if (!postbackSecret() || !secretMatches(String(req.params.secret || ''), postbackSecret())) return reply.status(404).send('Not found');
    const q = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    reply.status(200).send('OK');
    acceptPostback(q).catch(e => req.log.error({ err: e.message }, 'keitaro postback'));
    return reply;
  };
  app.get('/keitaro-postback/:secret', postback);
  app.post('/keitaro-postback/:secret', postback);

  /* ───── personal ───── */

  app.get('/me', auth, async (req) => {
    const s = await workspaceSettings(req.user.ws);
    const [{ rows: [link] }, { rows: prefs }] = await Promise.all([
      db.query('SELECT username, linked_at, muted, blocked_at FROM telegram_links WHERE user_id = $1', [req.user.id]),
      db.query('SELECT event, enabled, threshold FROM telegram_prefs WHERE user_id = $1', [req.user.id]),
    ]);
    const mine = new Map(prefs.map(p => [p.event, p]));
    let bot = null;
    try { bot = await botInfo(); } catch { bot = null; }
    return {
      bot_ready: botReady(), bot_username: bot?.username || null,
      linked: !!link, username: link?.username || null, linked_at: link?.linked_at || null, muted: !!link?.muted, blocked: !!link?.blocked_at,
      events: eventsFor(req.user.role).map(([key, e]) => ({
        key, label: e.label,
        enabled: mine.has(key) ? mine.get(key).enabled : !!s.events[key],
        custom: mine.has(key),
        threshold: e.threshold ? { ...(s.thresholds[key] || {}), ...(mine.get(key)?.threshold || {}) } : null,
        default_threshold: e.threshold ? s.thresholds[key] || e.threshold : null,
      })),
    };
  });

  app.post('/me/link', auth, async (req, reply) => {
    if (!botReady()) return reply.status(503).send({ error: 'Бот ещё не подключён — попросите владельца добавить токен бота' });
    let bot;
    try { bot = await botInfo(); } catch (e) { return reply.status(502).send({ error: `Telegram не ответил: ${e.message}` }); }
    const code = await createLinkCode(req.user.id);
    return { url: `https://t.me/${bot.username}?start=${code}`, expires_in: 900 };
  });

  // A link for a team member to forward: Telegram lets a bot write only after the person presses Start themselves.
  app.post('/admin/members/:id/link', lead, async (req, reply) => {
    if (!botReady()) return reply.status(503).send({ error: 'Бот ещё не подключён' });
    const { rows: [u] } = await db.query('SELECT id, name FROM users WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user.ws]);
    if (!u) return reply.status(404).send({ error: 'Участник не найден' });
    let bot;
    try { bot = await botInfo(); } catch (e) { return reply.status(502).send({ error: `Telegram не ответил: ${e.message}` }); }
    const code = await createLinkCode(u.id);
    return { url: `https://t.me/${bot.username}?start=${code}`, expires_in: 900, name: u.name };
  });

  app.delete('/me/link', auth, async (req) => {
    await db.query('DELETE FROM telegram_links WHERE user_id = $1', [req.user.id]);
    return { ok: true };
  });

  app.post('/me/mute', auth, async (req) => {
    await db.query('UPDATE telegram_links SET muted = $2 WHERE user_id = $1', [req.user.id, !!req.body?.muted]);
    return { ok: true };
  });

  app.put('/me/prefs', auth, async (req, reply) => {
    const { event, enabled, threshold, reset } = req.body || {};
    if (!eventsFor(req.user.role).some(([k]) => k === event)) return reply.status(400).send({ error: 'Неизвестное событие' });
    if (reset) { await db.query('DELETE FROM telegram_prefs WHERE user_id = $1 AND event = $2', [req.user.id, event]); return { ok: true }; }
    await db.query(`INSERT INTO telegram_prefs (user_id, event, enabled, threshold) VALUES ($1,$2,$3,$4::jsonb)
      ON CONFLICT (user_id, event) DO UPDATE SET enabled = $3, threshold = $4::jsonb`,
    [req.user.id, event, enabled !== false, threshold ? JSON.stringify(cleanThreshold(event, threshold)) : null]);
    return { ok: true };
  });

  app.post('/me/test', auth, async (req, reply) => {
    const { rows: [l] } = await db.query('SELECT chat_id FROM telegram_links WHERE user_id = $1 AND blocked_at IS NULL', [req.user.id]);
    if (!botReady()) return reply.status(503).send({ error: 'Бот ещё не подключён' });
    if (!l) return reply.status(400).send({ error: 'Сначала привяжите Telegram' });
    await notify('test', { workspace_id: req.user.ws, only: [{ user_id: req.user.id, chat_id: l.chat_id }], urgent: true });
    return { ok: true };
  });

  /* ───── admin (owner / lead) ───── */

  app.get('/admin/status', lead, async () => {
    const out = { token_set: botReady(), webhook_secret_set: !!process.env.TELEGRAM_WEBHOOK_SECRET, postback_secret_set: !!postbackSecret(),
      expected_webhook: webhookUrl(), bot: null, webhook: null, error: null };
    if (!botReady()) return out;
    try {
      const me = await botInfo();
      out.bot = { username: me.username, name: me.first_name };
      const w = await botApi('getWebhookInfo');
      out.webhook = { url: w.url || '', ok: w.url === webhookUrl(), pending: w.pending_update_count || 0,
        last_error: w.last_error_message || null, last_error_at: w.last_error_date ? new Date(w.last_error_date * 1000) : null };
    } catch (e) { out.error = e.message; }
    const { rows: [q] } = await db.query(`SELECT COUNT(*) FILTER (WHERE status='pending')::int AS pending,
      COUNT(*) FILTER (WHERE status='failed' AND created_at > NOW() - INTERVAL '1 day')::int AS failed_day,
      COUNT(*) FILTER (WHERE status='sent' AND created_at > NOW() - INTERVAL '1 day')::int AS sent_day FROM telegram_outbox`);
    out.queue = q;
    return out;
  });

  app.post('/admin/webhook', lead, async (req, reply) => {
    if (!botReady()) return reply.status(503).send({ error: 'Нет токена бота' });
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) return reply.status(503).send({ error: 'Нет секрета webhook на сервере' });
    try {
      await botApi('setWebhook', { url: webhookUrl(), secret_token: secret, allowed_updates: ['message'], drop_pending_updates: false });
      await botApi('setMyCommands', { commands: [
        { command: 'status', description: 'Мои цифры за сегодня' }, { command: 'stop', description: 'Пауза уведомлений' },
        { command: 'start', description: 'Включить уведомления' }, { command: 'settings', description: 'Что присылать' }, { command: 'help', description: 'Помощь' },
      ] }).catch(() => {});
      return { ok: true, url: webhookUrl() };
    } catch (e) { return reply.status(502).send({ error: e.message }); }
  });

  app.get('/admin/members', lead, async (req) => {
    const { rows } = await db.query(`
      SELECT u.id, u.name, u.email, u.role, l.username, l.chat_id, l.linked_at, l.muted, l.blocked_at
        FROM users u LEFT JOIN telegram_links l ON l.user_id = u.id
       WHERE u.workspace_id = $1 ORDER BY u.created_at`, [req.user.ws]);
    return rows.map(({ chat_id, ...r }) => ({ ...r, linked: !!chat_id, chat: chat_id ? maskChat(chat_id) : null }));
  });

  app.get('/admin/settings', lead, async (req) => ({
    settings: await workspaceSettings(req.user.ws),
    events: Object.entries(EVENTS).map(([key, e]) => ({ key, label: e.label, leads_only: e.roles === 'lead', threshold: e.threshold || null })),
  }));

  app.put('/admin/settings', lead, async (req) => {
    const current = await workspaceSettings(req.user.ws);
    const next = { ...current, ...cleanSettings(req.body || {}) };
    await db.query(`INSERT INTO telegram_settings (workspace_id, settings, updated_at) VALUES ($1,$2::jsonb,NOW())
      ON CONFLICT (workspace_id) DO UPDATE SET settings = $2::jsonb, updated_at = NOW()`, [req.user.ws, JSON.stringify(next)]);
    return { settings: next };
  });

  app.get('/admin/log', lead, async (req) => {
    const args = [req.user.ws];
    let where = 'o.workspace_id = $1';
    if (req.query.status) { args.push(String(req.query.status)); where += ` AND o.status = $${args.length}`; }
    if (req.query.event) { args.push(String(req.query.event)); where += ` AND o.event = $${args.length}`; }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const { rows } = await db.query(`
      SELECT o.id, o.event, o.status, o.attempts, o.error, o.created_at, o.sent_at, o.next_at, o.urgent, u.name AS user_name, u.email AS user_email
        FROM telegram_outbox o LEFT JOIN users u ON u.id = o.user_id
       WHERE ${where} ORDER BY o.created_at DESC LIMIT ${limit}`, args);
    return rows;
  });

  app.post('/admin/test', lead, async (req, reply) => {
    const { rows: [l] } = await db.query(`SELECT l.chat_id FROM telegram_links l JOIN users u ON u.id = l.user_id
      WHERE u.id = $1 AND u.workspace_id = $2 AND l.blocked_at IS NULL`, [req.body?.user_id, req.user.ws]);
    if (!botReady()) return reply.status(503).send({ error: 'Нет токена бота' });
    if (!l) return reply.status(400).send({ error: 'У участника Telegram не привязан' });
    await notify('test', { workspace_id: req.user.ws, only: [{ user_id: req.body.user_id, chat_id: l.chat_id }], urgent: true });
    return { ok: true };
  });

  app.post('/admin/broadcast', lead, async (req, reply) => {
    const text = String(req.body?.text || '').trim();
    if (!text || text.length > 2000) return reply.status(400).send({ error: 'Текст — от 1 до 2000 знаков' });
    if (req.body?.confirm !== true) return reply.status(400).send({ error: 'Подтвердите отправку' });
    if (!botReady()) return reply.status(503).send({ error: 'Нет токена бота' });
    const { rows } = await db.query(`SELECT l.user_id, l.chat_id FROM telegram_links l JOIN users u ON u.id = l.user_id
      WHERE u.workspace_id = $1 AND l.blocked_at IS NULL AND l.muted = false`, [req.user.ws]);
    const n = await notify('broadcast', { workspace_id: req.user.ws, only: rows, payload: { text }, urgent: true });
    wakeTelegram();
    return { ok: true, queued: n };
  });

  app.get('/admin/postbacks', lead, async (req) => {
    const [{ rows: [c] }, { rows: last }] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '1 day')::int AS day,
        COUNT(*) FILTER (WHERE duplicate)::int AS duplicates FROM telegram_postbacks WHERE workspace_id = $1`, [req.user.ws]),
      db.query(`SELECT received_at, status, payout, currency, campaign, offer, country, buyer, duplicate FROM telegram_postbacks
        WHERE workspace_id = $1 ORDER BY received_at DESC LIMIT 20`, [req.user.ws]),
    ]);
    return { url: postbackSecret() ? postbackUrl(req.user.ws) : null, secret_set: !!postbackSecret(), counts: c, last };
  });
}
