const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEV_CACHE_PREFIX = "twite-billing-shell-";

function isSecureOrigin() {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:" || LOCAL_HOSTS.has(window.location.hostname);
}

async function cleanupDevelopmentServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => {
        const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "";
        return scriptUrl.includes("/sw.js");
      })
      .map((registration) => registration.unregister())
  );

  if (!("caches" in window)) return;

  const cacheKeys = await caches.keys();
  await Promise.all(
    cacheKeys
      .filter((key) => key.startsWith(DEV_CACHE_PREFIX))
      .map((key) => caches.delete(key))
  );
}

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) {
    void cleanupDevelopmentServiceWorkers().catch(() => {});
    return;
  }
  if (!isSecureOrigin()) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.error("Service worker registration failed", error);
    });
  });
}
