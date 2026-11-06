import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { ownUser } from '../../middleware/access.js';
import { findSimilar, searchViaAgent } from '../../services/similar.js';

export async function searchRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  app.post('/amazon', auth, async (req) => {
    const { queries, marketplace = 'fr', min_price, max_price } = req.body || {};
    const { ws } = req.user;

    const job = await db.insert('scrape_jobs', {
      id: `srj_${nanoid(20)}`,
      workspace_id: ws,
      created_by: req.user.id,
      type: 'search',
      status: 'processing',
      params: JSON.stringify({ queries, marketplace, min_price, max_price }),
    });

    // Through the Mac agent in the scrape profile — Amazon is never opened from the server's IP.
    (async () => {
      const seen = new Set();
      const results = [];
      const errors = [];
      for (const q of (Array.isArray(queries) ? queries : []).slice(0, 20)) {
        try {
          for (const it of await searchViaAgent(req.user, marketplace, q, min_price, max_price)) {
            if (!seen.has(it.asin)) { seen.add(it.asin); results.push({ ...it, query: q }); }
          }
        } catch (e) {
          errors.push(`«${q}»: ${e.message}`);
          if (/робот/i.test(e.message)) break;
        }
      }
      if (!results.length && errors.length) throw new Error(errors[0]);
      return { results, errors };
    })().then(async ({ results, errors }) => {
      await db.update('scrape_jobs', job.id, {
        status: 'done',
        result: JSON.stringify({ items: results, total: results.length, errors }),
      });
    }).catch(async (err) => {
      await db.update('scrape_jobs', job.id, {
        status: 'failed',
        error: err.message,
      });
    });

    return { job_id: job.id, status: 'processing' };
  });

  // «Похожие на продающие»: samples from Keitaro sales in the period, search through the Mac agent.
  app.post('/similar', auth, async (req, reply) => {
    const { geo, day_from, day_to, min_price, max_price, marketplace, min_reviews } = req.body || {};
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    if (!/^[A-Z]{2}$/.test(String(geo || ''))) return reply.status(400).send({ error: 'Гео — код из двух букв (FR)' });
    if (!DAY.test(day_from || '') || !DAY.test(day_to || '')) return reply.status(400).send({ error: 'Период — даты YYYY-MM-DD' });
    const job = await db.insert('scrape_jobs', {
      id: `srj_${nanoid(20)}`, workspace_id: req.user.ws, created_by: req.user.id, type: 'similar', status: 'processing',
      params: JSON.stringify({ geo, day_from, day_to, min_price, max_price, marketplace, min_reviews }),
    });
    findSimilar(req.user, { geo, from: day_from, to: day_to, minPrice: min_price, maxPrice: max_price, marketplace, minReviews: min_reviews })
      .then((r) => db.update('scrape_jobs', job.id, { status: 'done', result: JSON.stringify(r) }))
      .catch((e) => db.update('scrape_jobs', job.id, { status: 'failed', error: e.message }).catch(() => {}));
    return { job_id: job.id, status: 'processing' };
  });

  app.get('/history', auth, async (req) => {
    const { rows } = await db.query(
      `SELECT id, type, status, params, error, created_at, updated_at FROM scrape_jobs
       WHERE workspace_id=$1 AND ($2::text IS NULL OR created_by=$2) ORDER BY created_at DESC LIMIT 100`,
      [req.user.ws, ownUser(req)]
    );
    return rows;
  });

  app.get('/:jobId', auth, async (req, reply) => {
    const job = await db.findOne('scrape_jobs', { id: req.params.jobId, workspace_id: req.user.ws });
    if (!job || (ownUser(req) && job.created_by !== req.user.id)) return reply.status(404).send({ error: 'Not found' });

    return {
      id: job.id,
      status: job.status,
      params: job.params,
      result: job.result,
      error: job.error,
      created_at: job.created_at,
      updated_at: job.updated_at,
    };
  });
}
