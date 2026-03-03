import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_NAV_ITEMS } from "../config/navigation";
import { authGetRole } from "../services/auth.service";
import { companyIsCompleted } from "../services/company.service";
import { canAccessSettings } from "../services/roles";
import { canAccessPathForRole } from "../services/accessControl";
import {
  ensureActivitySeed,
  listActivities,
  logActivity
} from "../services/activity.service";
import {
  CREDIT_NOTIFICATION_EVENT_NAME,
  listCreditNotificationsCached,
  markAllCreditNotificationsRead,
  markCreditNotificationRead,
  syncCreditNotificationsFromRemote
} from "../services/creditNotifications.service";
import { maybeRunDailyCreditMonitoringCheck } from "../modules/parties/store";

const AppShellContext = createContext(null);

export function AppShellProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [shortcutHintOpen, setShortcutHintOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [activities, setActivities] = useState([]);
  const role = authGetRole();
  const setupComplete = companyIsCompleted();
  const showCompanySetup = canAccessSettings(role) && !setupComplete;

  const refreshFeeds = useCallback(async () => {
    setNotifications(listCreditNotificationsCached());
    setActivities(listActivities(90));
    try {
      const synced = await syncCreditNotificationsFromRemote();
      setNotifications(synced);
    } catch {
      // Continue with local notification cache.
    }
  }, []);

  useEffect(() => {
    try {
      ensureActivitySeed();
    } catch (error) {
      console.warn("Failed to initialize activity seed", error);
    }
    void maybeRunDailyCreditMonitoringCheck();
    void refreshFeeds();
  }, [refreshFeeds]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void maybeRunDailyCreditMonitoringCheck();
      void refreshFeeds();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [refreshFeeds]);

  useEffect(() => {
    const onNotificationsUpdated = () => {
      void refreshFeeds();
    };

    window.addEventListener(CREDIT_NOTIFICATION_EVENT_NAME, onNotificationsUpdated);
    return () => window.removeEventListener(CREDIT_NOTIFICATION_EVENT_NAME, onNotificationsUpdated);
  }, [refreshFeeds]);

  useEffect(() => {
    if (!location?.pathname) return;
    if (location.pathname === "/login") return;

    try {
      logActivity("Visited page", {
        path: location.pathname
      });
    } catch (error) {
      console.warn("Failed to log activity", error);
    }
    void refreshFeeds();
  }, [location.pathname, refreshFeeds]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const key = typeof event?.key === "string" ? event.key.toLowerCase() : "";
      if (!key) return;

      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }

      if (event.altKey && key === "n") {
        event.preventDefault();
        setNotificationOpen((prev) => !prev);
        return;
      }

      if (event.shiftKey && key === "/") {
        event.preventDefault();
        setShortcutHintOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function navigateTo(path, options = {}) {
    if (!path) return;
    navigate(path);
    if (options.log !== false) {
      try {
        logActivity("Quick navigation", { path });
      } catch (error) {
        console.warn("Failed to log activity", error);
      }
    }
    setCommandOpen(false);
    setNotificationOpen(false);
    void refreshFeeds();
  }

  async function readNotification(id) {
    try {
      await markCreditNotificationRead(id);
    } catch {
      // Continue using local cache if remote mark-read fails.
    }
    void refreshFeeds();
  }

  async function clearNotificationBadge() {
    try {
      await markAllCreditNotificationsRead();
    } catch {
      // Continue using local cache if remote mark-read fails.
    }
    void refreshFeeds();
  }

  const commandItems = useMemo(
    () =>
      APP_NAV_ITEMS
        .filter((item) => showCompanySetup || item.to !== "/app/company-setup")
        .filter((item) => canAccessPathForRole(role, item.to))
        .map((item) => ({
          id: item.to,
          title: item.label,
          subtitle: item.section,
          keywords: `${item.label} ${item.section} ${item.shortcut || ""}`,
          to: item.to
        })),
    [showCompanySetup, role]
  );

  const unreadCount = useMemo(
    () => notifications.filter((entry) => !entry.isRead).length,
    [notifications]
  );

  const value = useMemo(
    () => ({
      commandOpen,
      notificationOpen,
      shortcutHintOpen,
      setCommandOpen,
      setNotificationOpen,
      setShortcutHintOpen,
      commandItems,
      notifications,
      activities,
      unreadCount,
      navigateTo,
      readNotification,
      clearNotificationBadge,
      refreshFeeds
    }),
    [
      commandOpen,
      notificationOpen,
      shortcutHintOpen,
      commandItems,
      notifications,
      activities,
      unreadCount,
      refreshFeeds
    ]
  );

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) throw new Error("useAppShell must be used within AppShellProvider");
  return context;
}
