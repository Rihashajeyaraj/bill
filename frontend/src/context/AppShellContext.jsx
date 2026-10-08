import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_NAV_ITEMS } from "../config/navigation";
import { authGetRole } from "../services/auth.service";
import { companyIsCompleted } from "../services/company.service";
import { canAccessSettings } from "../services/roles";
import { canAccessPathForRole } from "../services/accessControl";
import {
  APP_NOTIFICATION_EVENT_NAME,
  ensureActivitySeed,
  listNotifications as listAppNotifications,
  listActivities,
  logActivity,
  markAllNotificationsRead,
  markNotificationRead
} from "../services/activity.service";
import {
  CREDIT_NOTIFICATION_EVENT_NAME,
  listCreditNotificationsCached,
  markAllCreditNotificationsRead,
  markCreditNotificationRead,
  syncCreditNotificationsFromRemote
} from "../services/creditNotifications.service";
import {
  STOCK_NOTIFICATION_EVENT_NAME,
  listStockNotificationsCached,
  markAllStockNotificationsRead,
  markStockNotificationRead,
  syncStockNotificationsFromRemote
} from "../services/stockNotifications.service";
import { listItems } from "../modules/items/store";
import { listParties } from "../modules/parties/store";
import { syncTdsComplianceReminders } from "../services/tds.service";
import { useOrganization } from "./OrganizationContext";

const AppShellContext = createContext(null);
const REMOTE_NOTIFICATION_REFRESH_COOLDOWN_MS = 30 * 1000;

function resolveNotificationType(entry, fallback = "credit") {
  const directType = String(entry?.notificationType || "").trim().toLowerCase();
  if (directType === "stock") return "stock";
  if (directType === "credit") return "credit";
  const alertType = String(entry?.alertType || "").trim().toLowerCase();
  if (alertType === "low_stock") return "stock";
  return fallback;
}

