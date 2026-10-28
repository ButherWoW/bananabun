import 'dotenv/config';
import { createReadStream, existsSync } from 'fs';
import { join, dirname } from 'path';
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
import { db } from './db/client.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
// Without a real secret anyone could forge an owner token.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) throw new Error('JWT_SECRET is not set');
await app.register(jwt, { secret: process.env.JWT_SECRET, sign: { expiresIn: '7d' } });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

// Serve uploaded files
const uploadsDir = join(__dirname, '..', 'uploads');
await app.register(staticPlugin, { root: uploadsDir, prefix: '/uploads/', decorateReply: false });

// Auth decorator
// Role and workspace come from the DB on every request, so a removed or demoted user
// loses access at once instead of keeping the rights baked into an old token.
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

app.get('/health', () => ({ ok: true, ts: new Date() }));

try {
  await app.listen({ port: Number(process.env.PORT) || 4000, host: '0.0.0.0' });
  console.log('Backend running on port 4000');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
