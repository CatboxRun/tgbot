import fs from 'fs-extra';
import path from 'path';
import { Telegraf } from 'telegraf';
import { config, normalizeUser } from './src/config.js';
import {
  isOwner,
  isAdmin,
  addAdmin,
  removeAdmin,
  listAdmins,
  rememberOwnerChatId,
  getOwnerChatId,
  setTargetChat,
  getPublishChatId,
  describeTarget,
} from './src/store.js';
import { answerUserQuestion, generateMarketCaption, translatePrivacyDigestToEnglish } from './src/ai.js';
import { logEvent, buildStatsReport } from './src/analytics.js';
import {
  buildDigestDraft,
  getDigestDraft,
  setDigestDraft,
  clearDigestDraft,
  shouldRunDigestNow,
  markDigestRunToday,
  markDigestPublished,
} from './src/digest.js';
import {
  collectLimAlerts,
  shouldRunScheduledPriceNow,
  markScheduledPriceDone,
  bjNow,
} from './src/limPrice.js';
import { recognizeImageText } from './src/video.js';
import { getKnowledgeContext } from './src/knowledge.js';
import { getSession, setExpect, clearExpect, setDraft, clearDraft, setPendingMedia, clearPendingMedia } from './src/session.js';
import { keyboardFor, draftKeyboard, digestKeyboard, marketAskKeyboard, videoPostKeyboard } from './src/keyboards.js';
import {
  welcomeFor,
  userTips,
  softNoUsername,
  softRejectMedia,
  adminAskUpload,
  askMarketHint,
  mediaQueuedCancelled,
  adminStatusRecognizing,
  adminStatusDrafting,
  draftPreview,
  askEditCaption,
  draftUpdated,
  adminStatusPublished,
  adminStatusFail,
  draftCancelled,
  ownerAskAdd,
  ownerAskDel,
  ownerAskSetGroup,
  ownerDraftNotify,
  ownerPublishedNotify,
  bindHint,
  digestPreview,
  askEditDigest,
  digestUpdated,
  digestPublished,
  digestEnglishReady,
  digestEnglishFail,
  digestSkipped,
} from './src/copy.js';

await fs.ensureDir(config.tmpDir);
getKnowledgeContext();

const bot = new Telegraf(config.botToken);

/** @type {string} */
let botUsername = '';

function isGroup(ctx) {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
}

function isPrivate(ctx) {
  return ctx.chat?.type === 'private';
}

/** 群内：被 @ 机器人，或回复了机器人的消息 */
function isAddressedToBot(ctx) {
  if (!isGroup(ctx)) return true;
  const msg = ctx.message;
  if (!msg) return false;

  // 回复机器人
  if (msg.reply_to_message?.from?.is_bot && botUsername) {
    const ru = normalizeUser(msg.reply_to_message.from.username);
    if (ru && ru === botUsername) return true;
  }

  const text = msg.text || msg.caption || '';
  const entities = msg.entities || msg.caption_entities || [];
  for (const ent of entities) {
    if (ent.type === 'mention') {
      const mention = text.slice(ent.offset, ent.offset + ent.length);
      if (normalizeUser(mention) === botUsername) return true;
    }
    if (ent.type === 'text_mention' && ent.user?.is_bot && normalizeUser(ent.user.username) === botUsername) {
      return true;
    }
  }

  // 明文兜底：@Liminal_CNbot
  if (botUsername && new RegExp(`@${botUsername}\\b`, 'i').test(text)) return true;
  return false;
}

