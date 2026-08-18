import { createWorker } from 'tesseract.js';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cachePath = path.join(ROOT, 'tmp', 'tess-cache');

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      // 系统 TESSDATA_PREFIX 在部分 Windows 环境会干扰 wasm 加载
      delete process.env.TESSDATA_PREFIX;

      const worker = await createWorker('chi_sim+eng', 1, {
        cachePath,
        logger: (m) => {
          if (m.status === 'recognizing text') return;
          if (m.status?.includes('loading') || m.status?.includes('failed')) {
            console.log('[ocr]', m.status, m.progress ?? '');
          }
        },
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function ocrImage(filePathOrBuffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(filePathOrBuffer);
  return (data.text || '').replace(/[ \t]+\n/g, '\n').trim();
}

export async function ocrMany(paths) {
  const chunks = [];
  for (const p of paths) {
    try {
      const text = await ocrImage(p);
      if (text) chunks.push(text);
    } catch (e) {
      console.warn('[ocr] frame failed:', e.message);
    }
  }
  return dedupeLines(chunks.join('\n'));
}

function dedupeLines(text) {
  const seen = new Set();
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.length < 2) continue;
    const key = t.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.join('\n');
}
