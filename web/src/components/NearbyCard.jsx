import { useTranslation } from "react-i18next";

const MODE_BADGE_CLASS = {
  bus: "mode-bus",
  thsr: "mode-thsr",
  tra: "mode-tra",
  metro: "mode-metro",
  bike: "mode-bike",
};

function BusBody({ item, t }) {
  return <div>{t("nearbyRouteCount", { count: item.routeCount })}</div>;
}

function BikeBody({ item, t }) {
  if (!item.live) return <div className="hint-text">{t("estimateNoInfo")}</div>;
  return (
    <>
      <div>
        <span>{t("nearbyBikeRent")}</span>
        <span>{item.live.availableRent}</span>
      </div>
      <div>
        <span>{t("nearbyBikeReturn")}</span>
        <span>{item.live.availableReturn}</span>
      </div>
    </>
  );
}

function TraBody({ item, t }) {
  if (!item.live || item.live.length === 0) return <div className="hint-text">{t("estimateNoInfo")}</div>;
  return item.live.map((train, idx) => (
    <div key={idx}>
      <span>
        {train.trainType} {t("nearbyTowards")} {train.destination}
      </span>
      <span>
        {train.scheduledDeparture}
        {train.delayMinutes > 0 ? ` (+${train.delayMinutes}${t("navMinutesUnit")})` : ""}
      </span>
    </div>
  ));
}

function ThsrBody({ item, t }) {
  if (!item.live || item.live.length === 0) return <div className="hint-text">{t("estimateNoInfo")}</div>;
  return item.live.map((train, idx) => (
    <div key={idx}>
      <span>
        {t("nearbyTowards")} {train.destination}
      </span>
      <span>{train.departure}</span>
    </div>
  ));
}

function MetroBody({ item, t }) {
  if (!item.live || item.live.length === 0) return <div className="hint-text">{t("estimateNoInfo")}</div>;
  return item.live.map((entry, idx) => (
    <div key={idx}>
      <span>
        {entry.line} {t("nearbyTowards")} {entry.headsign}
      </span>
      <span>{entry.minutes != null ? `${entry.minutes} ${t("navMinutesUnit")}` : t("estimateNoInfo")}</span>
    </div>
  ));
}

const BODY_BY_MODE = { bus: BusBody, bike: BikeBody, tra: TraBody, thsr: ThsrBody, metro: MetroBody };

export default function NearbyCard({ item, onSelectBus }) {
  const { t } = useTranslation();
  const Body = BODY_BY_MODE[item.mode];
  const clickable = item.mode === "bus";

  const content = (
    <>
      <div className="info-card-header">
        <span>
          <span className={`mode-badge ${MODE_BADGE_CLASS[item.mode]}`}>{t(`mode_${item.mode}`)}</span>
          <span className="info-card-title">{item.name}</span>
        </span>
        <span className="info-card-distance">{item.distance} m</span>
      </div>
      <div className="info-card-body">{Body && <Body item={item} t={t} />}</div>
    </>
  );

  if (!clickable) {
    return <li className="info-card">{content}</li>;
  }

  return (
    <li className="info-card">
      <button type="button" className="info-card-button" onClick={() => onSelectBus(item.station)}>
        {content}
      </button>
    </li>
  );
}
