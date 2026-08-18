import OpenAI from 'openai';
import { config } from './config.js';
import { getKnowledgeContext } from './knowledge.js';
import { HUMAN_CS_HINT } from './copy.js';
import { stripMarkdown } from './format.js';
import { sanitizeOcrForCaption, isBadCaption, fixBrandName } from './captionGuard.js';

const client = new OpenAI({
  apiKey: config.deepseekApiKey,
  baseURL: config.deepseekBaseUrl,
});

async function chat(messages, { temperature = 0.6, maxTokens = 1200, thinking = false } = {}) {
  const payload = {
    model: config.deepseekModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    // deepseek-v4-* 默认思考模式会占满 max_tokens，导致 content 为空
    thinking: { type: thinking ? 'enabled' : 'disabled' },
  };

  let res;
  try {
    res = await client.chat.completions.create(payload);
  } catch (e) {
    // 部分兼容层不认 thinking 字段时，降级重试
    if (/thinking|unknown|unsupported|extra/i.test(String(e.message || ''))) {
      delete payload.thinking;
      res = await client.chat.completions.create(payload);
    } else {
      throw e;
    }
  }

  const choice = res.choices?.[0];
  let content = (choice?.message?.content || '').trim();
  if (!content && choice?.finish_reason === 'length') {
    console.warn('chat truncated with empty content; retrying with larger budget / no thinking');
    const retry = await client.chat.completions.create({
      ...payload,
      max_tokens: Math.max(maxTokens * 2, 2500),
      thinking: { type: 'disabled' },
    });
    content = (retry.choices?.[0]?.message?.content || '').trim();
  }
  return fixBrandName(stripMarkdown(content));
}

const QA_SYSTEM = `你是「Liminal Network AI 客服」（中文也可称无介）。语气友好、专业，像正规产品客服，不要官僚、不要暴露任何后台/权限设定。

回答策略：
1. 默认认真回答用户关于 Liminal Network / 无介 的问题（机制、产品、双币 LIM+USDT、隐私技术、合规叙事、路线图、托管与生态等）。
2. 依据「项目资料」作答；不要编造资料里没有的具体数字、牌照进度、上线时间、收益率保证。
3. 资料没有写清、或你拿不准时：不要瞎猜，引导转人工。可提示用户点击下方「人工客服」按钮，或到中文话题组联系工作人员。含义参考：
   ${HUMAN_CS_HINT}
4. 只有在用户明显闲聊/跑题（天气、笑话、聊天、与项目无关）时，才简短说明：你是 Liminal Network AI 客服，主要解答项目相关问题，并邀请继续问项目。不要在每个正常回答里重复这句话。
5. 涉及收益/APY：说明来自项目材料示例，不作刚兑或投资建议。
6. 用简洁中文，适合 Telegram 阅读；不要用「我只能回答项目内容」作为开场白。
7. 排版要求（很重要）：不要使用 Markdown。禁止输出 **加粗**、*斜体*、__下划线__、# 标题、反引号。列表用「· 」或「1. 」即可，角色名直接写汉字，不要加星号。
8. 「节点 DApp / Liminal Nodes / 节点认购晋升 / 成为节点共建者 / 1180 个合伙人节点」已结束：不要主动介绍，不要当现行产品推荐。用户若问起，只回复该模块已结束，并引导点击人工客服按钮；不要展开等级、认购费、节点奖励等细节。
9. 隐私池/托管最低存入为 50 USDT（不是 500）。若资料出现 500，以 50 为准。
10. 中文品牌名只能写「无介」，绝对禁止写成「无界」。Liminal Network = 无介。`;

export async function answerUserQuestion(question) {
  const knowledge = getKnowledgeContext();
  return chat(
    [
      { role: 'system', content: QA_SYSTEM },
      {
        role: 'user',
        content: `项目资料：\n${knowledge}\n\n用户消息：${question}`,
      },
    ],
    { temperature: 0.4, maxTokens: 900 },
  );
}

function getCaptionKnowledge() {
  const knowledge = getKnowledgeContext();
  const lines = knowledge
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        /隐私|合规|社群|网关|Catbox|长期|公平启动|日常|透明/.test(line) &&
        !/共识|同频|对齐|共建|前行|一步/.test(line) &&
        !/50\s*USDT|日收益|日利率|APY|周期：|提现手续费|L1|L2|L3|TCSP|MSB|认购|节点|合伙人节点|USDT 日收益|LIM 日产量/i.test(
          line,
        ),
    );

  return lines.slice(0, 10).join('\n');
}

