import fs from 'fs-extra';
import path from 'path';
import { config } from './config.js';
import { generatePrivacyDigest } from './ai.js';

const CRYPTO_PRIVACY_RE =
  /zk[\s-]?snark|zk[\s-]?stark|zk[\s-]?evm|zero[\s-]?knowledge|mixer|tornado|railgun|aztec|namada|penumbra|firo|monero|zcash|\bbeam\b|\bgrin\b|secret network|oasis network|\baleo\b|midnight|fhe|tfhe|homomorphic|shielded|stealth ?address|privacy coin|confidential transaction|混币|零知识|隐私币|隐私池|机密交易|匿名币/i;

const CRYPTO_RE =
  /crypto|bitcoin|btc\b|ethereum|eth\b|blockchain|defi|web3|token|wallet|exchange|stablecoin|nft|layer\s?2|\bl2\b|on-?chain|binance|coinbase|okx|加密|区块链|比特币|以太坊|交易所|钱包|稳定币|链上|代币|合约/i;

const PRIVACY_RE =
  /privacy|private|zk|zero[\s-]?knowledge|confidential|anonymi|mixer|tornado|monero|zcash|tor\b|fhe|tee\b|homomorphic|shielded|暗网|隐私|零知识|混币|匿名|机密计算|可验证|数据主权/i;

/** 通用生活隐私（房产地址、普通 cookie 等）——仅作弱补充，不优先 */
const GENERIC_ONLY_RE =
  /cookie|property|real estate|surveillance camera|facial recognition|人脸|房产|住址|社交网络|社交媒体|iphone|android|广告追踪/i;

const FEEDS = [
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { name: 'The Block', url: 'https://www.theblock.co/rss.xml' },
  { name: 'Tor Blog', url: 'https://blog.torproject.org/rss.xml' },
];

function scoreCryptoPrivacy(blob) {
  const text = String(blob || '');
  const cryptoPrivacy = CRYPTO_PRIVACY_RE.test(text);
  const crypto = CRYPTO_RE.test(text);
  const privacy = PRIVACY_RE.test(text);
  const genericOnly = GENERIC_ONLY_RE.test(text) && !crypto && !cryptoPrivacy;

  // 强相关：ZK / 混币 / 隐私币 / FHE 等
  if (cryptoPrivacy) return { hit: true, tier: 3, score: 100 };
  // 加密语境下的隐私/匿名/数据权限
  if (crypto && privacy) return { hit: true, tier: 2, score: 80 };
  // 加密监管/合规，可能影响隐私叙事
  if (crypto && /regulat|compliance|ofac|sanction|sec\b|cftc|mica|合规|监管|制裁|牌照/i.test(text)) {
    return { hit: true, tier: 1, score: 45 };
  }
  // 纯生活隐私：降权，默认不当主菜
  if (privacy && !crypto) return { hit: false, tier: 0, score: genericOnly ? 5 : 15 };
  return { hit: false, tier: 0, score: 0 };
}

