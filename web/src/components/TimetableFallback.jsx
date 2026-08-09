import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getRouteTimetable } from "../api/client.js";

// Shown next to a stop's live ETA when there isn't one (not yet departed /
// last bus already gone). Click-triggered rather than fetched
// automatically: Bus/DailyStopTimeTable has no per-stop filter, so getting
// it costs one full TDX call per route, and eagerly fetching it for every
// route at a busy stop would burn through this account's 5-req/min limit
// on a single page view.
function nextTimes(timeTables, count = 3) {
  const now = new Date();
  const nowHM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const sorted = [...timeTables].map((t) => t.DepartureTime).sort();
  const upcoming = sorted.filter((time) => time >= nowHM);
  return { times: (upcoming.length > 0 ? upcoming : sorted).slice(0, count), isNextDay: upcoming.length === 0 };
}

export default function TimetableFallback({ city, routeId, stopId }) {
  const { t } = useTranslation();
  const [state, setState] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    setState("loading");
    getRouteTimetable(city, routeId, stopId)
      .then((data) => {
        setResult(nextTimes(data.TimeTables || []));
        setState("loaded");
      })
      .catch((err) => {
        setError(err.message);
        setState("error");
      });
  }

  if (state === "idle") {
    return (
      <button type="button" className="timetable-link" onClick={load}>
        {t("viewTimetable")}
      </button>
    );
  }
  if (state === "loading") return <span className="hint-text">{t("loading")}</span>;
  if (state === "error")
    return (
      <span className="error-text">
        {t("errorPrefix")}
        {error}
      </span>
    );
  if (!result || result.times.length === 0) return <span className="hint-text">{t("estimateNoInfo")}</span>;
  return (
    <span className="hint-text">
      {result.isNextDay ? t("nextScheduledTomorrow") : t("nextScheduled")}: {result.times.join(", ")}
    </span>
  );
}