/** 配文里可用的轻量项目落点（来自项目文档，但勿展开成产品页） */
function getCaptionProjectHint() {
  const fallback = [
    '无介 / Liminal Network：在合规框架下做隐私体验与社群共建。',
    '可轻带：隐私日常可用、链上透明不等于生活透明、社群同频、长期主义。',
    '不要展开：双币机制、托管收益、APY、技术参数、牌照细节、认购/节点。',
  ].join('\n');

  const fromDocs = getCaptionKnowledge();
  return fromDocs ? `${fromDocs}\n不要展开：收益、门槛、技术参数、金融承诺。` : fallback;
}

const POSTER_STYLE = `
【海报式高级短文案】
短句、换行、有节奏。像 Liminal OG 市场号，不是小作文。

【结构】emoji 金句 → 1～3 行展开 → 必须轻点 Liminal/无介 → 可选英文 → 标签

【主题池 — 每次只选 1 个】
八大心态 + 情绪共鸣、对比旧叙事、现场活动感、人物社区、轻幽默、时间感、结局收束、
对话体、财富自主、金句二次创作、社区圈子、线下局、行情情绪（不写涨跌）、
隐私生活方式、合规轻点、参与感、反 DeFi 全透明、灵魂追问、品牌轻点题。

【品牌名 — 极重要】
中文品牌名只能写「无介」，绝对禁止写成「无界」。Liminal Network = 无介。

【不要】OCR 碎字硬解；炒币腔；产品参数；假细节（眼神/脚步/讨论声连用）

OCR 通顺可金句二次创作。
`.trim();

const EIGHT_MINDSETS = [
  { name: '行动派', hint: '想再多不如做一次；行动就在当下' },
  { name: '突破感', hint: '昨天的高度不是今天的天花板' },
  { name: '坚持感', hint: '方向在行动中清晰；答案在坚持中出现' },
  { name: '团队凝聚', hint: '凝聚团队、聚焦目标；为梦想创造无限可能' },
  { name: '价值表达', hint: '价值自有通途；隐私流动，价值无介' },
  { name: '当下主义', hint: '行动，就在当下' },
  { name: '梦想拓展', hint: 'Create endless possibilities' },
  { name: '隐私日常', hint: '隐私是生活方式；链上透明≠生活全摊开' },
];

const EXPRESSION_ANGLES = [
  { name: '情绪共鸣', hint: '普通人能接上的感受，一句戳心' },
  { name: '对比旧叙事', hint: '对比传统 DeFi 全透明，轻刺一刀' },
  { name: '现场活动感', hint: '市场/线下在推进，有热度' },
  { name: '人物社区点题', hint: 'OCR/补充有人名才点' },
  { name: '轻幽默吐槽', hint: '轻松一句，不油腻' },
  { name: '时间感', hint: '此刻/这轮/最近/今天' },
  { name: '结局式收束', hint: '最后一句利落' },
  { name: '对话体短推', hint: '像群聊接话' },
  { name: '财富自主', hint: '选择权，不说教' },
  { name: '金句二次创作', hint: 'OCR 通顺句润色；无 OCR 自造金句' },
  { name: '社区圈子', hint: '同频、共振、一起往前走' },
  { name: '线下局现场', hint: '城市+线下/活动氛围' },
  { name: '行情情绪', hint: '热/冷/分化，不承诺涨跌' },
  { name: '隐私生活方式', hint: '隐私是日常，不是说明书' },
  { name: '合规轻点', hint: '合规也可以有态度' },
  { name: '参与感', hint: '普通人也能接上' },
  { name: '反透明刺点', hint: '链上公开≠生活全摊开' },
  { name: '灵魂追问', hint: '最多一句追问' },
  { name: '品牌轻点题', hint: '收尾 Liminal/无介' },
];

const ALL_CAPTION_ANGLES = [...EIGHT_MINDSETS, ...EXPRESSION_ANGLES];

const STYLE_EXAMPLES = `
【风格范例 A — 行动派，学结构勿照抄】
💪 想再多，不如做一次。
方向会在行动中清晰，
答案会在坚持中出现
📈 隐私流动，价值无介。
#Liminal #行动派

【风格范例 B — 突破感】
🚀 那只是昨天的高度，不是今天的天花板。
⚡️ 突破。每一天都要突破昨天。
Everyday you wake up you have one job: to be better than yesterday.✨

【风格范例 C — 团队凝聚】
📈 Liminal 的每一步，都源于团队的凝聚。
🤝 凝聚团队，聚焦目标
🚀 为梦想创造无限可能！
Gather the team, Focus on your goal.
`.trim();

