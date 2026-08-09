const COMPASS_KEYS = {
  N: "compass_N",
  S: "compass_S",
  E: "compass_E",
  W: "compass_W",
  NE: "compass_NE",
  NW: "compass_NW",
  SE: "compass_SE",
  SW: "compass_SW",
};

export function compassLabel(bearing, t) {
  if (!bearing) return null;
  const key = COMPASS_KEYS[bearing.toUpperCase()];
  return key ? t(key) : bearing;
}
