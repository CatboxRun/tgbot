import fs from 'fs-extra';
import path from 'path';
import { config } from './config.js';
import { PROJECT_BRIEF } from './projectBrief.js';
import { scrubNodesProduct } from './scrub.js';

function readIfExists(file, maxChars) {
  if (!fs.existsSync(file)) return '';
  let text = fs.readFileSync(file, 'utf8');
  text = scrubNodesProduct(text).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.slice(0, maxChars);
}

let cached = null;

export function getKnowledgeContext() {
  if (cached) return cached;
  const parts = [PROJECT_BRIEF];
  const files = [
    ['business-plan.txt', 14000],
    ['greenpaper.txt', 18000],
    ['faq.txt', 12000],
    ['whitepaper.txt', 8000],
  ];
  for (const [name, max] of files) {
    const body = readIfExists(path.join(config.knowledgeDir, name), max);
    if (body && body.length > 80) {
      parts.push(`\n【资料:${name}】\n${body}`);
    }
  }
  cached = parts.join('\n\n').slice(0, 52000);
  return cached;
}

/** 热更新知识（改完资料可调用） */
export function refreshKnowledge() {
  cached = null;
  return getKnowledgeContext();
}