let lastAngleName = '';

function pickCaptionAngle() {
  const pool = ALL_CAPTION_ANGLES.filter((a) => a.name !== lastAngleName);
  const picked = pool[Math.floor(Math.random() * pool.length)] || ALL_CAPTION_ANGLES[0];
  lastAngleName = picked.name;
  return picked;
}

function formatAngleBlock(angle) {
  return `【本次主题 — 只写这一个】${angle.name}\n${angle.hint}\n\n必须收尾轻点 Liminal 或 无介（正文或标签均可）。`;
}

const CAPTION_SYSTEM = `你是 Liminal Network（无介）中文社群运营，写 Telegram 转发配文。

${POSTER_STYLE}

${STYLE_EXAMPLES}

只输出配文正文，不要解释。`;

const OCR_CAPTION_SYSTEM = `${CAPTION_SYSTEM}

【补充】画面有 OCR 时，可读文字融入金句；无 OCR 按主题角度写海报文案。`;

const NO_OCR_CAPTION_SYSTEM = `${CAPTION_SYSTEM}

【项目参考（仅供价值落点灵感，勿展开参数）】
${getCaptionProjectHint()}`;

const CITY_PATTERN =
  /(杭州|郑州|上海|北京|深圳|广州|成都|重庆|武汉|西安|长沙|苏州|南京|合肥|福州|厦门|青岛|济南|昆明|南宁|贵阳|海口|南昌|天津|宁波|无锡|大连|沈阳|长春|哈尔滨|兰州|银川|西宁|呼和浩特|乌鲁木齐|拉萨|香港|澳门|台北|洛阳|开封|许昌|新乡|周口|商丘|驻马店|南阳|焦作|平顶山|安阳|鹤壁|漯河|三门峡|信阳|济源|庆阳|塔城|九江)/g;
const MARKET_PATTERN = /([^\s，。；、]{2,16}(市场|团队|社群|战队|分会|俱乐部|社区))/g;

function uniqueMatches(text, pattern) {
  const matches = String(text || '').match(pattern) || [];
  return [...new Set(matches.map((item) => item.trim()))];
}

function extractCaptionContext(ocrText, extraHint = '') {
  const source = [ocrText, extraHint].filter(Boolean).join('\n');
  const cities = uniqueMatches(source, CITY_PATTERN);
  const markets = uniqueMatches(source, MARKET_PATTERN);
  const opener = cities[0] || markets[0] || '';
  return {
    opener,
    cities,
    markets,
  };
}

function formatContextBlock(context, extraHint) {
  const hint = String(extraHint || '').trim();
  const userSpecified =
    hint.includes('用户确认') ||
    hint.includes('城市/市场：') ||
    hint.includes('城市：') ||
    hint.includes('市场：');
  const parts = [];
  if (userSpecified) {
    parts.push('【必用】上传者已确认城市/市场/社区信息，开篇或金句中必须自然点到，不可省略。');
  }
  parts.push(`城市/市场线索：${context.opener || '无明确城市，按市场/团队热度写'}`);
  if (context.cities.length) parts.push(`城市=${context.cities.join('、')}`);
  if (context.markets.length) parts.push(`市场/团队=${context.markets.join('、')}`);
  parts.push(`管理员补充（优先当作城市/市场/团队线索）：${hint || '无'}`);
  return parts.join('\n');
}

function normalizeHint(extraHint = '') {
  return String(extraHint || '').trim();
}

async function generateOnce({ cleanOcr, extraHint, strict }) {
  const context = extractCaptionContext(cleanOcr, extraHint);
  const angle = pickCaptionAngle();

  const userBlock = [
    formatAngleBlock(angle),
    '',
    '【画面文字 — 碎字忽略】',
    cleanOcr || '（无）',
    '',
    formatContextBlock(context, extraHint),
    strict ? '\n【重试】更高级、更短句，必须点到 Liminal/无介。' : '',
  ].join('\n');

  return chat(
    [
      { role: 'system', content: OCR_CAPTION_SYSTEM },
      { role: 'user', content: userBlock },
    ],
    { temperature: strict ? 0.85 : 0.9, maxTokens: 320 },
  );
}

