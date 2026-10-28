import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';

export async function authRoutes(app) {
  // Register — requires invite code
  app.post('/register', async (req, reply) => {
    const { name, email, password, workspace_name, invite_code } = req.body;

    const validCode = process.env.INVITE_CODE;
    if (!validCode || invite_code !== validCode) {
      return reply.status(403).send({ error: 'Неверный инвайт-код.' });
    }

    const existing = await db.findOne('users', { email });
    if (existing) return reply.status(400).send({ error: 'Email уже зарегистрирован.' });

    // Join the first existing workspace, or create one if none exists
    let ws = (await db.query('SELECT * FROM workspaces ORDER BY created_at LIMIT 1')).rows[0];
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
    const { email, password } = req.body;

    const user = await db.findOne('users', { email });
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return reply.status(401).send({ error: 'Invalid credentials' });

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
