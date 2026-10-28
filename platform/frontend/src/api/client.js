import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r.data,
  (err) => {
    // A 401 from login itself is "wrong password": show it, don't reload the page.
    const authCall = String(err.config?.url || '').startsWith('/api/auth/login');
    if (err.response?.status === 401 && !authCall && window.location.pathname !== '/login') {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    const data = err.response?.data;
    // Fastify puts the readable text in `message` and the HTTP reason in `error`.
    if (data && typeof data === 'object' && data.statusCode && data.message) {
      return Promise.reject({ ...data, error: data.message });
    }
    return Promise.reject(data || { error: err.message || 'Сеть недоступна' });
  }
);

export const auth = {
  login: (data) => api.post('/api/auth/login', data),
  register: (data) => api.post('/api/auth/register', data),
  me: () => api.get('/api/auth/me'),
};

export const folders = {
  list: () => api.get('/api/folders'),
  create: (data) => api.post('/api/folders', data),
  counts: () => api.get('/api/folders/counts'),
  rename: (id, name) => api.patch(`/api/folders/${id}`, { name }),
  remove: (id) => api.delete(`/api/folders/${id}`),
};

export const products = {
  list: (params) => api.get('/api/products', { params }),
  get: (id) => api.get(`/api/products/${id}`),
  create: (data) => api.post('/api/products', data),
  update: (id, data) => api.patch(`/api/products/${id}`, data),
  remove: (ids) => api.delete('/api/products', { data: { ids } }),
  move: (ids, folder_id) => api.post('/api/products/move', { ids, folder_id }),
  bulkEdit: (ids, updates) => api.patch('/api/products/bulk', { ids, updates }),
};

export const scrape = {
  product: (data) => api.post('/api/scrape/product', data),
  bulk: (data) => api.post('/api/scrape/bulk', data),
  status: (id) => api.get(`/api/scrape/status/${id}`),
  retry: (id) => api.post(`/api/scrape/retry/${id}`),
  engine: () => api.get('/api/scrape/engine'),
  similar: (id) => api.get(`/api/scrape/similar/${id}`),
};

export const creatives = {
  list: (params) => api.get('/api/creatives', { params }),
  generate: (data) => api.post('/api/creatives/generate', data),
  remove: (ids) => api.delete('/api/creatives', { data: { ids } }),
  toggleFavorite: (id) => api.patch(`/api/creatives/${id}/favorite`),
  spend: () => api.get('/api/creatives/spend'),
  retry: (id) => api.post(`/api/creatives/${id}/retry`),
  readyImages: () => api.get('/api/creatives/ready-images'),
  importReady: (genId, product_id) => api.post(`/api/creatives/import-ready/${genId}`, { product_id }),
  faReady: () => api.get('/api/creatives/fa-ready'),
};

export const presets = {
  bundles: () => api.get('/api/presets/bundles'),
  saveBundle: (data) => api.post('/api/presets/bundles', data),
  deleteBundle: (id) => api.delete(`/api/presets/bundles/${id}`),
  creativePresets: () => api.get('/api/presets/creatives'),
  saveCreativePreset: (data) => api.post('/api/presets/creatives', data),
  deleteCreativePreset: (id) => api.delete(`/api/presets/creatives/${id}`),
};

export const analytics = {
  overview: () => api.get('/api/analytics/overview'),
  daily: (days) => api.get('/api/analytics/daily', { params: { days } }),
  landingFunnel: (from, to, group = 'template') => api.get('/api/analytics/landing-funnel', { params: { from, to, group } }),
  landingBehavior: (from, to) => api.get('/api/analytics/landing-behavior', { params: { from, to } }),
  buyers: (from, to, compare = false) => api.get('/api/analytics/buyers', { params: { from, to, compare: compare ? 'true' : undefined } }),
  query: (plan) => api.post('/api/analytics/query', plan),
  faQuery: (plan) => api.post('/api/analytics/fa-query', { plan }),
};