async function generateFromThemes(extraHint, { strict = false } = {}) {
  const context = extractCaptionContext('', extraHint);
  const angle = pickCaptionAngle();

  const userBlock = [
    formatAngleBlock(angle),
    '',
    formatContextBlock(context, extraHint),
    '',
    '无可靠 OCR。写海报式高级短文案，学范例结构，必须点到 Liminal/无介。',
    strict ? '\n【重试】换主题写法，更高级短句，禁止炒币腔。' : '',
  ].join('\n');

  return chat(
    [
      { role: 'system', content: NO_OCR_CAPTION_SYSTEM },
      { role: 'user', content: userBlock },
    ],
    { temperature: strict ? 0.85 : 0.9, maxTokens: 320 },
  );
}

const LAST_RESORT_SAMPLES = [
  '💪 想再多，不如做一次。\n方向会在行动中清晰，\n答案会在坚持中出现\n📈 隐私流动，价值无介。\n#Liminal #行动派',
  '🚀 那只是昨天的高度，不是今天的天花板。\n⚡️ 突破。每一天都要突破昨天。\nEveryday: be better than yesterday.✨',
  '📈 Liminal 的每一步，都源于团队的凝聚。\n🤝 凝聚团队，聚焦目标\n🚀 为梦想创造无限可能！\n#LiminalNetwork',
  '😀 Liminal Network · 无介网络\n价值，自有通途。💫\n#无介 #Liminal',
];

function pickLastResort(extraHint) {
  const hint = normalizeHint(extraHint);
  const context = extractCaptionContext('', hint);
  const opener = context.opener || hint.slice(0, 14);
  if (opener) {
    const samples = [
      `💪 ${opener}\n想再多，不如做一次。\n📈 隐私流动，价值无介。\n#Liminal`,
      `🚀 ${opener}\n突破。每一天都要突破昨天。\n#无介 #Liminal`,
    ];
    return samples[Math.floor(Math.random() * samples.length)];
  }
  return LAST_RESORT_SAMPLES[Math.floor(Math.random() * LAST_RESORT_SAMPLES.length)];
}

export async function generateMarketCaption(ocrText, extraHint = '') {
  try {
    const { clean, usable } = sanitizeOcrForCaption(ocrText);

    const generate = usable
      ? (strict) => generateOnce({ cleanOcr: clean, extraHint, strict })
      : (strict) => generateFromThemes(extraHint, { strict });

    for (let attempt = 0; attempt < 3; attempt++) {
      const caption = fixBrandName(await generate(attempt > 0));
      if (!isBadCaption(caption)) return caption;
      console.warn(`caption rejected attempt ${attempt + 1}:`, caption.slice(0, 80));
    }

    return fixBrandName(pickLastResort(extraHint));
  } catch (e) {
    console.error('generateMarketCaption failed:', e);
    return fixBrandName(pickLastResort(extraHint));
  }
}

