import fs from 'fs-extra';
import { config } from '../src/config.js';
import { extractHeadlineFingerprints, loadDigestState } from '../src/digest.js';

const known = [
  '① BitMEX｜停运前夕遭集体诉讼',
  '② CFTC｜再度警告预测市场',
  '③ 巴西奶农｜把牛上链融资',
  '④ Tor 浏览器｜稳定版与 Alpha 同步更新',
  '① 纽约市｜可搜索房产数据库引发隐私担忧',
  '② 泰国 SEC｜对 Bitkub 提起刑事指控',
  '③ Tor 项目｜Tor 浏览器发布多个新版本',
  '④ CFTC｜再次警告预测市场模板化认证',
].join('\n');

const state = loadDigestState();
const now = new Date().toISOString();
const rows = extractHeadlineFingerprints(known).map((row) => ({
  key: row.key,
  title: row.title,
  day: '2026-07-27',
  at: now,
}));

if (state.draft?.text) {
  for (const row of extractHeadlineFingerprints(state.draft.text)) {
    rows.push({
      key: row.key,
      title: row.title,
      day: state.draft.day || '2026-07-28',
      at: now,
    });
  }
}

// 丢掉过宽的 s: 主体键，只保留标题/链接指纹
const map = new Map();
for (const x of state.published || []) {
  if (String(x.key || '').startsWith('s:')) continue;
  map.set(x.key, x);
}
for (const r of rows) map.set(r.key, r);
state.published = [...map.values()];
fs.writeJsonSync(config.digestFile, state, { spaces: 2 });
console.log('seeded published keys:', state.published.length);
for (const row of state.published) console.log('-', row.key, row.title || '');
