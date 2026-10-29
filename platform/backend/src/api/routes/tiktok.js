import { db } from '../../db/client.js';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminOnly } from '../../middleware/access.js';
import { tiktokClient, getOAuthUrl, exchangeCode, refreshAccessToken, TIKTOK_LOCATIONS } from '../../services/tiktok.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function tiktokRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // List accounts (never expose access_token)
  app.get('/accounts', auth, async (req) => {
    const { rows } = await db.query(
      `SELECT id, advertiser_id, name, currency, timezone, status, pixel_id,
              created_at, updated_at, true AS has_token
       FROM tiktok_accounts WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [req.user.ws]
    );
    return rows;
  });

  // Add account manually
  app.post('/accounts', adminOnly(app), async (req, reply) => {
    const { advertiser_id, access_token, refresh_token, name, pixel_id } = req.body || {};
    if (!advertiser_id || !access_token) return reply.status(400).send({ error: 'advertiser_id and access_token required' });
    const client = tiktokClient(access_token);
    let info = {};
    try { info = (await client.getAdvertiserInfo(advertiser_id))?.advertiser_info?.[0] || {}; } catch { /* use body name */ }
    return db.insert('tiktok_accounts', {
      id: `tt_${nanoid(20)}`,
      workspace_id: req.user.ws,
      advertiser_id: String(advertiser_id),
      access_token,
      refresh_token: refresh_token || null,
      name: name || info.advertiser_name || advertiser_id,
      currency: info.currency || 'EUR',
      timezone: info.timezone || null,
      pixel_id: pixel_id || null,
      created_by: req.user.id,
    });
  });

  // Delete account
  app.delete('/accounts/:id', adminOnly(app), async (req, reply) => {
    const { rowCount } = await db.query(
      'DELETE FROM tiktok_accounts WHERE id = $1 AND workspace_id = $2',
      [req.params.id, req.user.ws]
    );
    if (!rowCount) return reply.status(404).send({ error: 'Not found' });
    return { ok: true };
  });

  // Update account
  app.patch('/accounts/:id', adminOnly(app), async (req, reply) => {
    const { name, pixel_id, status, access_token } = req.body || {};
    const sets = []; const vals = [];
    if (name !== undefined) { vals.push(name); sets.push(`name=$${vals.length}`); }
    if (pixel_id !== undefined) { vals.push(pixel_id); sets.push(`pixel_id=$${vals.length}`); }
    if (status !== undefined) { vals.push(status); sets.push(`status=$${vals.length}`); }
    if (access_token !== undefined) { vals.push(access_token); sets.push(`access_token=$${vals.length}`); }
    if (!sets.length) return reply.status(400).send({ error: 'Nothing to update' });
    vals.push(req.params.id, req.user.ws);
    const { rows } = await db.query(
      `UPDATE tiktok_accounts SET ${sets.join(', ')}, updated_at=NOW()
       WHERE id=$${vals.length - 1} AND workspace_id=$${vals.length} RETURNING id, name, status`,
      vals
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Not found' });
    return rows[0];
  });

  // OAuth URL
  app.get('/oauth/url', adminOnly(app), async (req, reply) => {
    const appId = process.env.TIKTOK_APP_ID;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI || `${process.env.PUBLIC_URL || 'https://srv2100328.hstgr.cloud'}/api/tiktok/oauth/callback`;
    if (!appId) return reply.status(503).send({ error: 'TIKTOK_APP_ID not configured' });
    return { url: getOAuthUrl(appId, redirectUri, req.user.ws) };
  });

  // OAuth callback
  app.get('/oauth/callback', async (req, reply) => {
    const { code, state: ws } = req.query;
    if (!code || !ws) return reply.redirect('/?error=tiktok_oauth_missing');
    const appId = process.env.TIKTOK_APP_ID;
    const appSecret = process.env.TIKTOK_APP_SECRET;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI || `${process.env.PUBLIC_URL || 'https://srv2100328.hstgr.cloud'}/api/tiktok/oauth/callback`;
    try {
      const tokens = await exchangeCode(appId, appSecret, code, redirectUri);
      const { access_token, refresh_token, access_token_expires_in = 86400, advertiser_ids = [] } = tokens;
      const tokenExpiresAt = new Date(Date.now() + access_token_expires_in * 1000);
      const client = tiktokClient(access_token);
      let created = 0;
      for (const advertiserId of advertiser_ids) {
        let info = {};
        try { info = (await client.getAdvertiserInfo(advertiserId))?.advertiser_info?.[0] || {}; } catch { /* */ }
        const existing = await db.findOne('tiktok_accounts', { advertiser_id: String(advertiserId), workspace_id: ws });
        if (existing) {
          await db.update('tiktok_accounts', existing.id, { access_token, refresh_token: refresh_token || null, token_expires_at: tokenExpiresAt, updated_at: new Date() });
        } else {
          await db.insert('tiktok_accounts', {
            id: `tt_${nanoid(20)}`,
            workspace_id: ws,
            advertiser_id: String(advertiserId),
            access_token,
            refresh_token: refresh_token || null,
            token_expires_at: tokenExpiresAt,
            name: info.advertiser_name || advertiserId,
            currency: info.currency || 'EUR',
            timezone: info.timezone || null,
          });
          created++;
        }
      }
      const frontendBase = process.env.FRONTEND_URL || 'https://srv2100328.hstgr.cloud';
      return reply.redirect(`${frontendBase}/tiktok?connected=${created}`);
    } catch (e) {
      req.log.error(e, 'TikTok OAuth failed');
      return reply.redirect('/?error=tiktok_oauth_failed');
    }
  });


  // Refresh expiring TikTok tokens for this workspace
  app.post('/accounts/refresh-tokens', adminOnly(app), async (req, reply) => {
    const appId = process.env.TIKTOK_APP_ID;
    const appSecret = process.env.TIKTOK_APP_SECRET;
    if (!appId || !appSecret) return reply.status(503).send({ error: 'TIKTOK_APP_ID/SECRET not configured' });

    const { rows: accounts } = await db.query(
      `SELECT id, advertiser_id, refresh_token FROM tiktok_accounts
       WHERE workspace_id = $1 AND status = 'active' AND refresh_token IS NOT NULL
         AND (token_expires_at IS NULL OR token_expires_at < NOW() + INTERVAL '2 days')`,
      [req.user.ws]
    );

    const results = [];
    for (const acc of accounts) {
      try {
        const tokens = await refreshAccessToken(appId, appSecret, acc.refresh_token);
        const { access_token, refresh_token, access_token_expires_in = 86400 } = tokens;
        const token_expires_at = new Date(Date.now() + access_token_expires_in * 1000);
        await db.update('tiktok_accounts', acc.id, {
          access_token,
          refresh_token: refresh_token || acc.refresh_token,
          token_expires_at,
          updated_at: new Date(),
        });
        results.push({ advertiser_id: acc.advertiser_id, ok: true });
      } catch (e) {
        results.push({ advertiser_id: acc.advertiser_id, ok: false, error: e.message });
      }
    }
    return { refreshed: results.filter(r => r.ok).length, total: accounts.length, results };
  });

  // Get pixels for an account
  app.get('/pixels/:accountId', auth, async (req, reply) => {
    const acc = await db.findOne('tiktok_accounts', { id: req.params.accountId, workspace_id: req.user.ws });
    if (!acc) return reply.status(404).send({ error: 'Account not found' });
    const client = tiktokClient(acc.access_token);
    try {
      const data = await client.getPixels(acc.advertiser_id);
      return data?.pixels || [];
    } catch (e) {
      return reply.status(502).send({ error: e.message });
    }
  });

  // Toggle campaign status: ENABLE or DISABLE
  app.patch('/campaigns/:campaign_id/status', auth, async (req, reply) => {
    const { campaign_id } = req.params;
    const { advertiser_id, status = 'ENABLE' } = req.body || {};
    if (!advertiser_id) return reply.status(400).send({ error: 'advertiser_id required' });
    if (!['ENABLE', 'DISABLE'].includes(status)) return reply.status(400).send({ error: 'status must be ENABLE or DISABLE' });
    const acc = await db.findOne('tiktok_accounts', { advertiser_id: String(advertiser_id), workspace_id: req.user.ws });
    if (!acc) return reply.status(404).send({ error: 'TikTok account not found' });
    const client = tiktokClient(acc.access_token);
    try {
      await client.setCampaignStatus(acc.advertiser_id, campaign_id, status);
      return { ok: true, campaign_id, status };
    } catch (e) {
      return reply.status(502).send({ error: e.message });
    }
  });

  // Generate video slideshow from product images
  app.post('/generate-video', auth, async (req, reply) => {
    const { product_id } = req.body || {};
    if (!product_id) return reply.status(400).send({ error: 'product_id required' });

    const product = await db.findOne('products', { id: product_id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Product not found' });

    const images = Array.isArray(product.images) ? product.images : [];
    if (!images.length) return { error: 'No images on product', fallback: true };

    const { generateTikTokVideo } = await import('../../services/tiktok-video.js');
    const uploadsBase = process.env.UPLOADS_DIR || path.join(__dirname, '../../../../uploads');
    const videoDir = path.join(uploadsBase, 'tiktok-videos');

    const result = await generateTikTokVideo(images, product.title, videoDir);
    if (!result) return { error: 'ffmpeg not available or generation failed', fallback: true };
    return { video_url: result.url };
  });

  // Full TikTok push
  app.post('/push', auth, async (req, reply) => {
    const {
      product_id, tiktok_account_id,
      video_url, ad_text, landing_page_url,
      countries = ['FR'],
      daily_budget, age_min = 18, age_max = 55,
      optimization_event = 'CompletePayment',
      campaign_name,
    } = req.body || {};

    if (!product_id) return reply.status(400).send({ error: 'product_id required' });
    if (!tiktok_account_id) return reply.status(400).send({ error: 'tiktok_account_id required' });
    if (!video_url) return reply.status(400).send({ error: 'video_url required' });
    if (!ad_text) return reply.status(400).send({ error: 'ad_text required' });
    if (!landing_page_url) return reply.status(400).send({ error: 'landing_page_url required' });
    if (!(Number(daily_budget) > 0)) return reply.status(400).send({ error: 'daily_budget must be > 0' });

    const product = await db.findOne('products', { id: product_id, workspace_id: req.user.ws });
    if (!product) return reply.status(404).send({ error: 'Product not found' });

    const acc = await db.findOne('tiktok_accounts', { id: tiktok_account_id, workspace_id: req.user.ws });
    if (!acc) return reply.status(404).send({ error: 'TikTok account not found' });

    const client = tiktokClient(acc.access_token);
    const cName = campaign_name || `[TT] ${(product.title || '').slice(0, 50)} [${countries.join('+')}]`;
    const location_ids = (Array.isArray(countries) ? countries : [countries])
      .map(c => TIKTOK_LOCATIONS[String(c).toUpperCase()])
      .filter(Boolean);

    try {
      // 1. Upload video
      const videoData = await client.uploadVideoUrl(acc.advertiser_id, video_url);
      const video_id = videoData.video_id;

      // 2. Create campaign
      const campaign = await client.createCampaign(acc.advertiser_id, {
        name: cName,
        objective: 'CONVERSIONS',
        budget: Number(daily_budget),
      });
      const campaign_id = campaign.campaign_id;

      // 3. Create ad group
      const adgroup = await client.createAdGroup(acc.advertiser_id, {
        campaign_id,
        name: `${cName} — AG`,
        location_ids,
        budget: Number(daily_budget),
        pixel_id: acc.pixel_id,
        optimization_event,
        age_min: Number(age_min),
        age_max: Number(age_max),
      });
      const adgroup_id = adgroup.adgroup_id;

      // 4. Create ad
      const ad = await client.createAd(acc.advertiser_id, {
        adgroup_id,
        video_id,
        ad_text,
        ad_name: cName,
        call_to_action: 'SHOP_NOW',
        landing_page_url,
      });
      const ad_id = ad.ad_ids?.[0] || ad.ad_id;

      // 5. Store push record
      const push = await db.insert('pushes', {
        workspace_id: req.user.ws,
        product_id,
        params: {
          tiktok: true,
          tiktok_account_id,
          advertiser_id: acc.advertiser_id,
          campaign_id,
          adgroup_id,
          ad_id,
          video_id,
          countries,
          daily_budget: Number(daily_budget),
          landing_page_url,
          ad_text,
        },
        status: 'done',
        created_by: req.user.id,
        log: JSON.stringify([
          { step: 'video_uploaded', video_id },
          { step: 'campaign_created', campaign_id },
          { step: 'adgroup_created', adgroup_id },
          { step: 'ad_created', ad_id },
        ]),
      });

      return {
        ok: true,
        push_id: push.id,
        campaign_id,
        adgroup_id,
        ad_id,
        video_id,
        status: 'created_paused',
        note: 'Кампания создана и остановлена. Запустите вручную в TikTok Ads Manager.',
      };
    } catch (e) {
      return reply.status(500).send({ error: e.message });
    }
  });
}
