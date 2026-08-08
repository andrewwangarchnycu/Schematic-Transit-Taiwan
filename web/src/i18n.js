import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhTW from "./locales/zh-TW.json";
import en from "./locales/en.json";

const STORAGE_KEY = "tw-transit-lang";
const savedLang = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
const browserLang = typeof navigator !== "undefined" && navigator.language.startsWith("zh") ? "zh-TW" : "en";

i18n.use(initReactI18next).init({
  resources: {
    "zh-TW": { translation: zhTW },
    en: { translation: en },
  },
  lng: savedLang || browserLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, lng);
  }
});

export default i18n;