export const campaigns = {
  list: () => api.get('/api/campaigns'),
  create: (data) => api.post('/api/campaigns', data),
  update: (id, data) => api.patch(`/api/campaigns/${id}`, data),
  remove: (id) => api.delete(`/api/campaigns/${id}`),
  history: (id) => api.get(`/api/campaigns/${id}/history`),
  ads: (id) => api.get(`/api/campaigns/${id}/ads`),
  setBudget: (id, data) => api.post(`/api/campaigns/${id}/set-budget`, data),
  renameAdset: (id, data) => api.post(`/api/campaigns/${id}/rename-adset`, data),
  duplicate: (id) => api.post(`/api/campaigns/${id}/duplicate`),
  rename: (id, name) => api.post(`/api/campaigns/${id}/rename`, { name }),
  setTargeting: (id, targeting) => api.post(`/api/campaigns/${id}/set-targeting`, targeting),
  bulkEdit: (campaign_ids, action, value) => api.post('/api/campaigns/bulk-edit', { campaign_ids, action, value }),
  applyAdSettings: (id, ad_settings_id) => api.post(`/api/campaigns/${id}/apply-ad-settings`, { ad_settings_id }),
  // Own list: Facebook via the Mac agent, joined to Keitaro by sub_id_2.
  fbList: (period) => api.get('/api/campaigns/fb', { params: { period } }),
  fbRefresh: () => api.post('/api/campaigns/fb/refresh'),
  fbEdit: (id, data) => api.post(`/api/campaigns/fb/${id}/edit`, data),
  fbDuplicate: (id, data) => api.post(`/api/campaigns/fb/${id}/duplicate`, data),
  fbApplyPreset: (id, data) => api.post(`/api/campaigns/fb/${id}/apply-preset`, data),
  fbBulk: (data) => api.post('/api/campaigns/fb/bulk', data),
  fbHistory: (id) => api.get(`/api/campaigns/fb/${id}/history`),
  fbRefreshOne: (id) => api.post(`/api/campaigns/fb/${id}/refresh`),
  fbArchive: (ids, off_first = false) => api.post('/api/campaigns/fb/archive', { ids, off_first }),
  fbUnarchive: (ids) => api.post('/api/campaigns/fb/archive', { ids, restore: true }),
  fbSummary: (id) => api.get(`/api/campaigns/fb/${id}/summary`),
};

export const search = {
  start: (data) => api.post('/api/search/amazon', data),
  similar: (data) => api.post('/api/search/similar', data),
  status: (id) => api.get(`/api/search/${id}`),
  history: () => api.get('/api/search/history'),
};

export const team = {
  members: () => api.get('/api/team/members'),
  invite: (data) => api.post('/api/team/invite', data),
  update: (id, data) => api.patch(`/api/team/members/${id}`, data),
  remove: (id) => api.delete(`/api/team/members/${id}`),
};

export const accounts = {
  list: () => api.get('/api/accounts'),
  sync: () => api.post('/api/accounts/sync'),
  open: (id) => api.post(`/api/accounts/${id}/open`),
  updateAssets: (id, data) => api.put(`/api/accounts/${id}/assets`, data),
  update: (id, data) => api.patch(`/api/accounts/${id}`, data),
  checkProfile: (id) => api.post(`/api/accounts/${id}/check-profile`),
  twoFa: (id) => api.post(`/api/accounts/${id}/2fa`, null, { timeout: 30000 }),
};

export const agent = {
  status: () => api.get('/api/agent/status'),
  newKey: () => api.post('/api/agent/key'),
  job: (id) => api.get(`/api/agent/jobs/${id}`),
};