/** 去掉文案里的 @机器人 */
function stripBotMention(text) {
  if (!botUsername || !text) return text;
  return text
    .replace(new RegExp(`@${botUsername}\\b`, 'ig'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

function usernameOf(ctx) {
  return normalizeUser(ctx.from?.username);
}

/** 仅私聊管理操作需要用户名；群里从不催人设用户名 */
function needUsername(ctx) {
  if (isGroup(ctx)) return null;
  if (!ctx.from?.username) return softNoUsername();
  return null;
}

function mainKb(ctx) {
  return keyboardFor(usernameOf(ctx));
}

function touchOwner(ctx) {
  if (isOwner(usernameOf(ctx)) && ctx.chat?.type === 'private') {
    rememberOwnerChatId(ctx.chat.id);
  }
}

async function replyWelcome(ctx) {
  touchOwner(ctx);
  const caption = welcomeFor(usernameOf(ctx)).slice(0, 1024);
  const kb = mainKb(ctx);
  try {
    if (await fs.pathExists(config.welcomeBanner)) {
      await ctx.replyWithPhoto(
        { source: config.welcomeBanner },
        { caption, ...kb },
      );
      return;
    }
  } catch (e) {
    console.warn('welcome banner send failed:', e.message);
  }
  await ctx.reply(caption, kb);
}

/** Telegram「正在输入…」指示，长请求期间每 4 秒刷新一次 */
async function withTyping(ctx, work) {
  const chatId = ctx.chat.id;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await ctx.telegram.sendChatAction(chatId, 'typing');
    } catch {
      // ignore
    }
  };
  await tick();
  const timer = setInterval(tick, 4000);
  try {
    return await work();
  } finally {
    stopped = true;
    clearInterval(timer);
  }
}

async function pretendNormalChat(ctx, text) {
  try {
    const answer = await withTyping(ctx, () => answerUserQuestion(text));
    logEvent('qa', ctx, { question: text, answerLen: answer.length });
    await ctx.reply(answer.slice(0, 4000));
  } catch (e) {
    console.error(e);
    await ctx.reply('刚才有点忙，请再发一次试试。');
  }
}

function friendlyPublishError(e) {
  const msg = e?.response?.description || e.message || '';
  if (/not a member/i.test(msg)) {
    return '机器人还进不了当前同步群。请把 @Liminal_CNbot 拉进目标群，并在群里发 /bind';
  }
  if (/chat not found|CHAT_NOT_FOUND/i.test(msg)) {
    return '找不到同步群。请在目标群发送 /bind 完成绑定';
  }
  if (/not enough rights|need administrator/i.test(msg)) {
    return '机器人在群里权限不够，请给发视频/发图权限';
  }
  return msg.slice(0, 180) || '未知错误';
}

async function notifyOwnerText(text, extra = {}) {
  const chat = getOwnerChatId() || `@${config.ownerUsername}`;
  try {
    await bot.telegram.sendMessage(chat, text, extra);
  } catch (e) {
    console.warn('notify owner text failed:', e.message);
  }
}

/** 发隐私日报：有封面图则先发图；正文≤1024 时直接挂在图上 */
async function sendDigestToChat(chatId, text, extra = {}) {
  const body = String(text || '').slice(0, 4000);
  const hasCover = await fs.pathExists(config.digestCover);
  if (hasCover) {
    try {
      if (body.length <= 1024) {
        await bot.telegram.sendPhoto(chatId, { source: config.digestCover }, { caption: body, ...extra });
        return;
      }
      await bot.telegram.sendPhoto(chatId, { source: config.digestCover });
    } catch (e) {
      console.warn('digest cover send failed:', e.message);
    }
  }
  await bot.telegram.sendMessage(chatId, body, extra);
}

async function sendDigestPreviewToOwner(draft) {
  if (!draft?.text) return;
  const chat = getOwnerChatId() || `@${config.ownerUsername}`;
  // 封面单独发；审核说明+按钮放在文字消息上，方便点确认
  try {
    if (await fs.pathExists(config.digestCover)) {
      await bot.telegram.sendPhoto(chat, { source: config.digestCover });
    }
  } catch (e) {
    console.warn('digest cover preview failed:', e.message);
  }
  const body = digestPreview(draft.text, draft).slice(0, 4000);
  await notifyOwnerText(body, digestKeyboard());
}

async function runDigestPipeline({ force = false, notifyBusy = null } = {}) {
  if (notifyBusy) await notifyBusy();
  const result = await buildDigestDraft({ force });
  await sendDigestPreviewToOwner(result.draft);
  return result;
}

async function publishDigestDraft(ctx) {
  const draft = getDigestDraft();
  if (!draft?.text) {
    await ctx.answerCbQuery('没有待审日报').catch(() => {});
    return ctx.reply('没有待审的隐私日报。可点「📰 隐私日报」立即生成。', mainKb(ctx));
  }
  try {
    const chinese = draft.text;
    const day = draft.day;
    await sendDigestToChat(getPublishChatId(), chinese);
    logEvent('digest', ctx, { day: draft.day, sourceCount: draft.sourceCount });
    markDigestPublished(draft);
    await ctx.editMessageText(digestPublished()).catch(() => ctx.reply(digestPublished()));

    // 发群成功后再译英文，单独发给总控（不进群）
    try {
      const english = await translatePrivacyDigestToEnglish(chinese, { dateLabel: day });
      if (english) {
        await notifyOwnerText(digestEnglishReady(english).slice(0, 4000));
        logEvent('digest_en', ctx, { day, answerLen: english.length });
      } else {
        await notifyOwnerText(digestEnglishFail());
      }
    } catch (enErr) {
      console.error('digest English translate failed:', enErr);
      await notifyOwnerText(digestEnglishFail());
    }

    await ctx.reply('菜单在这里～', mainKb(ctx));
  } catch (e) {
    console.error(e);
    await ctx.reply(`${adminStatusFail(friendlyPublishError(e))}\n\n${bindHint()}`, mainKb(ctx));
  }
}

async function publishLimAlerts(alerts) {
  if (!alerts?.length) return;
  const chat = getPublishChatId();
  for (const a of alerts) {
    await bot.telegram.sendMessage(chat, a.text.slice(0, 4000));
    console.log('LIM alert sent:', a.kind);
  }
}

async function previewLimToOwner(alerts) {
  if (!alerts?.length) return 0;
  const chat = getOwnerChatId() || `@${config.ownerUsername}`;
  await bot.telegram.sendMessage(
    chat,
    '📈 LIM 行情预览（仅总控可见，确认样式后再进群发定时播报）',
  );
  for (const a of alerts) {
    await bot.telegram.sendMessage(chat, a.text.slice(0, 4000));
    console.log('LIM preview sent:', a.kind);
  }
  return alerts.length;
}

async function runLimPriceTick({ forceScheduled = false, previewToOwner = false } = {}) {
  const { hour, minute } = bjNow();
  const doScheduled = forceScheduled || shouldRunScheduledPriceNow();
  const doPoll = minute % 5 === 0 || forceScheduled;
  if (!doScheduled && !doPoll) return { ok: true, sent: 0 };

  const { alerts } = await collectLimAlerts({ includeScheduled: doScheduled });
  if (previewToOwner) {
    const sent = await previewLimToOwner(alerts);
    return { ok: true, sent, kinds: alerts.map((a) => a.kind), preview: true };
  }
  if (alerts.length) await publishLimAlerts(alerts);
  if (doScheduled) markScheduledPriceDone(hour);
  return { ok: true, sent: alerts.length, kinds: alerts.map((a) => a.kind) };
}

async function notifyOwnerMedia(media, caption) {
  const chat = getOwnerChatId() || `@${config.ownerUsername}`;
  try {
    const safe = caption.slice(0, 1024);
    if (media.kind === 'video') {
      await bot.telegram.sendVideo(chat, media.fileId, { caption: safe });
    } else {
      await bot.telegram.sendPhoto(chat, media.fileId, { caption: safe });
    }
  } catch (e) {
    console.warn('notify owner media failed:', e.message);
    await notifyOwnerText(caption);
  }
}

async function publishToGroup(media, caption) {
  const chat = getPublishChatId();
  const safeCaption = caption.slice(0, 1024);
  const extra = media.kind === 'video' ? videoPostKeyboard() : undefined;
  if (media.kind === 'video') {
    await bot.telegram.sendVideo(chat, media.fileId, { caption: safeCaption, ...extra });
  } else {
    await bot.telegram.sendPhoto(chat, media.fileId, { caption: safeCaption });
  }
}

function bindCurrentChat(ctx) {
  const chat = ctx.chat;
  if (!chat || chat.type === 'private') {
    return { ok: false, msg: bindHint() };
  }
  setTargetChat({
    id: chat.id,
    title: chat.title || null,
    username: chat.username || null,
  });
  // 保持 env 回退一致
  if (chat.username) config.targetChat = `@${chat.username}`;
  else config.targetChat = String(chat.id);
  return {
    ok: true,
    msg: `✅ 已绑定同步群：${describeTarget()}`,
  };
}

async function downloadTelegramFile(ctx, fileId, ext) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const filePath = path.join(config.tmpDir, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  await fs.writeFile(filePath, buf);
  return filePath;
}

async function buildDraftFromMedia(ctx, { kind, fileId, thumbFileId, hint, skipOcr = false }) {
  touchOwner(ctx);
  const statusMsg = skipOcr || kind === 'video' ? adminStatusDrafting() : adminStatusRecognizing();
  const status = await ctx.reply(statusMsg);
  try {
    let ocrText = '';
    if (!skipOcr && kind === 'photo') {
      const imgPath = await downloadTelegramFile(ctx, fileId, '.jpg');
      ocrText = await recognizeImageText(imgPath);
      await fs.remove(imgPath).catch(() => {});
    }

    const caption = await generateMarketCaption(ocrText, hint);
    setDraft(ctx.from.id, {
      kind,
      fileId,
      thumbFileId: thumbFileId || null,
      caption,
      ocrText,
      marketHint: hint || '',
      fromUsername: usernameOf(ctx),
    });
    clearExpect(ctx.from.id);
    clearPendingMedia(ctx.from.id);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      status.message_id,
      undefined,
      draftPreview(caption).slice(0, 4000),
      draftKeyboard(),
    );

    if (!isOwner(usernameOf(ctx))) {
      await notifyOwnerText(ownerDraftNotify(usernameOf(ctx), caption));
    }
  } catch (e) {
    console.error(e);
    await ctx.telegram
      .editMessageText(ctx.chat.id, status.message_id, undefined, adminStatusFail())
      .catch(() => ctx.reply(adminStatusFail()));
  }
}

