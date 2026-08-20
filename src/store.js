import fs from 'fs-extra';
import path from 'path';
import { config, normalizeUser } from './config.js';

const defaultStore = () => ({
  admins: [],
  ownerChatId: null,
  targetChatId: null,
  targetChatTitle: null,
  targetChatUsername: null,
  updatedAt: new Date().toISOString(),
});

function ensure() {
  fs.ensureDirSync(path.dirname(config.dataFile));
}

function mergeSeedAdmins(store) {
  let changed = false;
  for (const a of config.seedAdmins) {
    if (!a || a === config.ownerUsername) continue;
    if (!store.admins.map(normalizeUser).includes(a)) {
      store.admins.push(a);
      changed = true;
    }
  }
  return changed;
}

export function loadStore() {
  ensure();
  if (!fs.existsSync(config.dataFile)) {
    const store = defaultStore();
    mergeSeedAdmins(store);
    fs.writeJsonSync(config.dataFile, store, { spaces: 2 });
    return store;
  }
  const store = { ...defaultStore(), ...fs.readJsonSync(config.dataFile) };
  store.admins = Array.isArray(store.admins) ? store.admins : [];
  // 云端重启后仍合并 .env 种子名单，避免 store.json 空名单导致无法传视频
  if (mergeSeedAdmins(store)) {
    saveStore(store);
  }
  return store;
}

function saveStore(store) {
  ensure();
  store.updatedAt = new Date().toISOString();
  fs.writeJsonSync(config.dataFile, store, { spaces: 2 });
}

export function listAdmins() {
  const store = loadStore();
  return [...new Set([config.ownerUsername, ...store.admins.map(normalizeUser)])];
}

export function isOwner(username) {
  return normalizeUser(username) === config.ownerUsername;
}

export function isAdmin(username) {
  const u = normalizeUser(username);
  if (!u) return false;
  if (u === config.ownerUsername) return true;
  return loadStore().admins.map(normalizeUser).includes(u);
}

export function addAdmin(username) {
  const u = normalizeUser(username);
  if (!u) throw new Error('用户名无效');
  if (u === config.ownerUsername) return { ok: true, msg: '该账号已在总控名单' };
  const store = loadStore();
  if (store.admins.map(normalizeUser).includes(u)) {
    return { ok: true, msg: `@${u} 已在协作名单` };
  }
  store.admins.push(u);
  saveStore(store);
  return { ok: true, msg: `已加入协作：@${u}` };
}

export function removeAdmin(username) {
  const u = normalizeUser(username);
  if (u === config.ownerUsername) {
    return { ok: false, msg: '总控账号不可移除' };
  }
  const store = loadStore();
  const before = store.admins.length;
  store.admins = store.admins.filter((x) => normalizeUser(x) !== u);
  saveStore(store);
  if (store.admins.length === before) {
    return { ok: false, msg: `@${u} 不在协作名单` };
  }
  return { ok: true, msg: `已移出协作：@${u}` };
}

export function rememberOwnerChatId(chatId) {
  if (!chatId) return;
  const store = loadStore();
  if (store.ownerChatId === chatId) return;
  store.ownerChatId = chatId;
  saveStore(store);
}

export function getOwnerChatId() {
  return loadStore().ownerChatId || null;
}

export function setTargetChat({ id, title, username, clearId = false } = {}) {
  const store = loadStore();
  if (clearId) store.targetChatId = null;
  if (id != null) store.targetChatId = id;
  if (title !== undefined) store.targetChatTitle = title;
  if (username !== undefined) {
    store.targetChatUsername = username ? String(username).replace(/^@/, '') : null;
  }
  saveStore(store);
  return store;
}

/** 发送目标：优先已绑定的数字群 ID，否则回退 .env 的 @username */
export function getPublishChatId() {
  const store = loadStore();
  if (store.targetChatId) return store.targetChatId;
  return config.targetChat;
}

export function describeTarget() {
  const store = loadStore();
  if (store.targetChatId) {
    const name = store.targetChatTitle || store.targetChatUsername || store.targetChatId;
    return `${name}（ID: ${store.targetChatId}）`;
  }
  return String(config.targetChat);
}
