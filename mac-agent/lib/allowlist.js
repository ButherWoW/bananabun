import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './common.js';

// Profiles this agent may touch, by AdsPower serial number: AGENT_ALLOWED_SERIALS="7,8,12" or one
// per line / comma in ~/scripts/.allowed_profiles. Neither set → null → every profile (the Mac as before).
export const ALLOWED_FILE = path.join(ROOT, '.allowed_profiles');
export const NOT_ALLOWED = 'Профиль не разрешён на этом агенте';

export function parseSerials(text) {
  const list = String(text || '').split(/[\s,;]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  return list.length ? new Set(list) : null;
}

export function loadAllowed({ env = process.env, file = ALLOWED_FILE } = {}) {
  if (env.AGENT_ALLOWED_SERIALS && String(env.AGENT_ALLOWED_SERIALS).trim()) return parseSerials(env.AGENT_ALLOWED_SERIALS);
  try { return parseSerials(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export const isAllowedSerial = (allowed, serial) => !allowed || allowed.has(String(serial ?? ''));

export const filterProfiles = (allowed, profiles) => (allowed ? profiles.filter((p) => isAllowedSerial(allowed, p.serial_number)) : profiles);

// Throws unless the profile with this AdsPower user_id is allowed; `serialOf(uid)` looks it up.
export async function assertAllowedUser(allowed, uid, serialOf) {
  if (!allowed) return;
  const serial = await serialOf(uid);
  if (!serial || !allowed.has(String(serial))) throw new Error(NOT_ALLOWED);
}

export function assertAllowedSerial(allowed, serial) {
  if (!isAllowedSerial(allowed, serial)) throw new Error(NOT_ALLOWED);
}