function composeMediaHint(pending, marketLine) {
  const parts = [pending?.captionHint, marketLine].filter(Boolean);
  return parts.join('\n').trim();
}

async function askVideoMarketThenDraft(ctx, media) {
  setPendingMedia(ctx.from.id, media);
  setExpect(ctx.from.id, 'market_hint');
  await ctx.reply(askMarketHint(), marketAskKeyboard());
}

async function startDraftFromPending(ctx, marketLine = '') {
  const session = getSession(ctx.from.id);
  const pending = session.pendingMedia;
  if (!pending) {
    await ctx.reply('没有待处理的视频，请先发送素材。', mainKb(ctx));
    return;
  }
  const hint = marketLine
    ? composeMediaHint(pending, `用户确认城市/市场：${marketLine}`)
    : composeMediaHint(pending, '');
  await buildDraftFromMedia(ctx, {
    kind: pending.kind,
    fileId: pending.fileId,
    thumbFileId: pending.thumbFileId,
    hint,
    skipOcr: true,
  });
}

async function publishDraft(ctx) {
  touchOwner(ctx);
  const session = getSession(ctx.from.id);
  const draft = session.draft;
  if (!draft) {
    await ctx.answerCbQuery('没有待发布的草稿').catch(() => {});
    return ctx.reply('没有待发布的草稿，请先点「🎬 上传视频 / 素材」。', mainKb(ctx));
  }

  try {
    await publishToGroup(draft, draft.caption);
    logEvent('publish', ctx, { kindMedia: draft.kind, captionLen: (draft.caption || '').length });
    const note = ownerPublishedNotify(draft.fromUsername || usernameOf(ctx), draft.caption);
    await notifyOwnerMedia(draft, `${note}\n\n同步群：${describeTarget()}`);
    clearDraft(ctx.from.id);
    await ctx.editMessageText(adminStatusPublished()).catch(() => ctx.reply(adminStatusPublished()));
    await ctx.reply('还需要继续整理的话，随时点按钮～', mainKb(ctx));
  } catch (e) {
    console.error(e);
    const tip = adminStatusFail(friendlyPublishError(e));
    await ctx.reply(`${tip}\n\n${bindHint()}`, mainKb(ctx));
  }
}

