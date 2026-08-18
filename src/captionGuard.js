/**
 * OCR 清洗 + 配文质量校验
 */

const GARBAGE_WORDS = /产儿|一毒|引通|给过|有人看轴/i;
const TEMPLATE_PHRASES = /说人话的那种|值得一看|持续在做合规隐私这条线/i;
const BROCHURE_PHRASES =
  /环签名|零知识证明|Stealth Address|Dandelion\+\+|日收益|日利率|APY|托管周期|最低存入|50\s*USDT|刚性兑付|认购|合伙人节点|1180\s*个/i;
const GARBAGE_INTERPRETATION =
  /个字[，,].*一场局|有人在拆墙|有人在织网|三个字.*一场局|两个字.*一场局/i;

/** 假细节堆砌（允许现场感，禁止眼睛脚步连用） */
const FAKE_SCENE =
  /有眼神|有脚步|讨论声|活动还在继续|实实在在的推进|有人在讨论|市场热气腾腾|冷的是账户|这届玩家|人群里有/i;

/** 炒币/理财腔 */
const TRADING_DEGEN =
  /all in|抄底|牛市|熊市|资产交给|人生交给运气|账户|翻车|私房钱|狂欢|焦虑|藏钱|躲亏|带单|韭菜|梭哈/i;

/** 通篇共识灌水（单出现「梦想同频」在团队稿里允许） */
const CONSENSUS_SPAM = /共识，|把共识|共识在|共识不是|真正的共识|共识升温|共识积累/g;

const BAD_CAPTION_PATTERNS = [
  GARBAGE_WORDS,
  TEMPLATE_PHRASES,
  BROCHURE_PHRASES,
  GARBAGE_INTERPRETATION,
  FAKE_SCENE,
  TRADING_DEGEN,
  CONSENSUS_SPAM,
];

function splitSegments(line) {
  return String(line)
    .split(/[，,、\s|｜\-—·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cjkLen(text) {
  return (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
}

export function isFragmentGarbageOcr(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;

  const compact = raw.replace(/\s+/g, '');
  if (cjkLen(compact) < 8) return true;

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hasRealPhrase = lines.some((line) => {
    if (cjkLen(line) >= 10) return true;
    if (splitSegments(line).some((s) => cjkLen(s) >= 6)) return true;
    return /(市场|团队|社群|隐私|无介|Liminal|杭州|郑州|广州|深圳)/i.test(line);
  });
  if (!hasRealPhrase) return true;

  const allSegs = lines.flatMap(splitSegments);
  const shortSegs = allSegs.filter((s) => cjkLen(s) <= 2);
  if (shortSegs.length >= 2 && shortSegs.length / allSegs.length >= 0.5) return true;

  return false;
}

function isReadableOcrLine(line) {
  const t = line.replace(/\s+/g, '').trim();
  if (t.length < 8 || t.length > 80) return false;
  if (GARBAGE_WORDS.test(t)) return false;
  if (cjkLen(t) / t.length < 0.55) return false;
  const segs = splitSegments(line);
  if (segs.length >= 2 && segs.every((s) => cjkLen(s) <= 3)) return false;
  return true;
}

export function sanitizeOcrForCaption(raw) {
  if (!raw) return { clean: '', usable: false, lines: [] };
  const lines = String(raw)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const good = lines.filter(isReadableOcrLine);
  const clean = good.join('\n').trim();
  return {
    clean,
    usable: clean.length >= 8 && !isFragmentGarbageOcr(clean),
    lines: good,
  };
}

/** 项目名纠错：无界 → 无介（禁止写成无界） */
export function fixBrandName(text) {
  if (!text) return '';
  return String(text)
    .replace(/无界/g, '无介')
    .replace(/#无界/g, '#无介');
}

export function isBadCaption(text) {
  if (!text || text.length < 15) return true;
  const fixed = fixBrandName(text);
  if (!/Liminal|无介|liminal/i.test(fixed)) return true;
  // 仍含「无界」视为不合格（纠错后不应再有）
  if (/无界/.test(fixed)) return true;
  const body = fixed.replace(/#[^\s#]+/g, ' ').trim();
  for (const re of BAD_CAPTION_PATTERNS) {
    if (re.test(body)) return true;
  }
  return false;
}
