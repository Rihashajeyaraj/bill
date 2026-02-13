import { useEffect, useRef } from "react";

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

  useEffect(() => {
    if (!enabled) return undefined;

    const markActivity = () => {
      lastActivityRef.current = Date.now();
      warnedRef.current = false;
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });

    const interval = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;

      if (!warnedRef.current && idleMs >= timeoutMs - warningMs && idleMs < timeoutMs) {
        warnedRef.current = true;
        onWarning?.();
      }

      if (idleMs >= timeoutMs) {
        onTimeout?.();
      }
    }, 15000);

    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
    };
  }, [enabled, timeoutMs, warningMs, onWarning, onTimeout]);
}
