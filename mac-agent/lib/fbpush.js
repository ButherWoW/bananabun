import { isOk } from './cdp.js';
import { sleep } from './common.js';
import { uploadImage } from '../cdp_upload_img.js';

// Every key OPT_OUT so Facebook doesn't rework creatives; contextual_multi_ads goes separately.
const CREATIVE_FEATURES = (process.env.CREATIVE_FEATURES ||
  'image_brightness_and_contrast,image_templates,image_touchups,image_uncrop,text_optimizations,enhance_cta,inline_comment,adapt_to_placement,add_text_overlay,description_automation,image_animation,music,product_extensions,site_extensions,text_translation,video_auto_crop'
).split(',');

const REQUIRED = ['act', 'name', 'page_id', 'page_name', 'pixel_id', 'custom_event_type', 'daily_budget', 'bid_amount', 'targeting', 'link', 'creatives'];

export function emptyState() {
  return { adsets: [], images: {}, creatives: {}, ads: {} };
}

// Bid and daily budget are set per geo by the lead — never defaulted.
export function checkSpec(spec) {
  const missing = REQUIRED.filter((k) => spec[k] == null || spec[k] === '');
  if (missing.length) throw new Error(`spec is missing: ${missing.join(', ')} (bid and daily budget are set per geo by the lead — never default them)`);
  if (!spec.creatives.length) throw new Error('no creatives');
  const adsets = spec.adsets ?? 3;
  if (spec.bid_amounts && (spec.bid_amounts.length !== adsets || spec.bid_amounts.some((b) => !(b > 0)))) {
    throw new Error(`bid_amounts must hold ${adsets} positive bids, one per adset`);
  }
  const layout = layoutOf(spec);
  if (layout.length !== adsets || layout.some((l) => !l.length || l.some((i) => !spec.creatives[i]))) {
    throw new Error('layout must give every adset at least one existing creative');
  }
}

// Creative indexes per adset; without a layout every creative goes into every adset.
function layoutOf(spec) {
  const adsets = spec.adsets ?? 3;
  return spec.layout || Array.from({ length: adsets }, () => spec.creatives.map((_, i) => i));
}

const bidOf = (spec, n) => spec.bid_amounts?.[n - 1] ?? spec.bid_amount;

export function planText(spec, state) {
  const act = spec.act.startsWith('act_') ? spec.act : `act_${spec.act}`;
  const adsetCount = spec.adsets ?? 3;
  const bids = Array.from({ length: adsetCount }, (_, i) => bidOf(spec, i + 1) / 100).join('/');
  const t = spec.targeting || {};
  return [
    `Account        ${act}`,
    `Campaign       ${spec.name}  (OUTCOME_LEADS, AUCTION, no CBO, PAUSED)`,
    `Adsets         ${adsetCount} × budget ${spec.daily_budget / 100}/day, bid cap ${bids}, OFFSITE_CONVERSIONS ${spec.custom_event_type}, click 7d`,
    `Audience       ${t.age_min}-${t.age_max} · genders ${t.genders?.join(',') || 'all'} · devices ${t.device_platforms?.join(',') || 'all'} · placements ${t.publisher_platforms?.join(',') || 'auto'}`,
    `Page / DSA     ${spec.page_name} (${spec.page_id})`,
    `Pixel          ${spec.pixel_id}`,
    `Link           ${spec.link}`,
    `Creatives      ${spec.creatives.length} → ${layoutOf(spec).flat().length} ads (${layoutOf(spec).map((l) => l.length).join('/')} per adset)`,
    `Already made   campaign ${state.campaign_id ? 'yes' : 'no'}, adsets ${state.adsets.length}, ads ${Object.keys(state.ads).length}`,
  ].join('\n');
}

