import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSerials, loadAllowed, filterProfiles, assertAllowedUser, assertAllowedSerial, NOT_ALLOWED } from '../lib/allowlist.js';

test('no list set → every profile, as on the Mac before', async () => {
  const allowed = loadAllowed({ env: {}, file: '/nonexistent/.allowed_profiles' });
  assert.equal(allowed, null);
  const list = [{ serial_number: '5' }, { serial_number: '7' }];
  assert.deepEqual(filterProfiles(allowed, list), list);
  await assertAllowedUser(allowed, 'k1', async () => '5');
  assertAllowedSerial(allowed, '5');
});

test('env list keeps only allowed profiles and refuses others', async () => {
  const allowed = loadAllowed({ env: { AGENT_ALLOWED_SERIALS: '8, 12;7' } });
  assert.deepEqual([...allowed].sort(), ['12', '7', '8']);
  assert.deepEqual(filterProfiles(allowed, [{ serial_number: '5' }, { serial_number: 8 }, { serial_number: '12' }]).map(p => String(p.serial_number)), ['8', '12']);
  await assertAllowedUser(allowed, 'k8', async () => '8');
  await assert.rejects(assertAllowedUser(allowed, 'k5', async () => '5'), { message: NOT_ALLOWED });
  await assert.rejects(assertAllowedUser(allowed, 'gone', async () => undefined), { message: NOT_ALLOWED });
  assert.throws(() => assertAllowedSerial(allowed, '5'), { message: NOT_ALLOWED });
});

test('file list is read when env is empty; junk is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allow-'));
  const file = path.join(dir, '.allowed_profiles');
  fs.writeFileSync(file, '8\n12\nabc\n');
  assert.deepEqual([...loadAllowed({ env: { AGENT_ALLOWED_SERIALS: '  ' }, file })].sort(), ['12', '8']);
  assert.equal(parseSerials('abc, x'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
