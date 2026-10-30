// Prints a short-lived pass cookie ("gate_<door>=…") for the deploy checks, so they can open closed pages
// without knowing the PINs: cd /opt/affiliate/backend && node src/gate-pass.js bl
import 'dotenv/config';
import { DOORS, makePass } from './services/gate.js';

const door = process.argv[2];
const secret = process.env.GATE_SECRET || '';
if (!Object.hasOwn(DOORS, door) || secret.length < 32) {
  console.error('usage: node src/gate-pass.js bl|bd|ul|ud (GATE_SECRET must be set)');
  process.exit(1);
}
// Ten minutes, whatever the door's normal lifetime.
const p = makePass(secret, door, Date.now() - (DOORS[door].ttl - 600) * 1000);
console.log(`${p.name}=${p.value}`);
