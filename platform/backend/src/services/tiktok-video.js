import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { nanoid } from 'nanoid';
import os from 'os';

async function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = protocol.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadImage(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    });
    req.on('error', (e) => { try { fs.unlinkSync(dest); } catch { /* */ } reject(e); });
    file.on('error', (e) => { try { fs.unlinkSync(dest); } catch { /* */ } reject(e); });
  });
}

function getFfmpegBin() {
  try {
    const require = createRequire(import.meta.url);
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer?.path && fs.existsSync(installer.path)) return installer.path;
  } catch { /* not installed */ }
  for (const cmd of ['which', 'where']) {
    try {
      const res = spawnSync(cmd, ['ffmpeg'], { encoding: 'utf8', timeout: 3000 });
      const bin = res.stdout?.split('\n')[0]?.trim();
      if (bin && fs.existsSync(bin)) return bin;
    } catch { /* */ }
  }
  return null;
}

export async function generateTikTokVideo(images, title, outputDir) {
  const ffmpegBin = getFfmpegBin();
  if (!ffmpegBin) return null;

  const imgUrls = (images || []).filter(Boolean).slice(0, 6);
  if (!imgUrls.length) return null;

  const tmpDir = path.join(os.tmpdir(), `tiktok-${nanoid(10)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const imgPaths = [];
    for (let i = 0; i < imgUrls.length; i++) {
      const ext = imgUrls[i].match(/\.(jpe?g|png|webp)/i)?.[1] || 'jpg';
      const dest = path.join(tmpDir, `img${i}.${ext}`);
      try {
        await downloadImage(imgUrls[i], dest);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) imgPaths.push(dest);
      } catch { /* skip */ }
    }
    if (!imgPaths.length) return null;

    // concat demuxer file: each image shown 2.5s
    const concatFile = path.join(tmpDir, 'concat.txt');
    const last = imgPaths[imgPaths.length - 1];
    const lines = imgPaths.map(p => `file '${p}'\nduration 2.5`).join('\n') + `\nfile '${last}'`;
    fs.writeFileSync(concatFile, lines);

    const outId = nanoid(16);
    fs.mkdirSync(outputDir, { recursive: true });
    const outPath = path.join(outputDir, `${outId}.mp4`);

    const safeTitle = (title || '').replace(/['":\\]/g, ' ').slice(0, 60);
    const dtFilter = safeTitle
      ? `,drawtext=text='${safeTitle}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=h-110:box=1:boxcolor=black@0.55:boxborderw=8`
      : '';
    const vf = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black${dtFilter}`;

    const args = [
      '-y',
      '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      outPath,
    ];

    const result = spawnSync(ffmpegBin, args, { timeout: 120000, encoding: 'utf8' });
    if (result.status !== 0 || !fs.existsSync(outPath)) {
      console.error('[tiktok-video] ffmpeg failed:', result.stderr?.slice(-500));
      return null;
    }

    const publicUrl = process.env.PUBLIC_URL || 'https://nespizdili.lol';
    return {
      path: outPath,
      url: `${publicUrl}/uploads/tiktok-videos/${outId}.mp4`,
    };
  } catch (e) {
    console.error('[tiktok-video] error:', e);
    return null;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  }
}
