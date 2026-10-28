#!/usr/bin/env node
// Usage: ws_find.js <serial_number> [--start]
// Resolves the profile's debug port by serial_number (never guess the port),
// finds the extension offscreen page and writes its WS URL to fb/ws_<serial>.txt.
import path from 'node:path';
import { activeBrowser, startBrowser } from './lib/adspower.js';
import { FB_DIR, die, writeSecret } from './lib/common.js';

const serial = process.argv[2];
if (!serial) die('usage: ws_find.js <serial_number> [--start]');

let info = await activeBrowser(serial).catch((e) => die(e.message));
if (info.status !== 'Active') {
  if (!process.argv.includes('--start')) die(`profile ${serial} is not open; open it in AdsPower or pass --start`);
  info = await startBrowser(serial).catch((e) => die(e.message));
}
const port = info.debug_port;
if (!port) die(`no debug_port for profile ${serial}`);

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const off = targets.find((t) => (t.url || '').includes('offscreen'));
if (!off) {
  const kinds = [...new Set(targets.map((t) => `${t.type}:${(t.url || '').split('/')[2] || t.url}`))];
  die(`profile ${serial}: no offscreen page. Targets: ${kinds.join(', ')}`);
}
const file = path.join(FB_DIR, `ws_${serial}.txt`);
writeSecret(file, off.webSocketDebuggerUrl);
console.log(`profile ${serial}: port ${port}, offscreen ${off.url.split('/')[2]} → ${file}`);
