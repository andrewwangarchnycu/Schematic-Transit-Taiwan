import { useTranslation } from "react-i18next";

export default function LangToggle() {
  const { t, i18n } = useTranslation();

  function toggle() {
    i18n.changeLanguage(i18n.language === "zh-TW" ? "en" : "zh-TW");
  }

  return (
    <button className="lang-toggle" onClick={toggle} type="button">
      {t("languageToggle")}
    </button>
  );
}
