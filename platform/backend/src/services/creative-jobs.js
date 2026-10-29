import { randomUUID } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import { db } from '../db/client.js';
import { generateCreative, closeCreativeBrowser } from './creative-generator.js';
import { generateFluxCreative } from './flux-generator.js';
import { renderBanner } from './banner-renderer.js';

const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';
async function pruneFluxCache(maxAgeMs = 30 * 24 * 3600 * 1000) {
  const now = Date.now();
  for (const f of await fs.readdir(UPLOADS_DIR).catch(() => [])) {
    if (!/^(cr_flux_cache_|thumb_cr_flux_).*\.jpg$/.test(f)) continue;
    const st = await fs.stat(path.join(UPLOADS_DIR, f)).catch(() => null);
    if (st && now - st.mtimeMs > maxAgeMs) await fs.unlink(path.join(UPLOADS_DIR, f)).catch(() => {});
  }
}

const SOURCES = "'local','flux','banner'";

// A renderer holds a five-minute lease. Interrupted jobs resume after the lease expires;
// three interrupted attempts fail visibly instead of retrying forever.
export async function runCreativeJobs({ render = generateCreative, limit = 2 } = {}) {
  await db.query(`UPDATE creatives SET status='failed', render_token=NULL,
    metadata=metadata || '{"error":"Рендер несколько раз прервался — проверьте Chromium и повторите"}'::jsonb
    WHERE metadata->>'source' IN (${SOURCES}) AND status='processing' AND render_attempts >= 3
      AND COALESCE(render_started_at, created_at) < NOW() - INTERVAL '5 minutes'`);
  for (let i=0;i<limit;i++) {
    const token = randomUUID();
    const { rows: [record] } = await db.query(`
      UPDATE creatives SET status='processing', render_token=$1, render_started_at=NOW(), render_attempts=render_attempts+1
      WHERE id = (
        SELECT id FROM creatives WHERE metadata->>'source' IN (${SOURCES}) AND render_attempts < 3
          AND (status='pending' OR (status='processing' AND COALESCE(render_started_at,created_at) < NOW() - INTERVAL '5 minutes'))
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING *`, [token]);
    if (!record) break;
    try {
      const product = await db.findOne('products', { id: record.product_id, workspace_id: record.workspace_id });
      if (!product) throw new Error('РўРѕРІР°СЂ Р±РѕР»СЊС€Рµ РЅРµ РґРѕСЃС‚СѓРїРµРЅ');
      const options = { ...record.metadata?.options, language: record.metadata?.language || 'fr', style: record.metadata?.style };
      const source = record.metadata?.source;
      const slot = typeof record.metadata?.auto_slot === 'number' ? record.metadata.auto_slot : 0;
      const result = source === 'flux'
        ? await generateFluxCreative(product, null, record.format, options, slot)
        : source === 'banner'
          ? await renderBanner(product, record.format, options, slot)
          : await render(product, null, record.format, options);
      if (!result?.url || !result?.thumbnail) throw new Error('Р”РІРёР¶РѕРє РЅРµ СЃРѕР·РґР°Р» С„Р°Р№Р» РёР·РѕР±СЂР°Р¶РµРЅРёСЏ');
      await db.query(`UPDATE creatives SET status='done', file_url=$1, thumbnail_url=$2, render_token=NULL,
        metadata=metadata || $3::jsonb WHERE id=$4 AND render_token=$5 AND status='processing'`,
      [result.url,result.thumbnail,JSON.stringify({ source,style:result.style,language:result.language,error:null }),record.id,token]);
    } catch (error) {
      await db.query(`UPDATE creatives SET status='failed',render_token=NULL,metadata=metadata || $1::jsonb
        WHERE id=$2 AND render_token=$3 AND status='processing'`,
      [JSON.stringify({ error:String(error.message || 'РћС€РёР±РєР° СЂРµРЅРґРµСЂР°').slice(0,500) }),record.id,token]);
    }
  }
}

let running = null;
let enabled = false;
function tick() {
  if (!enabled || running) return;
  running = runCreativeJobs().catch(() => console.error('[creative queue] processing failed')).finally(() => { running=null; });
}
export function wakeCreativeWorker() { queueMicrotask(tick); }
export function startCreativeWorker() {
  if (enabled) throw new Error('Creative worker already started');
  enabled=true;
  const timer=setInterval(tick,1000); timer.unref?.(); tick();
  // Prune old fal.ai cache files once a day
  const pruneTimer = setInterval(() => pruneFluxCache().catch(() => {}), 24 * 3600 * 1000);
  pruneTimer.unref?.();
  return async () => { enabled=false; clearInterval(timer); clearInterval(pruneTimer); await running; await closeCreativeBrowser(); };
}
