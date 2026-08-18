import fs from 'fs-extra';
import path from 'path';
import { config } from './config.js';

const BSC_RPC = process.env.BSC_RPC_URL || 'https://bsc.publicnode.com';
const GECKO = 'https://api.geckoterminal.com/api/v2/networks/bsc/tokens';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7b163c06a06165483445a0881';
const TRANSFER_TOPICS = new Set([
  TRANSFER_TOPIC.toLowerCase(),
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
]);
const LOG_CHUNK = 5000;
const LOG_LOOKBACK = Number(process.env.LIM_BURN_LOOKBACK_BLOCKS || 20000);

function defaultState() {
  return {
    athUsd: null,
    lastPriceUsd: null,
    lastBurnTotal: null,
    lastBurnBlock: null,
    seenBurnTx: [],
    lastScheduledDay: null,
    scheduledHoursDone: [],
    updatedAt: new Date().toISOString(),
  };
}

export function loadLimState() {
  try {
    if (!fs.existsSync(config.limPriceFile)) return defaultState();
    return { ...defaultState(), ...fs.readJsonSync(config.limPriceFile) };
  } catch (e) {
    console.warn('loadLimState failed:', e.message);
    return defaultState();
  }
}

function saveLimState(state) {
  fs.ensureDirSync(path.dirname(config.limPriceFile));
  state.updatedAt = new Date().toISOString();
  fs.writeJsonSync(config.limPriceFile, state, { spaces: 2 });
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

async function rpcCall(method, params) {
  const res = await fetch(BSC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'rpc error');
  return data.result;
}

function addrTopic(address) {
  return '0x' + address.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
}

function burnSinkTopics() {
  return new Set(config.limBurnSinks.map((s) => addrTopic(s)));
}

function parseTransferAmount(data) {
  if (!data || data === '0x') return 0;
  return Number(BigInt(data)) / 1e18;
}

function parseLogBurn(log) {
  const topic0 = log.topics?.[0]?.toLowerCase();
  if (!topic0 || !TRANSFER_TOPICS.has(topic0)) return null;
  if (!burnSinkTopics().has(log.topics[2]?.toLowerCase())) return null;
  const amount = parseTransferAmount(log.data);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const blockNumber = parseInt(log.blockNumber, 16);
  const blockTimestamp = log.blockTimestamp ? parseInt(log.blockTimestamp, 16) : null;
  return {
    txHash: log.transactionHash,
    amount,
    blockNumber,
    blockTimestamp,
    to: '0x' + log.topics[2].slice(-40),
  };
}

async function fetchLogs(fromBlock, toBlock) {
  const logs = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_CHUNK) {
    const to = Math.min(from + LOG_CHUNK - 1, toBlock);
    try {
      const batch = await rpcCall('eth_getLogs', [
        {
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
          address: config.limContract,
        },
      ]);
      if (Array.isArray(batch)) logs.push(...batch);
    } catch (e) {
      if (String(e.message).includes('Archive')) continue;
      throw e;
    }
  }
  return logs;
}

/** 扫描最近区块，返回最新一笔销毁（含 tx hash） */
export async function fetchLatestBurnTx({ lookbackBlocks = LOG_LOOKBACK } = {}) {
  const latest = parseInt(await rpcCall('eth_blockNumber', []), 16);
  const fromBlock = Math.max(0, latest - lookbackBlocks);
  const logs = await fetchLogs(fromBlock, latest);
  const burns = logs
    .map(parseLogBurn)
    .filter(Boolean)
    .sort((a, b) => a.blockNumber - b.blockNumber || a.txHash.localeCompare(b.txHash));
  const hit = burns[burns.length - 1];
  if (!hit) return null;
  if (!hit.blockTimestamp) {
    const blk = await rpcCall('eth_getBlockByNumber', ['0x' + hit.blockNumber.toString(16), false]);
    hit.blockTimestamp = parseInt(blk.timestamp, 16);
  }
  return hit;
}

