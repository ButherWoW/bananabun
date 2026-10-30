import { db } from '../db/client.js';

// Role and workspace come from the DB on every request, so a removed or demoted user
// loses access at once instead of keeping the rights baked into an old token.
export function registerAuthenticate(app) {
  app.decorate('authenticate', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const { rows: [u] } = await db.query('SELECT id, workspace_id, role, email FROM users WHERE id = $1', [req.user.id]);
    if (!u) return reply.status(401).send({ error: 'Unauthorized' });
    req.user = { ...req.user, ws: u.workspace_id, role: u.role, email: u.email };
  });
}
