/**
 * 轻量会话状态（内存）。重启后清空。
 */
const sessions = new Map();

export function getSession(userId) {
  const id = String(userId);
  if (!sessions.has(id)) {
    sessions.set(id, { expect: null, draft: null, pendingMedia: null });
  }
  return sessions.get(id);
}

export function setExpect(userId, expect) {
  const s = getSession(userId);
  s.expect = expect;
  return s;
}

export function clearExpect(userId) {
  const s = getSession(userId);
  s.expect = null;
  return s;
}

export function setDraft(userId, draft) {
  const s = getSession(userId);
  s.draft = draft;
  return s;
}

export function clearDraft(userId) {
  const s = getSession(userId);
  s.draft = null;
  s.expect = null;
  return s;
}

export function setPendingMedia(userId, media) {
  const s = getSession(userId);
  s.pendingMedia = media;
  return s;
}

export function clearPendingMedia(userId) {
  const s = getSession(userId);
  s.pendingMedia = null;
  return s;
}
