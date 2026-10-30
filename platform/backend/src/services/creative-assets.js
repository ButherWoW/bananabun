import fs from 'node:fs/promises';
import path from 'node:path';
import { safeDownload } from './safe-fetch.js';

const LIMIT = 12 * 1024 * 1024;
export function rasterType(bytes) {
  if (!bytes?.length || bytes.length > LIMIT) throw Object.assign(new Error('Нужна картинка до 12 МБ'), { statusCode: 400 });
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'webp';
  throw Object.assign(new Error('Поддерживаются настоящие JPG, PNG и WEBP'), { statusCode: 400 });
}

export async function localImageData(url) {
  if (!url) return null;
  let bytes;
  if (typeof url !== 'string' || !/^\/uploads\/(?:[A-Za-z0-9_-]+\/)?[A-Za-z0-9_.-]+\.(jpe?g|png|webp)$/i.test(url)) {
    throw Object.assign(new Error('Сначала загрузите фото или логотип в свою платформу'), { statusCode: 400 });
  }
  const root = await fs.realpath(process.env.UPLOADS_DIR || './uploads');
  let resolved;
  try { resolved = await fs.realpath(path.resolve(root,url.slice('/uploads/'.length))); }
  catch { throw Object.assign(new Error('Файл изображения не найден — загрузите его заново'), { statusCode: 400 }); }
  if (!resolved.startsWith(root + path.sep)) throw Object.assign(new Error('Недопустимый путь изображения'), { statusCode: 400 });
  if ((await fs.stat(resolved)).size > LIMIT) throw Object.assign(new Error('Нужна картинка до 12 МБ'), { statusCode: 400 });
  bytes = await fs.readFile(resolved);
  return `data:image/${rasterType(bytes)};base64,${bytes.toString('base64')}`;
}

// Product photo bytes for anything we package (landings): own files from disk, remote ones through the
// SSRF-safe loader, and only real raster images either way.
export async function productImageBytes(src) {
  if (typeof src !== 'string' || !src) return null;
  let bytes;
  if (src.startsWith('/uploads/')) {
    const data = await localImageData(src);
    bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
  } else if (/^https?:\/\//i.test(src)) {
    bytes = (await safeDownload(src, { maxBytes: LIMIT })).body;
  } else {
    return null;
  }
  rasterType(bytes);
  return bytes;
}