bot.start(async (ctx) => {
  if (isGroup(ctx) && !isAddressedToBot(ctx)) return;
  if (isGroup(ctx)) {
    // 群里被 @ 启动：简短回应，不甩一堆按钮说明书
    return ctx.reply('你好，我是 Liminal Network AI 客服。有项目问题可以 @ 我提问～');
  }
  clearExpect(ctx.from.id);
  logEvent('start', ctx);
  await replyWelcome(ctx);
});

bot.help(async (ctx) => {
  if (isGroup(ctx) && !isAddressedToBot(ctx)) return;
  if (isGroup(ctx)) {
    return ctx.reply('有项目问题直接 @ 我提问即可～');
  }
  await replyWelcome(ctx);
});

bot.command('bind', async (ctx) => {
  // 群内绑定：静默拒绝非协作，成功才回一句；不催用户名
  if (!isAdmin(usernameOf(ctx))) {
    if (isPrivate(ctx)) return ctx.reply('收到～有问题可以直接问我。');
    return;
  }
  const r = bindCurrentChat(ctx);
  await ctx.reply(r.msg);
});

bot.command('stats', async (ctx) => {
  if (isGroup(ctx)) return;
  touchOwner(ctx);
  if (!isOwner(usernameOf(ctx))) return pretendNormalChat(ctx, ctx.message.text || '');
  await ctx.reply(buildStatsReport().slice(0, 4000), mainKb(ctx));
});