async function collectNewBurns(state) {
  const latest = parseInt(await rpcCall('eth_blockNumber', []), 16);
  const bootstrap = state.lastBurnBlock == null;
  const fromBlock = bootstrap
    ? Math.max(0, latest - LOG_LOOKBACK)
    : Math.max(0, state.lastBurnBlock + 1);
  if (fromBlock > latest) return [];

  const logs = await fetchLogs(fromBlock, latest);
  const seen = new Set(state.seenBurnTx || []);
  const burns = logs
    .map(parseLogBurn)
    .filter(Boolean)
    .filter((b) => b.amount >= config.limBurnMinDelta && !seen.has(b.txHash))
    .sort((a, b) => a.blockNumber - b.blockNumber || a.txHash.localeCompare(b.txHash));

  state.lastBurnBlock = latest;
  state.seenBurnTx = [...seen, ...burns.map((b) => b.txHash)].slice(-100);
  if (bootstrap) return [];
  return burns;
}

async function balanceOf(address) {
  const padded = address.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
  const data = '0x70a08231' + padded;
  const hex = await rpcCall('eth_call', [{ to: config.limContract, data }, 'latest']);
  return Number(BigInt(hex)) / 1e18;
}

async function fetchBurnedTotal() {
  let total = 0;
  for (const sink of config.limBurnSinks) {
    total += await balanceOf(sink);
  }
  return total;
}

/** 主池价格：GeckoTerminal BSC */
export async function fetchLimMarket() {
  const addr = config.limContract;
  const [tokenRes, poolsRes, burned] = await Promise.all([
    fetch(`${GECKO}/${addr}`, {
      headers: { Accept: 'application/json;version=20230302' },
    }).then((r) => r.json()),
    fetch(`${GECKO}/${addr}/pools`, {
      headers: { Accept: 'application/json;version=20230302' },
    }).then((r) => r.json()),
    fetchBurnedTotal(),
  ]);

  const t = tokenRes?.data?.attributes || {};
  const pools = (poolsRes?.data || [])
    .map((p) => p.attributes || {})
    .filter((p) => p.base_token_price_usd)
    .sort((a, b) => Number(b.reserve_in_usd || 0) - Number(a.reserve_in_usd || 0));

  const main = pools[0] || {};
  const price = Number(main.base_token_price_usd || t.price_usd);
  if (!Number.isFinite(price) || price <= 0) throw new Error('price unavailable');

  const ch24 = Number(main.price_change_percentage?.h24 ?? t.price_change_percentage?.h24);
  const vol24 = Number(main.volume_usd?.h24 ?? t.volume_usd?.h24 ?? 0);
  const totalSupply = Number(t.normalized_total_supply || 0);
  const circulating = totalSupply > 0 ? Math.max(0, totalSupply - burned) : 0;
  const marketCap =
    Number(main.market_cap_usd ?? t.market_cap_usd) ||
    (circulating > 0 ? price * circulating : Number(t.fdv_usd ?? 0));

  return {
    price,
    ch24: Number.isFinite(ch24) ? ch24 : null,
    vol24,
    marketCap,
    burned,
    circulating,
    symbol: t.symbol || 'LIM',
    poolName: main.name || 'Lim / USDT',
  };
}

function fmtUsd(n, digits = 4) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toFixed(2);
}

function fmtCapUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return (
    '$' +
    n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatPriceBroadcast(market, { day } = {}) {
  const d = day || dayKeyBj();
  const lines = [
    `📈 Liminal (LIM) · ${d}`,
    '',
    `💵 现货 ${fmtUsd(market.price)}`,
  ];
  if (market.ch24 != null) lines.push(`📊 24h ${fmtPct(market.ch24)}`);
  if (market.marketCap > 0) lines.push(`💎 流通市值 ${fmtCapUsd(market.marketCap)}`);
  if (market.vol24 > 0) lines.push(`🔄 24h 成交额 ${fmtCapUsd(market.vol24)}`);
  lines.push('');
  lines.push('无介网络 · 隐私基础设施');
  lines.push('Privacy is Productive.');
  lines.push('');
  lines.push(`🔗 BSC · ${config.limContract}`);
  lines.push('#Liminal #LIM #无介');
  return lines.join('\n');
}

export function formatAthBroadcast(market, athUsd) {
  return [
    '🚀 Liminal (LIM) 创历史新高',
    '',
    `💵 现货 ${fmtUsd(market.price)}`,
    `🏔 前高 ${fmtUsd(athUsd)}`,
    market.ch24 != null ? `📊 24h ${fmtPct(market.ch24)}` : '',
    market.marketCap > 0 ? `💎 流通市值 ${fmtCapUsd(market.marketCap)}` : '',
    '',
    '无介网络 · 隐私基础设施',
    'Privacy is Productive.',
    '#Liminal #LIM #无介',
  ]
    .filter(Boolean)
    .join('\n');
}

function fmtLim(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

function fmtBjTime(unixSec) {
  if (!unixSec) return null;
  const d = new Date(unixSec * 1000 + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' (UTC+8)';
}

export function formatBurnBroadcast({ amount, delta, total, txHash, blockTimestamp }) {
  const burned = amount ?? delta;
  const lines = [
    '🔥 Liminal (LIM) 链上销毁',
    '',
    `本次销毁 ${fmtLim(burned)} LIM`,
    `累计黑洞 ${fmtLim(total)} LIM`,
  ];
  const when = fmtBjTime(blockTimestamp);
  if (when) lines.push(`🕒 ${when}`);
  lines.push('');
  if (txHash) {
    lines.push('🔗 交易哈希');
    lines.push(txHash);
    lines.push(`https://bscscan.com/tx/${txHash}`);
    lines.push('');
  }
  lines.push('BSC 链上可查 · 通缩机制持续运行');
  lines.push('无介网络 · 隐私基础设施');
  lines.push('Privacy is Productive.');
  lines.push('');
  lines.push('#Liminal #LIM #无介');
  return lines.join('\n');
}

export function bjNow(date = new Date()) {
  return bjParts(date);
}

export function shouldRunScheduledPriceNow() {
  if (!config.limPriceEnabled) return false;
  const { day, hour, minute } = bjParts();
  if (minute !== 0) return false;
  const hours = config.limPriceHoursBj;
  if (!hours.includes(hour)) return false;
  const state = loadLimState();
  if (state.lastScheduledDay === day && (state.scheduledHoursDone || []).includes(hour)) {
    return false;
  }
  return true;
}

export function markScheduledPriceDone(hour) {
  const state = loadLimState();
  const day = dayKeyBj();
  if (state.lastScheduledDay !== day) {
    state.lastScheduledDay = day;
    state.scheduledHoursDone = [];
  }
  if (!state.scheduledHoursDone.includes(hour)) state.scheduledHoursDone.push(hour);
  saveLimState(state);
}

/** 拉行情 + 检测 ATH / 销毁，返回需要播报的消息 */
export async function collectLimAlerts({ includeScheduled = false } = {}) {
  const state = loadLimState();
  const market = await fetchLimMarket();
  const out = [];

  const price = market.price;
  const prevAth = state.athUsd;
  const athThreshold = prevAth ? prevAth * (1 + config.limAthMinPct / 100) : price;

  if (prevAth == null) {
    state.athUsd = price;
  } else if (price >= athThreshold && price > prevAth) {
    out.push({ kind: 'ath', text: formatAthBroadcast(market, prevAth) });
    state.athUsd = price;
  }

  state.lastPriceUsd = price;
  state.lastBurnTotal = market.burned ?? 0;

  const newBurns = await collectNewBurns(state);
  for (const burn of newBurns) {
    if (!burn.blockTimestamp) {
      try {
        const blk = await rpcCall('eth_getBlockByNumber', ['0x' + burn.blockNumber.toString(16), false]);
        burn.blockTimestamp = parseInt(blk.timestamp, 16);
      } catch (_) {
        /* ignore */
      }
    }
    out.push({
      kind: 'burn',
      text: formatBurnBroadcast({
        amount: burn.amount,
        total: market.burned,
        txHash: burn.txHash,
        blockTimestamp: burn.blockTimestamp,
      }),
    });
  }

  saveLimState(state);

  if (includeScheduled) {
    out.unshift({ kind: 'price', text: formatPriceBroadcast(market) });
  }

  return { market, alerts: out };
}
