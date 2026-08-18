import fs from 'fs-extra';
import path from 'path';
import { config } from './config.js';

/** 以东八区（北京时间）计算“自然日”，返回 YYYY-MM-DD */
function dayKey(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function ensure() {
  fs.ensureDirSync(path.dirname(config.eventsFile));
}

/**
 * 追加一条事件日志（append-only JSONL）。失败只告警，绝不影响主流程。
 * kind: 'qa' | 'start' | 'publish'
 */
export function logEvent(kind, ctx, extra = {}) {
  try {
    ensure();
    const from = ctx?.from || {};
    const rec = {
      ts: new Date().toISOString(),
      day: dayKey(),
      kind,
      userId: from.id ?? null,
      username: from.username ? String(from.username).toLowerCase() : null,
      name: [from.first_name, from.last_name].filter(Boolean).join(' ') || null,
      chatType: ctx?.chat?.type || null,
      ...extra,
    };
    fs.appendFileSync(config.eventsFile, JSON.stringify(rec) + '\n');
  } catch (e) {
    console.warn('logEvent failed:', e.message);
  }
}

function readEvents() {
  try {
    if (!fs.existsSync(config.eventsFile)) return [];
    const raw = fs.readFileSync(config.eventsFile, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch {
        // 跳过损坏行
      }
    }
    return out;
  } catch (e) {
    console.warn('readEvents failed:', e.message);
    return [];
  }
}

function labelOf(rec) {
  if (rec.username) return '@' + rec.username;
  if (rec.name) return rec.name;
  if (rec.userId != null) return 'id:' + rec.userId;
  return '匿名';
}

/** 汇总最近 days 天的数据，构造给总控看的报表 */
export function buildStatsReport({ days = 7, recentLimit = 12 } = {}) {
  const events = readEvents();
  const today = dayKey();

  const dayList = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000);
    dayList.push(dayKey(d));
  }
  const rangeSet = new Set(dayList);

  const todayUsers = new Set();
  const rangeUsers = new Set();
  let todayQa = 0;
  let rangeQa = 0;
  let todayPrivate = 0;
  let todayGroup = 0;

  const askCount = new Map(); // label -> count（近 days 天问答）
  const recent = []; // 最近的问答

  for (const e of events) {
    const uid = e.userId != null ? String(e.userId) : labelOf(e);
    if (e.day === today) {
      todayUsers.add(uid);
      if (e.kind === 'qa') {
        todayQa += 1;
        if (e.chatType === 'private') todayPrivate += 1;
        else todayGroup += 1;
      }
    }
    if (rangeSet.has(e.day)) {
      rangeUsers.add(uid);
      if (e.kind === 'qa') {
        rangeQa += 1;
        askCount.set(labelOf(e), (askCount.get(labelOf(e)) || 0) + 1);
      }
    }
    if (e.kind === 'qa' && e.question) {
      recent.push(e);
    }
  }

  const topAskers = [...askCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const recentTail = recent.slice(-recentLimit).reverse();

  const lines = [];
  lines.push('📊 总控数据看板');
  lines.push('');
  lines.push(`📅 今日（${today}）`);
  lines.push(`· 活跃用户：${todayUsers.size} 人`);
  lines.push(`· 提问：${todayQa} 条（私聊 ${todayPrivate} / 群里 ${todayGroup}）`);
  lines.push('');
  lines.push(`🗓 近 ${days} 天`);
  lines.push(`· 活跃用户：${rangeUsers.size} 人`);
  lines.push(`· 提问：${rangeQa} 条`);

  if (topAskers.length) {
    lines.push('');
    lines.push('🔥 提问最多');
    for (const [label, n] of topAskers) {
      lines.push(`· ${label}：${n} 条`);
    }
  }

  lines.push('');
  lines.push(`💬 最近提问（最多 ${recentLimit} 条）`);
  if (!recentTail.length) {
    lines.push('· 暂无记录');
  } else {
    for (const e of recentTail) {
      const t = e.ts ? e.ts.slice(5, 16).replace('T', ' ') : '';
      const scene = e.chatType === 'private' ? '私聊' : '群';
      const q = String(e.question).replace(/\s+/g, ' ').slice(0, 40);
      lines.push(`· [${t} ${scene}] ${labelOf(e)}：${q}`);
    }
  }

  if (!events.length) {
    lines.push('');
    lines.push('（暂无数据，机器人开始被使用后这里会自动累积。）');
  }

  return lines.join('\n');
}