function dayKeyBj(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function bjParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return {
    day: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function stripTags(html = '') {
  return String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block, tag) {
  const m =
    block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')) ||
    block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? stripTags(m[1]) : '';
}

function linkOf(block) {
  const atom = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (atom) return atom[1].trim();
  const rss = tagText(block, 'link');
  if (rss) return rss;
  const guid = tagText(block, 'guid');
  if (/^https?:\/\//i.test(guid)) return guid;
  return '';
}

function parseFeed(xml, source) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  const items = [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    if (!title) continue;
    const snippet = tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content');
    items.push({
      source,
      title,
      snippet: snippet.slice(0, 220),
      link: linkOf(block),
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'LiminalCNBot/1.0 (+https://t.me/Liminal_CNbot)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) throw new Error(`${feed.name} HTTP ${res.status}`);
    const xml = await res.text();
    return parseFeed(xml, feed.name);
  } finally {
    clearTimeout(timer);
  }
}

function softTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
    .slice(0, 56);
}

/** 规范化单条资讯指纹：优先链接，其次压缩标题 */
export function itemFingerprint(it = {}) {
  const link = String(it.link || '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (/^https?:\/\//.test(link)) return `u:${link}`;
  const title = softTitleKey(it.title || '');
  return title ? `t:${title}` : '';
}

/** 从已发正文里提取 ①主体｜标题 作为补充去重键 */
export function extractHeadlineFingerprints(text) {
  const out = [];
  const re = /[①②③④]\s*([^\n｜|]+)[｜|]([^\n]+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const title = `${m[1].trim()}｜${m[2].trim()}`;
    const key = softTitleKey(title);
    if (key) out.push({ key: `t:${key}`, title });
  }
  // 去重
  const map = new Map();
  for (const row of out) map.set(row.key, row);
  return [...map.values()];
}

function defaultState() {
  return {
    lastRunDay: null,
    draft: null,
    /** @type {{ key: string, title?: string, day?: string, at: string }[]} */
    published: [],
    updatedAt: new Date().toISOString(),
  };
}

export function loadDigestState() {
  try {
    if (!fs.existsSync(config.digestFile)) return defaultState();
    const raw = fs.readJsonSync(config.digestFile);
    return {
      ...defaultState(),
      ...raw,
      published: Array.isArray(raw.published) ? raw.published : [],
    };
  } catch (e) {
    console.warn('loadDigestState failed:', e.message);
    return defaultState();
  }
}

function saveDigestState(state) {
  fs.ensureDirSync(path.dirname(config.digestFile));
  state.updatedAt = new Date().toISOString();
  fs.writeJsonSync(config.digestFile, state, { spaces: 2 });
}

function prunePublished(list) {
  const cutoff = Date.now() - 90 * 86400000;
  const cleaned = (list || []).filter((x) => {
    if (!x?.key) return false;
    const t = Date.parse(x.at || '');
    return !Number.isFinite(t) || t >= cutoff;
  });
  const map = new Map();
  for (const row of cleaned) map.set(row.key, row);
  return [...map.values()]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 400);
}

export function getPublishedKeySet() {
  return new Set(prunePublished(loadDigestState().published).map((x) => x.key));
}

export function listRecentPublishedTitles(limit = 20) {
  return prunePublished(loadDigestState().published)
    .filter((x) => x.title)
    .slice(0, limit)
    .map((x) => x.title);
}

/** 发布成功后写入去重库（素材指纹 + 正文标题） */
export function markDigestPublished(draft) {
  if (!draft) return;
  const state = loadDigestState();
  const now = new Date().toISOString();
  const day = draft.day || dayKeyBj();
  const rows = [];

  for (const it of draft.items || []) {
    const key = it.key || itemFingerprint(it);
    if (!key) continue;
    rows.push({ key, title: it.title || '', day, at: now });
  }
  for (const row of extractHeadlineFingerprints(draft.text || '')) {
    rows.push({ key: row.key, title: row.title || '', day, at: now });
  }

  state.published = prunePublished([...(state.published || []), ...rows]);
  state.draft = null;
  saveDigestState(state);
}

export function getDigestDraft() {
  return loadDigestState().draft || null;
}

export function setDigestDraft(draft) {
  const state = loadDigestState();
  state.draft = draft;
  saveDigestState(state);
  return draft;
}

export function clearDigestDraft() {
  const state = loadDigestState();
  state.draft = null;
  saveDigestState(state);
}

export function markDigestRunToday() {
  const state = loadDigestState();
  state.lastRunDay = dayKeyBj();
  saveDigestState(state);
}

export function alreadyRanToday() {
  return loadDigestState().lastRunDay === dayKeyBj();
}

export function shouldRunDigestNow() {
  if (!config.digestEnabled) return false;
  if (alreadyRanToday()) return false;
  const { hour, minute } = bjParts();
  const h = Number.isFinite(config.digestHourBj) ? config.digestHourBj : 9;
  const m = Number.isFinite(config.digestMinuteBj) ? config.digestMinuteBj : 0;
  return hour === h && minute === m;
}

function isUsedItem(it, publishedKeys) {
  const key = itemFingerprint(it);
  if (key && publishedKeys.has(key)) return true;
  const soft = softTitleKey(it.title || '');
  if (soft && publishedKeys.has(`t:${soft}`)) return true;
  return false;
}

export async function collectPrivacyItems({ max = 10 } = {}) {
  const publishedKeys = getPublishedKeySet();
  const all = [];
  const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
    else console.warn('digest feed failed:', r.reason?.message || r.reason);
  }

  const scored = [];
  const seen = new Set();
  let skipped = 0;
  for (const it of all) {
    const dedupe = (it.title || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (!dedupe || seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (isUsedItem(it, publishedKeys)) {
      skipped += 1;
      continue;
    }
    const blob = `${it.title} ${it.snippet}`;
    const ranked = scoreCryptoPrivacy(blob);
    scored.push({
      ...it,
      hit: ranked.hit,
      tier: ranked.tier,
      score: ranked.score,
      key: itemFingerprint(it),
    });
  }

  scored.sort((a, b) => b.score - a.score || Number(b.hit) - Number(a.hit));
  const strong = scored.filter((x) => x.score >= 45);
  const picked = (strong.length >= 3 ? strong : scored.filter((x) => x.score > 0)).slice(0, max);
  console.log(
    `digest collect: raw=${all.length} fresh=${scored.length} picked=${picked.length} strong=${strong.length} skippedPublished=${skipped} publishedKeys=${publishedKeys.size}`,
  );
  return picked;
}

/** 抓资讯 + 生成文案，写入待审草稿（不直接发群） */
export async function buildDigestDraft({ force = false } = {}) {
  if (!force && alreadyRanToday() && getDigestDraft()) {
    return { ok: true, reused: true, draft: getDigestDraft() };
  }

  const items = await collectPrivacyItems({ max: 12 });
  const avoidTitles = listRecentPublishedTitles(24);
  console.log(
    `digest materials: ${items.length} items, cryptoPrivacyHits=${items.filter((x) => x.hit).length}, avoid=${avoidTitles.length}`,
  );

  let text = '';
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      text = String(
        (await generatePrivacyDigest(items, {
          dateLabel: dayKeyBj(),
          avoidTitles,
        })) || '',
      ).trim();
      if (text) break;
      console.warn(`digest AI empty on attempt ${attempt}`);
    } catch (e) {
      lastErr = e;
      console.warn(`digest AI failed attempt ${attempt}:`, e.message);
    }
  }

  if (!text) {
    text = fallbackDigestFromItems(items, dayKeyBj());
    console.warn('digest used local fallback template');
  }
  if (!text) {
    throw lastErr || new Error('日报生成失败：资讯与模型均无可用内容');
  }

  const draft = {
    text,
    createdAt: new Date().toISOString(),
    day: dayKeyBj(),
    sourceCount: items.length,
    privacyHits: items.filter((x) => x.hit).length,
    items: items.map((it) => ({
      key: it.key || itemFingerprint(it),
      title: it.title || '',
      link: it.link || '',
      source: it.source || '',
      hit: !!it.hit,
    })),
  };
  setDigestDraft(draft);
  markDigestRunToday();
  return { ok: true, reused: false, draft, items };
}

function fallbackDigestFromItems(items, day) {
  const marks = ['①', '②', '③', '④'];
  const picked = (items || []).filter((x) => x.hit).slice(0, 4);
  const use = picked.length ? picked : (items || []).slice(0, 4);

  if (!use.length) {
    return [
      `🗞 隐私赛道观察 · ${day}`,
      '',
      '① 赛道｜今日加密隐私新资讯有限',
      '公开源里近期条目多已覆盖，或强相关加密隐私新闻较少。暂以趋势观察代替硬凑。',
      '',
      '② 趋势｜ZK 与合规边界并行',
      '零知识、隐私池与监管披露要求仍在拉扯：既要可审计，也要保住链上不该裸奔的部分。',
      '',
      '——————',
      '💡 无介视角',
      '在合规框架下把加密隐私做成日常可用体验，而不是口号。链上透明不等于生活透明。',
      '',
      '#无介 #Liminal #加密隐私',
    ].join('\n');
  }

  const lines = [`🗞 隐私赛道观察 · ${day}`, ''];
  use.forEach((it, i) => {
    const title = (it.title || '').trim().slice(0, 36);
    const src = (it.source || '来源').slice(0, 16);
    lines.push(`${marks[i] || `${i + 1}.`} ${src}｜${title}`);
    lines.push('公开资讯摘要如上，细节以原报道为准。');
    lines.push('');
  });
  lines.push('——————');
  lines.push('💡 无介视角');
  lines.push('加密世界里，透明账本不等于生活透明；合规边界内保住该私密的部分，才是可持续的隐私体验。');
  lines.push('无介关注把链上隐私做成日常可用，而不是一次性的概念演示。');
  lines.push('');
  lines.push('#无介 #Liminal #加密隐私');
  return lines.join('\n');
}
