#!/usr/bin/env node
// Usage: adspower_profiles.js [filter]   — lists profiles without secrets.
import { listProfiles } from './lib/adspower.js';
import { die } from './lib/common.js';

const filter = (process.argv[2] || '').toLowerCase();
try {
  const all = await listProfiles();
  const rows = all.filter((p) => !filter || JSON.stringify(p).toLowerCase().includes(filter));
  console.table(rows);
  console.log(`${rows.length} of ${all.length} profiles`);
} catch (e) { die(e.message); }
