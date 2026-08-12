import { useState } from "react";
import { useTranslation } from "react-i18next";
import { enableArrivalNotification, disableArrivalNotification, isPushSupported } from "../utils/push.js";
import { isWatchActive, setWatchActive } from "../utils/personalization.js";

// MVP: fixed 5-minute arrival threshold, not user-configurable yet.
const THRESHOLD_MINUTES = 5;

export default function NotifyToggle({ city, item, label }) {
  const { t } = useTranslation();
  const watchId = `${city}:${item.StopID}:${item.RouteID}:${item.Direction ?? 0}`;
  const [active, setActive] = useState(() => isWatchActive(watchId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!isPushSupported()) return null;

  async function toggle(e) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (active) {
        await disableArrivalNotification(watchId);
        setWatchActive(watchId, false);
        setActive(false);
      } else {
        await enableArrivalNotification({
          city,
          stopId: item.StopID,
          routeId: item.RouteID,
          direction: item.Direction ?? 0,
          label,
          thresholdMinutes: THRESHOLD_MINUTES,
        });
        setWatchActive(watchId, true);
        setActive(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={`notify-toggle ${active ? "notify-toggle-active" : ""}`} disabled={busy} onClick={toggle}>
        {t(active ? "notifyOn" : "notifyOff")}
      </button>
      {error && <span className="error-text notify-error">{error}</span>}
    </>
  );
}
