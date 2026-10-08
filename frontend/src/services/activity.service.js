import { LS_KEYS, lsGet, lsSet, uid } from "./storage";

const MAX_NOTIFICATIONS = 120;
const MAX_ACTIVITIES = 200;
const QUOTA_FALLBACK_SIZES = [120, 90, 60, 40, 20, 10, 5, 1];
export const APP_NOTIFICATION_EVENT_NAME = "app-notifications-updated";

function nowIso() {
  return new Date().toISOString();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function sortDescByDate(list) {
  return [...list].sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());
}

function isQuotaExceededError(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    name.includes("quotaexceeded") ||
    message.includes("quotaexceeded") ||
    message.includes("storage") && message.includes("quota")
  );
}

function toSafePayload(value, fallback = {}) {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return fallback;
    if (serialized.length > 1200) {
      return { truncated: true, preview: serialized.slice(0, 1200) };
    }
    return JSON.parse(serialized);
  } catch {
    const text = String(value ?? "");
    return text ? { truncated: true, preview: text.slice(0, 1200) } : fallback;
  }
}

function safeSetWithTrim(key, list, maxCount) {
  const source = ensureArray(list).slice(0, Math.max(1, Number(maxCount || 1)));
  const attempts = [source.length, ...QUOTA_FALLBACK_SIZES]
    .map((size) => Math.min(size, source.length))
    .filter((size, index, arr) => size > 0 && arr.indexOf(size) === index);

  for (const size of attempts) {
    try {
      lsSet(key, source.slice(0, size));
      return true;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        console.warn(`Failed to write ${key}`, error);
        return false;
      }
    }
  }

  console.warn(`Skipped writing ${key}: browser storage quota exceeded.`);
  return false;
}

function safeSetValue(key, value) {
  try {
    lsSet(key, value);
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      console.warn(`Failed to write ${key}`, error);
      return false;
    }
    console.warn(`Skipped writing ${key}: browser storage quota exceeded.`);
    return false;
  }
}

function emitAppNotificationUpdate() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(APP_NOTIFICATION_EVENT_NAME));
}

export function listNotifications() {
  return sortDescByDate(ensureArray(lsGet(LS_KEYS.app_notifications, [])));
}

export function pushNotification(notification) {
  const payload = {
    id: uid("ntf_"),
    title: notification?.title || "Notification",
    description: notification?.description || "",
    tone: notification?.tone || "info",
    read: false,
    createdAt: nowIso(),
    link: notification?.link || "",
    meta: toSafePayload(notification?.meta, {})
  };
  const next = [payload, ...listNotifications()].slice(0, MAX_NOTIFICATIONS);
  safeSetWithTrim(LS_KEYS.app_notifications, next, MAX_NOTIFICATIONS);
  emitAppNotificationUpdate();
  return payload;
}

export function markNotificationRead(id) {
  const next = listNotifications().map((entry) => (entry.id === id ? { ...entry, read: true } : entry));
  safeSetWithTrim(LS_KEYS.app_notifications, next, MAX_NOTIFICATIONS);
  emitAppNotificationUpdate();
}

export function markAllNotificationsRead() {
  const next = listNotifications().map((entry) => ({ ...entry, read: true }));
  safeSetWithTrim(LS_KEYS.app_notifications, next, MAX_NOTIFICATIONS);
  emitAppNotificationUpdate();
}

export function listActivities(limit = 80) {
  const list = sortDescByDate(ensureArray(lsGet(LS_KEYS.activity_logs, [])));
  return list.slice(0, Math.max(1, limit));
}

export function logActivity(action, details = {}) {
  const payload = {
    id: uid("act_"),
    action: action || "Activity",
    details: toSafePayload(details, {}),
    createdAt: nowIso()
  };
  const next = [payload, ...listActivities(MAX_ACTIVITIES - 1)].slice(0, MAX_ACTIVITIES);
  safeSetWithTrim(LS_KEYS.activity_logs, next, MAX_ACTIVITIES);
  return payload;
}

export function ensureActivitySeed() {
  if (!listNotifications().length) {
    safeSetWithTrim(LS_KEYS.app_notifications, [
      {
        id: uid("ntf_"),
        title: "Welcome to Premium Workspace",
        description: "Use Ctrl + K to search modules and actions instantly.",
        tone: "info",
        read: false,
        createdAt: nowIso(),
        link: "/dashboard"
      }
    ], MAX_NOTIFICATIONS);
  }

  if (!listActivities().length) {
    safeSetWithTrim(LS_KEYS.activity_logs, [
      {
        id: uid("act_"),
        action: "Workspace initialized",
        details: { module: "System" },
        createdAt: nowIso()
      }
    ], MAX_ACTIVITIES);
  }
}

export function getBackupReminder() {
  return lsGet(LS_KEYS.auto_backup_reminder, { lastPromptAt: "", completedAt: "" });
}

export function markBackupReminderPrompted() {
  const current = getBackupReminder();
  const next = { ...current, lastPromptAt: nowIso() };
  safeSetValue(LS_KEYS.auto_backup_reminder, next);
  return next;
}

export function markBackupReminderCompleted() {
  const next = { lastPromptAt: nowIso(), completedAt: nowIso() };
  safeSetValue(LS_KEYS.auto_backup_reminder, next);
  return next;
}

export function isBackupReminderDue(days = 7) {
  const reminder = getBackupReminder();
  const source = reminder.completedAt || reminder.lastPromptAt;
  if (!source) return true;
  const elapsed = Date.now() - new Date(source).getTime();
  return elapsed >= days * 24 * 60 * 60 * 1000;
}
