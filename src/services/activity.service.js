import { LS_KEYS, lsGet, lsSet, uid } from "./storage";

function nowIso() {
  return new Date().toISOString();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function sortDescByDate(list) {
  return [...list].sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());
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
    meta: notification?.meta || {}
  };
  const next = [payload, ...listNotifications()].slice(0, 120);
  lsSet(LS_KEYS.app_notifications, next);
  return payload;
}

export function markNotificationRead(id) {
  const next = listNotifications().map((entry) => (entry.id === id ? { ...entry, read: true } : entry));
  lsSet(LS_KEYS.app_notifications, next);
}

export function markAllNotificationsRead() {
  const next = listNotifications().map((entry) => ({ ...entry, read: true }));
  lsSet(LS_KEYS.app_notifications, next);
}

export function listActivities(limit = 80) {
  const list = sortDescByDate(ensureArray(lsGet(LS_KEYS.activity_logs, [])));
  return list.slice(0, Math.max(1, limit));
}

export function logActivity(action, details = {}) {
  const payload = {
    id: uid("act_"),
    action: action || "Activity",
    details,
    createdAt: nowIso()
  };
  const next = [payload, ...listActivities(199)].slice(0, 200);
  lsSet(LS_KEYS.activity_logs, next);
  return payload;
}

export function ensureActivitySeed() {
  if (!listNotifications().length) {
    lsSet(LS_KEYS.app_notifications, [
      {
        id: uid("ntf_"),
        title: "Welcome to Premium Workspace",
        description: "Use Ctrl + K to search modules and actions instantly.",
        tone: "info",
        read: false,
        createdAt: nowIso(),
        link: "/dashboard"
      }
    ]);
  }

  if (!listActivities().length) {
    lsSet(LS_KEYS.activity_logs, [
      {
        id: uid("act_"),
        action: "Workspace initialized",
        details: { module: "System" },
        createdAt: nowIso()
      }
    ]);
  }
}

export function getBackupReminder() {
  return lsGet(LS_KEYS.auto_backup_reminder, { lastPromptAt: "", completedAt: "" });
}

export function markBackupReminderPrompted() {
  const current = getBackupReminder();
  const next = { ...current, lastPromptAt: nowIso() };
  lsSet(LS_KEYS.auto_backup_reminder, next);
  return next;
}

export function markBackupReminderCompleted() {
  const next = { lastPromptAt: nowIso(), completedAt: nowIso() };
  lsSet(LS_KEYS.auto_backup_reminder, next);
  return next;
}

export function isBackupReminderDue(days = 7) {
  const reminder = getBackupReminder();
  const source = reminder.completedAt || reminder.lastPromptAt;
  if (!source) return true;
  const elapsed = Date.now() - new Date(source).getTime();
  return elapsed >= days * 24 * 60 * 60 * 1000;
}
