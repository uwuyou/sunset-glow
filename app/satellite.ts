// 实况卫星云图数据源：
//   hima9-ir  NASA GIBS Himawari-9 红外假彩色（昼夜可用，CORS 直连，10 分钟更新）——主源
//   hima9-vis NASA GIBS Himawari-9 可见光（白天经典云图，CORS 直连）
//   fy4b      NSMC FY-4B 中国区域真彩（备）
//   himawari  NICT Himawari-8 全盘真彩（备，无 CORS 头，仅服务端代理可用）
//   viirs     NASA GIBS VIIRS 昨日真彩（兜底）
import { withTimeout } from "./abort";

export type SatSource = "hima9-ir" | "hima9-vis" | "fy4b" | "himawari" | "viirs";

const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

// GIBS Himawari-9：不传 TIME，GIBS 自动返回最新可用影像（约 1~2 小时处理延迟）
function gibsHimawari(
  layer: string,
  label: string,
  lat: number,
  lon: number,
  mode: "ir" | "vis",
): SatelliteInfo {
  const bbox = `${lon - 10},${lat - 6},${lon + 10},${lat + 6}`;
  return {
    url: `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&FORMAT=image/jpeg&TRANSPARENT=false&HEIGHT=420&WIDTH=560&SRS=EPSG:4326&BBOX=${bbox}`,
    source: mode === "ir" ? "hima9-ir" : "hima9-vis",
    label,
    time: null, // 观测时间由 getLatestSatTime 补充
  };
}

export type SatelliteInfo = {
  url: string;
  source: SatSource;
  label: string;
  time: string | null; // 观测时间（UTC ISO），VIIRS 为昨日影像无精确时刻
};

// 多帧叠加：历史影像信息
export type SatelliteFrame = {
  url: string;
  time: string; // ISO 时间
  hoursAgo: number; // 相对于当前的小时差
};

const FY4B_XML =
  "https://img.nsmc.org.cn/CLOUDIMAGE/FY4B/AGRI/GCLR/SEC/xml/FY4B-china-72h.xml";

// FY-4B 中国区域真彩：从 NSMC 72h 清单 XML 解析最新一帧影像 URL（每 15 分钟更新）
async function fy4b(signal?: AbortSignal): Promise<SatelliteInfo | null> {
  try {
    const res = await fetch(FY4B_XML, {
      signal: withTimeout(signal, 12000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const m = xml.match(/<image time="([^"]+)"[^>]*url="([^"]+)"/);
    if (!m) return null;
    const [, time, url] = m;
    return {
      url: url.startsWith("//") ? "https:" + url : url,
      source: "fy4b",
      label: "FY-4B 中国区域真彩",
      time,
    };
  } catch {
    return null;
  }
}

// Himawari-8 全盘真彩：取最近一个 10 分钟整点，并回退 20 分钟确保影像已生成
function himawari(signal?: AbortSignal): SatelliteInfo {
  const now = new Date(Date.now() - 20 * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getUTCFullYear(),
    mo = pad(now.getUTCMonth() + 1),
    d = pad(now.getUTCDate()),
    h = pad(now.getUTCHours()),
    mi = pad(Math.floor(now.getUTCMinutes() / 10) * 10);
  return {
    url: `https://himawari8.nict.go.jp/img/D531106/1d/550/${y}/${mo}/${d}/${h}${mi}00_0_0.png`,
    source: "himawari",
    label: "Himawari-8 全盘真彩",
    time: `${y}-${mo}-${d} ${h}:${mi}:00 UTC`,
  };
}

// NASA VIIRS 昨日真彩：按观测点经纬度裁剪区域（原实现，作为兜底）
function viirs(lat: number, lon: number): SatelliteInfo {
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    bbox = `${lon - 4},${lat - 3},${lon + 4},${lat + 3}`;
  return {
    url: `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&STYLES=&FORMAT=image/jpeg&TRANSPARENT=false&HEIGHT=300&WIDTH=420&SRS=EPSG:4326&BBOX=${bbox}&TIME=${day}`,
    source: "viirs",
    label: "NASA VIIRS 昨日真彩",
    time: null,
  };
}

// 按用户选择的数据源获取实况卫星图；主源失败时自动回退
export async function getSatelliteInfo(
  source: SatSource,
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<SatelliteInfo> {
  if (source === "hima9-ir")
    return gibsHimawari(
      "Himawari_AHI_Band13_Clean_Infrared",
      "Himawari-9 红外云图",
      lat,
      lon,
      "ir",
    );
  if (source === "hima9-vis")
    return gibsHimawari(
      "Himawari_AHI_Band3_Red_Visible_1km",
      "Himawari-9 可见光云图",
      lat,
      lon,
      "vis",
    );
  if (source === "fy4b") {
    const s = await fy4b(signal);
    if (s) return s;
    return gibsHimawari(
      "Himawari_AHI_Band13_Clean_Infrared",
      "Himawari-9 红外云图",
      lat,
      lon,
      "ir",
    );
  }
  if (source === "himawari") return himawari(signal);
  return viirs(lat, lon);
}

// 自动主源：GIBS Himawari-9 红外 → FY-4B 中国区域 → Himawari-9 可见光
export async function getPrimarySatellite(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<SatelliteInfo> {
  return gibsHimawari(
    "Himawari_AHI_Band13_Clean_Infrared",
    "Himawari-9 红外云图",
    lat,
    lon,
    "ir",
  );
}

// 多帧历史卫星云图（同一区域，不同时间点），用于云动态叠加可视化
// 步长 30 分钟，覆盖过去 3 小时，共 7 帧
export async function getSatelliteFrames(
  source: SatSource,
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<SatelliteFrame[]> {
  // 仅支持 GIBS 数据源（hima9-ir, hima9-vis, viirs），其他源返回空数组
  if (source !== "hima9-ir" && source !== "hima9-vis" && source !== "viirs")
    return [];
  // 估算最新可用时间：GIBS 有 ~1h 处理延迟
  const now = new Date();
  const latest = new Date(now.getTime() - 60 * 60000);
  // 如果是 VIIRS（昨日影像），取昨日同时段
  if (source === "viirs") latest.setTime(latest.getTime() - 86400000 * 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(Math.floor(d.getUTCMinutes() / 30) * 30)}:00Z`;
  const bbox = `${lon - 10},${lat - 6},${lon + 10},${lat + 6}`;
  const layer =
    source === "hima9-ir"
      ? "Himawari_AHI_Band13_Clean_Infrared"
      : source === "hima9-vis"
        ? "Himawari_AHI_Band3_Red_Visible_1km"
        : "VIIRS_SNPP_CorrectedReflectance_TrueColor";
  const baseUrl = `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&FORMAT=image/jpeg&TRANSPARENT=true&HEIGHT=420&WIDTH=560&SRS=EPSG:4326&BBOX=${bbox}`;
  // 帧按时间正序排列（最旧 → 最新）：云动态演变动画按真实时间流向播放，
  // 否则从最新倒放回过去会呈现云团反向移动
  const frames: SatelliteFrame[] = [];
  for (let i = 6; i >= 0; i--) {
    const t = new Date(latest.getTime() - i * 30 * 60000);
    const timeStr = iso(t);
    if (signal?.aborted) return [];
    frames.push({
      url: `${baseUrl}&TIME=${timeStr}`,
      time: timeStr,
      hoursAgo: i * 0.5,
    });
  }
  return frames;
}
