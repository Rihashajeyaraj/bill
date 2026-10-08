let deferredInstallPromptEvent = null;
const INSTALL_STATE_EVENT = "twite:pwa-install-state-change";

function notifyInstallStateChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INSTALL_STATE_EVENT));
}

export function setupInstallPromptCapture() {
  if (typeof window === "undefined") return;
  if (window.__twiteInstallPromptSetup) return;

  window.__twiteInstallPromptSetup = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPromptEvent = event;
    notifyInstallStateChange();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPromptEvent = null;
    notifyInstallStateChange();
  });
}

export function getDeferredInstallPrompt() {
  return deferredInstallPromptEvent;
}

export function getInstallStateEventName() {
  return INSTALL_STATE_EVENT;
}

export async function promptAppInstall() {
  if (!deferredInstallPromptEvent) return { outcome: "unavailable" };

  const promptEvent = deferredInstallPromptEvent;
  deferredInstallPromptEvent = null;
  notifyInstallStateChange();

  await promptEvent.prompt();
  const result = await promptEvent.userChoice;
  const outcome = result?.outcome || "dismissed";

  if (outcome === "accepted") {
    return { outcome: "accepted" };
  }

  return { outcome: "dismissed" };
}