bot.command('digest', async (ctx) => {
  if (isGroup(ctx)) return;
  touchOwner(ctx);
  if (!isOwner(usernameOf(ctx))) return pretendNormalChat(ctx, ctx.message.text || '');
  await ctx.reply('📰 正在抓取隐私赛道公开资讯并起草日报…');
  try {
    await runDigestPipeline({ force: true });
    await ctx.reply('草稿已发到上方，确认后再进群。', mainKb(ctx));
  } catch (e) {
    console.error(e);
    await ctx.reply(adminStatusFail(e.message || '生成失败'), mainKb(ctx));
  }
});

bot.command('limprice', async (ctx) => {
  if (isGroup(ctx)) return;
  touchOwner(ctx);
  if (!isOwner(usernameOf(ctx))) return pretendNormalChat(ctx, ctx.message.text || '');
  await ctx.reply('📈 正在抓取 LIM 行情…');
  try {
    const r = await runLimPriceTick({ forceScheduled: true, previewToOwner: true });
    const tip =
      r.sent > 0
        ? `预览已发到上方（${(r.kinds || []).join('、')}）`
        : '暂无需要播报的内容（价格无新高、销毁无变化）';
    await ctx.reply(tip, mainKb(ctx));
  } catch (e) {
    console.error(e);
    await ctx.reply(adminStatusFail(e.message || '抓取失败'), mainKb(ctx));
  }
});

bot.command('admins', async (ctx) => {
  if (isGroup(ctx)) return; // 管理命令只走私聊
  touchOwner(ctx);
  if (!isOwner(usernameOf(ctx))) return pretendNormalChat(ctx, ctx.message.text || 'admins');
  const list = listAdmins()
    .map((u) => `· @${u}`)
    .join('\n');
  await ctx.reply(`👥 协作名单：\n${list}`, mainKb(ctx));
});

bot.command('addadmin', async (ctx) => {
  if (isGroup(ctx)) return;
  touchOwner(ctx);
  const err = needUsername(ctx);
  if (err) return ctx.reply(err);
  if (!isOwner(usernameOf(ctx))) return pretendNormalChat(ctx, ctx.message.text || '');
  const arg = (ctx.message.text || '').split(/\s+/)[1];
  if (!arg) {
    setExpect(ctx.from.id, 'addadmin');
    return ctx.reply(ownerAskAdd());
  }
  const r = addAdmin(arg);
  await ctx.reply(r.msg, mainKb(ctx));
});

bot.command('deladmin', async (ctx) => {
  if (isGroup(ctx)) return;
  touchOwner(ctx);
  const err = needUsername(ctx);
  if (err) return ctx.reply(err);
  if (!isOwner(usernameOf(ctx))) return pretendNormalChat(ctx, ctx.message.text || '');
  const arg = (ctx.message.text || '').split(/\s+/)[1];
  if (!arg) {
    setExpect(ctx.from.id, 'deladmin');
    return ctx.reply(ownerAskDel());
  }
  const r = removeAdmin(arg);
  await ctx.reply(r.msg, mainKb(ctx));
});

bot.command('setgroup', async (ctx) => {
  if (isGroup(ctx)) return;
  touchOwner(ctx);
  const err = needUsername(ctx);
  if (err) return ctx.reply(err);
  if (!isOwner(usernameOf(ctx))) return pretendNormalChat(ctx, ctx.message.text || '');
  const arg = (ctx.message.text || '').split(/\s+/)[1];
  if (!arg) {
    setExpect(ctx.from.id, 'setgroup');
    return ctx.reply(`${ownerAskSetGroup()}\n\n更推荐：直接去目标群发 /bind`);
  }
  if (/^-?\d+$/.test(arg)) {
    setTargetChat({ id: Number(arg), title: null, username: null });
    config.targetChat = arg;
  } else {
    const uname = arg.replace(/^@/, '');
    setTargetChat({ clearId: true, id: undefined, title: null, username: uname });
    config.targetChat = `@${uname}`;
  }
  await ctx.reply(`🎯 同步目标写为 ${describeTarget()}\n若发布仍失败，请到目标群发 /bind`, mainKb(ctx));
});

// 机器人被拉进群：只提醒，不自动覆盖绑定（避免绑错群）
bot.on('my_chat_member', async (ctx) => {
  try {
    const chat = ctx.chat;
    const status = ctx.myChatMember?.new_chat_member?.status;
    if (!chat || chat.type === 'private') return;
    if (!['member', 'administrator'].includes(status)) return;
    const label = chat.title || chat.username || chat.id;
    console.log('Joined chat:', label, chat.id);
    await notifyOwnerText(
      `🔗 机器人已加入「${label}」（ID: ${chat.id}）。\n若要作为发布群，请在该群发送 /bind`,
    );
  } catch (e) {
    console.warn('my_chat_member handle failed', e.message);
  }
});

