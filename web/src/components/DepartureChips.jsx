import { useTranslation } from "react-i18next";
import { upcomingDepartures, formatChipMinutes } from "../utils/eta.js";

// Apple-Maps-style horizontal "Upcoming Departures" row -- real queued
// buses from TDX's Estimates[] (see utils/eta.js), not synthesized future
// times. Every chip here is an actual GPS-tracked bus (unlike Apple's own
// UI, where later chips are schedule-only predictions, not live) -- so
// only the first gets a "live" badge and the rest just show their time,
// to avoid implying a live/scheduled distinction TDX doesn't give us.
export default function DepartureChips({ item }) {
  const { t } = useTranslation();
  const deps = upcomingDepartures(item);
  if (deps.length === 0) return <p className="hint-text">{t("estimateNoInfo")}</p>;

  return (
    <div className="dep-chip-row">
      {deps.map((d, idx) => (
        <div key={idx} className={`dep-chip ${idx === 0 ? "dep-chip-primary" : ""}`}>
          <span className="dep-chip-time">{formatChipMinutes(d.minutes, t)}</span>
          {(idx === 0 || d.isLast) && (
            <span className="dep-chip-status">{idx === 0 ? t("estimateLive") : t("estimateLastBus")}</span>
          )}
        </div>
      ))}
    </div>
  );
}
