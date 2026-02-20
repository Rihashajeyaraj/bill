const AUTH_TAB_SESSION_KEY = "auth:tab_session_active";
const AUTH_TAB_ID_KEY = "auth:tab_id";
const AUTH_TAB_CHANNEL = "auth:tab_channel";

let channel = null;
let listening = false;

function safeTabId() {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(AUTH_TAB_ID_KEY);
  if (existing) return existing;
  const generated = `tab_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  window.sessionStorage.setItem(AUTH_TAB_ID_KEY, generated);
  return generated;
}

function ensureChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel(AUTH_TAB_CHANNEL);
  }
  return channel;
}

function handleMessage(event) {
  const payload = event?.data || {};
  if (payload.type !== "auth:ping") return;

  const thisTabId = safeTabId();
  if (!thisTabId || payload.tabId === thisTabId) return;
  if (!hasCurrentTabAuthSession()) return;

  const ch = ensureChannel();
  if (!ch) return;
  ch.postMessage({
    type: "auth:pong",
    requestId: payload.requestId,
    tabId: thisTabId
  });
}

export function startAuthTabResponder() {
  const ch = ensureChannel();
  if (!ch || listening) return;
  ch.addEventListener("message", handleMessage);
  listening = true;
}

export function stopAuthTabResponder() {
  if (!channel || !listening) return;
  channel.removeEventListener("message", handleMessage);
  listening = false;
}

export function markCurrentTabAuthSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(AUTH_TAB_SESSION_KEY, "1");
  startAuthTabResponder();
}

export function clearCurrentTabAuthSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTH_TAB_SESSION_KEY);
  stopAuthTabResponder();
}

export function hasCurrentTabAuthSession() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(AUTH_TAB_SESSION_KEY) === "1";
}

export function hasLiveAuthSiblingTab(timeoutMs = 250) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return Promise.resolve(false);
  }

  const thisTabId = safeTabId();
  const ch = ensureChannel();
  if (!thisTabId || !ch) return Promise.resolve(false);

  const requestId = `rq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    let settled = false;

    const finalize = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      ch.removeEventListener("message", onMessage);
      resolve(value);
    };

    const onMessage = (event) => {
      const payload = event?.data || {};
      if (payload.type !== "auth:pong") return;
      if (payload.requestId !== requestId) return;
      if (!payload.tabId || payload.tabId === thisTabId) return;
      finalize(true);
    };

    const timer = window.setTimeout(() => finalize(false), Math.max(100, timeoutMs));
    ch.addEventListener("message", onMessage);
    ch.postMessage({
      type: "auth:ping",
      requestId,
      tabId: thisTabId
    });
  });
}
