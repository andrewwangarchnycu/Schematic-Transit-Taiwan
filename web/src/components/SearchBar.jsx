import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function SearchBar({ disabled, onSearch }) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");

  function submit(e) {
    e.preventDefault();
    if (keyword.trim()) {
      onSearch(keyword.trim());
    }
  }

  return (
    <form className="search-bar" onSubmit={submit}>
      <input
        type="text"
        value={keyword}
        placeholder={t("searchPlaceholder")}
        disabled={disabled}
        onChange={(e) => setKeyword(e.target.value)}
      />
      <button type="submit" disabled={disabled || !keyword.trim()}>
        {t("searchButton")}
      </button>
    </form>
  );
}
