import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.join(os.homedir(), 'scripts');
export const FB_DIR = path.join(ROOT, 'fb');
export const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v21.0';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tokens must never reach stdout, logs or files outside fb/.
export function redact(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s
    .replace(/EAA[A-Za-z0-9]{20,}/g, 'EAA…[hidden]')
    .replace(/(access_token=)[^&"\s]+/g, '$1[hidden]');
}

export function die(msg, code = 1) {
  process.stderr.write(redact(msg) + '\n');
  process.exit(code);
}

export function readSecret(file, label) {
  if (!file) die(`${label} is not set`);
  let st;
  try { st = fs.statSync(file); } catch { die(`${label} not found: ${file}`); }
  if ((st.mode & 0o077) !== 0) die(`${label} must have permissions 600: ${file}`);
  return fs.readFileSync(file, 'utf8').trim();
}

export function writeSecret(file, content) {
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, data) {
  fs.writeFileSync(file, redact(JSON.stringify(data, null, 2)) + '\n');
}
