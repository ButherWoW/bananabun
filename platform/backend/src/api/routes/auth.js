import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { attemptLimiter, clientIp } from '../../services/attempt-limit.js';

// Failed logins per address + email, failed invite codes per address.
export const loginLimit = attemptLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
export const registerLimit = attemptLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
const TOO_MANY = (minutes) => ({ error: `Слишком много неудачных попыток. Попробуйте через ${minutes} минут.` });

export async function authRoutes(app) {
  // Register — requires invite code
  app.post('/register', async (req, reply) => {
    const { name, password, workspace_name, invite_code } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return reply.status(400).send({ error: 'Нужен email' });

    const ipKey = clientIp(req);
    if (registerLimit.blocked(ipKey)) return reply.status(429).send(TOO_MANY(60));
    const validCode = process.env.INVITE_CODE;
    if (!validCode || invite_code !== validCode) {
      registerLimit.fail(ipKey);
      return reply.status(403).send({ error: 'Неверный инвайт-код.' });
    }
    if (!password || password.length < 6) return reply.status(400).send({ error: 'Пароль — минимум 6 символов' });

    const existing = await db.findOne('users', { email });
    if (existing) return reply.status(400).send({ error: 'Email уже зарегистрирован.' });

    // Join the existing workspace (single-tenant: all users share one workspace)
    // If somehow multiple workspaces exist, fail loudly so it's not silently wrong
    const wsRows = (await db.query('SELECT * FROM workspaces ORDER BY created_at LIMIT 2')).rows;
    if (wsRows.length > 1) req.log.error('Multiple workspaces detected — attaching user to oldest');
    let ws = wsRows[0];
    if (!ws) {
      ws = await db.insert('workspaces', {
        id: `ws_${nanoid(20)}`,
        name: workspace_name || 'Main Workspace',
      });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await db.insert('users', {
      id: `usr_${nanoid(20)}`,
      workspace_id: ws.id,
      email,
      name,
      password_hash: hash,
      role: 'buyer',
    });

    const token = app.jwt.sign({ id: user.id, ws: ws.id, role: user.role, email });
    return { token, user: { id: user.id, name, email, role: user.role }, workspace: { id: ws.id, name: ws.name } };
  });

  // Login
  app.post('/login', async (req, reply) => {
    const { password } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return reply.status(400).send({ error: 'Нужен email' });

    const key = `${clientIp(req)}|${email}`;
    if (loginLimit.blocked(key)) return reply.status(429).send(TOO_MANY(15));

    const user = await db.findOne('users', { email });
    const ok = !!user && await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) {
      loginLimit.fail(key);
      return reply.status(401).send({ error: 'Invalid credentials' });
    }
    loginLimit.clear(key);

    const token = app.jwt.sign({ id: user.id, ws: user.workspace_id, role: user.role, email });
    return { token, user: { id: user.id, name: user.name, email, role: user.role } };
  });

  // Me
  app.get('/me', { onRequest: [app.authenticate] }, async (req) => {
    const user = await db.findOne('users', { id: req.user.id });
    const ws = await db.findOne('workspaces', { id: user.workspace_id });
    // Only safe workspace fields: the row also holds the Keitaro API key.
    return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, workspace: ws && { id: ws.id, name: ws.name } };
  });
}