bot.on('callback_query', async (ctx) => {
  touchOwner(ctx);
  const data = ctx.callbackQuery.data || '';
  const u = usernameOf(ctx);
  const err = needUsername(ctx);
  if (err && data.startsWith('owner:')) {
    await ctx.answerCbQuery();
    return ctx.reply(err);
  }

  if (data === 'user:tips') {
    await ctx.answerCbQuery();
    return ctx.reply(userTips(), mainKb(ctx));
  }

  if (data === 'admin:upload') {
    if (!isAdmin(u)) {
      await ctx.answerCbQuery('暂无此入口');
      return;
    }
    setExpect(ctx.from.id, 'upload');
    await ctx.answerCbQuery();
    return ctx.reply(adminAskUpload());
  }

  if (data === 'admin:target') {
    if (!isAdmin(u)) {
      await ctx.answerCbQuery();
      return;
    }
    await ctx.answerCbQuery();
    return ctx.reply(`📌 当前同步目标：${describeTarget()}\n\n${bindHint()}`, mainKb(ctx));
  }

  if (data.startsWith('owner:')) {
    if (!isOwner(u)) {
      await ctx.answerCbQuery();
      return pretendNormalChat(ctx, data);
    }
    await ctx.answerCbQuery();
    if (data === 'owner:list') {
      const list = listAdmins()
        .map((x) => `· @${x}`)
        .join('\n');
      return ctx.reply(`👥 协作名单：\n${list}`, mainKb(ctx));
    }
    if (data === 'owner:add') {
      setExpect(ctx.from.id, 'addadmin');
      return ctx.reply(ownerAskAdd());
    }
    if (data === 'owner:del') {
      setExpect(ctx.from.id, 'deladmin');
      return ctx.reply(ownerAskDel());
    }
    if (data === 'owner:setgroup') {
      setExpect(ctx.from.id, 'setgroup');
      return ctx.reply(`${ownerAskSetGroup()}\n\n更推荐：直接去目标群发 /bind`);
    }
    if (data === 'owner:bindhelp') {
      return ctx.reply(`${bindHint()}\n\n当前：${describeTarget()}`, mainKb(ctx));
    }
    if (data === 'owner:stats') {
      return ctx.reply(buildStatsReport().slice(0, 4000), mainKb(ctx));
    }
    if (data === 'owner:limprice') {
      await ctx.reply('📈 正在抓取 LIM 行情…');
      try {
        const r = await runLimPriceTick({ forceScheduled: true, previewToOwner: true });
        const tip =
          r.sent > 0
            ? `预览已发到上方（${(r.kinds || []).join('、')}）`
            : '暂无需要播报的内容（价格无新高、销毁无变化）';
        await ctx.reply(tip, mainKb(ctx));
      } catch (e) {
        console.error(e);
        await ctx.reply(adminStatusFail(e.message || '抓取失败'), mainKb(ctx));
      }
      return;
    }
    if (data === 'owner:digest') {
      await ctx.reply('📰 正在抓取隐私赛道公开资讯并起草日报…');
      try {
        await runDigestPipeline({ force: true });
        await ctx.reply('草稿已发到上方，确认后再进群。', mainKb(ctx));
      } catch (e) {
        console.error(e);
        await ctx.reply(adminStatusFail(e.message || '生成失败'), mainKb(ctx));
      }
      return;
    }
  }

  if (data.startsWith('digest:')) {
    if (!isOwner(u)) {
      await ctx.answerCbQuery();
      return;
    }
    if (data === 'digest:publish') {
      await ctx.answerCbQuery('发布中…');
      return publishDigestDraft(ctx);
    }
    if (data === 'digest:edit') {
      setExpect(ctx.from.id, 'edit_digest');
      await ctx.answerCbQuery();
      return ctx.reply(askEditDigest());
    }
    if (data === 'digest:skip') {
      clearDigestDraft();
      markDigestRunToday();
      await ctx.answerCbQuery();
      await ctx.editMessageText(digestSkipped()).catch(() => ctx.reply(digestSkipped()));
      return ctx.reply('菜单在这里～', mainKb(ctx));
    }
  }

  if (data.startsWith('media:')) {
    if (!isAdmin(u)) {
      await ctx.answerCbQuery();
      return;
    }
    const session = getSession(ctx.from.id);
    if (data === 'media:cancel') {
      clearPendingMedia(ctx.from.id);
      clearExpect(ctx.from.id);
      await ctx.answerCbQuery();
      return ctx.reply(mediaQueuedCancelled(), mainKb(ctx));
    }
    if (!session.pendingMedia) {
      await ctx.answerCbQuery('素材已过期，请重新发送');
      return ctx.reply('素材已过期，请重新发送视频。', mainKb(ctx));
    }
    if (data === 'media:market_skip') {
      await ctx.answerCbQuery('正在起草…');
      return startDraftFromPending(ctx);
    }
  }

  if (data.startsWith('draft:')) {
    if (!isAdmin(u)) {
      await ctx.answerCbQuery();
      return;
    }
    if (data === 'draft:publish') {
      await ctx.answerCbQuery('发布中…');
      return publishDraft(ctx);
    }
    if (data === 'draft:edit') {
      setExpect(ctx.from.id, 'edit_caption');
      await ctx.answerCbQuery();
      return ctx.reply(askEditCaption());
    }
    if (data === 'draft:cancel') {
      clearDraft(ctx.from.id);
      await ctx.answerCbQuery();
      await ctx.editMessageText(draftCancelled()).catch(() => ctx.reply(draftCancelled()));
      return ctx.reply('菜单在这里～', mainKb(ctx));
    }
  }

  await ctx.answerCbQuery().catch(() => {});
});

