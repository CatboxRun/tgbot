import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { config } from './config.js';
import { ocrMany, ocrImage } from './ocr.js';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-500) || `exit ${code}`));
    });
  });
}

export async function extractFrames(videoPath, outDir, { count = 6 } = {}) {
  await fs.ensureDir(outDir);
  const pattern = path.join(outDir, 'frame_%03d.jpg');
  // 均匀抽样：约每秒最多取一帧，总量约 count
  const fps = Math.max(0.2, count / 30);
  await run(ffmpegPath || 'ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-vf',
    `fps=${fps}`,
    '-frames:v',
    String(count),
    '-q:v',
    '3',
    pattern,
  ]);
  const files = (await fs.readdir(outDir))
    .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
    .map((f) => path.join(outDir, f))
    .sort();
  return files;
}

export async function recognizeVideoText(videoPath, thumbPath) {
  const work = path.join(config.tmpDir, `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  await fs.ensureDir(work);
  try {
    let frames = [];
    try {
      frames = await extractFrames(videoPath, work, { count: 8 });
    } catch (e) {
      console.warn('抽帧失败，回退缩略图:', e.message);
    }
    if (thumbPath && (await fs.pathExists(thumbPath))) {
      frames.unshift(thumbPath);
    }
    if (!frames.length) {
      return '';
    }
    const existing = [];
    for (const f of frames) {
      if (await fs.pathExists(f)) existing.push(f);
    }
    if (!existing.length) return '';
    return ocrMany(existing);
  } finally {
    await fs.remove(work).catch(() => {});
  }
}

export async function recognizeImageText(imagePath) {
  return ocrImage(imagePath);
}