/** 根据抓取到的隐私赛道资讯条目，生成社群日报文案 */
export async function generatePrivacyDigest(items, { dateLabel, avoidTitles = [] } = {}) {
  const day = dateLabel || new Date().toISOString().slice(0, 10);
  const bullet = (items || [])
    .slice(0, 12)
    .map((it, i) => {
      const title = (it.title || '').trim();
      const snippet = (it.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const source = it.source || '';
      const link = it.link || '';
      return `${i + 1}. [${source}] ${title}\n   ${snippet}${link ? `\n   ${link}` : ''}`;
    })
    .join('\n\n');

  const material = bullet || '（本次未能抓到可靠外站标题，请基于公开常识写「赛道观察」口吻，不要编造具体新闻标题、日期或链接。）';
  const avoidBlock = (avoidTitles || []).filter(Boolean).slice(0, 24);
  const avoidText = avoidBlock.length
    ? `已报道过、禁止再写的话题/标题：\n${avoidBlock.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : '（暂无已发布黑名单）';

  const system = `你是 Liminal Network（无介）中文社群的内容编辑。
任务：把「加密隐私 / 链上隐私」公开资讯整理成适合 Telegram 手机阅读的「每日观察」。

侧重点（按优先级）：
1. 加密隐私技术与产品：ZK、混币/隐私池、隐私币、FHE、机密计算、隐身地址、隐私 L2/应用
2. 交易所 / 钱包 / 协议里的用户资金与交易隐私、链上可追踪性争议
3. 影响加密隐私的监管与合规（OFAC、混币执法、隐私币上下架、数据披露要求）
不要主写：普通互联网生活隐私（房产地址库、手机广告追踪、一般社交媒体）——除非明确落到加密/链上语境。

排版必须严格按下面模板输出（不要增减结构）：

🗞 隐私赛道观察 · ${day}

① 主体｜一句话标题
一句说明（发生了什么）。一句点题（和加密隐私/链上匿名有什么关系）。

② 主体｜一句话标题
一句说明。一句点题。

③ 主体｜一句话标题
一句说明。一句点题。

（可选④，同样格式）

——————
💡 无介视角
两到三句收束即可，轻点「合规框架下的加密隐私体验 / 链上透明不等于生活透明」，不要硬广。

#无介 #Liminal #加密隐私

硬性要求：
1. 只用中文。不要 Markdown：禁止 **加粗**、*斜体*、标题井号、反引号。文末话题标签除外。
2. 条目用 ①②③④，标题行用「主体｜标题」；主体可是协议/币种/交易所/机构名，尽量短。
3. 每条正文最多两句，总共不超过约 70 字；条目之间空一行。不要写成大段新闻稿。
4. 只写 3～4 条，必须围绕加密隐私；材料不够就写「加密隐私趋势观察」，标明「今日加密隐私新资讯有限」，不要硬凑生活隐私新闻。
5. 严禁重复「已报道过」列表里的同一事件/同一主体旧闻；不要换个说法再写一遍。
6. 不要编造材料里没有的具体新闻、公司、数字、监管结论。
7. 禁止收益承诺、投资建议、喊单、APY、刚兑话术。
8. 品牌中文名只能写「无介」，禁止「无界」。
9. 全文控制在 650 字以内。不要输出「作为 AI」之类元叙述。`;

  const raw = await chat(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `${avoidText}\n\n今日公开资讯材料（已排除已知旧链，请优先选用加密隐私相关）：\n\n${material}\n\n请按模板输出完整群发文案，只写新鲜的加密隐私内容。`,
      },
    ],
    { temperature: 0.45, maxTokens: 1800 },
  );
  return normalizeDigestFormat(raw, day);
}

/** 将已发布的中文隐私日报译成英文版（结构对齐，供总控留存/转发） */
export async function translatePrivacyDigestToEnglish(chineseText, { dateLabel } = {}) {
  const day = dateLabel || new Date().toISOString().slice(0, 10);
  const source = String(chineseText || '').trim();
  if (!source) return '';

  const system = `You are the English editor for Liminal Network (Chinese brand name: 无介 / Wujie).
Task: translate the Chinese crypto-privacy daily brief into English for Telegram.

Keep the same structure:
🗞 Privacy Track Brief · ${day}

① Subject | one-line headline
One sentence what happened. One sentence why it matters for crypto privacy / on-chain anonymity.

② ...
③ ...
(optional ④)

——————
💡 Liminal Take
2–3 closing sentences. Light touch on privacy under compliance / on-chain transparency ≠ life transparency. No hard sell.

#Liminal #Wujie #CryptoPrivacy

Rules:
1. English only. No Markdown (** * # backticks). Hashtags at the end are fine.
2. Faithful translation of facts; do not invent news, numbers, or claims not in the Chinese source.
3. Keep compact for mobile; under ~650 words.
4. Brand: Liminal Network; Chinese name 无介 may appear as Wujie once if natural. Never write 无界.
5. No investment advice, APY, or price calls.`;

  const raw = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: `Chinese source:\n\n${source}\n\nOutput the full English brief only.` },
    ],
    { temperature: 0.3, maxTokens: 1800 },
  );

  let t = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!t) return '';
  if (!/^🗞/.test(t)) t = `🗞 Privacy Track Brief · ${day}\n\n${t}`;
  if (!/#Liminal/i.test(t)) t = `${t}\n\n#Liminal #Wujie #CryptoPrivacy`;
  return fixBrandName(t.replace(/\n{3,}/g, '\n\n').trim());
}

/** 轻量规整：压缩多余空行、补齐标题/分隔/标签 */
function normalizeDigestFormat(text, day) {
  let t = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!t) return t;

  if (!/^🗞/.test(t)) {
    t = `🗞 隐私赛道观察 · ${day}\n\n${t}`;
  }
  if (!/——————/.test(t) && /💡?\s*无介视角/.test(t)) {
    t = t.replace(/\n*💡?\s*无介视角/, '\n\n——————\n💡 无介视角');
  } else if (/无介视角/.test(t) && !/💡\s*无介视角/.test(t)) {
    t = t.replace(/无介视角/, '💡 无介视角');
  }
  if (!/#无介/.test(t)) {
    t = `${t}\n\n#无介 #Liminal #加密隐私`;
  } else if (!/#加密隐私/.test(t) && /#隐私\b/.test(t)) {
    t = t.replace(/#隐私\b/, '#加密隐私');
  }
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
