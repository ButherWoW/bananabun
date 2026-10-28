export function adspowerClient(baseUrl, apiKey) {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  async function request(path, params = {}) {
    const url = new URL(path, baseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`AdsPower HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg || 'AdsPower error');
    return data.data;
  }

  return {
    profiles: (page = 1, pageSize = 50, groupId) => {
      const params = { page, page_size: pageSize };
      if (groupId) params.group_id = groupId;
      return request('/api/v1/user/list', params);
    },

    groups: () => request('/api/v1/group/list', { page: 1, page_size: 100 }),

    openBrowser: (userId) => request('/api/v1/browser/start', { user_id: userId }),

    closeBrowser: (userId) => request('/api/v1/browser/stop', { user_id: userId }),

    browserStatus: (userId) => request('/api/v1/browser/active', { user_id: userId }),
  };
}
