// 地理工具：弧度换算、WGS‑84/GCJ‑02 纠偏、Web Mercator 投影。
// 供主视图（page.tsx 地图选点）与"值得专程拍摄范围"地图（worth-map.tsx）共用。
export const rad = (v: number) => (v * Math.PI) / 180,
  deg = (v: number) => (v * 180) / Math.PI;

// 从起点沿方位角前进 km（WGS‑84 大圆航线）
export function destination(lat: number, lon: number, bearing: number, km: number) {
  const p1 = rad(lat),
    l1 = rad(lon),
    b = rad(bearing),
    d = km / 6371;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}

// 中国大陆粗略边界，用于判断是否需要 GCJ‑02 纠偏
export function outsideChina(lat: number, lon: number) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

// 火星坐标偏移量（经典算法）
function gcjDelta(lat: number, lon: number) {
  const a = 6378245,
    ee = 0.006693421622965943,
    x = lon - 105,
    y = lat - 35;
  let dLat =
      -100 +
      2 * x +
      3 * y +
      0.2 * y * y +
      0.1 * x * y +
      0.2 * Math.sqrt(Math.abs(x)),
    dLon =
      300 +
      x +
      2 * y +
      0.1 * x * x +
      0.1 * x * y +
      0.1 * Math.sqrt(Math.abs(x));
  dLat +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  dLat +=
    ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  dLat +=
    ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) *
      2) /
    3;
  dLon +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  dLon +=
    ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  dLon +=
    ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) *
      2) /
    3;
  const rLat = rad(lat),
    magic = 1 - ee * Math.sin(rLat) ** 2,
    root = Math.sqrt(magic);
  return [
    (dLat * 180) / (((a * (1 - ee)) / (magic * root)) * Math.PI),
    (dLon * 180) / ((a / root) * Math.cos(rLat) * Math.PI),
  ];
}
export function wgsToGcj(lat: number, lon: number): [number, number] {
  if (outsideChina(lat, lon)) return [lat, lon];
  const [dLat, dLon] = gcjDelta(lat, lon);
  return [lat + dLat, lon + dLon];
}
export function gcjToWgs(lat: number, lon: number): [number, number] {
  if (outsideChina(lat, lon)) return [lat, lon];
  let wLat = lat,
    wLon = lon;
  for (let i = 0; i < 3; i++) {
    const [gLat, gLon] = wgsToGcj(wLat, wLon);
    wLat += lat - gLat;
    wLon += lon - gLon;
  }
  return [wLat, wLon];
}

// Web Mercator：经纬度 ↔ 世界坐标（瓦片坐标系，256×2^zoom 全局）
export function lonLatToWorld(lon: number, lat: number, zoom: number) {
  const size = 256 * 2 ** zoom,
    clamped = Math.max(-85.05112878, Math.min(85.05112878, lat)),
    sin = Math.sin(rad(clamped));
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}
export function worldToLonLat(x: number, y: number, zoom: number) {
  const size = 256 * 2 ** zoom,
    lon = (x / size) * 360 - 180,
    n = Math.PI - (2 * Math.PI * y) / size,
    lat = deg(Math.atan(Math.sinh(n)));
  return { lat, lon };
}
