const BASE = 'https://graph.facebook.com/v21.0';

export function fbGraph(token) {
  async function req(method, path, body) {
    const url = `${BASE}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (data.error) throw Object.assign(new Error(data.error.message), { fb: data.error });
    return data;
  }

  return {
    // Create campaign
    createCampaign(cabinetId, { name, objective, status = 'PAUSED', special_ad_categories = [] }) {
      return req('POST', `/act_${cabinetId}/campaigns`, {
        name, objective, status, special_ad_categories,
      });
    },

    // Create adset
    createAdset(cabinetId, {
      name, campaign_id, daily_budget, bid_strategy, bid_amount,
      optimization_goal, billing_event, pixel_id, pixel_event,
      targeting, status = 'PAUSED',
    }) {
      const body = {
        name, campaign_id, daily_budget: Math.round(daily_budget * 100),
        bid_strategy, optimization_goal, billing_event,
        promoted_object: { pixel_id, custom_event_type: pixel_event },
        targeting, status,
      };
      if (bid_amount) body.bid_amount = Math.round(bid_amount * 100);
      return req('POST', `/act_${cabinetId}/adsets`, body);
    },

    // Upload image
    async uploadImage(cabinetId, imageUrl) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
      const buf = await imgRes.arrayBuffer();
      const b64 = Buffer.from(buf).toString('base64');

      const form = new URLSearchParams();
      form.set('bytes', b64);
      form.set('access_token', token);

      const res = await fetch(`${BASE}/act_${cabinetId}/adimages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (data.error) throw Object.assign(new Error(data.error.message), { fb: data.error });
      // Returns { images: { filename: { hash, url } } }
      const images = Object.values(data.images || {});
      return images[0];
    },

    // Create ad creative
    createCreative(cabinetId, { name, page_id, image_hash, title, body, link_url, call_to_action = 'LEARN_MORE' }) {
      return req('POST', `/act_${cabinetId}/adcreatives`, {
        name,
        object_story_spec: {
          page_id,
          link_data: {
            image_hash,
            link: link_url,
            message: body,
            name: title,
            call_to_action: { type: call_to_action, value: { link: link_url } },
          },
        },
      });
    },

    // Create ad
    createAd(cabinetId, { name, adset_id, creative_id, status = 'PAUSED' }) {
      return req('POST', `/act_${cabinetId}/ads`, {
        name,
        adset_id,
        creative: { creative_id },
        status,
      });
    },

    // Get page access token from user token
    async getPageToken(pageId) {
      const data = await req('GET', `/${pageId}?fields=access_token`);
      return data.access_token;
    },
  };
}
