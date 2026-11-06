import { db } from '../../db/client.js';
import { runPush } from '../../services/push.js';
import { emit } from '../../services/telegram.js';
import { keitaroClient } from '../../services/keitaro.js';
import { assertProductAccess, assertCreativeAccess, assertRecordAccess, ownUser } from '../../middleware/access.js';

const ownOnly = (req) => (req.user.role === 'buyer' ? req.user.id : null);

// A push goes only into a cabinet synced for this workspace; buyers only into cabinets of their own AdsPower group
// (named after their email).
async function cabinetAllowed(req, externalId) {
  const ext = String(externalId || '').replace(/^act_/, '');
  const buyer = req.user.role === 'buyer';
  const { rows } = await db.query(`
    SELECT 1 FROM fb_cabinets c
      LEFT JOIN fb_accounts fa ON fa.id = c.fb_account_id
      LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
     WHERE c.workspace_id = $1 AND c.external_id IN ($2, $3) AND ($4::text IS NULL OR LOWER(ap.group_name) = $4) LIMIT 1`,
    [req.user.ws, ext, `act_${ext}`, buyer ? String(req.user.email || '').toLowerCase() : null]);
  return rows.length > 0;
}

// Validates one push request and returns its params; no side effects, so a batch can check every cabinet first.
async function buildPushParams(req, input) {
  const {
    product_id, landing_id, landing_url, campaign_name,
    domain_id, whitepage,
    cabinet_id, cabinet_external_id,
    page_external_id, pixel_id,
    creative_ids, preset_id,
    objective, daily_budget, bid_strategy, bid_amount,
    optimization_goal, billing_event, pixel_event,
    countries, age_min, age_max, auto_placement,
    adsets_count, call_to_action,
    genders, devices, platforms, bid_amounts, creo_mode, creo_per_adset,
    ad_title, ad_body,
    kt_landing_id, white_landing_id, offer_ids, kt_group_id,
  } = input;

  if (!product_id || !creative_ids?.length || !cabinet_external_id || !pixel_id)
    throw Object.assign(new Error('Missing required fields'), { statusCode: 400 });
  await assertProductAccess(req, product_id);
  if (!Array.isArray(creative_ids) || new Set(creative_ids).size !== creative_ids.length)
    throw Object.assign(new Error('Нужен список различных креативов'), { statusCode: 400 });
  await assertCreativeAccess(req, creative_ids, { productId: product_id, ready: true });
  if (preset_id) await assertRecordAccess(req, 'ad_settings', preset_id);
  if (landing_id) await assertRecordAccess(req, 'landing_templates', landing_id);
  if (!(await cabinetAllowed(req, cabinet_external_id)))
    throw Object.assign(new Error('Это не ваш кабинет'), { statusCode: 403 });
  // Bid and daily budget are set per geo with the lead — never defaulted.
  if (!(Number(daily_budget) > 0) || !(Number(bid_amount) > 0))
    throw Object.assign(new Error('Укажите дневной бюджет и ставку'), { statusCode: 400 });

  const adsets = Math.min(Math.max(Number(adsets_count) || 3, 1), 20);
  // A bid per adset (lead's choice) — exactly one per adset, or none and bid_amount goes to all.
  const bids = Array.isArray(bid_amounts) && bid_amounts.length ? bid_amounts.map(Number) : null;
  if (bids && (bids.length !== adsets || bids.some(b => !(b > 0))))
    throw Object.assign(new Error(`Ставок по адсетам должно быть ${adsets}, каждая больше нуля`), { statusCode: 400 });
  const placementList = auto_placement === false
    ? (Array.isArray(platforms) ? platforms : []).filter(p => ['facebook', 'instagram', 'audience_network', 'messenger'].includes(p))
    : [];
  if (auto_placement === false && !placementList.length)
    throw Object.assign(new Error('Авто-плейсменты выключены — выберите площадки'), { statusCode: 400 });
  const perAdset = Math.min(Math.max(Number(creo_per_adset) || 1, 1), 50);
  if (creo_mode === 'one-per' && perAdset * adsets > creative_ids.length)
    throw Object.assign(new Error(`Раскладка «по ${perAdset} на адсет» × ${adsets} адсетов требует ${perAdset * adsets} креативов, выбрано ${creative_ids.length}`), { statusCode: 400 });

  const params = {
    product_id, landing_id, landing_url, campaign_name,
    domain_id, whitepage,
    cabinet_id, cabinet_external_id,
    page_external_id, pixel_id,
    creative_ids, preset_id,
    objective: 'OUTCOME_LEADS',
    daily_budget: Number(daily_budget),
    bid_strategy: 'LOWEST_COST_WITH_BID_CAP',
    bid_amount: Number(bid_amount),
    optimization_goal: 'OFFSITE_CONVERSIONS',
    billing_event: 'IMPRESSIONS',
    pixel_event: pixel_event || 'LEAD',
    countries: countries || [],
    age_min: age_min || 18,
    age_max: age_max || 65,
    auto_placement: auto_placement !== false,
    platforms: placementList,
    adsets_count: adsets,
    bid_amounts: bids,
    genders: ['male', 'female'].includes(genders) ? genders : 'all',
    devices: ['mobile', 'desktop'].includes(devices) ? devices : 'all',
    creo_mode: creo_mode === 'one-per' ? 'one-per' : 'all-all',
    creo_per_adset: perAdset,
    call_to_action: call_to_action || 'SHOP_NOW',
    ad_title, ad_body,
    kt_landing_id, white_landing_id, kt_group_id,
    offer_ids: (Array.isArray(offer_ids) ? offer_ids : [offer_ids]).filter(Boolean).map(Number),
    // Everything is created PAUSED; activation is a separate, confirmed step.
    run_now: false,
  };

  return params;
}

