import { adminOnly } from '../../middleware/access.js';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { deleteUser } from '../../services/users.js';

export async function teamRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  app.get('/members', auth, async (req) => {
    const { rows } = await db.query(
      `SELECT id, name, email, role, created_at FROM users WHERE workspace_id = $1 ORDER BY created_at ASC`,
      [req.user.ws]
    );
    return rows;
  });

  app.post('/invite', adminOnly(app), async (req, reply) => {
    const { name, role, password } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return reply.status(400).send({ error: 'Нужен email' });
    if (!password || password.length < 6) return reply.status(400).send({ error: 'Пароль — минимум 6 символов' });
    const VALID_ROLES = ['owner', 'lead', 'buyer'];
    if (role && !VALID_ROLES.includes(role)) return reply.status(400).send({ error: 'Недопустимая роль' });
    if (req.user.role !== 'owner' && role && role !== 'buyer') return reply.status(403).send({ error: 'Lead может приглашать только баеров' });
    const { ws } = req.user;

    const existing = await db.findOne('users', { email });
    if (existing) return reply.status(400).send({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const user = await db.insert('users', {
      id: `usr_${nanoid(20)}`,
      workspace_id: ws,
      email,
      name,
      password_hash: hash,
      role: role || 'buyer',
    });

    return { id: user.id, name: user.name, email: user.email, role: user.role, created_at: user.created_at };
  });

  app.patch('/members/:id', adminOnly(app), async (req, reply) => {
    const body = req.body || {};
    if (req.user.role !== 'owner' && body.role !== undefined) return reply.status(403).send({ error: 'Менять роли может только owner' });
    const member = await db.findOne('users', { id: req.params.id, workspace_id: req.user.ws });
    if (!member) return reply.status(404).send({ error: 'Not found' });
    // Same policy as /admin/users: nobody changes their own role, so the team never loses its last owner this way.
    if (body.role !== undefined && member.id === req.user.id && body.role !== member.role) {
      return reply.status(400).send({ error: 'Нельзя изменить свою роль' });
    }
    if (body.role !== undefined && !['owner', 'lead', 'buyer'].includes(body.role)) {
      return reply.status(400).send({ error: 'Недопустимая роль' });
    }

    const allowed = ['role', 'name'];
    const data = {};
    for (const key of allowed) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    const updated = await db.update('users', member.id, data);
    return { id: updated.id, name: updated.name, email: updated.email, role: updated.role };
  });

  app.delete('/members/:id', adminOnly(app), async (req, reply) => {
    if (req.params.id === req.user.id) return reply.status(400).send({ error: 'Cannot delete yourself' });
    const member = await db.findOne('users', { id: req.params.id, workspace_id: req.user.ws });
    if (!member) return reply.status(404).send({ error: 'Not found' });
    if (req.user.role !== 'owner' && member.role !== 'buyer') return reply.status(403).send({ error: 'Lead может удалять только баеров' });
    return deleteUser(member.id, reply);
  });
}
