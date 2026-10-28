import { adminOnly } from '../../middleware/access.js';
import { db } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { faAvailable, faListLandingTemplates } from '../../services/fa-client.js';

export async function landingRoutes(app) {
  const auth = { onRequest: [app.authenticate] };

  app.get('/templates', auth, async (req) => {
    const { rows } = await db.query(
      'SELECT * FROM landing_templates WHERE workspace_id=$1 ORDER BY created_at DESC',
      [req.user.ws]
    );
    return rows;
  });

  app.post('/templates', auth, async (req) => {
    const { name, html, geo } = req.body;
    return db.insert('landing_templates', {
      id: `lt_${nanoid(20)}`,
      workspace_id: req.user.ws,
      name,
      html: html || '',
      geo: geo || 'FR',
      created_by: req.user.id,
    });
  });

  app.put('/templates/:id', adminOnly(app), async (req) => {
    const { name, html, geo } = req.body;
    await db.query(
      'UPDATE landing_templates SET name=$1, html=$2, geo=$3, updated_at=NOW() WHERE id=$4 AND workspace_id=$5',
      [name, html, geo, req.params.id, req.user.ws]
    );
    return { ok: true };
  });

  app.delete('/templates/:id', adminOnly(app), async (req) => {
    await db.query(
      'DELETE FROM landing_templates WHERE id=$1 AND workspace_id=$2',
      [req.params.id, req.user.ws]
    );
    return { ok: true };
  });

  app.post('/templates/upload', auth, async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) return reply.status(400).send({ error: 'No file' });
      const buf = await data.toBuffer();
      const html = buf.toString('utf-8');
      const name = (data.filename || 'upload').replace(/\.html?$/i, '');
      const template = await db.insert('landing_templates', {
        id: `lt_${nanoid(20)}`,
        workspace_id: req.user.ws,
        name,
        html,
        geo: '',
        created_by: req.user.id,
      });
      return template;
    } catch (e) {
      return reply.status(500).send({ error: e.message });
    }
  });

  // Our own product template: one layout, interface words by geo, only real product data;
  // the buy link is built by the Keitaro offer script, like on the team's Keitaro landings.
  app.post('/templates/store', adminOnly(app), async (req, reply) => {
    const store = String(req.body?.store || '').trim().slice(0, 40);
    if (!store) return reply.status(400).send({ error: 'Укажите название своего магазина — чужие бренды на лендинге не используем' });
    const { readFile } = await import('fs/promises');
    const { OWN_GEOS } = await import('../../services/landing-i18n.js');
    const html = await readFile(new URL('../../services/landing-assets/store.html', import.meta.url), 'utf8');
    return db.insert('landing_templates', {
      id: `lt_${nanoid(20)}`,
      workspace_id: req.user.ws,
      name: String(req.body?.name || `${store} — витрина`).slice(0, 120),
      html,
      geo: '',
      type: 'store',
      store,
      state: 'ready',
      versions: JSON.stringify(OWN_GEOS.map(g => ({ geo: g }))),
      created_by: req.user.id,
    });
  });

  app.post('/templates/white-page', auth, async (req, reply) => {
    const rawName = String(req.body?.name || 'White Page').slice(0, 120);
    const name = rawName.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name}</title>
<style>body{margin:0;font-family:Arial,sans-serif;background:#fff;color:#333;padding:40px 20px;max-width:800px;margin:0 auto}h1{font-size:1.5rem}p{line-height:1.6}</style>
</head>
<body>
<h1>${name}</h1>
<p>Page en cours de construction.</p>
</body>
</html>`;
    const template = await db.insert('landing_templates', {
      id: `lt_${nanoid(20)}`,
      workspace_id: req.user.ws,
      name,
      html,
      geo: '',
      type: 'white',
      created_by: req.user.id,
    });
    return template;
  });

  // Look at the compiled landing like a visitor (phone + desktop) and list what is wrong.
  // One check at a time: each one opens a Chromium page on the server.
  let checking = false;
  app.post('/check', auth, async (req, reply) => {
    const { template_id, product_id, geo = 'FR' } = req.body || {};
    if (!template_id || !product_id) return reply.status(400).send({ error: 'Нужны шаблон и товар' });
    if (!/^[A-Z]{2}$/.test(String(geo).toUpperCase())) return reply.status(400).send({ error: 'Гео — код из двух букв' });
    if (checking) return reply.status(429).send({ error: 'Идёт другая проверка — повторите через полминуты' });
    checking = true;
    try {
      const { checkLanding } = await import('../../services/landing-check.js');
      return await checkLanding({ templateId: template_id, productId: product_id, geo: String(geo).toUpperCase(), ws: req.user.ws });
    } catch (e) {
      return reply.status(400).send({ error: e.message });
    } finally {
      checking = false;
    }
  });

  app.post('/templates/form-page', auth, async (req, reply) => {
    const { geo = 'FR' } = req.body || {};
    // Name and price come from the product when the page is compiled ({{title}}, {{price_fmt}}),
    // so one form page serves any product with its real price.
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const name = esc(req.body?.name || 'Form Page');
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;min-height:100vh}
.header{background:#e63946;color:#fff;padding:12px 20px;text-align:center;font-size:14px;font-weight:600}
.container{max-width:480px;margin:20px auto;padding:0 16px}
.card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden}
.product-info{padding:20px;border-bottom:1px solid #f0f0f0;display:flex;gap:16px;align-items:center}
.product-img{width:80px;height:80px;object-fit:cover;border-radius:8px;background:#f0f0f0;flex-shrink:0}
.product-name{font-weight:700;font-size:16px;color:#1a1a2e;margin-bottom:4px}
.product-price{font-size:22px;font-weight:800;color:#e63946}
.product-price-old{font-size:14px;color:#999;text-decoration:line-through;margin-left:8px}
.form-section{padding:20px}
.form-title{font-weight:700;font-size:16px;color:#1a1a2e;margin-bottom:16px;text-align:center}
.field{margin-bottom:14px}
.field label{display:block;font-size:13px;font-weight:600;color:#555;margin-bottom:5px}
.field input,.field select{width:100%;padding:12px 14px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:15px;outline:none;transition:border .2s}
.field input:focus,.field select:focus{border-color:#e63946}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.submit-btn{width:100%;padding:16px;background:linear-gradient(135deg,#e63946,#c1121f);color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;transition:opacity .2s;margin-top:4px}
.submit-btn:hover{opacity:.9}
.submit-btn:active{transform:scale(.98)}
.security{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#999;margin-top:12px}
.confirm-screen{display:none;text-align:center;padding:40px 20px}
.confirm-screen h2{color:#2d6a4f;font-size:22px;margin-bottom:12px}
.confirm-screen p{color:#555;font-size:14px;line-height:1.6}
.check-icon{font-size:64px;margin-bottom:16px}
</style>
</head>
<body>
<div class="header">🔒 Commande Sécurisée — Livraison Gratuite</div>
<div class="container">
  <div class="card">
    <div class="product-info">
      <div class="product-img" style="display:flex;align-items:center;justify-content:center;font-size:32px">🛍️</div>
      <div>
        <div class="product-name">{{title}}</div>
        <div>
          <span class="product-price">{{price_fmt}}</span>
        </div>
      </div>
    </div>
    <div class="form-section" id="form-section">
      <div class="form-title">📦 Complétez votre commande</div>
      <form id="order-form" onsubmit="handleSubmit(event)">
        <div class="row">
          <div class="field">
            <label>Prénom *</label>
            <input type="text" name="first_name" placeholder="Jean" required>
          </div>
          <div class="field">
            <label>Nom *</label>
            <input type="text" name="last_name" placeholder="Dupont" required>
          </div>
        </div>
        <div class="field">
          <label>Téléphone *</label>
          <input type="tel" name="phone" placeholder="+33 6 00 00 00 00" required>
        </div>
        <div class="field">
          <label>Email</label>
          <input type="email" name="email" placeholder="jean@email.com">
        </div>
        <div class="field">
          <label>Adresse *</label>
          <input type="text" name="address" placeholder="12 rue de la Paix" required>
        </div>
        <div class="row">
          <div class="field">
            <label>Code postal *</label>
            <input type="text" name="zip" placeholder="75001" required>
          </div>
          <div class="field">
            <label>Ville *</label>
            <input type="text" name="city" placeholder="Paris" required>
          </div>
        </div>
        <div class="field">
          <label>Pays</label>
          <select name="country">
            <option value="FR" ${geo==='FR'?'selected':''}>🇫🇷 France</option>
            <option value="BE" ${geo==='BE'?'selected':''}>🇧🇪 Belgique</option>
            <option value="CH" ${geo==='CH'?'selected':''}>🇨🇭 Suisse</option>
            <option value="LU" ${geo==='LU'?'selected':''}>🇱🇺 Luxembourg</option>
          </select>
        </div>
        <button type="submit" class="submit-btn">🛒 Confirmer la commande — {{price_fmt}}</button>
      </form>
      <div class="security">🔒 Paiement sécurisé · SSL · RGPD conforme</div>
    </div>
  </div>
</div>
<script>
// The order goes to the Keitaro offer of this stream with the form fields, the same parameters the
// team's Keitaro offer script uses (sub10 first name, adv3 last name, sub4 email, sub8 phone,
// sub7 address, sub6 city, sub3 zip). No pixel event here: a purchase is reported by the offer.
function handleSubmit(e) {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const url = new URL('/', location.origin);
  new URLSearchParams(location.search).forEach((v, k) => url.searchParams.set(k, v));
  url.searchParams.set('_lp', '1');
  const put = { sub10: d.first_name, adv3: d.last_name, sub4: (d.email || '').replace(/ /g, ''), sub8: d.phone, sub7: d.address, sub6: d.city, sub3: (d.zip || '').replace(/ /g, ''), country: d.country };
  for (const [k, v] of Object.entries(put)) url.searchParams.set(k, v || '');
  location.href = url.toString();
}
</script>
</body>
</html>`;
    const template = await db.insert('landing_templates', {
      id: `lt_${nanoid(20)}`,
      workspace_id: req.user.ws,
      name,
      html,
      geo,
      type: 'form',
      created_by: req.user.id,
    });
    return template;
  });

  app.post('/templates/sync-fa', auth, async (req, reply) => {
    if (!faAvailable()) return reply.status(503).send({ error: 'FA not configured' });
    try {
      const templates = await faListLandingTemplates();
      const list = Array.isArray(templates) ? templates : (templates.templates || templates.items || []);
      let created = 0, updated = 0;
      for (const t of list) {
        const fa_id = String(t.id || t.template_id || '');
        if (!fa_id) continue;
        // Keep everything the push wizard and the card need: store, readiness and one version per geo.
        const versions = (Array.isArray(t.versions) ? t.versions : []).map(v => ({
          id: v.id, geo: String(v.geo || '').toUpperCase(), country: v.country || '', language: v.language || '',
          language_name: v.language_name || '', version: v.version ?? null, size_bytes: v.size_bytes ?? null,
          files_count: v.files_count ?? null, updated_at: v.updated_at || null,
        })).filter(v => v.geo);
        const fields = {
          name: String(t.name || t.title || `FA Template ${fa_id}`).slice(0, 255),
          store: t.store ? String(t.store).slice(0, 50) : null,
          state: t.ready === false ? (t.state || 'not_ready').slice(0, 20) : 'ready',
          geos: JSON.stringify(versions.map(v => v.geo)),
          versions: JSON.stringify(versions),
          geo: versions[0]?.geo || '',
          synced_at: new Date().toISOString(),
        };
        const { rows } = await db.query(
          `UPDATE landing_templates SET name=$1, store=$2, state=$3, geos=$4::jsonb, versions=$5::jsonb, geo=$6, synced_at=$7, updated_at=NOW()
            WHERE workspace_id=$8 AND fa_id=$9 RETURNING id`,
          [fields.name, fields.store, fields.state, fields.geos, fields.versions, fields.geo, fields.synced_at, req.user.ws, fa_id]
        );
        if (rows.length) { updated++; continue; }
        await db.query(
          `INSERT INTO landing_templates (id, workspace_id, name, fa_id, type, html, store, state, geos, versions, geo, synced_at, created_by)
           VALUES ($1,$2,$3,$4,'fa','', $5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`,
          [`lt_${nanoid(12)}`, req.user.ws, fields.name, fa_id, fields.store, fields.state, fields.geos, fields.versions, fields.geo, fields.synced_at, req.user.id]
        );
        created++;
      }
      return { ok: true, synced: list.length, created, updated };
    } catch (e) {
      return reply.status(502).send({ error: e.message });
    }
  });
}
