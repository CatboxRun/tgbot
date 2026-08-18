import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pdfPath = path.join(root, 'knowledge', 'faq.pdf');
const outPath = path.join(root, 'knowledge', 'faq.txt');

const buf = await fs.readFile(pdfPath);
const parser = new PDFParse({ data: buf });
const imgs = await parser.getImage();
console.log('FAQ image pages:', imgs.pages.length);

const langChi = ['c', 'h', 'i', '_', 's', 'i', 'm'].join('');
const worker = await createWorker([langChi, 'eng']);
const texts = [];

for (const page of imgs.pages) {
  const embedded = page.images?.[0];
  if (!embedded?.data) {
    console.log('skip page', page.pageNumber);
    continue;
  }
  const imgBuf = Buffer.from(embedded.data);
  const tmp = path.join(root, 'tmp', `faq_page_${page.pageNumber}.png`);
  await fs.ensureDir(path.dirname(tmp));
  await fs.writeFile(tmp, imgBuf);
  const {
    data: { text },
  } = await worker.recognize(tmp);
  console.log(`page ${page.pageNumber}: ${text.trim().length} chars`);
  texts.push(`--- FAQ page ${page.pageNumber} ---\n${text.trim()}`);
  await fs.remove(tmp).catch(() => {});
}

await worker.terminate();
await parser.destroy();
await fs.writeFile(outPath, texts.join('\n\n'), 'utf8');
console.log('Wrote', outPath, 'total chars', texts.join('\n\n').length);
