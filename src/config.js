import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v.trim();
}

function normalizeUser(u) {
  return String(u || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

export const config = {
  botToken: must('BOT_TOKEN'),
  deepseekApiKey: must('DEEPSEEK_API_KEY'),
  deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  ownerUsername: normalizeUser(process.env.OWNER_USERNAME || 'XLswSpider'),
  targetChat: process.env.TARGET_CHAT || '@Liminal_CN',
  seedAdmins: (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map(normalizeUser)
    .filter(Boolean),
  dataFile: path.join(ROOT, 'data', 'store.json'),
  eventsFile: path.join(ROOT, 'data', 'events.jsonl'),
  knowledgeDir: path.join(ROOT, 'knowledge'),
  tmpDir: path.join(ROOT, 'tmp'),
  welcomeBanner: path.join(ROOT, 'assets', 'welcome-banner.png'),
  digestCover: path.join(ROOT, 'assets', 'digest-cover.png'),
  digestFile: path.join(ROOT, 'data', 'digest.json'),
  /** 北京时间每日推送小时（0-23），可用 DIGEST_HOUR_BJ 覆盖 */
  digestHourBj: Number(process.env.DIGEST_HOUR_BJ || 9),
  digestMinuteBj: Number(process.env.DIGEST_MINUTE_BJ || 0),
  digestEnabled: String(process.env.DIGEST_ENABLED || '1') !== '0',
  /** LIM 行情播报 */
  limContract: (process.env.LIM_CONTRACT || '0x1d6430fdfc63ea481fe157017b47530663c96001').toLowerCase(),
  limPriceFile: path.join(ROOT, 'data', 'limPrice.json'),
  limPriceEnabled: String(process.env.LIM_PRICE_ENABLED || '1') !== '0',
  /** 北京时间整点播报，逗号分隔，默认 10,18,22 */
  limPriceHoursBj: (process.env.LIM_PRICE_HOURS_BJ || '10,18,22')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23),
  /** ATH 需超过前高百分比才播报 */
  limAthMinPct: Number(process.env.LIM_ATH_MIN_PCT || 0.3),
  /** 黑洞地址累计增加超过此值才播报销毁 */
  limBurnMinDelta: Number(process.env.LIM_BURN_MIN_DELTA || 1),
  limBurnSinks: (process.env.LIM_BURN_SINKS || '0x000000000000000000000000000000000000dead')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
};

export { normalizeUser };