// One campaign → N adsets (own bid each, if given) → creatives laid out per adset, all PAUSED.
// Idempotent: `state` records what exists and `save()` persists it after every object,
// so a rerun with the same state creates only what is missing.
// Each creative needs `file` (local image path).
export async function runFbPush(g, spec, state, save, log = () => {}) {
  checkSpec(spec);
  const act = spec.act.startsWith('act_') ? spec.act : `act_${spec.act}`;
  const adsetCount = spec.adsets ?? 3;

  async function must(label, r) {
    if (r.fatal) throw Object.assign(new Error('Токен FB мёртв (код 190): стоп, нужен свежий токен из профиля'), { fatal: true });
    if (!isOk(r)) {
      const e = r.data?.error || {};
      throw new Error(`${label}: status ${r.status} code ${e.code ?? '-'}/${e.error_subcode ?? '-'} ${e.error_user_msg || e.message || JSON.stringify(r.data).slice(0, 300)}`);
    }
    await sleep(350);
    return r.data;
  }

  if (!state.campaign_id) {
    const d = await must('campaign', await g.post(`${act}/campaigns`, {
      name: spec.name,
      objective: 'OUTCOME_LEADS',
      buying_type: 'AUCTION',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      status: 'PAUSED',
    }));
    state.campaign_id = d.id; save();
    log(`campaign ${d.id}`);
  }

  while (state.adsets.length < adsetCount) {
    const n = state.adsets.length + 1;
    const d = await must(`adset ${n}`, await g.post(`${act}/adsets`, {
      name: `${spec.name} #${n}`,
      campaign_id: state.campaign_id,
      daily_budget: String(spec.daily_budget),
      bid_amount: String(bidOf(spec, n)),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITH_BID_CAP',
      promoted_object: { pixel_id: spec.pixel_id, custom_event_type: spec.custom_event_type },
      attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }],
      targeting: spec.targeting,
      dsa_beneficiary: spec.page_name,
      dsa_payor: spec.page_name,
      status: 'PAUSED',
    }));
    state.adsets.push(d.id); save();
    log(`adset ${n}: ${d.id}`);
  }

  const layout = layoutOf(spec);
  for (const [i, c] of spec.creatives.entries()) {
    const key = String(i);
    if (!layout.some((l) => l.includes(i))) continue;
    if (!state.images[key]) {
      state.images[key] = await uploadImage(g, act, c.file); save();
      await sleep(350);
    }
    if (!state.creatives[key]) {
      const features = Object.fromEntries(CREATIVE_FEATURES.map((f) => [f, { enroll_status: 'OPT_OUT' }]));
      const d = await must(`creative ${i + 1}`, await g.post(`${act}/adcreatives`, {
        name: `${spec.name} c${i + 1}`,
        object_story_spec: {
          page_id: spec.page_id,
          link_data: {
            link: spec.link,
            message: c.primary_text || '',
            name: c.headline || '',
            description: c.description || '',
            image_hash: state.images[key],
            call_to_action: { type: c.cta || spec.cta || 'SHOP_NOW', value: { link: spec.link } },
          },
        },
        degrees_of_freedom_spec: { creative_features_spec: features },
        contextual_multi_ads: { enroll_status: 'OPT_OUT' },
        ...(spec.url_tags ? { url_tags: spec.url_tags } : {}),
      }));
      state.creatives[key] = d.id; save();
      log(`creative ${i + 1}: ${d.id}`);
    }
    for (const [a, adsetId] of state.adsets.entries()) {
      const adKey = `${a}:${key}`;
      if (!layout[a].includes(i) || state.ads[adKey]) continue;
      const d = await must(`ad ${a + 1}.${i + 1}`, await g.post(`${act}/ads`, {
        name: `${spec.name} #${a + 1} c${i + 1}`,
        adset_id: adsetId,
        creative: { creative_id: state.creatives[key] },
        status: 'PAUSED',
      }));
      state.ads[adKey] = d.id; save();
    }
    log(`creative ${i + 1}: ads in ${layout.filter((l) => l.includes(i)).length} adsets`);
  }
  return state;
}