bot.on('video', async (ctx) => {
  if (isGroup(ctx)) return; // 素材整理只走私聊
  const err = needUsername(ctx);
  if (err) return ctx.reply(err);
  if (!isAdmin(usernameOf(ctx))) return ctx.reply(softRejectMedia());

  const session = getSession(ctx.from.id);
  if (session.expect === 'market_hint') {
    // 等填城市，不被 upload 状态清掉
  } else if (session.expect && session.expect !== 'upload') {
    clearExpect(ctx.from.id);
  }

  const v = ctx.message.video;
  await askVideoMarketThenDraft(ctx, {
    kind: 'video',
    fileId: v.file_id,
    thumbFileId: v.thumbnail?.file_id || null,
    captionHint: ctx.message.caption || '',
  });
});

bot.on('photo', async (ctx) => {
  if (isGroup(ctx)) return;
  const err = needUsername(ctx);
  if (err) return ctx.reply(err);
  if (!isAdmin(usernameOf(ctx))) return ctx.reply(softRejectMedia());

  const photos = ctx.message.photo;
  const best = photos[photos.length - 1];
  await buildDraftFromMedia(ctx, {
    kind: 'photo',
    fileId: best.file_id,
    hint: ctx.message.caption || '',
  });
});

bot.on('animation', async (ctx) => {
  if (isGroup(ctx)) return;
  const err = needUsername(ctx);
  if (err) return ctx.reply(err);
  if (!isAdmin(usernameOf(ctx))) return ctx.reply(softRejectMedia());

  const a = ctx.message.animation;
  await askVideoMarketThenDraft(ctx, {
    kind: 'video',
    fileId: a.file_id,
    thumbFileId: a.thumbnail?.file_id || null,
    captionHint: ctx.message.caption || '',
  });
});

