// 卫星云图驱动体积云渲染：从 NASA GIBS 获取 Himawari-9 云图，
// 解码为云密度图（0~1），供取景场景的 texturedDeck 使用——
// 真实云的位置/形态 + 体积渲染的厚度与受光，替代纯程序化噪声。
//
// 选源理由：GIBS 返回 access-control-allow-origin: *（浏览器可直连），
// Himawari-9 每 10 分钟更新、覆盖中国全境；Band13 红外昼夜可用（黄昏/夜晚
// 可见光失效，必须用红外），Band3 可见光仅白天。
import { withTimeout } from "./abort";

const GIBS_WMS =
  "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

export type SatCloudMode = "ir" | "vis";

export type SatCloudData = {
  density: Float32Array; // width*height，0~1 云密度
  width: number;
  height: number;
  time: string; // 观测时间（UTC ISO）
  mode: SatCloudMode;
};

// 构建 GIBS WMS 请求 URL：覆盖观测点周围经度 ±10°、纬度 ±6° 的区域。
// 不传 TIME：GIBS 自动返回最新可用影像（Himawari-9 有约 1~2 小时处理延迟）。
export function buildSatCloudUrl(
  lat: number,
  lon: number,
  mode: SatCloudMode = "ir",
  width = 224,
  height = 64,
): string {
  const layer =
    mode === "ir"
      ? "Himawari_AHI_Band13_Clean_Infrared"
      : "Himawari_AHI_Band3_Red_Visible_1km";
  const bbox = `${lon - 10},${lat - 6},${lon + 10},${lat + 6}`;
  return `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&FORMAT=image/jpeg&TRANSPARENT=false&HEIGHT=${height}&WIDTH=${width}&SRS=EPSG:4326&BBOX=${bbox}`;
}

// IR 假彩色 → 云密度（0~1）。GIBS Band13 增强色标按云顶温度着色：
// 灰(暖地表/无云)=0 → 蓝=0.35 → 绿=0.55 → 黄=0.75 → 红(最冷厚云)=0.95。
function irDensity(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    sat = mx - mn;
  if (sat < 28) return 0; // 灰 = 暖地表，无云
  let d: number;
  if (b >= r && b >= g) d = 0.35; // 蓝：中云
  else if (g >= r && g >= b) d = 0.55; // 绿：较高云
  else if (r >= g && r >= b) d = g > 90 ? 0.75 : 0.95; // 黄橙/深红：冷高云
  else d = 0.5;
  return Math.min(1, d + (sat / 255) * 0.12);
}

// 可见光亮度 → 云密度（0~1）。白天亮像素=厚云；夜晚全黑=0。
function visDensity(r: number, g: number, b: number): number {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return Math.max(0, Math.min(1, (lum - 30) / 200));
}

// 获取卫星云密度图。失败返回 null（调用方回退程序化云）。
export async function fetchSatCloud(
  lat: number,
  lon: number,
  mode: SatCloudMode = "ir",
  signal?: AbortSignal,
): Promise<SatCloudData | null> {
  const width = 224,
    height = 64;
  try {
    const url = buildSatCloudUrl(lat, lon, mode, width, height);
    const res = await fetch(url, { signal: withTimeout(signal, 15000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    // 用 Image + decode 解码（兼容旧浏览器，createImageBitmap 部分 WebView 不支持）
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = URL.createObjectURL(blob);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(img.src);
    const data = ctx.getImageData(0, 0, width, height).data;
    const density = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const k = i * 4;
      density[i] =
        mode === "ir"
          ? irDensity(data[k], data[k + 1], data[k + 2])
          : visDensity(data[k], data[k + 1], data[k + 2]);
    }
    return { density, width, height, time: latestSatTime ?? "", mode };
  } catch {
    return null;
  }
}

// GIBS 最新可用观测时间（GetCapabilities 的 default 值），缓存 10 分钟。
// Himawari-9 影像有约 1~2 小时处理延迟，直接取 default 最可靠。
let latestSatTime: string | null = null;
let latestSatTimeAt = 0;
export async function getLatestSatTime(
  signal?: AbortSignal,
): Promise<string | null> {
  if (latestSatTime && Date.now() - latestSatTimeAt < 600000)
    return latestSatTime;
  try {
    const res = await fetch(
      `${GIBS_WMS}?SERVICE=WMS&REQUEST=GetCapabilities`,
      { signal: withTimeout(signal, 15000) },
    );
    if (!res.ok) return latestSatTime;
    const xml = await res.text();
    const m = xml.match(
      /<Name>Himawari_AHI_Band13_Clean_Infrared<\/Name>[\s\S]{0,4000}?<Dimension name="time"[^>]*default="([^"]+)"/,
    );
    if (m) {
      latestSatTime = m[1];
      latestSatTimeAt = Date.now();
    }
    return latestSatTime;
  } catch {
    return latestSatTime;
  }
}
