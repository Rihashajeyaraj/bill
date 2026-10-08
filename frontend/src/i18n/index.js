import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ta from "./locales/ta.json";

export const LANGUAGE_STORAGE_KEY = "app_language";

const resources = {
  en: { translation: en },
  ta: { translation: ta }
};

function getStoredLanguage() {
  if (typeof window === "undefined") return "en";
  const stored = String(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || "").trim().toLowerCase();
  return stored === "ta" ? "ta" : "en";
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: getStoredLanguage(),
    fallbackLng: "en",
    supportedLngs: ["en", "ta"],
    interpolation: {
      escapeValue: false
    },
    returnNull: false
  });
}

i18n.on("languageChanged", (lng) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng === "ta" ? "ta" : "en");
});

export default i18n;