function mergeNotifications(creditList, stockList, appList, options = {}) {
  const allowedPartyIds = options?.allowedPartyIds instanceof Set ? options.allowedPartyIds : null;
  const allowedItemIds = options?.allowedItemIds instanceof Set ? options.allowedItemIds : null;
  const hasPartyScope = !!allowedPartyIds?.size;
  const hasItemScope = !!allowedItemIds?.size;

  const normalizedCredit = (Array.isArray(creditList) ? creditList : [])
    .map((entry) => ({
      ...entry,
      notificationType: resolveNotificationType(entry, "credit")
    }))
    .filter((entry) => {
      if (!hasPartyScope) return true;
      const partyId = String(entry?.partyId || "").trim();
      return !partyId || allowedPartyIds.has(partyId);
    });
  const normalizedStock = (Array.isArray(stockList) ? stockList : [])
    .map((entry) => ({
      ...entry,
      notificationType: resolveNotificationType(entry, "stock")
    }))
    .filter((entry) => {
      if (!hasItemScope) return true;
      const itemId = String(entry?.itemId || "").trim();
      return !itemId || allowedItemIds.has(itemId);
    });
  const normalizedApp = (Array.isArray(appList) ? appList : [])
    .filter((entry) => String(entry?.meta?.kind || "").startsWith("tds_"))
    .map((entry) => ({
    ...entry,
    notificationType: "app",
    isRead: !!entry?.read,
    createdAt: entry?.createdAt || new Date().toISOString()
  }));
  return [...normalizedCredit, ...normalizedStock, ...normalizedApp].sort(
    (a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime()
  );
}

export function AppShellProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { organizationId } = useOrganization();

  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [shortcutHintOpen, setShortcutHintOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [activities, setActivities] = useState([]);
  const lastRemoteRefreshAtRef = useRef(0);
  const remoteRefreshPromiseRef = useRef(null);
  const role = authGetRole();
  const setupComplete = companyIsCompleted();
  const showCompanySetup = canAccessSettings(role) && !setupComplete;

  const refreshFeeds = useCallback(async (options = {}) => {
    const remote = options?.remote === true;
    const force = options?.force === true;
    syncTdsComplianceReminders();
    const allowedPartyIds = new Set(listParties().map((entry) => String(entry?.id || "").trim()).filter(Boolean));
    const allowedItemIds = new Set(listItems().map((entry) => String(entry?.id || "").trim()).filter(Boolean));
    const cachedCredit = listCreditNotificationsCached();
    const cachedStock = listStockNotificationsCached();
    const cachedApp = listAppNotifications();
    const cachedMerged = mergeNotifications(cachedCredit, cachedStock, cachedApp, {
      allowedPartyIds,
      allowedItemIds
    });
    setNotifications(cachedMerged);
    setActivities(listActivities(90));

    if (!remote) return cachedMerged;

    if (!force && Date.now() - lastRemoteRefreshAtRef.current < REMOTE_NOTIFICATION_REFRESH_COOLDOWN_MS) {
      return cachedMerged;
    }
    if (remoteRefreshPromiseRef.current) return remoteRefreshPromiseRef.current;

    const remotePromise = (async () => {
      const [creditResult, stockResult] = await Promise.allSettled([
        syncCreditNotificationsFromRemote(),
        syncStockNotificationsFromRemote()
      ]);
      const nextCredit = creditResult.status === "fulfilled" ? creditResult.value : cachedCredit;
      const nextStock = stockResult.status === "fulfilled" ? stockResult.value : cachedStock;
      const merged = mergeNotifications(nextCredit, nextStock, listAppNotifications(), {
        allowedPartyIds,
        allowedItemIds
      });
      setNotifications(merged);
      lastRemoteRefreshAtRef.current = Date.now();
      return merged;
    })();

    remoteRefreshPromiseRef.current = remotePromise.finally(() => {
      remoteRefreshPromiseRef.current = null;
    });

    return remoteRefreshPromiseRef.current;
  }, []);

  useEffect(() => {
    try {
      ensureActivitySeed();
    } catch (error) {
      console.warn("Failed to initialize activity seed", error);
    }
    void refreshFeeds();
  }, [refreshFeeds, organizationId]);

  useEffect(() => {
    const onNotificationsUpdated = () => {
      void refreshFeeds();
    };

    window.addEventListener(CREDIT_NOTIFICATION_EVENT_NAME, onNotificationsUpdated);
    window.addEventListener(STOCK_NOTIFICATION_EVENT_NAME, onNotificationsUpdated);
    window.addEventListener(APP_NOTIFICATION_EVENT_NAME, onNotificationsUpdated);
    return () => {
      window.removeEventListener(CREDIT_NOTIFICATION_EVENT_NAME, onNotificationsUpdated);
      window.removeEventListener(STOCK_NOTIFICATION_EVENT_NAME, onNotificationsUpdated);
      window.removeEventListener(APP_NOTIFICATION_EVENT_NAME, onNotificationsUpdated);
    };
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

  async function readNotification(input) {
    const id =
      typeof input === "object" && input !== null
        ? String(input?.id || "").trim()
        : String(input || "").trim();
    if (!id) return;

    const selectedType =
      typeof input === "object" && input !== null
        ? resolveNotificationType(input, "")
        : "";
    const matched = notifications.find((entry) => String(entry?.id || "") === id);
    const resolvedType = selectedType || resolveNotificationType(matched, "credit");

    try {
      if (resolvedType === "app") {
        markNotificationRead(id);
      } else if (resolvedType === "stock") {
        await markStockNotificationRead(id);
      } else {
        await markCreditNotificationRead(id);
      }
    } catch {
      // Continue using local cache if remote mark-read fails for selected feed.
      if (resolvedType === "stock") {
        try {
          await markCreditNotificationRead(id);
        } catch {
          // noop
        }
      } else {
        try {
          await markStockNotificationRead(id);
        } catch {
          // noop
        }
      }
    }
    void refreshFeeds();
  }

  async function clearNotificationBadge() {
    try {
      markAllNotificationsRead();
      await markAllCreditNotificationsRead();
      await markAllStockNotificationsRead();
    } catch {
      // Continue using local cache if remote mark-read fails for either feed.
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
