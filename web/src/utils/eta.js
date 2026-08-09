// Shared by StopDetail (Stations tab) and LinesTab (per-stop live ETA),
// both of which render TDX Bus/EstimatedTimeOfArrival records.
//
// TDX Bus StopStatus: 0 normal, 1 not yet departed, 2 skipped (traffic
// control), 3 last bus already left, 4 no service today.
//
// The live API gives EstimateTime (seconds, only for GPS-tracked buses
// already en route) and/or NextBusTime (absolute ISO timestamp, the
// scheduled prediction) -- a stop can have either, both, or neither
// depending on the route. minutesUntil() normalizes both into one number
// so sorting and display agree.
export function minutesUntil(item) {
  if (item.EstimateTime != null) return item.EstimateTime / 60;
  if (item.NextBusTime) {
    const diffMs = new Date(item.NextBusTime).getTime() - Date.now();
    return diffMs / 60000;
  }
  return null;
}

export function formatEstimate(item, t) {
  if (item.StopStatus === 4) return t("estimateNoService");
  const minutes = minutesUntil(item);
  if (minutes == null) {
    return item.StopStatus === 1 ? t("estimateNotDeparted") : t("estimateNoInfo");
  }
  if (minutes <= 1.5) return t("estimateArriving");
  return t("estimateMinutes", { minutes: Math.round(minutes) });
}
