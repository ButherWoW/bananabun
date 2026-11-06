import 'dotenv/config';
import { reqSerializer } from './services/log-redact.js';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { authRoutes } from './api/routes/auth.js';
import { folderRoutes } from './api/routes/folders.js';
import { productRoutes } from './api/routes/products.js';
import { creativeRoutes } from './api/routes/creatives.js';
import { presetRoutes } from './api/routes/presets.js';
import { scrapeRoutes } from './api/routes/scrape.js';
import { analyticsRoutes } from './api/routes/analytics.js';
import { campaignRoutes } from './api/routes/campaigns.js';
import { searchRoutes } from './api/routes/search.js';
import { teamRoutes } from './api/routes/team.js';
import { keitaroRoutes } from './api/routes/keitaro.js';
import { adspowerRoutes } from './api/routes/adspower.js';
import { accountRoutes } from './api/routes/accounts.js';
import { agentRoutes } from './api/routes/agent.js';
import { adPresetRoutes } from './api/routes/adpresets.js';
import { pushRoutes } from './api/routes/push.js';
import { adminRoutes } from './api/routes/admin.js';
import { landingRoutes } from './api/routes/landings.js';
import { adSettingsRoutes } from './api/routes/adSettings.js';
import { trackRoutes } from './api/routes/track.js';
import { tiktokRoutes } from './api/routes/tiktok.js';
import { gateRoutes } from './api/routes/gate.js';
import { mcpRoutes, mcpTokenRoutes } from './api/routes/mcp.js';
import { telegramRoutes } from './api/routes/telegram.js';
import { startTelegramWorker } from './services/telegram.js';
import { registerAuthenticate } from './middleware/authenticate.js';
import { registerHardening } from './hardening.js';
import { startScrapeRecovery } from './services/scrape-jobs.js';
import { pool } from './db/client.js';
import { startCreativeWorker } from './services/creative-jobs.js';

const app = Fastify({ logger: { serializers: { req: reqSerializer } } });

await app.register(cors, {
  origin: (process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'https://nespizdili.lol').split(',').map(s => s.trim()).filter(Boolean),
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
});
// Without a real secret anyone could forge an owner token.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) throw new Error('JWT_SECRET is not set');
await app.register(jwt, { secret: process.env.JWT_SECRET, sign: { expiresIn: '7d' } });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

// Serve uploaded files
const uploadsDir = process.env.UPLOADS_DIR ? resolve(process.env.UPLOADS_DIR) : join(__dirname, '..', 'uploads');
await app.register(staticPlugin, { root: uploadsDir, prefix: '/uploads/', decorateReply: false });

registerHardening(app);
registerAuthenticate(app);

// Routes
app.register(authRoutes, { prefix: '/api/auth' });
app.register(folderRoutes, { prefix: '/api/folders' });
app.register(productRoutes, { prefix: '/api/products' });
app.register(creativeRoutes, { prefix: '/api/creatives' });
app.register(presetRoutes, { prefix: '/api/presets' });
app.register(scrapeRoutes, { prefix: '/api/scrape' });
app.register(analyticsRoutes, { prefix: '/api/analytics' });
app.register(campaignRoutes, { prefix: '/api/campaigns' });
app.register(searchRoutes, { prefix: '/api/search' });
app.register(teamRoutes, { prefix: '/api/team' });
app.register(keitaroRoutes, { prefix: '/api/keitaro' });
app.register(adspowerRoutes, { prefix: '/api/adspower' });
app.register(accountRoutes, { prefix: '/api/accounts' });
app.register(agentRoutes, { prefix: '/api/agent' });
app.register(adPresetRoutes, { prefix: '/api/ad-presets' });
app.register(pushRoutes, { prefix: '/api/push' });
app.register(adminRoutes, { prefix: '/api/admin' });
app.register(landingRoutes, { prefix: '/api/landings' });
app.register(adSettingsRoutes, { prefix: '/api/ad-settings' });
app.register(trackRoutes, { prefix: '/api/t' });
app.register(tiktokRoutes, { prefix: '/api/tiktok' });
app.register(mcpTokenRoutes, { prefix: '/api/mcp-tokens' });
app.register(mcpRoutes, { prefix: '/api/mcp' });
app.register(telegramRoutes, { prefix: '/api/telegram' });
// PIN doors of the stub page: not under /api, reachable only through nginx (see routes/gate.js).
app.register(gateRoutes, { prefix: '/gate' });

app.get('/health', () => ({ ok: true, ts: new Date() }));

let stopCreatives, stopTelegram;
app.addHook('onClose', async () => { await stopCreatives?.(); stopTelegram?.(); });
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, async () => {
  await app.close();
  await pool.end();
  process.exit(0);
});

try {
  await app.listen({ port: Number(process.env.PORT) || 4000, host: process.env.HOST || '0.0.0.0' });
  console.log('Backend running on port 4000');
  startScrapeRecovery();
  stopCreatives = startCreativeWorker();
  stopTelegram = startTelegramWorker();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
