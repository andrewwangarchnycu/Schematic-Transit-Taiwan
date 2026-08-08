import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCities } from "../api/client.js";

export default function CitySelect({ value, onChange }) {
  const { t, i18n } = useTranslation();
  const [cities, setCities] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    getCities()
      .then(setCities)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return <p className="error-text">{t("errorPrefix")}{error}</p>;
  }

  return (
    <select
      className="city-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t("selectCity")}
    >
      <option value="">{t("selectCity")}</option>
      {cities.map((c) => (
        <option key={c.City} value={c.City}>
          {i18n.language === "zh-TW" ? c.CityName?.Zh_tw : c.CityName?.En || c.City}
        </option>
      ))}
    </select>
  );
}