bot.on('text', async (ctx) => {
  const raw = (ctx.message.text || '').trim();
  if (!raw || raw.startsWith('/')) return;

  // 群里：只有 @ 机器人（或回复机器人）才答，且不催用户名、不甩菜单
  if (isGroup(ctx)) {
    if (!isAddressedToBot(ctx)) return;
    const question = stripBotMention(raw);
    if (!question) {
      return ctx.reply('你好，有项目问题可以直接问我～', { reply_parameters: { message_id: ctx.message.message_id } });
    }
    try {
      const answer = await withTyping(ctx, () => answerUserQuestion(question));
      logEvent('qa', ctx, { question, answerLen: answer.length });
      await ctx.reply(answer.slice(0, 4000), { reply_parameters: { message_id: ctx.message.message_id } });
    } catch (e) {
      console.error(e);
      await ctx.reply('刚才有点忙，请再 @ 我问一次。', {
        reply_parameters: { message_id: ctx.message.message_id },
      }).catch(() => {});
    }
    return;
  }

  touchOwner(ctx);

  const uid = ctx.from.id;
  const session = getSession(uid);
  const u = usernameOf(ctx);
  const text = raw;

  if (isOwner(u) && session.expect === 'addadmin') {
    clearExpect(uid);
    const r = addAdmin(text);
    return ctx.reply(r.msg, mainKb(ctx));
  }
  if (isOwner(u) && session.expect === 'deladmin') {
    clearExpect(uid);
    const r = removeAdmin(text);
    return ctx.reply(r.msg, mainKb(ctx));
  }
  if (isOwner(u) && session.expect === 'setgroup') {
    clearExpect(uid);
    const arg = text.trim();
    if (/^-?\d+$/.test(arg)) {
      setTargetChat({ id: Number(arg), title: null, username: null });
      config.targetChat = arg;
    } else {
      const uname = arg.replace(/^@/, '');
      setTargetChat({ clearId: true, username: uname, title: null });
      config.targetChat = `@${uname}`;
    }
    return ctx.reply(`🎯 同步目标写为 ${describeTarget()}\n建议再到群里发一次 /bind 更稳`, mainKb(ctx));
  }

  if (isAdmin(u) && session.expect === 'market_hint') {
    if (!session.pendingMedia) {
      clearExpect(uid);
      return ctx.reply('素材已过期，请重新发送视频。', mainKb(ctx));
    }
    clearExpect(uid);
    await startDraftFromPending(ctx, text);
    return;
  }

  if (isAdmin(u) && session.expect === 'edit_caption' && session.draft) {
    session.draft.caption = text;
    clearExpect(uid);
    return ctx.reply(draftUpdated(text).slice(0, 4000), draftKeyboard());
  }

  if (isOwner(u) && session.expect === 'edit_digest') {
    clearExpect(uid);
    const prev = getDigestDraft() || {};
    const draft = setDigestDraft({
      ...prev,
      text,
      createdAt: new Date().toISOString(),
      day: prev.day || new Date().toISOString().slice(0, 10),
    });
    return ctx.reply(digestUpdated(draft.text).slice(0, 4000), digestKeyboard());
  }

  if (isOwner(u) && /^(协作|协作台|collab|菜单|menu)$/i.test(text)) {
    return replyWelcome(ctx);
  }

  if (/^(菜单|menu|开始)$/i.test(text)) {
    return replyWelcome(ctx);
  }

  try {
    const answer = await withTyping(ctx, () => answerUserQuestion(text));
    logEvent('qa', ctx, { question: text, answerLen: answer.length });
    await ctx.reply(answer.slice(0, 4000));
    await ctx.reply('需要入口的话点下面～', mainKb(ctx));
  } catch (e) {
    console.error(e);
    await ctx.reply('刚才有点忙，请再发一次试试。');
  }
});

bot.catch((err) => {
  console.error('Bot error', err);
});

console.log('Liminal TG bot starting…');
console.log(`Owner: @${config.ownerUsername}  Target: ${describeTarget()}`);

const me = await bot.telegram.getMe();
botUsername = normalizeUser(me.username);
console.log(`Bot username: @${botUsername}`);

bot.launch({ dropPendingUpdates: true, allowedUpdates: ['message', 'callback_query', 'my_chat_member'] }).then(() =>
  console.log('Bot stopped.'),
);
console.log('Bot running.');

/** 每分钟检查一次：北京时间到点则生成日报草稿发给总控（不自动进群） */
let digestBusy = false;
setInterval(async () => {
  if (!shouldRunDigestNow() || digestBusy) return;
  digestBusy = true;
  try {
    console.log('Daily privacy digest: generating…');
    await runDigestPipeline({ force: true });
    console.log('Daily privacy digest: draft sent to owner');
  } catch (e) {
    console.error('Daily privacy digest failed:', e);
    // 失败也占坑，避免整点分钟内反复刷；可用「📰 隐私日报」手动重试
    markDigestRunToday();
  } finally {
    digestBusy = false;
  }
}, 60 * 1000);

if (config.digestEnabled) {
  console.log(
    `Privacy digest scheduler on · Beijing ${String(config.digestHourBj).padStart(2, '0')}:${String(config.digestMinuteBj).padStart(2, '0')} · preview to owner first`,
  );
}

/** LIM 行情：整点定时播报 + 每 5 分钟检查 ATH / 链上销毁 */
let limPriceBusy = false;
setInterval(async () => {
  if (!config.limPriceEnabled || limPriceBusy) return;
  const { minute } = bjNow();
  const doScheduled = shouldRunScheduledPriceNow();
  const doPoll = minute % 5 === 0;
  if (!doScheduled && !doPoll) return;
  limPriceBusy = true;
  try {
    await runLimPriceTick();
  } catch (e) {
    console.error('LIM price tick failed:', e);
  } finally {
    limPriceBusy = false;
  }
}, 60 * 1000);

if (config.limPriceEnabled) {
  const hrs = config.limPriceHoursBj.map((h) => String(h).padStart(2, '0') + ':00').join(', ');
  console.log(`LIM price scheduler on · Beijing ${hrs} · ATH/burn poll every 5m`);
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
