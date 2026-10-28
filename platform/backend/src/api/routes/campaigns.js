import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import { assertCampaignAccess } from '../../middleware/access.js';
import { keitaroClient } from '../../services/keitaro.js';
import { enqueueAgentJob } from './agent.js';
import { logFbEvent } from '../../services/fb-campaigns.js';
import { faAvailable, faCampaignHistory, faGetCampaignAds, faSetBudget, faDuplicate, faRename, faSetTargeting, faBulkEdit, faApplyAdSettings } from '../../services/fa-client.js';

export async function campaignRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  // ── Own campaign list: Facebook via the Mac agent, joined to Keitaro by sub_id_2 ──

  // Facebook ad account statuses that stop delivery.
  const ACCOUNT_STATUS = { 2: 'кабинет отключён', 3: 'долг по оплате в кабинете', 7: 'кабинет на проверке рисков', 8: 'кабинет ждёт расчёта', 9: 'кабинет в льготном периоде', 100: 'кабинет ждёт закрытия', 101: 'кабинет закрыт' };

  // Why a campaign belongs on the «Внимание» tab, in words; [] when all is fine.
  function attentionReasons(c, spend, revenue) {
    const out = [];
    if (c.account_status != null && ACCOUNT_STATUS[c.account_status]) out.push(ACCOUNT_STATUS[c.account_status]);
    const m = c.moderation;
    if (m?.rejected) out.push(`отклонено объявлений: ${m.rejected} из ${m.total}`);
    if (m?.issues) out.push(`объявлений с проблемой: ${m.issues} из ${m.total}`);
    if (c.effective_status === 'WITH_ISSUES') out.push('у кампании проблема в Facebook');
    if (c.effective_status === 'ACTIVE' && spend > 0 && revenue === 0) out.push('есть расход, нет дохода');
    else if (c.effective_status === 'ACTIVE' && spend > 0 && (revenue - spend) / spend < -0.3) out.push('ROI ниже −30 %');
    return out;
  }

  // Buyers see campaigns of their own AdsPower group (named after their email).
  const fbScope = (user) => user.role === 'buyer' ? String(user.email || '').toLowerCase() : null;
  const SPEND_COL = { today: 'spend_today', yesterday: 'spend_yesterday', last_3_days: 'spend_3d', last_7_days: 'spend_7d', last_30_days: 'spend_30d' };

  app.get('/fb', auth, async (req) => {
    const period = SPEND_COL[req.query.period] ? req.query.period : 'today';
    const { rows } = await db.query(`
      SELECT c.*, fa.name AS account_name, ap.serial_number, ap.group_name
        FROM fb_campaigns c
        JOIN fb_accounts fa ON fa.id = c.fb_account_id
        LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
       WHERE c.workspace_id = $1 AND ($2::text IS NULL OR LOWER(ap.group_name) = $2)
       ORDER BY c.created_time DESC NULLS LAST`, [req.user.ws, fbScope(req.user)]);

    // Keitaro: leads and LP clicks by FB campaign id; junk sub_id_2 (empty, raw macro) is dropped.
    const kt = new Map();
    let keitaroError = null;
    const ws = await db.findOne('workspaces', { id: req.user.ws });
    if (ws?.keitaro_url && ws?.keitaro_api_key && rows.length) {
      try {
        const data = await keitaroClient(ws.keitaro_url, ws.keitaro_api_key)
          .stats(period, ['sub_id_2'], ['clicks', 'lp_clicks', 'conversions', 'leads', 'sales', 'revenue']);
        for (const r of data?.rows || []) if (/^\d+$/.test(String(r.sub_id_2))) kt.set(String(r.sub_id_2), r);
      } catch (e) { keitaroError = e.message; }
    }

    const list = rows.map(c => {
      const k = kt.get(c.id) || {};
      // NULL = this period not read yet (agent before 3/30-day spend): unknown, not zero.
      const raw = c[SPEND_COL[period]];
      const known = raw !== null && raw !== undefined;
      const spend = known ? Number(raw) || 0 : null;
      const revenue = Number(k.revenue) || 0;
      const lp = Number(k.lp_clicks) || 0;
      return {
        id: c.id, name: c.name, status: c.status, effective_status: c.effective_status,
        act_id: c.act_id, act_name: c.act_name, currency: c.currency,
        account: c.account_name, profile: c.serial_number, buyer: c.group_name,
        daily_budget: c.daily_budget != null ? Number(c.daily_budget) / 100 : null,
        adsets: (c.adsets || []).map(a => ({ ...a,
          daily_budget: a.daily_budget != null ? Number(a.daily_budget) / 100 : null,
          bid_amount: a.bid_amount != null ? Number(a.bid_amount) / 100 : null })),
        spend, lp_clicks: lp, leads: Number(k.leads) || 0, sales: Number(k.sales) || 0, revenue,
        lp_cost: known && lp ? spend / lp : null,
        profit: known ? revenue - spend : null, roi: known && spend ? (revenue - spend) / spend * 100 : null,
        created_time: c.created_time, synced_at: c.synced_at,
        moderation: c.moderation, account_status: c.account_status,
        spend_cap: c.spend_cap != null ? Number(c.spend_cap) / 100 : null,
        archived: !!c.archived_at, archived_at: c.archived_at,
        attention: c.archived_at ? [] : attentionReasons(c, spend || 0, revenue),
      };
    });
    return { period, campaigns: list, keitaro_error: keitaroError };
  });

  // Campaign card: numbers by period (FB spend + Keitaro), composition, the push behind it and its landing.
  app.get('/fb/:id/summary', auth, async (req) => {
    await fbCampaign(req, req.params.id);
    const { rows: [c] } = await db.query(`
      SELECT c.*, fa.name AS account_name, ap.serial_number, ap.group_name
        FROM fb_campaigns c JOIN fb_accounts fa ON fa.id = c.fb_account_id
        LEFT JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
       WHERE c.id = $1 AND c.workspace_id = $2`, [String(req.params.id), req.user.ws]);

    const ws = await db.findOne('workspaces', { id: req.user.ws });
    const periods = [];
    let keitaroError = null;
    const PERIOD_ROWS = [['today', 'spend_today', 'Сегодня'], ['yesterday', 'spend_yesterday', 'Вчера'], ['last_3_days', 'spend_3d', '3 дня'],
      ['last_7_days', 'spend_7d', '7 дней'], ['last_30_days', 'spend_30d', '30 дней']];
    for (const [period, col, label] of PERIOD_ROWS) {
      if (c[col] === null || c[col] === undefined) continue; // not read yet by the agent
      let k = {};
      if (ws?.keitaro_url && ws?.keitaro_api_key) {
        try {
          const data = await keitaroClient(ws.keitaro_url, ws.keitaro_api_key)
            .stats(period, ['sub_id_2'], ['clicks', 'lp_clicks', 'conversions', 'sales', 'revenue']);
          k = (data?.rows || []).find(r => String(r.sub_id_2) === c.id) || {};
        } catch (e) { keitaroError = e.message; }
      }
      const spend = Number(c[col]) || 0, revenue = Number(k.revenue) || 0, clicks = Number(k.clicks) || 0;
      periods.push({ period, label, spend, clicks, lp_clicks: Number(k.lp_clicks) || 0, sales: Number(k.sales) || 0, revenue,
        profit: revenue - spend, roi: spend ? (revenue - spend) / spend * 100 : null, cpc: clicks ? spend / clicks : null });
    }

    const adsets = c.adsets || [];
    const ads = adsets.flatMap(a => a.ads || []);
    const composition = {
      adsets: adsets.length,
      adsets_active: adsets.filter(a => a.effective_status === 'ACTIVE').length,
      ads: ads.length,
      ads_active: ads.filter(a => a.effective_status === 'ACTIVE').length,
      moderation: c.moderation || null,
    };

    const { rows: [push] } = await db.query(`
      SELECT p.id, p.status, p.created_at, p.params, p.kt_campaign_id, pr.id AS product_id, pr.title AS product_title,
             pr.source_url, lt.name AS template_name, u.name AS author
        FROM pushes p LEFT JOIN products pr ON pr.id = p.product_id
        LEFT JOIN landing_templates lt ON lt.id = p.params->>'landing_id'
        LEFT JOIN users u ON u.id = p.created_by
       WHERE p.workspace_id = $1 AND p.fb_campaign_id = $2 ORDER BY p.created_at DESC LIMIT 1`, [req.user.ws, c.id]);

    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const { landingFunnel } = await import('../../services/lp-analytics.js');
    const funnel = await landingFunnel(req.user, { from, to, group: 'template', campaigns: [c.id] }).catch(() => null);

    return {
      id: c.id, name: c.name, status: c.status, effective_status: c.effective_status,
      act_id: c.act_id, act_name: c.act_name, currency: c.currency, account: c.account_name,
      profile: c.serial_number, buyer: c.group_name, created_time: c.created_time, synced_at: c.synced_at,
      daily_budget: c.daily_budget != null ? Number(c.daily_budget) / 100 : null,
      spend_cap: c.spend_cap != null ? Number(c.spend_cap) / 100 : null,
      attention: c.archived_at ? [] : attentionReasons(c, Number(c.spend_today) || 0, periods[0]?.revenue || 0),
      archived: !!c.archived_at,
      periods, composition, keitaro_error: keitaroError,
      push: push ? {
        id: push.id, status: push.status, created_at: push.created_at, author: push.author,
        product_id: push.product_id, product_title: push.product_title, source_url: push.source_url,
        template: push.template_name, geo: (push.params?.countries || []).join(', '),
        kt_campaign_id: push.kt_campaign_id, offer_ids: push.params?.offer_ids || [],
        bid: push.params?.bid_amounts?.length ? push.params.bid_amounts.join(' / ') : push.params?.bid_amount,
        daily_budget: push.params?.daily_budget,
      } : null,
      landing: funnel ? { period: { from, to }, totals: funnel.totals, rows: funnel.rows } : null,
    };
  });

  // Fresh read from Facebook: one agent job per profile in scope that has cabinets.
  app.post('/fb/refresh', auth, async (req) => {
    const { rows } = await db.query(`
      SELECT DISTINCT ap.raw->>'user_id' AS user_id
        FROM fb_accounts fa JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
       WHERE fa.workspace_id = $1 AND fa.cabinets_count > 0 AND ($2::text IS NULL OR LOWER(ap.group_name) = $2)`,
      [req.user.ws, fbScope(req.user)]);
    const jobs = [];
    for (const r of rows) if (r.user_id) jobs.push(await enqueueAgentJob(req.user.ws, 'fb_campaigns', { user_id: r.user_id }, req.user.id));
    return { ok: true, job_ids: jobs };
  });

  // «Обновить» one campaign: re-read only its ad account (reading, nothing is written to FB).
  app.post('/fb/:id/refresh', auth, async (req) => {
    const c = await fbCampaign(req, req.params.id);
    const { rows: [busy] } = await db.query(
      `SELECT id FROM agent_jobs WHERE workspace_id = $1 AND type = 'fb_campaigns' AND status IN ('pending', 'taken')
         AND payload->>'user_id' = $2 AND COALESCE(payload->>'act', '') IN ('', $3) LIMIT 1`,
      [req.user.ws, c.user_id, String(c.act_id || '')]);
    if (busy) return { ok: true, job_id: busy.id, already: true };
    const jobId = await enqueueAgentJob(req.user.ws, 'fb_campaigns', { user_id: c.user_id, act: c.act_id }, req.user.id);
    return { ok: true, job_id: jobId };
  });

  // «В архив»: a platform mark, nothing changes in Facebook. Live campaigns only with off_first
  // («Выключить и в архив»): the switch-off goes to the agent like any edit.
  app.post('/fb/archive', auth, async (req) => {
    const { ids, off_first, restore } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) bad('Нужно от 1 до 200 кампаний');
    const camps = [];
    for (const id of [...new Set(ids.map(String))]) camps.push(await fbCampaign(req, id));
    if (restore) {
      await db.query(`UPDATE fb_campaigns SET archived_at = NULL, archived_by = NULL WHERE workspace_id = $1 AND id = ANY($2)`,
        [req.user.ws, camps.map(c => c.id)]);
      for (const c of camps) await logFbEvent(req.user.ws, c.id, req.user.id, 'возвращена из архива платформы');
      return { ok: true, restored: camps.length };
    }
    const live = camps.filter(c => c.status === 'ACTIVE');
    if (live.length && !off_first) bad(`Включены: ${live.map(c => c.name).join(', ')} — выберите «Выключить и в архив»`);
    const byProfile = new Map();
    for (const c of live) {
      if (!byProfile.has(c.user_id)) byProfile.set(c.user_id, []);
      byProfile.get(c.user_id).push(c);
    }
    const jobs = [];
    for (const [userId, list] of byProfile) {
      const jobId = await enqueueAgentJob(req.user.ws, 'fb_edit', { user_id: userId, ops: list.map(c => ({ id: c.id, status: 'PAUSED' })) }, req.user.id);
      for (const c of list) await logFbEvent(req.user.ws, c.id, req.user.id, 'выключить перед архивом', jobId);
      jobs.push(jobId);
    }
    await db.query(`UPDATE fb_campaigns SET archived_at = NOW(), archived_by = $3 WHERE workspace_id = $1 AND id = ANY($2)`,
      [req.user.ws, camps.map(c => c.id), req.user.id]);
    for (const c of camps) await logFbEvent(req.user.ws, c.id, req.user.id, 'в архив платформы (в Facebook кампания не архивируется)');
    return { ok: true, archived: camps.length, job_ids: jobs };
  });

  // A campaign of our FB list in the caller's scope, with the profile that owns it.
  async function fbCampaign(req, id) {
    const { rows: [c] } = await db.query(`
      SELECT c.id, c.name, c.adsets, c.currency, c.status, c.act_id, ap.raw->>'user_id' AS user_id, ap.group_name
        FROM fb_campaigns c JOIN fb_accounts fa ON fa.id = c.fb_account_id
        JOIN ap_profiles ap ON ap.id = fa.ap_profile_id
       WHERE c.id = $1 AND c.workspace_id = $2`, [String(id), req.user.ws]);
    if (!c) throw Object.assign(new Error('Кампания не найдена'), { statusCode: 404 });
    const scope = fbScope(req.user);
    if (scope && String(c.group_name || '').toLowerCase() !== scope) throw Object.assign(new Error('Access denied'), { statusCode: 403 });
    return c;
  }
  const bad = (msg) => { throw Object.assign(new Error(msg), { statusCode: 400 }); };
  const findAdset = (c, id) => (c.adsets || []).find(a => String(a.id) === String(id));
  const findAd = (c, id) => (c.adsets || []).flatMap(a => a.ads || []).find(a => String(a.id) === String(id));
  const toCents = (v) => (v == null || v === '' ? null : Math.round(Number(v) * 100));
  const GENDERS = { all: 'все', male: 'мужчины', female: 'женщины' };

  // One agent job per edit; the campaign history gets a line that the result closes later.
  async function queueEdit(req, c, ops, text) {
    const jobId = await enqueueAgentJob(req.user.ws, 'fb_edit', { user_id: c.user_id, ops }, req.user.id);
    await logFbEvent(req.user.ws, c.id, req.user.id, text, jobId);
    return { ok: true, queued: true, job_id: jobId };
  }

  // Edit the campaign, one adset or one ad through the profile. Activation needs explicit confirm.
  app.post('/fb/:id/edit', auth, async (req) => {
    const { adset_id, ad_id, status, daily_budget, bid_amount, name, targeting, spend_cap, spend_cap_clear, confirm } = req.body || {};
    const c = await fbCampaign(req, req.params.id);
    const target = ad_id ? findAd(c, ad_id) : adset_id ? findAdset(c, adset_id) : c;
    if (!target) bad(ad_id ? 'Объявление не найдено' : 'Адсет не найден');
    const level = ad_id ? 'объявление' : adset_id ? 'адсет' : 'кампания';
    if (status && !['ACTIVE', 'PAUSED'].includes(status)) bad('status: ACTIVE или PAUSED');
    if (status === 'ACTIVE' && confirm !== true) bad('Включение требует подтверждения');
    if (ad_id && (daily_budget != null || bid_amount != null || targeting)) bad('У объявления меняются только статус и имя');
    if (bid_amount != null && !adset_id) bad('Ставка задаётся на адсете');
    if (targeting && !adset_id) bad('Таргетинг меняется у адсета');
    // Budgets on the adsets (no CBO): FB would reject a campaign budget — say it here, not in the history.
    if (daily_budget != null && !adset_id && !ad_id && (c.adsets || []).some(a => a.daily_budget != null))
      bad('У этой кампании бюджет на адсетах — меняйте бюджет у адсета');
    if ((spend_cap != null || spend_cap_clear) && (adset_id || ad_id)) bad('Лимит трат — у кампании');

    const op = { id: String(target.id) };
    const said = [];
    if (status) { op.status = status; said.push(status === 'ACTIVE' ? 'включить' : 'выключить'); }
    if (toCents(daily_budget)) { op.daily_budget = toCents(daily_budget); said.push(`бюджет в день → ${Number(daily_budget)} ${c.currency || ''}`); }
    if (toCents(bid_amount)) { op.bid_amount = toCents(bid_amount); said.push(`ставка → ${Number(bid_amount)} ${c.currency || ''}`); }
    if (name) { op.name = String(name).slice(0, 400); said.push(`имя → «${op.name}»`); }
    if (spend_cap_clear) { op.spend_cap = 'clear'; said.push('снять лимит трат'); }
    else if (toCents(spend_cap)) { op.spend_cap = toCents(spend_cap); said.push(`лимит трат → ${Number(spend_cap)} ${c.currency || ''}`); }
    if (targeting) {
      const t = {};
      const amin = targeting.age_min != null ? Number(targeting.age_min) : null;
      const amax = targeting.age_max != null ? Number(targeting.age_max) : null;
      if (amin != null && !(amin >= 13 && amin <= 65)) bad('Возраст от: 13–65');
      if (amax != null && !(amax >= 13 && amax <= 65)) bad('Возраст до: 13–65');
      if (amin != null && amax != null && amin > amax) bad('Возраст «от» больше «до»');
      if (amin != null) t.age_min = amin;
      if (amax != null) t.age_max = amax;
      if (targeting.genders) { if (!GENDERS[targeting.genders]) bad('Пол: all, male или female'); t.genders = targeting.genders; }
      if (targeting.countries != null) {
        const list = (Array.isArray(targeting.countries) ? targeting.countries : String(targeting.countries).split(','))
          .map(x => String(x).trim().toUpperCase()).filter(Boolean);
        if (!list.length || list.some(x => !/^[A-Z]{2}$/.test(x))) bad('Страны — коды из двух букв: FR, ES');
        t.countries = list;
      }
      if (!Object.keys(t).length) bad('Нечего менять в таргетинге');
      op.targeting = t;
      said.push(`таргетинг → ${[t.age_min != null || t.age_max != null ? `${t.age_min ?? '…'}–${t.age_max ?? '…'}` : null, t.genders && GENDERS[t.genders], t.countries?.join(',')].filter(Boolean).join(' · ')} (адсет уйдёт на проверку и в обучение)`);
    }
    if (Object.keys(op).length === 1) bad('Нечего менять');
    return queueEdit(req, c, [op], `${level} «${target.name || target.id}»: ${said.join(', ')}`);
  });

  // Copy an adset (with its ads) or an ad; copies are always PAUSED. A campaign is copied by a new push.
  app.post('/fb/:id/duplicate', auth, async (req) => {
    const { level, row_id, copies } = req.body || {};
    const c = await fbCampaign(req, req.params.id);
    if (!['adset', 'ad'].includes(level)) bad('Дублируются адсет или объявление; кампанию копирует новый залив');
    const row = level === 'ad' ? findAd(c, row_id) : findAdset(c, row_id);
    if (!row) bad(level === 'ad' ? 'Объявление не найдено' : 'Адсет не найден');
    const n = Math.min(Math.max(Number(copies) || 1, 1), 10);
    return queueEdit(req, c, [{ id: String(row.id), copy: { level, copies: n } }],
      `дубль ${level === 'ad' ? 'объявления' : 'адсета'} «${row.name || row.id}» × ${n}, на паузе`);
  });

  // Ad preset onto a live adset: what a live adset can change — age, gender, budget, bid.
  // Devices, placements, objective, pixel event, button and layout need a new push.
  app.post('/fb/:id/apply-preset', auth, async (req) => {
    const { adset_id, preset_id } = req.body || {};
    const c = await fbCampaign(req, req.params.id);
    const adset = findAdset(c, adset_id);
    if (!adset) bad('Пресет применяется к адсету — выбери адсет');
    const p = await db.findOne('ad_settings', { id: String(preset_id || ''), workspace_id: req.user.ws });
    if (!p) bad('Пресет не найден');
    // Per-adset bids follow the creation order «#n» in the adset name; never borrow another adset's bid.
    let bid = p.bid_amount;
    if (Array.isArray(p.bid_amounts) && p.bid_amounts.length) {
      const n = Number(String(adset.name || '').match(/#(\d+)\s*$/)?.[1]);
      if (!(n >= 1 && n <= p.bid_amounts.length)) bad(`У пресета ставки для ${p.bid_amounts.length} адсетов, а номер этого адсета не определить — задайте ставку вручную`);
      bid = p.bid_amounts[n - 1];
    }
    // Only what the preset actually sets: empty preset fields keep the live targeting.
    const targeting = {};
    if (Number(p.age_min) > 0) targeting.age_min = Number(p.age_min);
    if (Number(p.age_max) > 0) targeting.age_max = Number(p.age_max);
    if (p.genders) targeting.genders = p.genders;
    const op = { id: String(adset.id), ...(Object.keys(targeting).length ? { targeting } : {}) };
    if (toCents(p.budget)) op.daily_budget = toCents(p.budget);
    if (toCents(bid)) op.bid_amount = toCents(bid);
    if (!op.targeting && !op.daily_budget && !op.bid_amount) bad('В пресете нет ничего, что можно поменять у живого адсета');
    return queueEdit(req, c, [op],
      `пресет «${p.name}» на адсет «${adset.name}»: ${targeting.age_min ?? '…'}–${targeting.age_max ?? '…'}${targeting.genders ? ` · ${GENDERS[targeting.genders]}` : ''}`
      + `${op.daily_budget ? `, бюджет ${op.daily_budget / 100}` : ''}${op.bid_amount ? `, ставка ${op.bid_amount / 100}` : ''}`
      + ' (устройства, площадки, цель и раскладка — только новым заливом)');
  });

  // One action on many rows: off / on / budget_set (each adset, in its cabinet's currency) / budget_pct (−90…+500).
  app.post('/fb/bulk', auth, async (req) => {
    const { ids, action, value, confirm } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) bad('Нужно от 1 до 200 кампаний');
    if (!['off', 'on', 'budget_set', 'budget_pct'].includes(action)) bad('Действие: off, on, budget_set или budget_pct');
    if (action === 'on' && confirm !== true) bad('Включение требует подтверждения');
    const v = Number(String(value ?? '').replace(',', '.'));
    if (action === 'budget_set' && !(v > 0)) bad('Укажи бюджет больше нуля');
    if (action === 'budget_pct' && !(v >= -90 && v <= 500 && v !== 0)) bad('Процент — от −90 до +500');

    const camps = [];
    for (const id of [...new Set(ids.map(String))]) camps.push(await fbCampaign(req, id));
    const byProfile = new Map();
    const lines = [];
    for (const c of camps) {
      const ops = [];
      if (action === 'off' || action === 'on') ops.push({ id: c.id, status: action === 'on' ? 'ACTIVE' : 'PAUSED' });
      else for (const a of c.adsets || []) {
        if (a.daily_budget == null) continue; // budget lives on the campaign or is a lifetime one: not this action
        const cents = action === 'budget_set' ? Math.round(v * 100) : Math.round(Number(a.daily_budget) * (1 + v / 100));
        if (cents > 0) ops.push({ id: String(a.id), daily_budget: cents });
      }
      if (!ops.length) continue;
      if (!byProfile.has(c.user_id)) byProfile.set(c.user_id, []);
      byProfile.get(c.user_id).push(...ops);
      lines.push({ c, ops });
    }
    if (!lines.length) bad('Нечего менять: у выбранных кампаний нет дневного бюджета на адсетах');
    const what = { off: 'выключить', on: 'включить', budget_set: `бюджет каждого адсета → ${v}`, budget_pct: `бюджет адсетов ${v > 0 ? '+' : ''}${v} %` }[action];
    const jobs = [];
    for (const [userId, ops] of byProfile) {
      const jobId = await enqueueAgentJob(req.user.ws, 'fb_edit', { user_id: userId, ops }, req.user.id);
      jobs.push(jobId);
      for (const { c } of lines.filter(l => l.c.user_id === userId)) await logFbEvent(req.user.ws, c.id, req.user.id, `массово: ${what}`, jobId);
    }
    return { ok: true, queued: true, job_ids: jobs, campaigns: lines.length };
  });

  // History of one campaign: push, edits and their results, newest first.
  app.get('/fb/:id/history', auth, async (req) => {
    const c = await fbCampaign(req, req.params.id);
    const { rows } = await db.query(`
      SELECT e.at, e.text, e.result, e.error, u.name AS user_name
        FROM fb_campaign_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.workspace_id = $1 AND e.campaign_id = $2 ORDER BY e.at DESC LIMIT 200`, [req.user.ws, c.id]);
    return { events: rows };
  });

  app.get('/', auth, async (req) => {
    const { ws, role, id: userId } = req.user;
    const isBuyer = role === 'buyer';
    let sql = `SELECT c.*, p.title as product_title, p.source_id as product_asin
       FROM campaigns c
       LEFT JOIN products p ON c.product_id = p.id
       WHERE c.workspace_id = $1`;
    const vals = [ws];
    if (isBuyer) { sql += ` AND c.created_by = $2`; vals.push(userId); }
    sql += ` ORDER BY c.created_at DESC`;
    const { rows } = await db.query(sql, vals);
    return rows;
  });

  app.post('/', auth, async (req) => {
    const { name, product_id, daily_budget, targeting } = req.body;
    const { ws, id: userId } = req.user;

    return db.insert('campaigns', {
      id: `cmp_${nanoid(20)}`,
      workspace_id: ws,
      product_id: product_id || null,
      name,
      status: 'draft',
      daily_budget: daily_budget || 0,
      spend: 0,
      revenue: 0,
      clicks: 0,
      impressions: 0,
      targeting: JSON.stringify(targeting || {}),
      created_by: userId,
    });
  });

  app.patch('/:id', auth, async (req, reply) => {
    const campaign = await db.findOne('campaigns', { id: req.params.id, workspace_id: req.user.ws });
    if (!campaign) return reply.status(404).send({ error: 'Not found' });
    if (req.user.role === 'buyer' && campaign.created_by !== req.user.id) return reply.status(403).send({ error: 'Access denied' });

    const allowed = ['name', 'status', 'daily_budget', 'spend', 'revenue', 'clicks', 'impressions', 'targeting', 'fb_campaign_id'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    return db.update('campaigns', campaign.id, data);
  });

  app.delete('/:id', auth, async (req, reply) => {
    const campaign = await db.findOne('campaigns', { id: req.params.id, workspace_id: req.user.ws });
    if (!campaign) return reply.status(404).send({ error: 'Not found' });
    if (req.user.role === 'buyer' && campaign.created_by !== req.user.id) return reply.status(403).send({ error: 'Access denied' });
    await db.delete('campaigns', campaign.id);
    return { ok: true };
  });

  app.get('/:id/history', auth, async (req, reply) => {
    if (!faAvailable()) return reply.status(410).send({ error: 'Этот старый маршрут FA отключён. Используйте собственный раздел.', code: 'FA_DISABLED' });
    await assertCampaignAccess(req, req.params.id);
    try {
      return await faCampaignHistory(req.params.id);
    } catch (e) {
      return reply.status(502).send({ error: e.message });
    }
  });

  // :id here is the FA campaign (Facebook campaign id or fbkc_ row); adset ids come from /:id/ads.
  const fa = (handler) => async (req, reply) => {
    if (!faAvailable()) return reply.status(410).send({ error: 'Этот старый маршрут FA отключён. Используйте собственный раздел.', code: 'FA_DISABLED' });
    try {
      return await handler(req, reply);
    } catch (e) {
      if (e.statusCode) throw e;
      return reply.status(502).send({ error: e.message });
    }
  };
  const need = (cond, msg) => { if (!cond) throw Object.assign(new Error(msg), { statusCode: 400 }); };

  app.post('/:id/apply-ad-settings', auth, fa(async (req) => {
    await assertCampaignAccess(req, req.params.id);
    const { ad_settings_id, adset_id } = req.body;
    need(ad_settings_id, 'Выбери пресет');
    need(adset_id, 'Пресет применяется к адсету — выбери адсет в раскрытой строке');
    return faApplyAdSettings(adset_id, ad_settings_id);
  }));

  app.post('/:id/set-targeting', auth, fa(async (req) => {
    await assertCampaignAccess(req, req.params.id);
    const { adset_id, age_min, age_max, gender, genders, countries } = req.body;
    need(adset_id, 'Таргетинг меняется у адсета — выбери адсет в раскрытой строке');
    return faSetTargeting(req.params.id, { adset_id, age_min, age_max, gender: gender || genders, countries });
  }));

  app.post('/bulk-edit', auth, fa(async (req) => {
    const { campaign_ids, action, value } = req.body;
    need(campaign_ids?.length && action, 'Нужны кампании и действие');
    await assertCampaignAccess(req, campaign_ids);
    return faBulkEdit(campaign_ids, action, value);
  }));

  app.post('/:id/duplicate', auth, fa(async (req) => {
    await assertCampaignAccess(req, req.params.id);
    const { row_id, level, copies } = req.body || {};
    need(row_id && level, 'Дублируются адсет или объявление; кампанию копирует новый залив');
    return faDuplicate(req.params.id, { rowId: row_id, level, copies: copies || 1 });
  }));

  app.post('/:id/rename', auth, fa(async (req) => {
    await assertCampaignAccess(req, req.params.id);
    need(false, 'Имя кампании в FA собирается автоматически — переименовать можно адсет или объявление');
  }));

  app.post('/:id/set-budget', auth, fa(async (req) => {
    await assertCampaignAccess(req, req.params.id);
    const { budget, adset_id, level } = req.body;
    need(budget && !isNaN(Number(budget)), 'Укажи бюджет');
    return faSetBudget(req.params.id, {
      rowId: adset_id || req.params.id,
      level: adset_id ? 'adset' : (level || 'campaign'),
      dailyBudget: Number(budget),
    });
  }));

  app.post('/:id/rename-adset', auth, fa(async (req) => {
    await assertCampaignAccess(req, req.params.id);
    const { adset_id, ad_id, name } = req.body;
    need((adset_id || ad_id) && name, 'Нужны адсет или объявление и новое имя');
    return faRename(ad_id ? 'ad' : 'adset', ad_id || adset_id, name);
  }));

  app.get('/:id/ads', auth, async (req, reply) => {
    if (!faAvailable()) return reply.status(410).send({ error: 'Этот старый маршрут FA отключён. Используйте собственный раздел.', code: 'FA_DISABLED' });
    await assertCampaignAccess(req, req.params.id);
    try {
      return await faGetCampaignAds(req.params.id);
    } catch (e) {
      return reply.status(502).send({ error: e.message });
    }
  });
}
