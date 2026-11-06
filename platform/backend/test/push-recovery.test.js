import test from 'node:test';
import assert from 'node:assert/strict';

import { createCampaignIdempotent, isAliasTaken, lastLoggedAlias } from '../src/services/push.js';

const aliasErr = () => new Error('Keitaro 422: {"alias":["Alias is already used"]}');



test('isAliasTaken recognises only alias collisions', () => {
  assert.equal(isAliasTaken(aliasErr()), true);
  assert.equal(isAliasTaken(new Error('Keitaro 500: alias')), false);
  assert.equal(isAliasTaken(new Error('Keitaro 422: domain_id invalid')), false);
});

test('lastLoggedAlias takes the newest keitaro_creating entry', () => {
  assert.equal(lastLoggedAlias(null), null);
  assert.equal(lastLoggedAlias([{ step: 'keitaro_creating', alias: 'a' }, { step: 'x' }, { step: 'keitaro_creating', alias: 'b' }]), 'b');
});

test('alias collision is retried with a new alias', async () => {
  const seen = [];
  const kt = { createCampaign: async (d) => { seen.push(d.alias); if (seen.length < 3) throw aliasErr(); return { id: 7, alias: d.alias }; } };
  const logged = [];
  const r = await createCampaignIdempotent(kt, { name: 'n' }, 'Good Product', null, async a => { logged.push(a); });
  assert.equal(r.campaign.id, 7);
  assert.equal(new Set(seen).size, 3);
  assert.deepEqual(logged, seen);
});

test('other Keitaro errors and exhausted attempts are thrown', async () => {
  const bad = { createCampaign: async () => { throw new Error('Keitaro 500: boom'); } };
  await assert.rejects(createCampaignIdempotent(bad, {}, 'x', null), /500/);
  let n = 0;
  const always = { createCampaign: async () => { n++; throw aliasErr(); } };
  await assert.rejects(createCampaignIdempotent(always, {}, 'x', null, undefined, 3), /already used/);
  assert.equal(n, 3);
});

test('rerun adopts the campaign created by the interrupted attempt', async () => {
  const kt = {
    allCampaigns: async () => [{ id: 1, alias: 'other' }, { id: 42, alias: 'prev-alias' }],
    createCampaign: async () => { throw new Error('must not create a second campaign'); },
  };
  const r = await createCampaignIdempotent(kt, {}, 'x', 'prev-alias');
  assert.equal(r.adopted, true);
  assert.equal(r.campaign.id, 42);
});

test('rerun with a logged alias that never reached Keitaro reuses that alias', async () => {
  let used;
  const kt = { allCampaigns: async () => [], createCampaign: async (d) => { used = d.alias; return { id: 5, alias: d.alias }; } };
  await createCampaignIdempotent(kt, {}, 'x', 'prev-alias');
  assert.equal(used, 'prev-alias');
});
