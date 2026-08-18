import { Markup } from 'telegraf';
import { roleOf } from './copy.js';
import { LINKS } from './links.js';

/** 全员共用入口 */
export function linkRow() {
  return [
    Markup.button.url('🌐 官方话题组', LINKS.official),
    Markup.button.url('💬 中文话题组', LINKS.cn),
  ];
}

export function twitterRow() {
  return [Markup.button.url('🐦 官方推特', LINKS.twitter)];
}

export function gatewayRow() {
  return [Markup.button.url('🔐 隐私网关', LINKS.gateway)];
}

export function catboxRow() {
  return [Markup.button.url('🐱 Catbox 匿名分发', LINKS.catbox)];
}

export function docsRow() {
  return [
    Markup.button.url('📜 合规牌照', LINKS.license),
    Markup.button.url('📖 操作教程', LINKS.tutorial),
  ];
}

export function supportRow() {
  return [
    Markup.button.url('🙋 人工客服①', LINKS.cs1),
    Markup.button.url('💁 人工客服②', LINKS.cs2),
  ];
}

export function userKeyboard() {
  return Markup.inlineKeyboard([
    supportRow(),
    docsRow(),
    gatewayRow(),
    catboxRow(),
    linkRow(),
    twitterRow(),
    [Markup.button.callback('❓ 我能问什么', 'user:tips')],
  ]);
}

export function adminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎬 上传视频 / 素材', 'admin:upload')],
    [Markup.button.callback('📌 查看同步目标', 'admin:target')],
    supportRow(),
    docsRow(),
    gatewayRow(),
    catboxRow(),
    linkRow(),
    twitterRow(),
  ]);
}

export function ownerKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ 添加协作', 'owner:add'),
      Markup.button.callback('➖ 移除协作', 'owner:del'),
    ],
    [
      Markup.button.callback('👥 协作名单', 'owner:list'),
      Markup.button.callback('🎯 同步目标', 'owner:setgroup'),
    ],
    [Markup.button.callback('📌 如何绑定群', 'owner:bindhelp')],
    [Markup.button.callback('📊 今日数据', 'owner:stats')],
    [Markup.button.callback('📈 LIM 行情', 'owner:limprice')],
    [Markup.button.callback('📰 隐私日报', 'owner:digest')],
    [Markup.button.callback('🎬 上传视频 / 素材', 'admin:upload')],
    supportRow(),
    docsRow(),
    gatewayRow(),
    catboxRow(),
    linkRow(),
    twitterRow(),
  ]);
}

export function keyboardFor(username) {
  const role = roleOf(username);
  if (role === 'owner') return ownerKeyboard();
  if (role === 'admin') return adminKeyboard();
  return userKeyboard();
}

/** 视频推文进同步群时附带的入口按钮 */
export function videoPostKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.url('🔐 隐私转账', LINKS.gateway),
      Markup.button.url('🐱 Catbox', LINKS.catbox),
    ],
    [Markup.button.url('🎮 Catbox Dash', LINKS.catboxDash)],
  ]);
}

/** 文案确认条 */
export function draftKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ 确认发布', 'draft:publish'),
      Markup.button.callback('✏️ 修改文案', 'draft:edit'),
    ],
    [Markup.button.callback('❌ 取消', 'draft:cancel')],
  ]);
}

/** 视频素材：手动填城市 / 跳过 */
export function marketAskKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏭ 跳过，不写城市', 'media:market_skip')],
    [Markup.button.callback('❌ 取消', 'media:cancel')],
  ]);
}

/** 隐私日报待审 */
export function digestKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ 发到群', 'digest:publish'),
      Markup.button.callback('✏️ 修改', 'digest:edit'),
    ],
    [Markup.button.callback('⏭ 跳过今天', 'digest:skip')],
  ]);
}
