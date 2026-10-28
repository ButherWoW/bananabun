import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';

function requireRole(...roles) {
  return async (req, reply) => {
    await req.jwtVerify();
    if (!roles.includes(req.user.role)) {
      return reply.status(403).send({ error: 'Недостаточно прав' });
    }
  };
}

export async function adminRoutes(app) {
  const authOwner = { onRequest: [requireRole('owner')] };
  const authLead  = { onRequest: [requireRole('owner', 'lead')] };

  // List users in workspace
  app.get('/users', authLead, async (req) => {
    const { rows } = await db.query(
      `SELECT id, name, email, role, keitaro_tag, created_at FROM users WHERE workspace_id = $1 ORDER BY created_at`,
      [req.user.ws]
    );
    return rows;
  });

  // Create user (owner or lead)
  app.post('/users', authLead, async (req, reply) => {
    const { name, email, password, role = 'buyer' } = req.body;
    if (!name || !email || !password) return reply.status(400).send({ error: 'name, email, password обязательны' });

    // Lead can only create buyers
    if (req.user.role === 'lead' && role !== 'buyer') {
      return reply.status(403).send({ error: 'Лид может создавать только байеров' });
    }
    const allowed = ['owner', 'lead', 'buyer'];
    if (!allowed.includes(role)) return reply.status(400).send({ error: 'Недопустимая роль' });

    const existing = await db.findOne('users', { email });
    if (existing) return reply.status(400).send({ error: 'Email уже занят' });

    const hash = await bcrypt.hash(password, 10);
    const user = await db.insert('users', {
      id: `usr_${nanoid(20)}`,
      workspace_id: req.user.ws,
      email,
      name,
      password_hash: hash,
      role,
    });

    return { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at };
  });

  // Update user (change role or name)
  app.patch('/users/:id', authOwner, async (req, reply) => {
    const { id } = req.params;
    const { name, role, password, keitaro_tag } = req.body;

    const user = await db.findOne('users', { id, workspace_id: req.user.ws });
    if (!user) return reply.status(404).send({ error: 'Пользователь не найден' });

    // Can't demote yourself
    if (id === req.user.id && role && role !== 'owner') {
      return reply.status(400).send({ error: 'Нельзя изменить свою роль' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (role) updates.role = role;
    if (password) updates.password_hash = await bcrypt.hash(password, 10);
    if (keitaro_tag !== undefined) updates.keitaro_tag = String(keitaro_tag).trim().slice(0, 80) || null;
    updates.updated_at = new Date();

    if (Object.keys(updates).length === 0) return { ok: true };

    const keys = Object.keys(updates);
    const vals = Object.values(updates);
    const set = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await db.query(`UPDATE users SET ${set} WHERE id = $${keys.length + 1}`, [...vals, id]);

    return { ok: true };
  });

  // Delete user
  app.delete('/users/:id', authOwner, async (req, reply) => {
    const { id } = req.params;
    if (id === req.user.id) return reply.status(400).send({ error: 'Нельзя удалить себя' });

    const user = await db.findOne('users', { id, workspace_id: req.user.ws });
    if (!user) return reply.status(404).send({ error: 'Пользователь не найден' });

    await db.query('DELETE FROM users WHERE id = $1', [id]);
    return { ok: true };
  });

  // Reset password (owner only)
  app.post('/users/:id/reset-password', authOwner, async (req, reply) => {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 6) return reply.status(400).send({ error: 'Минимум 6 символов' });

    const user = await db.findOne('users', { id, workspace_id: req.user.ws });
    if (!user) return reply.status(404).send({ error: 'Пользователь не найден' });

    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
    return { ok: true };
  });
}