// Polls a Mac-agent job until it finishes; rejects with the agent's error text.
export async function waitAgentJob(id, { timeoutMs = 90000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const job = await agent.job(id);
    if (job.status === 'done') return job.result?.data ?? job.result;
    if (job.status === 'failed') throw new Error(job.result?.error || 'Агент не смог выполнить задачу');
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Агент на Mac не ответил: проверьте, что он запущен и AdsPower открыт');
}

export const adspower = {
  profiles: (params) => api.get('/api/adspower/profiles', { params }),
  groups: () => api.get('/api/adspower/groups'),
  openBrowser: (user_id) => api.post('/api/adspower/browser/open', { user_id }),
  closeBrowser: (user_id) => api.post('/api/adspower/browser/close', { user_id }),
  browserStatus: (user_id) => api.get('/api/adspower/browser/status', { params: { user_id } }),
  settings: () => api.get('/api/adspower/settings'),
  saveSettings: (data) => api.put('/api/adspower/settings', data),
  test: (data) => api.post('/api/adspower/test', data),
};

export const keitaro = {
  stats: (range = 'today') => {
    if (range && typeof range === 'object') {
      return api.get('/api/keitaro/stats', { params: { from: range.from, to: range.to } });
    }
    return api.get('/api/keitaro/stats', { params: { range } });
  },
  statsDaily: (days = 30) => api.get('/api/keitaro/stats/daily', { params: { days } }),
  campaigns: () => api.get('/api/keitaro/campaigns'),
  deletedCampaigns: () => api.get('/api/keitaro/campaigns/deleted'),
  groups: () => api.get('/api/keitaro/groups'),
  offers: () => api.get('/api/keitaro/offers'),
  landings: () => api.get('/api/keitaro/landings'),
  domains: () => api.get('/api/keitaro/domains'),
  settings: () => api.get('/api/keitaro/settings'),
  saveSettings: (data) => api.put('/api/keitaro/settings', data),
  test: (data) => api.post('/api/keitaro/test', data),
  setCampaignState: (id, state) => api.put(`/api/keitaro/campaigns/${id}/state`, { state }),
  campaignStreams: (id) => api.get(`/api/keitaro/campaigns/${id}/streams`),
};

export const adPresets = {
  list: () => api.get('/api/ad-presets'),
  create: (data) => api.post('/api/ad-presets', data),
  update: (id, data) => api.patch(`/api/ad-presets/${id}`, data),
  remove: (id) => api.delete(`/api/ad-presets/${id}`),
};

export const adSettings = {
  list: () => api.get('/api/ad-settings'),
  stats: () => api.get('/api/ad-settings/stats'),
  create: (data) => api.post('/api/ad-settings', data),
  update: (id, data) => api.patch(`/api/ad-settings/${id}`, data),
  remove: (id) => api.delete(`/api/ad-settings/${id}`),
};

export const pushes = {
  list: (params) => api.get('/api/push', { params }),
  get: (id) => api.get(`/api/push/${id}`),
  start: (data) => api.post('/api/push', data),
  retry: (id) => api.post(`/api/push/${id}/retry`),
  dismiss: (id) => api.post(`/api/push/${id}/dismiss`),
  restore: (id) => api.post(`/api/push/${id}/restore`),
  options: () => api.get('/api/push/options'),
  generateTexts: (data) => api.post('/api/push/generate-texts', data),
  trace: (id) => api.get(`/api/push/${id}/trace`),
  compileLanding: (data) => api.post('/api/push/compile-landing', data),
  uploadLandingKeitaro: (data) => api.post('/api/push/upload-landing-keitaro', data),
};

export const landingTemplates = {
  list: () => api.get('/api/landings/templates'),
  create: (data) => api.post('/api/landings/templates', data),
  update: (id, data) => api.put(`/api/landings/templates/${id}`, data),
  remove: (id) => api.delete(`/api/landings/templates/${id}`),
  syncFa: () => api.post('/api/landings/templates/sync-fa'),
  uploadHtml: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/api/landings/templates/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  createStore: (data) => api.post('/api/landings/templates/store', data),
  createWhitePage: (name) => api.post('/api/landings/templates/white-page', { name }),
  createFormPage: (data) => api.post('/api/landings/templates/form-page', data),
  check: (data) => api.post('/api/landings/check', data, { timeout: 120000 }),
};

export const landings = {
  generate: (data) => api.post('/api/landings/generate', data),
};

export const admin = {
  users: () => api.get('/api/admin/users'),
  create: (data) => api.post('/api/admin/users', data),
  update: (id, data) => api.patch(`/api/admin/users/${id}`, data),
  remove: (id) => api.delete(`/api/admin/users/${id}`),
  resetPassword: (id, password) => api.post(`/api/admin/users/${id}/reset-password`, { password }),
};
