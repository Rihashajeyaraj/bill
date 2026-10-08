import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppShellProvider } from "./AppShellContext";
import { ConfirmProvider } from "./ConfirmContext";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { ToastProvider, useToast } from "./ToastContext";
import { PageLoadingProvider } from "./PageLoadingContext";
import { OrganizationProvider } from "./OrganizationContext";
import { FinancialYearProvider } from "./FinancialYearContext";
import { useSessionTimeout } from "../hooks/useSessionTimeout";
import { authGetRole, authGetToken, authLogout } from "../services/auth.service";
import { canAccessPathForRole } from "../services/accessControl";
import CommandPalette from "../components/shell/CommandPalette";
import NotificationCenter from "../components/shell/NotificationCenter";
import { useAppShell } from "./AppShellContext";

function SessionAndShellLayer({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { toggleTheme } = useTheme();
  const { navigateTo } = useAppShell();

  const authenticated = !!authGetToken();

  function isEditableTarget(target) {
    if (!target || typeof target !== "object" || !("tagName" in target)) return false;
    const tagName = String(target.tagName || "").toLowerCase();
    if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
    if (target.isContentEditable) return true;
    if (typeof target.closest === "function" && target.closest("[contenteditable='true']")) return true;
    return false;
  }

  useSessionTimeout({
    enabled: authenticated,
    timeoutMs: 30 * 60 * 1000,
    warningMs: 5 * 60 * 1000,
    onWarning: () => {
      toast.warning("Session expiring soon", "You will be logged out in 5 minutes due to inactivity.");
    },
    onTimeout: () => {
      authLogout();
      toast.info("Session ended", "You have been signed out for security reasons.");
      navigate("/login", { replace: true, state: { from: location.pathname } });
    }
  });

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isEditableTarget(event.target)) return;
      const key = typeof event?.key === "string" ? event.key.toLowerCase() : "";
      if (!key) return;

      if (event.altKey && key === "d") {
        event.preventDefault();
        toggleTheme();
      }

      if (key === "g" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const listener = (nextEvent) => {
          if (isEditableTarget(nextEvent.target)) return;
          const nextKey = typeof nextEvent?.key === "string" ? nextEvent.key.toLowerCase() : "";
          if (!nextKey) return;
          if (nextKey === "d") navigateTo("/dashboard");
          if (nextKey === "n") navigateTo("/app/notifications");
          if (nextKey === "r") {
            if (canAccessPathForRole(authGetRole(), "/app/reports")) navigateTo("/app/reports");
            else toast.warning("Permission denied", "Reports are blocked by Users & Roles permissions.");
          }
          if (nextKey === "p") navigateTo("/app/parties");
          if (nextKey === "i") navigateTo("/app/items");
          if (nextKey === "s") {
            if (canAccessPathForRole(authGetRole(), "/app/company-settings")) navigateTo("/app/company-settings");
            else toast.warning("Permission denied", "Company settings access is blocked for your role.");
          }
          window.removeEventListener("keydown", listener);
        };

        window.addEventListener("keydown", listener, { once: true });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleTheme, navigateTo, toast]);

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (message) => {
      toast.info("Notice", String(message || ""));
    };
    return () => {
      window.alert = originalAlert;
    };
  }, [toast]);

  return (
    <>
      {children}
      <CommandPalette />
      <NotificationCenter />
    </>
  );
}

function ProvidersTree({ children }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <PageLoadingProvider>
            <OrganizationProvider>
              <FinancialYearProvider>
                <AppShellProvider>
                  <SessionAndShellLayer>{children}</SessionAndShellLayer>
                </AppShellProvider>
              </FinancialYearProvider>
            </OrganizationProvider>
          </PageLoadingProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default ProvidersTree;
