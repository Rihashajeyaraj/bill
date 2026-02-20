import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_NAV_ITEMS } from "../config/navigation";
import { authGetRole } from "../services/auth.service";
import { companyIsCompleted } from "../services/company.service";
import { isOwnerRole } from "../services/roles";
import {
  ensureActivitySeed,
  listActivities,
  listNotifications,
  logActivity,
  markAllNotificationsRead,
  markNotificationRead,
  pushNotification
} from "../services/activity.service";

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
  const showCompanySetup = isOwnerRole(role) && !setupComplete;

  function refreshFeeds() {
    setNotifications(listNotifications());
    setActivities(listActivities(90));
  }

  useEffect(() => {
    ensureActivitySeed();
    refreshFeeds();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => refreshFeeds(), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!location?.pathname) return;
    if (location.pathname === "/login") return;

    logActivity("Visited page", {
      path: location.pathname
    });
    refreshFeeds();
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const key = event.key.toLowerCase();

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
      logActivity("Quick navigation", { path });
    }
    setCommandOpen(false);
    setNotificationOpen(false);
    refreshFeeds();
  }

  function createNotification(payload) {
    pushNotification(payload);
    refreshFeeds();
  }

  function readNotification(id) {
    markNotificationRead(id);
    refreshFeeds();
  }

  function clearNotificationBadge() {
    markAllNotificationsRead();
    refreshFeeds();
  }

  const commandItems = useMemo(
    () =>
      APP_NAV_ITEMS.filter((item) => showCompanySetup || item.to !== "/app/company-setup").map((item) => ({
        id: item.to,
        title: item.label,
        subtitle: item.section,
        keywords: `${item.label} ${item.section} ${item.shortcut || ""}`,
        to: item.to
      })),
    [showCompanySetup]
  );

  const unreadCount = useMemo(
    () => notifications.filter((entry) => !entry.read).length,
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
      createNotification,
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
      unreadCount
    ]
  );

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) throw new Error("useAppShell must be used within AppShellProvider");
  return context;
}
