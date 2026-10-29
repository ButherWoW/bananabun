const BASE = 'https://business-api.tiktok.com/open_api/v1.3';

export function tiktokClient(accessToken) {
  const headers = {
    'Access-Token': accessToken,
    'Content-Type': 'application/json',
  };

  async function req(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (data.code !== 0) {
      throw Object.assign(new Error(data.message || `TikTok error ${data.code}`), { tiktok: data });
    }
    return data.data;
  }

  return {
    getAdvertiserInfo(advertiserId) {
      return req('GET', `/advertiser/info/?advertiser_id=${encodeURIComponent(advertiserId)}`);
    },

    getPixels(advertiserId) {
      return req('GET', `/pixel/list/?advertiser_id=${encodeURIComponent(advertiserId)}&page=1&page_size=100`);
    },

    async uploadVideoUrl(advertiserId, videoUrl) {
      const imgRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) });
      if (!imgRes.ok) throw new Error(`Failed to fetch video: ${videoUrl}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const ext = videoUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'mp4';
      const filename = `upload.${ext}`;

      const form = new FormData();
      form.append('advertiser_id', advertiserId);
      form.append('video_file', new Blob([buf], { type: 'video/mp4' }), filename);

      const res = await fetch(`${BASE}/file/video/ad/upload/`, {
        method: 'POST',
        headers: { 'Access-Token': accessToken },
        body: form,
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json();
      if (data.code !== 0) throw Object.assign(new Error(data.message || 'Video upload failed'), { tiktok: data });
      return data.data;
    },

    createCampaign(advertiserId, { name, objective = 'CONVERSIONS', budget, budget_mode = 'BUDGET_MODE_DAY' }) {
      return req('POST', '/campaign/create/', {
        advertiser_id: advertiserId,
        campaign_name: name,
        objective_type: objective,
        budget_mode,
        budget: budget ? Number(budget) : undefined,
        operation_status: 'DISABLE',
        special_industries: [],
      });
    },

    createAdGroup(advertiserId, {
      campaign_id, name, location_ids, budget,
      pixel_id, optimization_event = 'CompletePayment',
      age_min = 18, age_max = 55,
      schedule_start,
    }) {
      return req('POST', '/adgroup/create/', {
        advertiser_id: advertiserId,
        campaign_id,
        adgroup_name: name,
        placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
        location_ids: location_ids || [],
        budget_mode: 'BUDGET_MODE_DAY',
        budget: Number(budget),
        schedule_type: 'SCHEDULE_START_END',
        schedule_start_time: schedule_start || new Date().toISOString().replace('T', ' ').slice(0, 19),
        schedule_end_time: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19),
        optimization_goal: 'CONVERT',
        pixel_id,
        optimization_event,
        bid_type: 'BID_TYPE_NO_BID',
        billing_event: 'OCPM',
        age_groups: buildAgeGroups(age_min, age_max),
        operation_status: 'DISABLE',
      });
    },

    createAd(advertiserId, { adgroup_id, video_id, ad_text, ad_name, call_to_action = 'SHOP_NOW', landing_page_url }) {
      return req('POST', '/ad/create/', {
        advertiser_id: advertiserId,
        adgroup_id,
        creatives: [{
          ad_name,
          ad_text,
          video_id,
          call_to_action,
          landing_page_url,
          identity_type: 'CUSTOMIZED_USER',
        }],
        operation_status: 'DISABLE',
      });
    },

    setCampaignStatus(advertiserId, campaignId, status) {
      return req('POST', '/campaign/status/update/', {
        advertiser_id: advertiserId,
        campaign_ids: [String(campaignId)],
        operation_status: status,
      });
    },
  };
}

// TikTok age group codes
function buildAgeGroups(min, max) {
  const groups = [
    { code: 'AGE_13_17', from: 13, to: 17 },
    { code: 'AGE_18_24', from: 18, to: 24 },
    { code: 'AGE_25_34', from: 25, to: 34 },
    { code: 'AGE_35_44', from: 35, to: 44 },
    { code: 'AGE_45_54', from: 45, to: 54 },
    { code: 'AGE_55_100', from: 55, to: 100 },
  ];
  return groups.filter(g => g.from <= max && g.to >= min).map(g => g.code);
}

// Country code → TikTok location_id mapping (common European markets)
export const TIKTOK_LOCATIONS = {
  FR: '6252001', BE: '2802361', CH: '2658434', LU: '2960313',
  DE: '2921044', ES: '2510769', IT: '3175395', NL: '2750405',
  PT: '2264397', PL: '798544', AT: '2782113', GB: '2635167',
};

export function getOAuthUrl(appId, redirectUri, state) {
  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: redirectUri,
    state: state || '',
    scope: 'advertiser.info,campaign.read,campaign.write,adgroup.read,adgroup.write,ad.read,ad.write,pixel.read',
    response_type: 'code',
    rid: String(Date.now()),
  });
  return `https://ads.tiktok.com/marketing_api/auth?${params}`;
}

export async function exchangeCode(appId, appSecret, code, redirectUri) {
  const res = await fetch(`${BASE}/oauth2/access_token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, secret: appSecret, auth_code: code }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message || 'OAuth exchange failed');
  return data.data;
}