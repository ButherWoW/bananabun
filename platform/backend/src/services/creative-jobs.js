import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { generateCreative, closeCreativeBrowser } from './creative-generator.js';

// A renderer holds a five-minute lease. Interrupted jobs resume after the lease expires;
// three interrupted attempts fail visibly instead of retrying forever.
export async function runCreativeJobs({ render = generateCreative, limit = 2 } = {}) {
  await db.query(`UPDATE creatives SET status='failed', render_token=NULL,
    metadata=metadata || '{"error":"Рендер несколько раз прервался — проверьте Chromium и повторите"}'::jsonb
    WHERE metadata->>'source'='local' AND status='processing' AND render_attempts >= 3
      AND COALESCE(render_started_at, created_at) < NOW() - INTERVAL '5 minutes'`);
  for (let i=0;i<limit;i++) {
    const token = randomUUID();
    const { rows: [record] } = await db.query(`
      UPDATE creatives SET status='processing', render_token=$1, render_started_at=NOW(), render_attempts=render_attempts+1
      WHERE id = (
        SELECT id FROM creatives WHERE metadata->>'source'='local' AND render_attempts < 3
          AND (status='pending' OR (status='processing' AND COALESCE(render_started_at,created_at) < NOW() - INTERVAL '5 minutes'))
        ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING *`, [token]);
    if (!record) break;
    try {
      const product = await db.findOne('products', { id: record.product_id, workspace_id: record.workspace_id });
      if (!product) throw new Error('Товар больше не доступен');
      const options = { ...record.metadata?.options, language: record.metadata?.language || 'fr', style: record.metadata?.style };
      const result = await render(product,null,record.format,options);
      if (!result?.url || !result?.thumbnail) throw new Error('Собственный движок не создал файл изображения');
      await db.query(`UPDATE creatives SET status='done', file_url=$1, thumbnail_url=$2, render_token=NULL,
        metadata=metadata || $3::jsonb WHERE id=$4 AND render_token=$5 AND status='processing'`,
      [result.url,result.thumbnail,JSON.stringify({ source:'local',style:result.style,language:result.language,error:null }),record.id,token]);
    } catch (error) {
      await db.query(`UPDATE creatives SET status='failed',render_token=NULL,metadata=metadata || $1::jsonb
        WHERE id=$2 AND render_token=$3 AND status='processing'`,
      [JSON.stringify({ error:String(error.message || 'Ошибка собственного рендера').slice(0,500) }),record.id,token]);
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
  return async () => { enabled=false; clearInterval(timer); await running; await closeCreativeBrowser(); };
}
