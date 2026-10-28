import { db } from '../db/client.js';

// Only fields that are safe to keep: AdsPower remarks carry passwords, FB tokens and proxies.
export function safeProfile(p) {
  return {
    user_id: String(p.user_id || ''),
    serial_number: String(p.serial_number || ''),
    name: String(p.name || '').slice(0, 200),
    group_id: String(p.group_id || ''),
    group_name: String(p.group_name || '').slice(0, 200),
    ip_country: String(p.ip_country || p.country || '').slice(0, 10),
    email: typeof p.email === 'string' && p.email.includes('@') ? p.email.slice(0, 200) : '',
  };
}

export async function upsertProfiles(ws, profiles) {
  let synced = 0;
  for (const raw of profiles) {
    const p = safeProfile(raw);
    if (!p.user_id) continue;
    const profileId = `ap_${ws}_${p.user_id}`;
    await db.query(`
      INSERT INTO ap_profiles (id, workspace_id, serial_number, name, group_id, group_name, ip_country, raw, last_synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (id) DO UPDATE SET
        serial_number=$3, name=$4, group_id=$5, group_name=$6, ip_country=$7, raw=$8, last_synced_at=NOW(), updated_at=NOW()
    `, [profileId, ws, p.serial_number, p.name, p.group_id, p.group_name, p.ip_country,
        JSON.stringify({ user_id: p.user_id, serial_number: p.serial_number })]);

    const accId = `fbacc_${ws}_${p.user_id}`;
    const name = p.name || (p.email ? p.email.split('@')[0] : `#${p.serial_number}`);
    await db.query(`
      INSERT INTO fb_accounts (id, workspace_id, ap_profile_id, name, email, status, geo)
      VALUES ($1,$2,$3,$4,$5,'active',$6)
      ON CONFLICT (id) DO UPDATE SET ap_profile_id=$3, name=$4, email=COALESCE(NULLIF($5,''), fb_accounts.email), geo=$6
    `, [accId, ws, profileId, name, p.email, p.ip_country ? p.ip_country.toUpperCase() : null]);
    synced++;
  }
  return synced;
}