async function insertPush(req, params) {
  const push = await db.insert('pushes', {
    workspace_id: req.user.ws,
    product_id: params.product_id,
    params,
    status: 'pending',
    created_by: req.user.id,
    log: JSON.stringify([]),
  });
  runPush(push.id).catch(console.error);
  return push.id;
}

const CABINET_FIELDS = ['cabinet_id', 'cabinet_external_id', 'page_external_id', 'pixel_id', 'daily_budget', 'bid_amount', 'bid_amounts'];
const MAX_BATCH_CABINETS = 20;

export async function pushRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // Start a new push
  // ?dry_run=1 runs every check and writes nothing (MCP drafts are validated this way before the human says yes).
  app.post('/', auth, async (req) => {
    const params = await buildPushParams(req, req.body || {});
    if (req.query?.dry_run === '1') return { ok: true, params };
    const id = await insertPush(req, params);
    return { id, status: 'pending' };
  });

  // One push per cabinet with shared product, creatives and settings. Budget and bid come from each cabinet's own
  // entry (never copied from another one). Every cabinet is validated before any push row is written.
  app.post('/batch', auth, async (req) => {
    const { cabinets, ...common } = req.body || {};
    if (!Array.isArray(cabinets) || !cabinets.length)
      throw Object.assign(new Error('Выберите хотя бы один кабинет'), { statusCode: 400 });
    if (cabinets.length > MAX_BATCH_CABINETS)
      throw Object.assign(new Error(`Не больше ${MAX_BATCH_CABINETS} кабинетов за раз`), { statusCode: 400 });
    const ext = cabinets.map(c => String(c?.cabinet_external_id || '').replace(/^act_/, ''));
    if (new Set(ext).size !== ext.length)
      throw Object.assign(new Error('Кабинет выбран дважды'), { statusCode: 400 });
    for (const f of CABINET_FIELDS) delete common[f];

    const planned = [];
    for (const [i, cab] of cabinets.entries()) {
      const own = Object.fromEntries(CABINET_FIELDS.filter(f => cab?.[f] !== undefined).map(f => [f, cab[f]]));
      try {
        planned.push(await buildPushParams(req, { ...common, ...own }));
      } catch (e) {
        e.message = `Кабинет ${cab?.cabinet_external_id || i + 1}: ${e.message}`;
        throw e;
      }
    }
    if (req.query?.dry_run === '1') return { ok: true, cabinets: planned };

    const results = [];
    for (const params of planned) {
      try {
        results.push({ cabinet_id: params.cabinet_id, cabinet_external_id: params.cabinet_external_id, push_id: await insertPush(req, params), status: 'pending' });
      } catch (e) {
        results.push({ cabinet_id: params.cabinet_id, cabinet_external_id: params.cabinet_external_id, error: e.message });
      }
    }
    return { results };
  });

  // List pushes
  app.get('/', auth, async (req) => {
    const { status, dismissed } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Math.floor(Number(req.query.offset) || 0), 0);
    let where = 'p.workspace_id = $1';
    const args = [req.user.ws];
    if (req.user.role === 'buyer') { where += ` AND p.created_by = $${args.length + 1}`; args.push(req.user.id); }
    if (status) { where += ` AND p.status = $${args.length + 1}`; args.push(status); }
    // By default hide dismissed; pass dismissed=true to show only dismissed
    if (dismissed === 'true') {
      where += ` AND p.dismissed = true`;
    } else {
      where += ` AND (p.dismissed IS NULL OR p.dismissed = false)`;
    }
    const result = await db.query(
      `SELECT p.*, pr.title as product_name
       FROM pushes p
       LEFT JOIN products pr ON pr.id = p.product_id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, limit, offset]
    );
    return result.rows;
  });

  // Dismiss push (move to dismissed tab)
  app.post('/:id/dismiss', auth, async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE pushes SET dismissed = true WHERE id = $1 AND workspace_id = $2 AND ($3::text IS NULL OR created_by = $3) RETURNING id`,
      [req.params.id, req.user.ws, ownOnly(req)]
    );
    if (!rows.length) return reply.status(404).send({ error: 'Not found' });
    return { ok: true };
  });

  // Restore dismissed push
  app.post('/:id/restore', auth, async (req, reply) => {
    const { rows } = await db.query(
      `UPDATE pushes SET dismissed = false WHERE id = $1 AND workspace_id = $2 AND ($3::text IS NULL OR created_by = $3) RETURNING id`,
      [req.params.id, req.user.ws, ownOnly(req)]
    );
    if (!rows.length) return reply.status(404).send({ error: 'Not found' });
    return { ok: true };
  });

  // Get push status + log
  app.get('/:id', auth, async (req) => {
    const result = await db.query(
      `SELECT p.*, pr.title as product_name FROM pushes p
       LEFT JOIN products pr ON pr.id = p.product_id
       WHERE p.id = $1 AND p.workspace_id = $2 AND ($3::text IS NULL OR p.created_by = $3)`,
      [req.params.id, req.user.ws, ownOnly(req)]
    );
    if (!result.rows[0]) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    return result.rows[0];
  });

  // Retry failed push
  // Only a failed push of this workspace (a buyer's own) is retried, and only once at a time:
  // retrying a done or running push would create duplicate paid campaigns.
  // The Mac agent keeps what it created for a push (push/<id>/state.json) and on a rerun of the same push adds only
  // what is missing. That is safe only when the agent itself reported the previous attempt; a job still with the
  // agent, or one the server gave up on without an answer, may be creating objects right now — so no retry then.
  app.post('/:id/retry', auth, async (req, reply) => {
    const { rows: [p] } = await db.query(
      `SELECT p.id, p.status, p.fb_campaign_id, p.fb_adset_ids, p.fb_ad_ids, j.status AS job_status, j.result AS job_result
         FROM pushes p LEFT JOIN agent_jobs j ON j.id = p.agent_job_id AND j.workspace_id = p.workspace_id
        WHERE p.id=$1 AND p.workspace_id=$2 AND ($3::text IS NULL OR p.created_by = $3)`,
      [req.params.id, req.user.ws, ownOnly(req)]);
    if (!p || p.status !== 'failed') return reply.status(409).send({ error: 'Повторить можно только упавший залив' });
    const created = {
      campaign_id: p.fb_campaign_id || null,
      adset_ids: Array.isArray(p.fb_adset_ids) ? p.fb_adset_ids : [],
      ad_ids: Array.isArray(p.fb_ad_ids) ? p.fb_ad_ids : [],
    };
    const blocked = (error) => {
      emit('push_retry_blocked', { workspace_id: req.user.ws, owner_user_id: req.user.id, dedupe_key: `retry_blocked:${p.id}:${Date.now()}`, payload: { reason: error } });
      return reply.status(409).send({ error, created });
    };
    if (p.job_status === 'pending' || p.job_status === 'taken') {
      return blocked('Задача этого залива ещё у агента — дождитесь её итога, повтор создал бы второй набор');
    }
    const reaped = p.job_status === 'failed' && (p.job_result?.reaped || /^Агент не выполнил задачу/.test(p.job_result?.error || ''));
    if (reaped) {
      return blocked('Агент не сообщил итог этого залива — в кабинете уже могут быть созданные кампания, адсеты или объявления. Проверьте кабинет; если там пусто, запустите новый залив');
    }
    const { rows } = await db.query(
      `UPDATE pushes SET status='pending', error=NULL, started_at=NULL, finished_at=NULL, updated_at=NOW()
        WHERE id=$1 AND workspace_id=$2 AND status='failed' RETURNING id`,
      [p.id, req.user.ws]);
    if (!rows.length) return reply.status(409).send({ error: 'Повторить можно только упавший залив' });
    await db.query(`UPDATE pushes SET log = log || $1::jsonb WHERE id = $2`,
      [JSON.stringify([{ ts: new Date().toISOString(), step: 'retry', resume: created }]), p.id]);
    runPush(p.id).catch(console.error);
    return { ok: true, resume: created };
  });

  // Compile landing HTML from local template + product data
  app.post('/compile-landing', auth, async (req, reply) => {
    const { template_id, product_id, geo = 'FR' } = req.body;
    if (!template_id || !product_id) return reply.status(400).send({ error: 'template_id and product_id required' });
    await assertProductAccess(req, product_id);
    await assertRecordAccess(req, 'landing_templates', template_id);
    try {
      const { compileLanding } = await import('../../services/landing-compiler.js');
      const { html, product, template } = await compileLanding(template_id, product_id, geo, req.user.ws);
      return { html, title: product.title || product.name, template_name: template.name };
    } catch (e) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // Compile landing + upload to Keitaro
  app.post('/upload-landing-keitaro', auth, async (req, reply) => {
    const { template_id, product_id, geo = 'FR', name } = req.body;
    if (!template_id || !product_id) return reply.status(400).send({ error: 'template_id and product_id required' });
    await assertProductAccess(req, product_id);
    await assertRecordAccess(req, 'landing_templates', template_id);
    try {
      const { compileLanding } = await import('../../services/landing-compiler.js');
      const { html, product, template } = await compileLanding(template_id, product_id, geo, req.user.ws);
      const landingName = name || `${template.name}_${product.title || product.name}_${geo}_${Date.now()}`;
      const wsRow = await db.findOne('workspaces', { id: req.user.ws });
      if (!wsRow?.keitaro_url || !wsRow?.keitaro_api_key)
        return reply.status(400).send({ error: 'Keitaro не настроен' });
      const result = await keitaroClient(wsRow.keitaro_url, wsRow.keitaro_api_key).createLanding(landingName, html);
      return { ok: true, landing: result };
    } catch (e) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // Read the log produced by our own push, with the same scope as status.
  app.get('/:id/trace', auth, async (req, reply) => {
    const push = await db.findOne('pushes', { id: req.params.id, workspace_id: req.user.ws });
    if (!push) return reply.status(404).send({ error: 'Not found' });
    if (req.user.role === 'buyer' && push.created_by !== req.user.id) return reply.status(403).send({ error: 'Access denied' });
    let steps = push.log;
    if (typeof steps === 'string') { try { steps = JSON.parse(steps); } catch { steps = []; } }
    return { steps: Array.isArray(steps) ? steps : [], status: push.status, source: 'own' };
  });

  // Get all options for push wizard
  app.get('/options', auth, async (req) => {
    const { ws } = req.user;
    const wsRow = await db.findOne('workspaces', { id: ws });

    const [
      productsRes,
      cabinetsRes,
      presetsRes,
      creativesRes,
      landings,
      domains,
      localTemplatesRes,
    ] = await Promise.all([
      db.query(
        `SELECT id, title as name, COALESCE(images->0->>'url', images->>0) as cover, photo_reviews_count FROM products WHERE workspace_id=$1 AND ($2::text IS NULL OR created_by=$2) AND scrape_status='done' ORDER BY created_at DESC`,
        [ws, ownUser(req)]
      ),
      db.query(
        // «Куда лить»: ready cabinets first, then the most daily limit left, then the fewest running ads.
        // Figures come from the last campaign read (every 15 min), never from a call to Facebook here.
        `SELECT c.id, c.external_id, c.name, c.pixel_id, c.status, c.ready_kind, c.ready_label, c.payment_missing,
           c.currency, c.daily_limit, c.account_status, c.limits_at, ap.serial_number AS profile,
           st.spent_today, st.active_ads, st.data_at,
           CASE WHEN c.daily_limit IS NULL THEN NULL ELSE GREATEST(c.daily_limit - st.spent_today, 0) END AS limit_left,
           json_agg(DISTINCT jsonb_build_object('id', p.id, 'external_id', p.external_id, 'name', p.name))
             FILTER (WHERE p.id IS NOT NULL) as pages
         FROM fb_cabinets c
         -- Pages of the cabinet's BM and every page of the same FB user: FB lets a user advertise any page they manage.
         LEFT JOIN fb_pages p ON p.workspace_id = c.workspace_id AND (p.bm_id = c.bm_id OR p.fb_account_id = c.fb_account_id)
         LEFT JOIN fb_accounts fa ON fa.id = c.fb_account_id
         LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(fc.spend_today), 0) AS spent_today, MAX(fc.synced_at) AS data_at,
                  COALESCE(SUM((SELECT COUNT(*) FROM jsonb_array_elements(fc.adsets) s,
                                  jsonb_array_elements(COALESCE(s->'ads', '[]'::jsonb)) a
                                 WHERE a->>'effective_status' = 'ACTIVE')), 0)::int AS active_ads
             FROM fb_campaigns fc
            WHERE fc.workspace_id = c.workspace_id AND REPLACE(fc.act_id, 'act_', '') = REPLACE(c.external_id, 'act_', '')
         ) st ON true
         WHERE c.workspace_id = $1 AND c.status = 'active' AND ($2::text IS NULL OR LOWER(ap.group_name) = $2)
         GROUP BY c.id, ap.serial_number, st.spent_today, st.active_ads, st.data_at
         ORDER BY (c.ready_kind = 'ready' AND COALESCE(c.account_status, 1) = 1) DESC,
                  (c.daily_limit IS NULL OR c.daily_limit > st.spent_today) DESC,
                  st.active_ads ASC,
                  CASE WHEN c.daily_limit IS NULL THEN NULL ELSE c.daily_limit - st.spent_today END DESC NULLS LAST,
                  c.name`,
        [ws, req.user.role === 'buyer' ? String(req.user.email || '').toLowerCase() : null]
      ),
      db.query(`SELECT * FROM ad_settings WHERE workspace_id=$1 AND ($2::text IS NULL OR created_by=$2) ORDER BY name`, [ws, ownUser(req)]),
      db.query(
        `SELECT id, product_id, file_url as url, thumbnail_url, metadata->>'language' as language, type, status FROM creatives WHERE workspace_id=$1 AND ($2::text IS NULL OR created_by=$2) AND status='done' AND file_url IS NOT NULL ORDER BY created_at DESC`,
        [ws, ownUser(req)]
      ),
      wsRow?.keitaro_url && wsRow?.keitaro_api_key
        ? keitaroClient(wsRow.keitaro_url, wsRow.keitaro_api_key).landingPages().catch(() => [])
        : Promise.resolve([]),
      wsRow?.keitaro_url && wsRow?.keitaro_api_key
        ? keitaroClient(wsRow.keitaro_url, wsRow.keitaro_api_key).domains().catch(() => [])
        : Promise.resolve([]),
      // Only templates that can be compiled: FA-synced rows without HTML would upload a blank page.
      db.query(`SELECT id, name, store, state, geos, versions, type FROM landing_templates
                 WHERE workspace_id=$1 AND ($2::text IS NULL OR created_by=$2) AND state='ready' AND COALESCE(type, '') <> 'white'
                   AND (COALESCE(html, '') <> '' OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(versions, '[]'::jsonb)) v WHERE COALESCE(v->>'html', '') <> ''))
                 ORDER BY name`, [ws, ownUser(req)]),
    ]);

    // Merge local templates + Keitaro landings (local templates first, marked with source)
    const localTemplates = localTemplatesRes.rows.map(t => ({
      ...t,
      source: 'local',
      versions: typeof t.versions === 'string' ? JSON.parse(t.versions || '[]') : (t.versions || []),
      geos: typeof t.geos === 'string' ? JSON.parse(t.geos || '[]') : (t.geos || []),
    }));

    const allLandings = [
      ...localTemplates,
      ...(Array.isArray(landings) ? landings : []).map(l => ({ ...l, source: 'keitaro' })),
    ];

    return {
      products: productsRes.rows,
      cabinets: cabinetsRes.rows,
      presets: presetsRes.rows,
      creatives: creativesRes.rows,
      landings: allLandings,
      domains,
    };
  });

  // Generate FB ad texts via Claude
  app.post('/generate-texts', auth, async (req) => {
    const { product_id, geo, language } = req.body;
    const { ws } = req.user;

    const product = await db.findOne('products', { id: product_id, workspace_id: ws });
    if (!product) throw Object.assign(new Error('Product not found'), { statusCode: 404 });
    await assertProductAccess(req, product_id);

    // No generator configured: say so instead of handing out canned claims (discounts, «official», guarantees).
    if (!process.env.ANTHROPIC_API_KEY) {
      throw Object.assign(new Error('Генерация текстов не настроена — впишите заголовок и текст вручную'), { statusCode: 503 });
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const safeTitle = String(product.title || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 300);
    const safeDesc = String(product.description || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 1000);
    const prompt = `Ты копирайтер для Facebook рекламы. Напиши 3 варианта рекламного текста для товара.

<product_data>
Товар: ${safeTitle}
Описание: ${safeDesc}
Цена: ${product.source_price || ''}
</product_data>
Страна: ${geo}
Язык объявления: ${language}

Пиши только то, что следует из названия и описания. Не выдумывай скидки, акции, сроки, остатки, гарантии, «официальность» и отзывы.

Для каждого варианта дай:
- title: заголовок (до 40 символов)
- body: основной текст (до 125 символов)

Ответ строго в JSON: {"variants": [{"title":"...","body":"..."},{"title":"...","body":"..."},{"title":"...","body":"..."}]}
Только JSON, без пояснений.`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0]?.text || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { variants: [] };
    return { variants: parsed.variants || [] };
  });
}
