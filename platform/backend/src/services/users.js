import { db } from '../db/client.js';

// Every reference to users is ON DELETE SET NULL (migration 032), so one DELETE either removes the user and
// unsets authorship everywhere, or fails as a whole and changes nothing.
export async function deleteUser(id, reply) {
  try {
    await db.query('DELETE FROM users WHERE id = $1', [id]);
  } catch (e) {
    if (e.code === '23503') return reply.status(409).send({ error: 'У пользователя есть связанные записи, удаление отменено' });
    throw e;
  }
  return { ok: true };
}
