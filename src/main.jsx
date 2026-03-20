import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ProvidersTree from "./context/AppProviders";
import RootErrorBoundary from "./components/RootErrorBoundary";
import { hydrateThemeFromStorage } from "./theme/runtimeTheme";
import { setupInstallPromptCapture } from "./pwa/installPrompt";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import "./index.css";
import "./styles/themes.css";

async function bootstrap() {
  if (window.__twiteDevServiceWorkerCleanup) {
    try {
      await window.__twiteDevServiceWorkerCleanup;
    } catch (_) {}
  }

  hydrateThemeFromStorage();
  setupInstallPromptCapture();
  registerServiceWorker();

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <RootErrorBoundary>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <ProvidersTree>
            <App />
          </ProvidersTree>
        </BrowserRouter>
      </RootErrorBoundary>
    </React.StrictMode>
  );
}

void bootstrap();
