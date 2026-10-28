#!/usr/bin/env node
// Usage: WS_FILE=… TOKEN_FILE=… fb_check_profile.js [out.json]
// Read-only: token owner, ad accounts (status, money, payment), pages, pixels.
import { Graph, isOk } from './lib/cdp.js';
import { die, sleep, writeJson } from './lib/common.js';

const STATUS = { 1: 'active', 2: 'disabled', 3: 'unsettled', 7: 'pending_review', 9: 'grace_period', 100: 'pending_closure', 101: 'closed' };
const PAY = { 1: 'card', 4: 'prepaid' };
const cents = (v) => (v == null || v === '' ? null : Number(v) / 100);

const g = await new Graph().open();
const out = {};
try {
  const me = await g.get('me', { fields: 'id,name' });
  if (me.fatal) die(me.fatal, 2);
  if (!isOk(me)) die(`me: status ${me.status} ${me.data?.error?.message ?? ''}`);
  out.user = me.data;

  const acc = await g.get('me/adaccounts', {
    fields: 'id,name,account_status,disable_reason,currency,timezone_name,spend_cap,amount_spent,balance,adtrust_dsl,funding_source_details,business{id,name}',
    limit: '200',
  });
  out.ad_accounts = (acc.data?.data || []).map((a) => ({
    id: a.id,
    name: a.name,
    status: STATUS[a.account_status] || a.account_status,
    disable_reason: a.disable_reason || 0,
    currency: a.currency,
    timezone: a.timezone_name,
    payment: PAY[a.funding_source_details?.type] || (a.funding_source_details ? String(a.funding_source_details.type) : 'none'),
    remaining: a.spend_cap && Number(a.spend_cap) > 0 ? cents(a.spend_cap) - cents(a.amount_spent) : null,
    daily_limit: a.adtrust_dsl ?? null,
    business: a.business?.name || '',
  }));

  const pages = await g.get('me/accounts', { fields: 'id,name', limit: '200' });
  out.pages = (pages.data?.data || []).map((p) => ({ id: p.id, name: p.name }));

  out.pixels = [];
  for (const a of out.ad_accounts.filter((x) => x.status === 'active')) {
    await sleep(250);
    const px = await g.get(`${a.id}/adspixels`, { fields: 'id,name,last_fired_time', limit: '50' });
    for (const p of px.data?.data || []) out.pixels.push({ account: a.id, id: p.id, name: p.name, last_fired: p.last_fired_time || '' });
  }
} finally { g.close(); }

console.log(`token owner: ${out.user.name} (${out.user.id})`);
console.log('\nAd accounts:'); console.table(out.ad_accounts);
console.log('Pages:'); console.table(out.pages);
console.log('Pixels:'); console.table(out.pixels);
if (process.argv[2]) writeJson(process.argv[2], out);
