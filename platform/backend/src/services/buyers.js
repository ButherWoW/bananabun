import { db } from '../db/client.js';

// Share of a buyer's positive profit shown as «Байеру»; a loss pays nothing.
export const BUYER_SHARE_PCT = Number(process.env.BUYER_SHARE_PCT) > 0 ? Number(process.env.BUYER_SHARE_PCT) : 35;
export const buyerShare = (profit) => Math.round(Math.max(Number(profit) || 0, 0) * BUYER_SHARE_PCT) / 100;

// The tracker reports in one currency; Keitaro's API does not say which, so it is configured.
export const TRACKER_CURRENCY = (process.env.KEITARO_CURRENCY || 'USD').toUpperCase();

// FA-style names carry the buyer in the 3rd bracket: [hash][date][izya(723604)][…]; older ones: [Buyer] Product.
export function campaignBuyerTag(name = '') {
  const segs = [...(String(name).match(/^(\[[^\]]*\])+/)?.[0] || '').matchAll(/\[([^\]]*)\]/g)].map(m => m[1]);
  const raw = segs.length >= 6 ? segs[2] : segs[0];
  return (raw || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
}

const groupTag = (g) => String(g || '').replace(/^\[|\]$/g, '').trim().toLowerCase();

export const NO_BUYER = 'без метки';
export const userLabel = (u) => u.name || u.email?.split('@')[0] || '?';

// One rule for every buyer in analytics and the bot: the author of our push for the FB campaign (sub_id_2), then the
// nickname in the campaign name, then the Keitaro group; a nickname or group listed in a member's Keitaro tags is that
// member. Returns row → { userId, label }: userId is null when no member owns the row (label is then the bare tag).
// `fbIdsOf(row)` returns the FB campaign ids of a row (rows grouped by campaign may have many).
export async function buyerResolver(ws, rows, fbIdsOf = (r) => [r.sub_id_2]) {
  const ids = [...new Set(rows.flatMap(r => [...(fbIdsOf(r) || [])].map(String)).filter(id => /^\d+$/.test(id)))];
  const [{ rows: pushRows }, { rows: users }] = await Promise.all([
    ids.length ? db.query(
      `SELECT p.fb_campaign_id, u.id, u.name, u.email FROM pushes p JOIN users u ON u.id = p.created_by
        WHERE p.workspace_id = $1 AND p.fb_campaign_id = ANY($2)`, [ws, ids]) : { rows: [] },
    db.query('SELECT id, name, email, keitaro_tag FROM users WHERE workspace_id = $1', [ws]),
  ]);
  const byFb = new Map(pushRows.map(r => [String(r.fb_campaign_id), { userId: r.id, label: userLabel(r) }]));
  const byTag = new Map();
  for (const u of users) {
    for (const t of String(u.keitaro_tag || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) {
      if (!byTag.has(t)) byTag.set(t, { userId: u.id, label: userLabel(u) });
    }
  }
  return (r) => {
    for (const id of fbIdsOf(r) || []) { const n = byFb.get(String(id)); if (n) return n; }
    const tag = campaignBuyerTag(r.campaign);
    if (tag) return byTag.get(tag) || { userId: null, label: tag };
    const g = groupTag(r.campaign_group);
    if (g) return byTag.get(g) || { userId: null, label: g };
    return { userId: null, label: NO_BUYER };
  };
}

// The same rule as a label only (analytics shows labels).
export async function buyerNamer(ws, rows, fbIdsOf) {
  const who = await buyerResolver(ws, rows, fbIdsOf);
  return (r) => who(r).label;
}
