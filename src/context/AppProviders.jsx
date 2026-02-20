import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppShellProvider } from "./AppShellContext";
import { ConfirmProvider } from "./ConfirmContext";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { ToastProvider, useToast } from "./ToastContext";
import { PageLoadingProvider } from "./PageLoadingContext";
import { OrganizationProvider } from "./OrganizationContext";
import { useSessionTimeout } from "../hooks/useSessionTimeout";
import { authGetToken, authLogout } from "../services/auth.service";
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
      if (event.altKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggleTheme();
      }

      if (event.key.toLowerCase() === "g" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const listener = (nextEvent) => {
          const key = nextEvent.key.toLowerCase();
          if (key === "d") navigateTo("/dashboard");
          if (key === "r") navigateTo("/app/reports");
          if (key === "p") navigateTo("/app/parties");
          if (key === "i") navigateTo("/app/items");
          if (key === "s") navigateTo("/app/company-settings");
          window.removeEventListener("keydown", listener);
        };

        window.addEventListener("keydown", listener, { once: true });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleTheme, navigateTo]);

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
              <AppShellProvider>
                <SessionAndShellLayer>{children}</SessionAndShellLayer>
              </AppShellProvider>
            </OrganizationProvider>
          </PageLoadingProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default ProvidersTree;
