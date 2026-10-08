const SESSION_ACTIVITY_KEY = "auth:last_activity_ms";
const BROADCAST_THROTTLE_MS = 3000;

let lastBroadcastAt = 0;

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getSessionActivityStorageKey() {
  return SESSION_ACTIVITY_KEY;
}

export function getSharedSessionActivity() {
  if (typeof window === "undefined") return 0;
  return safeNumber(window.localStorage.getItem(SESSION_ACTIVITY_KEY));
}

export function markSharedSessionActivity(timestamp = Date.now(), force = false) {
  if (typeof window === "undefined") return 0;
  const safeTimestamp = safeNumber(timestamp) || Date.now();
  if (!force && safeTimestamp - lastBroadcastAt < BROADCAST_THROTTLE_MS) {
    return safeTimestamp;
  }
  try {
    window.localStorage.setItem(SESSION_ACTIVITY_KEY, String(safeTimestamp));
  } catch (error) {
    console.warn("Failed to persist shared session activity", error);
    return safeTimestamp;
  }
  lastBroadcastAt = safeTimestamp;
  return safeTimestamp;
}

export function clearSharedSessionActivity() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_ACTIVITY_KEY);
  lastBroadcastAt = 0;
}
