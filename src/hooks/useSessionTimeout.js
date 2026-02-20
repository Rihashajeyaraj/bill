import { useEffect, useRef } from "react";
import {
  getSessionActivityStorageKey,
  getSharedSessionActivity,
  markSharedSessionActivity
} from "../services/sessionActivity.service";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keypress", "touchstart", "scroll"];

export function useSessionTimeout({
  enabled = true,
  timeoutMs = 30 * 60 * 1000,
  warningMs = 5 * 60 * 1000,
  onWarning,
  onTimeout
}) {
  const lastActivityRef = useRef(Date.now());
  const warnedRef = useRef(false);
  const timedOutRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;

    const getLastKnownActivity = () =>
      Math.max(lastActivityRef.current, getSharedSessionActivity());

    const markActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      markSharedSessionActivity(now);
      warnedRef.current = false;
      timedOutRef.current = false;
    };

    const syncFromSharedActivity = () => {
      const shared = getSharedSessionActivity();
      if (shared > lastActivityRef.current) {
        lastActivityRef.current = shared;
        warnedRef.current = false;
        timedOutRef.current = false;
      }
    };

    const onStorage = (event) => {
      if (!event?.key || event.key === getSessionActivityStorageKey()) {
        syncFromSharedActivity();
      }
    };

    markSharedSessionActivity(lastActivityRef.current, true);
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    window.addEventListener("focus", syncFromSharedActivity);
    window.addEventListener("storage", onStorage);

    const interval = window.setInterval(() => {
      const idleMs = Date.now() - getLastKnownActivity();

      if (!warnedRef.current && idleMs >= timeoutMs - warningMs && idleMs < timeoutMs) {
        warnedRef.current = true;
        onWarning?.();
      }

      if (idleMs >= timeoutMs && !timedOutRef.current) {
        const latestIdleMs = Date.now() - getLastKnownActivity();
        if (latestIdleMs < timeoutMs) return;
        timedOutRef.current = true;
        onTimeout?.();
      }
    }, 15000);

    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      window.removeEventListener("focus", syncFromSharedActivity);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, timeoutMs, warningMs, onWarning, onTimeout]);
}
