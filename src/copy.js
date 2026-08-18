import { config, normalizeUser } from './config.js';
import { isOwner, isAdmin } from './store.js';
import { LINKS } from './links.js';

export function roleOf(username) {
  const u = normalizeUser(username);
  if (!u) return 'guest';
  if (isOwner(u)) return 'owner';
  if (isAdmin(u)) return 'admin';
  return 'user';
}

export function welcomeUser() {
  return [
    '👋 你好，我是 Liminal Network AI 客服。',
    '',
    '有关无介 / Liminal 的机制、产品、双币体系、隐私能力等问题，都可以直接问我～',
    '',
    '👇 也可以从下面入口看看官方动态。',
  ].join('\n');
}

export function welcomeAdmin() {
  return [
    '👋 你好，我是 Liminal Network AI 客服。',
    '',
    '成员问题可以直接问我。',
    '需要整理社群素材时，点「🎬 上传视频 / 素材」，我会先给你文案预览，确认后再同步到社群。',
    '',
    '👇 入口如下。',
  ].join('\n');
}

export function welcomeOwner() {
  return [
    '👋 你好，我是 Liminal Network AI 客服（总控视图）。',
    '',
    '成员问答与素材同步已就绪。',
    '协作安排、同步目标、素材审核、隐私日报、LIM 行情播报都可以从下方按钮进入。',
    '',
    '📈 每天 10:00 / 18:00 / 22:00（北京时间）自动发 LIM 行情；创历史新高或链上销毁时也会播报。',
    '',
    '📰 每天会先把「隐私赛道观察」草稿发给你，确认后再进群。',
    '🎬 上传素材后：先出文案给你（及协作）确认，确认发布后才会进群，并同步一份到这里。',
  ].join('\n');
}

export function welcomeFor(username) {
  const role = roleOf(username);
  if (role === 'owner') return welcomeOwner();
  if (role === 'admin') return welcomeAdmin();
  return welcomeUser();
}

export function userTips() {
  return [
    '💡 你可以问我例如：',
    '· 无介 / Liminal 是做什么的？',
    '· LIM 和 USDT 分别什么角色？',
    '· 隐私池、托管周期怎么理解？',
    '',
    '更细节的材料外问题，可以走社群人工客服哦。',
  ].join('\n');
}

export function softNoUsername() {
  return '😊 为了更好地为你服务，请先在 Telegram 设置一个用户名后再继续。';
}

export function softRejectMedia() {
  return '📎 图片和视频素材请通过官方协作渠道提交。文字问题可以继续问我～';
}

export function adminAskUpload() {
  return [
    '🎬 请直接发送「视频」或「带文字的截图」。',
    '',
    '视频：先手动填写城市 / 市场 / 社区，再起草文案（不识别画面文字）。',
    '截图：可识别画面文字；可附一句说明。',
    '确认后才会同步到社群。',
  ].join('\n');
}

export function askVideoMarket() {
  return askMarketHint();
}

export function askMarketHint() {
  return [
    '✍️ 请手动发送本条视频对应的城市 / 市场 / 社区（一条消息）。',
    '',
    '示例：九江市场 · 郑州团队 · 杭州社区',
    '',
    '文案会自然带入你填写的城市 / 市场；不需要可点「跳过」。',
  ].join('\n');
}

export function mediaQueuedCancelled() {
  return '已取消本次素材，需要时再发视频或截图即可。';
}

export function adminStatusRecognizing() {
  return '✨ 素材已收到，正在识别画面并起草文案…';
}

export function adminStatusDrafting() {
  return '✨ 正在根据城市 / 市场信息起草文案…';
}

export function adminStatusNoText() {
  return '😅 画面文字识别不到可靠内容。请换更清楚的图/视频，或上传时附一句说明（例如活动主题、城市名）。';
}

export function draftPreview(caption) {
  return [
    '📝 文案草稿如下，请确认后再发布：',
    '',
    caption,
    '',
    '可以点「✏️ 修改文案」，或「✅ 确认发布」。',
  ].join('\n');
}

export function askEditCaption() {
  return '✏️ 请直接发送修改后的完整文案（下一条文字消息）。';
}

export function draftUpdated(caption) {
  return ['📝 已更新草稿：', '', caption, '', '确认无误就点「✅ 确认发布」吧。'].join('\n');
}

export function adminStatusPublished() {
  return '🚀 已发布到社群，并已同步一份到总控。';
}

export function adminStatusFail(detail = '') {
  if (detail) return `😅 这次没同步成功：${detail}`;
  return '😅 这次没能完成，请稍后再试，或换一份素材。';
}

export function bindHint() {
  return [
    '📌 要往群里发内容，需要先绑定同步群：',
    '1. 确认 @Liminal_CNbot 已在目标群里（建议管理员权限）',
    '2. 在目标群发送：/bind',
    '（总控或协作账号均可绑定）',
  ].join('\n');
}

export function draftCancelled() {
  return '已取消本次素材整理。随时可以再点「🎬 上传视频 / 素材」。';
}

export function ownerAskAdd() {
  return '➕ 请发送要加入协作的 Telegram 用户名（可带或不带 @）。';
}

export function ownerAskDel() {
  return '➖ 请发送要移出协作的 Telegram 用户名。';
}

export function ownerAskSetGroup() {
  return `🎯 请发送新的同步目标（如 @Liminal_CN 或群数字 ID）。\n当前：${config.targetChat}`;
}

export function ownerDraftNotify(adminUsername, caption) {
  return [
    `👀 协作 @${adminUsername || 'unknown'} 正在确认一篇社群文案：`,
    '',
    caption.slice(0, 3500),
    '',
    '（对方确认后才会正式发布到社群，届时再同步一份完整内容给你。）',
  ].join('\n');
}

export function ownerPublishedNotify(adminUsername, caption) {
  return [
    `📣 协作 @${adminUsername || 'unknown'} 已发布到社群 ${config.targetChat}`,
    '',
    caption.slice(0, 3500),
  ].join('\n');
}

export function digestPreview(text, meta = {}) {
  const hits = meta.privacyHits != null ? meta.privacyHits : '?';
  const total = meta.sourceCount != null ? meta.sourceCount : '?';
  return [
    '📰 隐私赛道日报草稿（仅你可见）',
    `素材：${total} 条 · 隐私相关约 ${hits} 条`,
    '确认后再发到同步群；可修改或跳过。',
    '',
    '————————',
    '',
    text,
  ].join('\n');
}

export function askEditDigest() {
  return '✏️ 请发送修改后的完整日报文案（下一条文字消息）。';
}

export function digestUpdated(text) {
  return ['📰 已更新日报草稿：', '', text, '', '确认无误就点「✅ 发到群」。'].join('\n');
}

export function digestPublished() {
  return '🚀 隐私日报已发到社群。正在生成英文版发给总控…';
}

export function digestEnglishReady(text) {
  return [
    '🌐 English edition（仅总控）',
    '中文版已发群；以下为对应英文稿，可自行转发。',
    '',
    '————————',
    '',
    text,
  ].join('\n');
}

export function digestEnglishFail() {
  return '😅 中文版已发群，但英文版生成失败。可稍后再点「📰 隐私日报」或告诉我重试。';
}

export function digestSkipped() {
  return '已跳过今天的隐私日报。';
}

export const HUMAN_CS_HINT = `这类细节建议咨询人工客服确认。可点下方「🙋 人工客服① / 💁 人工客服②」（@LiminalNetwork01、@LiminalNetworkSupport），或到中文话题组 ${LINKS.cn} 联系工作人员。`;

