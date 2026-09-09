"use client";
// 静态托管标记（由 vite.static.config.ts 注入）：GitHub Pages 无 /api/scene 后端
declare const __STATIC__: boolean;
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  CloudLightning,
  Compass,
  Database,
  Layers3,
  MapPin,
  Maximize2,
  Mountain,
  Navigation,
  Pause,
  Play,
  RefreshCw,
  Satellite,
  Search,
  Settings,
  Share2,
  Sparkles,
  Sunrise,
  TrendingUp,
  Trophy,
  Wind,
  X,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPosition, getTimes } from "suncalc";
import { toPng } from "html-to-image";
import TerrainProfile from "./terrain-profile";
import SunPathProfile from "./sun-path-profile";
import CityCloudProfile from "./city-cloud-profile";
import { cirrusCount, deckThreshold } from "./cloud-deck";
import { classifyGenus, type CloudGenus } from "./cloud-genus";
import { cloudProfile, type CloudLayerProfile } from "./cloud-profile";
import { cloudTone, GENUS_TONE, calcOvercast } from "./cloud-color";
import { withTimeout } from "./abort";
import { rankCities, type CityRank } from "./cities";
import {
  getPrimarySatellite,
  getSatelliteInfo,
  getSatelliteFrames,
  type SatSource,
  type SatelliteInfo,
  type SatelliteFrame,
} from "./satellite";

// 给 Promise 加超时保护：超时抛错，避免分享/截图在部分设备上挂起导致按钮卡在"生成中"
function withPromiseTimeout<T>(p: Promise<T>, ms: number, msg: string) {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(msg)), ms)),
  ]);
}

// 触发浏览器下载一个文件（File 是 Blob 子类）
function downloadBlob(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

type Mode = "dawn" | "sunset";
type Solar = { altitude: number; azimuth: number };
type SceneData = {
  weather: {
    hourly: Record<string, (number | string)[]>;
    daily: { time: string[]; sunrise: string[]; sunset: string[] };
    elevation: number;
  };
  dem: {
    grid: number[][];
    depths: number[];
    laterals: number[];
    source: string;
  };
  corridor?: {
    distances: number[];
    forecasts: { hourly: Record<string, (number | string)[]> }[];
  };
  sunPath?: {
    distances: number[];
    forecasts: { hourly: Record<string, (number | string)[]> }[];
  };
  comparison?: { hourly: Record<string, (number | string)[]> } | null;
  satellite: SatelliteInfo;
  updated: string;
};
const places = {
  "成都·天府广场": { lat: 30.657, lon: 104.066 },
  "德阳·旌阳": { lat: 31.129, lon: 104.346 },
  "成都·龙泉山": { lat: 30.52, lon: 104.31 },
};
type PlaceKey = keyof typeof places | "地图选点";
// 任意地名搜索：Open-Meteo Geocoding API 返回的候选地点
type GeoResult = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  admin2?: string;
  timezone?: string;
};
async function searchPlace(q: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    q,
  )}&count=6&language=zh&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`geocoding ${res.status}`);
  const json = await res.json();
  const results: GeoResult[] = json?.results ?? [];
  return results.map((r: Record<string, unknown>) => ({
    name: String(r.name ?? q),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    country: r.country ? String(r.country) : undefined,
    admin1: r.admin1 ? String(r.admin1) : undefined,
    admin2: r.admin2 ? String(r.admin2) : undefined,
    timezone: r.timezone ? String(r.timezone) : undefined,
  }));
}
const rad = (v: number) => (v * Math.PI) / 180,
  deg = (v: number) => (v * 180) / Math.PI;
function solarPosition(date: Date, lat: number, lon: number): Solar {
  // 无效日期（如数据未加载的瞬时状态）回退为太阳在地平线下，避免 NaN 传导到云色/天空渐变
  if (!Number.isFinite(date.getTime())) return { altitude: -90, azimuth: 0 };
  const position = getPosition(date, lat, lon);
  return { altitude: position.altitude, azimuth: position.azimuth };
}
function eventDate(event: Date, offset: number) {
  return new Date(event.getTime() + offset * 60000);
}
function beijingDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
// 卫星观测时刻（UTC）转北京时间显示；无精确时刻返回“昨日影像”
function fmtObsTime(t: string | null) {
  if (!t) return "昨日影像";
  const m = t.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return t;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 8 * 3600000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} 北京时间`;
}
function dip(heightKm: number) {
  return deg(Math.acos(6371 / (6371 + heightKm)));
}
function destination(lat: number, lon: number, bearing: number, km: number) {
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
function outsideChina(lat: number, lon: number) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
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
function wgsToGcj(lat: number, lon: number): [number, number] {
  if (outsideChina(lat, lon)) return [lat, lon];
  const [dLat, dLon] = gcjDelta(lat, lon);
  return [lat + dLat, lon + dLon];
}
function gcjToWgs(lat: number, lon: number): [number, number] {
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
function lonLatToWorld(lon: number, lat: number, zoom: number) {
  const size = 256 * 2 ** zoom,
    clamped = Math.max(-85.05112878, Math.min(85.05112878, lat)),
    sin = Math.sin(rad(clamped));
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}
function worldToLonLat(x: number, y: number, zoom: number) {
  const size = 256 * 2 ** zoom,
    lon = (x / size) * 360 - 180,
    n = Math.PI - (2 * Math.PI * y) / size,
    lat = deg(Math.atan(Math.sinh(n)));
  return { lat, lon };
}

function AmapPicker({
  open,
  initial,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  initial: { lat: number; lon: number };
  onOpenChange: (open: boolean) => void;
  onConfirm: (point: { lat: number; lon: number }) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null),
    dragRef = useRef({
      active: false,
      moved: false,
      x: 0,
      y: 0,
      worldX: 0,
      worldY: 0,
    });
  const [center, setCenter] = useState(() => {
      const [lat, lon] = wgsToGcj(initial.lat, initial.lon);
      return { lat, lon };
    }),
    [zoom, setZoom] = useState(11),
    [size, setSize] = useState({ width: 760, height: 470 });
  useEffect(() => {
    if (!open) return;
    const [lat, lon] = wgsToGcj(initial.lat, initial.lon);
    setCenter({ lat, lon });
    const node = mapRef.current;
    if (!node) return;
    const resize = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    resize.observe(node);
    return () => resize.disconnect();
  }, [open, initial.lat, initial.lon]);
  const centerWorld = lonLatToWorld(center.lon, center.lat, zoom),
    tileMinX = Math.floor((centerWorld.x - size.width / 2) / 256),
    tileMaxX = Math.floor((centerWorld.x + size.width / 2) / 256),
    tileMinY = Math.floor((centerWorld.y - size.height / 2) / 256),
    tileMaxY = Math.floor((centerWorld.y + size.height / 2) / 256),
    tileCount = 2 ** zoom,
    tiles: { x: number; y: number; left: number; top: number; src: string }[] =
      [];
  for (let y = tileMinY; y <= tileMaxY; y++)
    for (let x = tileMinX; x <= tileMaxX; x++) {
      if (y < 0 || y >= tileCount) continue;
      const wrappedX = ((x % tileCount) + tileCount) % tileCount,
        server = ((wrappedX + y) % 4) + 1;
      tiles.push({
        x,
        y,
        left: x * 256 - centerWorld.x + size.width / 2,
        top: y * 256 - centerWorld.y + size.height / 2,
        src: `https://wprd0${server}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=7&x=${wrappedX}&y=${y}&z=${zoom}`,
      });
    }
  const [wgsLat, wgsLon] = gcjToWgs(center.lat, center.lon);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="amap-dialog sm:max-w-[820px]"
      >
        <DialogHeader className="amap-header">
          <DialogTitle>高德地图选择观测点</DialogTitle>
          <DialogDescription>
            点击或拖动地图，将中心标记移到实际拍摄位置。
          </DialogDescription>
        </DialogHeader>
        <div
          ref={mapRef}
          className="amap-canvas"
          role="application"
          aria-label="高德地图选点"
          onPointerDown={(e) => {
            const world = lonLatToWorld(center.lon, center.lat, zoom);
            dragRef.current = {
              active: true,
              moved: false,
              x: e.clientX,
              y: e.clientY,
              worldX: world.x,
              worldY: world.y,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current;
            if (!drag.active) return;
            const dx = e.clientX - drag.x,
              dy = e.clientY - drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
            setCenter(worldToLonLat(drag.worldX - dx, drag.worldY - dy, zoom));
          }}
          onPointerUp={(e) => {
            const drag = dragRef.current;
            if (!drag.active) return;
            drag.active = false;
            if (!drag.moved) {
              const rect = e.currentTarget.getBoundingClientRect(),
                world = lonLatToWorld(center.lon, center.lat, zoom);
              setCenter(
                worldToLonLat(
                  world.x + e.clientX - rect.left - rect.width / 2,
                  world.y + e.clientY - rect.top - rect.height / 2,
                  zoom,
                ),
              );
            }
          }}
          onWheel={(e) => {
            e.preventDefault();
            setZoom((v) =>
              Math.max(4, Math.min(17, v + (e.deltaY < 0 ? 1 : -1))),
            );
          }}
        >
          {tiles.map((tile) => (
            <img
              key={`${zoom}-${tile.x}-${tile.y}`}
              src={tile.src}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
              style={{ left: tile.left, top: tile.top }}
            />
          ))}
          <div className="amap-crosshair">
            <MapPin size={30} />
          </div>
          <div className="amap-zoom">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setZoom((v) => Math.min(17, v + 1))}
            >
              +
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setZoom((v) => Math.max(4, v - 1))}
            >
              −
            </button>
          </div>
          <span className="amap-attribution">高德地图 · 直连瓦片</span>
        </div>
        <div className="amap-footer">
          <div>
            <b>
              WGS‑84 {wgsLat.toFixed(6)}, {wgsLon.toFixed(6)}
            </b>
            <small>已自动校正高德 GCJ‑02 偏移</small>
          </div>
          <div>
            <button onClick={() => onOpenChange(false)}>取消</button>
            <button
              className="primary"
              onClick={() => {
                onConfirm({ lat: wgsLat, lon: wgsLon });
                onOpenChange(false);
              }}
            >
              使用此观测点
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
async function directSceneData(
  lat: number,
  lon: number,
  bearing: number,
  signal?: AbortSignal,
): Promise<SceneData> {
  const depths = [2, 8, 18, 32, 48, 65, 82],
    laterals = [-18, -9, 0, 9, 18],
    points: number[][] = [];
  for (const depth of depths)
    for (const lateral of laterals) {
      const center = destination(lat, lon, bearing, depth);
      points.push(destination(center[0], center[1], bearing + 90, lateral));
    }
  const lats = points.map((p) => p[0].toFixed(5)).join(","),
    lons = points.map((p) => p[1].toFixed(5)).join(",");
  const corridorDistances = [0, 80, 160, 240, 320, 400, 520, 640],
    corridorPoints = corridorDistances.map((km) =>
      destination(lat, lon, bearing, km),
    );
  // 日出/日落光路剖面：沿太阳方位以细粒度采样云量（0→200km），
  // 供「光路」视图绘制沿程云带与云边界标注
  const sunPathDistances = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100, 120, 150, 180, 200],
    sunPathPoints = sunPathDistances.map((km) =>
      destination(lat, lon, bearing, km),
    );
  const corridorLats = corridorPoints.map((p) => p[0].toFixed(5)).join(","),
    corridorLons = corridorPoints.map((p) => p[1].toFixed(5)).join(",");
  const vars =
    "cloud_cover_low,cloud_cover_mid,cloud_cover_high,direct_radiation,diffuse_radiation,boundary_layer_height,geopotential_height_850hPa,geopotential_height_500hPa,geopotential_height_250hPa";
  const wfUrl = `https://api.open-meteo.com/v1/ecmwf?latitude=${lat}&longitude=${lon}&hourly=${vars}&daily=sunrise,sunset&timezone=Asia%2FShanghai&forecast_days=7`;
  const demUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
  const visUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=visibility,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,cape,wind_speed_500hPa,wind_direction_500hPa,wind_gusts_10m,wind_speed_10m,wind_direction_10m,wind_speed_850hPa,wind_direction_850hPa,wind_speed_250hPa,wind_direction_250hPa&timezone=Asia%2FShanghai&forecast_days=7`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=aerosol_optical_depth,pm2_5&timezone=Asia%2FShanghai&forecast_days=7`;
  const corridorUrl = `https://api.open-meteo.com/v1/ecmwf?latitude=${corridorLats}&longitude=${corridorLons}&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high&timezone=Asia%2FShanghai&forecast_days=7`;
  const sunPathLats = sunPathPoints.map((p) => p[0].toFixed(5)).join(","),
    sunPathLons = sunPathPoints.map((p) => p[1].toFixed(5)).join(","),
    sunPathUrl = `https://api.open-meteo.com/v1/ecmwf?latitude=${sunPathLats}&longitude=${sunPathLons}&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high&timezone=Asia%2FShanghai&forecast_days=7`;
  const [wfResult, demResult, visResult, aqResult, corResult, sunPathResult] =
    await Promise.allSettled([
      fetch(wfUrl, { signal: withTimeout(signal, 20000) }),
      fetch(demUrl, { signal: withTimeout(signal, 20000) }),
      fetch(visUrl, { signal: withTimeout(signal, 20000) }),
      fetch(airUrl, { signal: withTimeout(signal, 20000) }),
      fetch(corridorUrl, { signal: withTimeout(signal, 20000) }),
      fetch(sunPathUrl, { signal: withTimeout(signal, 20000) }),
    ]);
  if (wfResult.status !== "fulfilled" || !wfResult.value.ok)
    throw new Error("ECMWF 暂时无法连接");
  const weather = await wfResult.value.json();
  // DEM 高程清洗：Open-Meteo elevation 接口存在间歇性返回空数组/长度不足/含 null 的情况，
  // 若直接透传会导致地形网格出现 NaN、取景界面地形消失。任何异常都回退站址海拔。
  const fallbackElev = Number(weather.elevation) || 500;
  let elevations = Array(points.length).fill(fallbackElev);
  if (demResult.status === "fulfilled" && demResult.value.ok) {
    const elevationData = await demResult.value.json();
    if (
      Array.isArray(elevationData.elevation) &&
      elevationData.elevation.length === points.length
    ) {
      elevations = elevationData.elevation.map((e) =>
        Number.isFinite(Number(e)) ? Number(e) : fallbackElev,
      );
    }
  }
  let comparison = null;
  if (visResult.status === "fulfilled" && visResult.value.ok) {
    const v = await visResult.value.json();
    comparison = v;
    weather.hourly.visibility = v.hourly?.visibility || [];
    // 阵风与多层风场（供「阵风/风切变」面板）
    [
      "wind_gusts_10m",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_speed_850hPa",
      "wind_direction_850hPa",
      "wind_speed_500hPa",
      "wind_direction_500hPa",
      "wind_speed_250hPa",
      "wind_direction_250hPa",
    ].forEach((k) => {
      weather.hourly[k] = v.hourly?.[k] || [];
    });
  }
  if (aqResult.status === "fulfilled" && aqResult.value.ok) {
    const a = await aqResult.value.json();
    weather.hourly.aerosol_optical_depth =
      a.hourly?.aerosol_optical_depth || [];
    weather.hourly.pm2_5 = a.hourly?.pm2_5 || [];
  }
  const corridorData =
    corResult.status === "fulfilled" && corResult.value.ok
      ? await corResult.value.json()
      : [];
  const sunPathData =
    sunPathResult.status === "fulfilled" && sunPathResult.value.ok
      ? await sunPathResult.value.json()
      : [];
  const grid = depths.map((_, di) =>
    laterals.map((__, li) => elevations[di * laterals.length + li]),
  );
  const satellite = await getPrimarySatellite(lat, lon, signal);
  return {
    weather,
    comparison,
    dem: { grid, depths, laterals, source: "Open-Meteo 90m DEM" },
    corridor: {
      distances: corridorDistances,
      forecasts: Array.isArray(corridorData) ? corridorData : [],
    },
    sunPath: {
      distances: sunPathDistances,
      forecasts: Array.isArray(sunPathData) ? sunPathData : [],
    },
    satellite,
    updated: new Date().toISOString(),
  };
}

function Scene({
  solar,
  cover,
  visible,
  dem,
  demDepths,
  demLaterals,
  heights,
  focal,
  playing,
  viewBearing,
  scenario,
  wind500,
  aod,
  visibilityKm,
  precipitation,
  illumination,
  event,
  lat,
  lon,
  cb,
  genus,
  onLookChange,
  pitch,
}: {
  solar: Solar;
  cover: number[];
  visible: boolean[];
  dem: number[][];
  demDepths?: number[];
  demLaterals?: number[];
  heights: number[];
  focal: number;
  playing: boolean;
  viewBearing: number;
  scenario: string;
  wind500: number;
  aod: number;
  visibilityKm: number;
  precipitation: number;
  illumination: boolean[];
  event: Date | null;
  lat: number;
  lon: number;
  cb: boolean;
  genus: { low: CloudGenus; mid: CloudGenus; high: CloudGenus };
  onLookChange: (look: number) => void;
  pitch?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    drag = useRef({ on: false, x: 0 });
  const [look, setLook] = useState(0);
  useEffect(() => {
    const c = ref.current,
      x = c?.getContext("2d");
    if (!c || !x) return;
    let f = 0,
      id = 0;
    const draw = () => {
      const d = Math.min(devicePixelRatio || 1, 2),
        r = c.getBoundingClientRect(),
        w = r.width,
        h = r.height;
      if (c.width !== w * d || c.height !== h * d) {
        c.width = w * d;
        c.height = h * d;
      }
      x.setTransform(d, 0, 0, d, 0, 0);
      // 仰角联动：上仰 → 地平线下移、天空占比增大；下俯反之
      const pitchPx = Math.max(-18, Math.min(18, pitch ?? 0)) * (h / 560),
        hor = h * 0.61 + pitchPx,
        warm = Math.max(0, 1 - Math.abs(solar.altitude + 1) / 7),
        aerosol = Math.max(0, Math.min(1, (aod - 0.08) / 0.72)),
        cloudiness = Math.min(
          1,
          (cover[0] * 0.28 + cover[1] * 0.42 + cover[2] * 0.3) / 100,
        ),
        murk = Math.max(
          0,
          Math.min(1, (14 - visibilityKm) / 14 + aerosol * 0.45),
        ),
        // 阴天遮光因子（提前计算，供天空渐变和云色共用）
        overcast = calcOvercast(cover, precipitation, visibilityKm * 1000),
        sky = x.createLinearGradient(0, 0, 0, hor);
      sky.addColorStop(
        0,
        // 阴天时天空顶部从蓝紫向灰白偏移
        overcast > 0.4
          ? `rgb(${56 + overcast * 50},${64 + overcast * 40},${78 - overcast * 20})`
          : `rgb(${29 + warm * 35 + aerosol * 42 + cloudiness * 18},${45 + warm * 12 + aerosol * 34 + cloudiness * 14},${84 + warm * 12 + aerosol * 18 + cloudiness * 8})`,
      );
      sky.addColorStop(
        0.65,
        overcast > 0.4
          ? `rgb(${68 + overcast * 30},${72 + overcast * 20},${76 - overcast * 10})`
          : `rgb(${104 + warm * 95},${91 + warm * 35},${124 - warm * 38})`,
      );
      sky.addColorStop(
        1,
        overcast > 0.4
          ? `rgb(${80 + overcast * 20},${76 + overcast * 15},${74 - overcast * 5})`
          : `rgb(${220 + warm * 32},${116 + warm * 58},${70 + warm * 18})`,
      );
      x.fillStyle = sky;
      x.fillRect(0, 0, w, h);
      if (cloudiness > 0.12) {
        x.fillStyle = `rgba(56,67,91,${cloudiness * (0.13 + murk * 0.16 + overcast * 0.2)})`;
        x.fillRect(0, 0, w, hor * 0.72);
      }
      if (aerosol > 0) {
        const haze = x.createLinearGradient(
          0,
          hor - h * 0.28,
          0,
          hor + h * 0.1,
        );
        haze.addColorStop(0, "rgba(235,210,182,0)");
        haze.addColorStop(0.72, `rgba(235,201,164,${aerosol * 0.32})`);
        haze.addColorStop(1, `rgba(220,190,160,${aerosol * 0.48})`);
        x.fillStyle = haze;
        x.fillRect(0, hor - h * 0.3, w, h * 0.42);
      }
      // 全画幅横向视场角：下方的云、太阳和 DEM 都进入同一套透视投影。
      const horizontalFov = Math.max(
          3.4,
          Math.min(74, (2 * Math.atan(36 / (2 * focal)) * 180) / Math.PI),
        ),
        referenceFov = 26,
        frameScale = Math.max(0.35, Math.min(5, referenceFov / horizontalFov));
      // 以地平线为相机光轴缩放；不只是太阳，而是云层、远景和地形一同变焦。
      x.save();
      x.translate(w / 2, hor);
      x.scale(frameScale, frameScale);
      x.translate(-w / 2, -hor);
      const azimuthOffset = ((solar.azimuth - viewBearing + 540) % 360) - 180,
        sx = w / 2 + ((azimuthOffset + look) * w) / referenceFov,
        sy = hor - solar.altitude * 9;
      // 阴天时太阳光晕淡出
      if (overcast < 0.5) {
        const g = x.createRadialGradient(sx, sy, 1, sx, sy, 150);
        g.addColorStop(0, "rgba(255,244,185,.95)");
        g.addColorStop(0.1, "rgba(255,190,100,.65)");
        g.addColorStop(1, "rgba(255,120,50,0)");
        x.fillStyle = g;
        x.fillRect(0, 0, w, hor);
        x.beginPath();
        x.arc(
          sx,
          sy,
          Math.max(3, Math.min(w * 0.16, (0.53 / referenceFov) * w * 0.5)),
          0,
          Math.PI * 2,
        );
        x.fillStyle = overcast > 0.3 ? `rgba(200,190,180,${0.5 - overcast})` : "#fff1b3";
        x.fill();
      }
      // 巧摄式太阳轨迹弧线：以日出/日落为锚点 ±150 分钟，随取景环顾同步平移
      if (event) {
        x.save();
        x.setLineDash([3, 5]);
        x.lineWidth = 1.1;
        x.strokeStyle = "rgba(255,206,132,0.62)";
        x.beginPath();
        let started = false;
        for (let m = -150; m <= 150; m += 4) {
          const pp = getPosition(
              new Date(event.getTime() + m * 60000),
              lat,
              lon,
            ),
            rel = ((pp.azimuth - viewBearing + 540) % 360) - 180;
          if (Math.abs(rel + look) > referenceFov / 2 + 8) continue;
          const px = w / 2 + ((rel + look) * w) / referenceFov,
            py = hor - pp.altitude * 9;
          started ? x.lineTo(px, py) : (x.moveTo(px, py), (started = true));
        }
        x.stroke();
        x.setLineDash([]);
        const ep = getPosition(event, lat, lon),
          er = ((ep.azimuth - viewBearing + 540) % 360) - 180;
        if (Math.abs(er + look) <= referenceFov / 2 + 8) {
          x.fillStyle = "rgba(255,224,160,0.95)";
          x.beginPath();
          x.arc(
            w / 2 + ((er + look) * w) / referenceFov,
            hor,
            2.6,
            0,
            Math.PI * 2,
          );
          x.fill();
        }
        x.restore();
      }
      const n = (v: number) => {
          const q = Math.sin(v * 12.9898 + 78.233) * 43758.5453;
          return q - Math.floor(q);
        },
        drift = f * (0.12 + wind500 * 0.008) + look * 2,
        wrap = (v: number, pad = 240) => ((v + pad) % (w + pad * 2)) - pad,
        clamp = (v: number) => Math.max(0, Math.min(1, v)),
        mix = (from: number[], to: number[], amount: number) =>
          from.map((v, i) => Math.round(v + (to[i] - v) * clamp(amount))),
        aodHaze = clamp((aod - 0.08) / 0.65),
        lowSun = clamp(1 - Math.abs(solar.altitude + 1.2) / 8);
      // 云色统一取自共享比色模块 cloud-color.ts（依据《火烧云定量预报》比色卡）：
      // 云底越高色域越全（金黄→绯红）、AOD 升高则褪灰；三处渲染共用，避免漂移。
      // overcast 阴天因子使厚云/雨天云色褪为灰白，不再渲染暖色。
      const highTone = cloudTone(heights[2] || 10, genus.high, illumination[2], lowSun, aodHaze, overcast),
        midTone = cloudTone(heights[1] || 5.5, genus.mid, illumination[1], lowSun, aodHaze, overcast),
        lowTone = cloudTone(heights[0] || 1.5, genus.low, illumination[0], lowSun, aodHaze, overcast);
      const veil = (
        y: number,
        amount: number,
        tone: number[],
        sunlit: boolean,
      ) => {
        x.save();
        const v = x.createLinearGradient(0, y - 65, 0, y + 42);
        v.addColorStop(0, `rgba(${tone.join(",")},${0.025 + amount / 1100})`);
        v.addColorStop(0.55, `rgba(${tone.join(",")},${0.055 + amount / 500})`);
        v.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = v;
        x.fillRect(0, y - 80, w, 135);
        x.globalAlpha = (sunlit ? 0.2 : 0.1) + amount / 520;
        x.strokeStyle = `rgb(${mix(tone, [255, 232, 190], sunlit ? 0.48 : 0.15).join(",")})`;
        x.lineWidth = 1;
        for (let i = 0; i < 14; i++) {
          const yy = y - 35 + i * 6 + n(i) * 8;
          x.beginPath();
          x.moveTo(-20, yy);
          x.bezierCurveTo(
            w * 0.26,
            yy - 11 + n(i + 9) * 14,
            w * 0.68,
            yy + 10 - n(i + 4) * 16,
            w + 20,
            yy + n(i + 8) * 9,
          );
          x.stroke();
        }
        x.restore();
      };
      const cirrus = (
        y: number,
        amount: number,
        tone: number[],
        sunlit: boolean,
      ) => {
        x.save();
        const lines = cirrusCount(amount);
        x.globalAlpha = lines ? (sunlit ? 0.18 : 0.1) + amount / 350 : 0;
        x.strokeStyle = `rgb(${mix(tone, [255, 236, 197], sunlit ? 0.55 : 0.12).join(",")})`;
        for (let i = 0; i < lines; i++) {
          const px = wrap(i * 97 + drift * 0.55),
            yy = y - 38 + n(i) * 74;
          x.lineWidth = 0.65 + n(i + 2) * 2.2;
          x.beginPath();
          x.moveTo(px - 70, yy + n(i + 7) * 8);
          x.bezierCurveTo(
            px - 18,
            yy - 18,
            px + 54 + wind500 * 1.5,
            yy + 16,
            px + 132 + wind500 * 2.3,
            yy - 9 + n(i + 3) * 17,
          );
          x.stroke();
        }
        x.restore();
      };
      const texturedDeck = (
        y: number,
        amount: number,
        tone: number[],
        scale: number,
        low = false,
        sunlit = false,
      ) => {
        const ow = 224,
          oh = low ? 86 : 64,
          off = document.createElement("canvas"),
          ox = off.getContext("2d");
        if (!ox) return;
        off.width = ow;
        off.height = oh;
        const image = ox.createImageData(ow, oh),
          fade = (v: number) => v * v * (3 - 2 * v),
          noise2 = (u: number, v: number) => {
            const ix = Math.floor(u),
              iy = Math.floor(v),
              tx = u - ix,
              ty = v - iy,
              a = n(ix * 91.37 + iy * 17.19),
              b = n((ix + 1) * 91.37 + iy * 17.19),
              c2 = n(ix * 91.37 + (iy + 1) * 17.19),
              d2 = n((ix + 1) * 91.37 + (iy + 1) * 17.19),
              sx = fade(tx),
              sy = fade(ty);
            return (a + (b - a) * sx) * (1 - sy) + (c2 + (d2 - c2) * sx) * sy;
          },
          fbm = (u: number, v: number) =>
            noise2(u, v) * 0.54 +
            noise2(u * 2.03 + 19, v * 2.03 - 11) * 0.29 +
            noise2(u * 4.1 - 7, v * 4.1 + 23) * 0.12 +
            noise2(u * 8.2 + 31, v * 8.2 - 29) * 0.05,
          worley = (u: number, v: number) => {
            const ix = Math.floor(u),
              iy = Math.floor(v);
            let nearest = 99;
            for (let j = -1; j <= 1; j++)
              for (let i = -1; i <= 1; i++) {
                const cx = ix + i + n((ix + i) * 71.1 + (iy + j) * 23.7),
                  cy = iy + j + n((ix + i) * 31.7 + (iy + j) * 91.3),
                  dx = cx - u,
                  dy = cy - v,
                  distance = Math.sqrt(dx * dx + dy * dy);
                nearest = Math.min(nearest, distance);
              }
            return Math.min(1, nearest / 1.05);
          },
          bright = mix(tone, [255, 225, 170], sunlit ? 0.46 : 0.08),
          shade = mix(tone, [27, 39, 56], low ? 0.56 : 0.38),
          threshold = deckThreshold(amount),
          flow = drift * (low ? 0.011 : 0.016);
        for (let py = 0; py < oh; py++)
          for (let px = 0; px < ow; px++) {
            const u = (px / ow) * (low ? 5.6 : 7.4) + flow,
              v = (py / oh) * (low ? 2.4 : 3.3),
              perlin = fbm(u, v),
              cellular =
                1 -
                worley(u * (low ? 2.1 : 2.8) + 7, v * (low ? 2.1 : 2.8) - 5),
              // 云属配方：Perlin 定平滑主体，Worley 按权重制造团块/孔洞。
              shape = perlin * 0.7 + cellular * 0.3,
              height01 = py / oh,
              vertical = Math.pow(
                Math.sin(Math.PI * height01),
                low ? 0.72 : 1.3,
              ),
              // 高频 Worley 侵蚀云缘（G 通道思路），制造絮状细节
              erosion = worley(u * 5.7 - 14, v * 5.7 + 9) * (low ? 0.17 : 0.24),
              density =
                clamp((shape - erosion - threshold) * 5.2) *
                clamp(vertical * 1.7),
              underside = clamp((height01 - 0.22) * 1.4),
              beer = Math.exp(-density * (sunlit ? 1.35 : 1.9)),
              lightMix = sunlit ? clamp(beer + (1 - height01) * 0.28) : 0.05,
              color = mix(
                mix(tone, bright, lightMix),
                shade,
                underside * (0.72 + aodHaze * 0.16),
              ),
              k = (py * ow + px) * 4;
            image.data[k] = color[0];
            image.data[k + 1] = color[1];
            image.data[k + 2] = color[2];
            image.data[k + 3] = Math.round(density * (low ? 224 : 196));
          }
        ox.putImageData(image, 0, 0);
        x.save();
        x.imageSmoothingEnabled = true;
        const depthCount = low ? 2 : 1;
        for (let depth = 0; depth < depthCount; depth++) {
          const parallax = depth === 0 ? 0.62 : 1,
            deckH = oh * scale * (low ? 2.55 : 2.1) * parallax,
            deckY = y - deckH * (0.42 + depth * 0.12),
            alpha = depth === 0 ? 0.58 : 0.9;
          x.globalAlpha = alpha;
          x.drawImage(off, -14, deckY, w + 28, deckH);
        }
        x.restore();
      };
      const strata = (
        y: number,
        amount: number,
        tone: number[],
        sunlit: boolean,
      ) => {
        x.save();
        x.globalAlpha = (sunlit ? 0.24 : 0.14) + amount / 330;
        x.fillStyle = `rgb(${tone.join(",")})`;
        for (let band = 0; band < 4; band++) {
          x.beginPath();
          x.moveTo(-25, y - 38 + band * 22);
          for (let px = 0; px <= w + 50; px += 48)
            x.lineTo(px, y - 38 + band * 22 + (n(px * 0.11 + band) - 0.5) * 16);
          x.lineTo(w + 25, y + 4 + band * 22);
          x.lineTo(-25, y + 14 + band * 22);
          x.closePath();
          x.fill();
        }
        x.restore();
      };
      const cloudY = (km: number) =>
        hor - (Math.min(13, Math.max(0.2, km)) / 13) * h * 0.5;
      // 积雨云 Cb：高耸花椰菜状塔身 + 薄广铁砧云顶 + 垂落雨幡 + 乳状云下缘。
      // 以 CAPE/降水/高空风判定为强对流时替代通用低云层，呈现雷暴云顶天立地的形态。
      const cumulonimbus = (
        baseY: number,
        anvilY: number,
        amount: number,
        tone: number[],
        sunlit: boolean,
      ) => {
        const a = clamp(amount / 100);
        if (a <= 0) return;
        const cx = wrap(sunlit ? sx : w / 2 + look, 320),
          towerH = baseY - anvilY,
          baseW = w * (0.1 + a * 0.09),
          anvilW = w * (0.46 + a * 0.24),
          top = anvilY + Math.max(12, towerH * 0.05),
          anvilH = Math.max(13, towerH * 0.055),
          dark = mix(tone, [28, 34, 50], sunlit ? 0.74 : 0.52),
          glow = mix(tone, [255, 216, 150], sunlit ? 0.6 : 0.13),
          topGlow = mix(glow, [255, 238, 190], 0.35);
        x.save();
        // 1) 雨幡：从云底向下垂落的弥散丝缕，随高度渐隐、略带弯曲。
        //    高空风（wind500）驱动丝缕整体顺风倾斜飘散，强对流时更为显著。
        const windTilt = Math.min(0.95, (wind500 || 0) * 0.02);
        for (let i = 0; i < 14; i++) {
          const rx = cx + (n(i * 3.1 + 1) - 0.5) * baseW * 2.6,
            len = towerH * (0.55 + n(i * 5.7 + 3) * 0.75),
            sway = (n(i * 7.9 + 6) - 0.5) * len * 0.55,
            drift = windTilt * len * (0.55 + n(i * 11.3) * 0.5),
            half = baseW * (0.05 + n(i * 4.3 + 2) * 0.085),
            g = x.createLinearGradient(0, baseY, 0, baseY + len);
          g.addColorStop(0, `rgba(${dark.join(",")},${0.42 + n(i * 2.9) * 0.26})`);
          g.addColorStop(0.55, `rgba(${dark.join(",")},${0.17 + n(i * 2.9) * 0.12})`);
          g.addColorStop(1, `rgba(${dark.join(",")},0)`);
          x.globalAlpha = (0.22 + n(i * 6.1) * 0.26) * a;
          x.fillStyle = g;
          x.beginPath();
          x.moveTo(rx - half, baseY);
          x.quadraticCurveTo(
            rx - half * 0.4 + drift * 0.45,
            baseY + len * 0.55 + sway,
            rx + drift,
            baseY + len,
          );
          x.quadraticCurveTo(
            rx + half * 0.4 + drift * 0.45,
            baseY + len * 0.55 + sway,
            rx + half,
            baseY,
          );
          x.closePath();
          x.fill();
        }
        // 2) 塔状主体：连续堆叠的云泡（花椰菜状），加垂直抖动避免规则层叠
        for (let layer = 0; layer < 2; layer++) {
          const off = layer ? 0.6 : 1,
            isFront = layer === 1;
          for (let i = 0; i < 20; i++) {
            const t = i / 19,
              jit = (n(i * 7.7 + layer * 13) - 0.5) * towerH * 0.06,
              yy = baseY - towerH * t + jit,
              bulge = 0.5 + 0.9 * Math.sin(Math.PI * Math.min(1, t * 1.7)),
              ww = (baseW * (0.45 + bulge) + anvilW * 0.16 * t) * off,
              rr = 0.65 + n(i * 3.1 + layer * 5) * 0.55,
              lit = isFront ? (sunlit ? 0.32 + 0.42 * t : 0.1) : 0.03,
              col = isFront
                ? mix(dark, glow, lit)
                : mix(dark, [16, 20, 32], 0.45);
            x.globalAlpha = (isFront ? 0.94 : 0.82) * a;
            x.fillStyle = `rgb(${col.join(",")})`;
            x.beginPath();
            x.ellipse(
              cx + (n(i * 5.1 + layer * 9 + 4) - 0.5) * ww * 0.7,
              yy,
              ww * rr,
              Math.max(10, towerH * 0.12),
              0,
              0,
              Math.PI * 2,
            );
            x.fill();
          }
        }
        // 3) 薄广铁砧云顶：扁平云砧大幅向两侧铺展
        x.globalAlpha = 0.95 * a;
        x.fillStyle = `rgb(${topGlow.join(",")})`;
        x.beginPath();
        x.moveTo(cx - anvilW, top);
        x.quadraticCurveTo(
          cx - anvilW * 0.45,
          top - anvilH * 1.5,
          cx,
          top - anvilH * 0.4,
        );
        x.quadraticCurveTo(
          cx + anvilW * 0.45,
          top - anvilH * 1.5,
          cx + anvilW,
          top,
        );
        x.quadraticCurveTo(
          cx + anvilW * 0.6,
          top + anvilH * 1.1,
          cx + anvilW * 0.2,
          top + anvilH * 0.55,
        );
        x.quadraticCurveTo(cx, top + anvilH * 1.2, cx - anvilW * 0.2, top + anvilH * 0.55);
        x.quadraticCurveTo(
          cx - anvilW * 0.6,
          top + anvilH * 1.1,
          cx - anvilW,
          top,
        );
        x.fill();
        // 云砧下缘：乳状云（mammatus），稀疏分布在大片阴面
        x.globalAlpha = 0.5 * a;
        x.fillStyle = `rgb(${dark.join(",")})`;
        for (let i = 0; i < 12; i++) {
          const bx = cx + (i / 11 - 0.5) * anvilW * 1.8,
            by = top + anvilH * (0.6 + n(i * 6.2) * 1.1);
          x.beginPath();
          x.ellipse(bx, by, anvilW * 0.12, anvilH * 0.7, 0, 0, Math.PI);
          x.fill();
        }
        // 4) 上冲云塔：云砧顶部的残留鼓包
        for (let i = 0; i < 6; i++) {
          const bx = cx + (i - 2.5) * anvilW * 0.38 + n(i * 9 + 2) * 24,
            by = top - anvilH * (0.4 + n(i * 3 + 7) * 1.3);
          x.globalAlpha = 0.85 * a;
          x.fillStyle = `rgb(${topGlow.join(",")})`;
          x.beginPath();
          x.ellipse(
            bx,
            by,
            anvilW * 0.11,
            anvilH * (0.7 + n(i) * 0.9),
            0,
            0,
            Math.PI * 2,
          );
          x.fill();
        }
        // 5) 塔基暗面
        x.globalAlpha = 0.4 * a;
        x.fillStyle = `rgb(${dark.join(",")})`;
        x.beginPath();
        x.ellipse(cx, baseY - 4, baseW * 1.1, towerH * 0.08, 0, 0, Math.PI * 2);
        x.fill();
        x.restore();
      };
      const highY = cloudY(heights[2] || 10),
        midY = cloudY(heights[1] || 5.5),
        lowY = cloudY(heights[0] || 1.5);
      const cbActive = visible[0] && cb,
        cbAnvilY = cloudY(Math.max(11, heights[2] || 10));
      if (cbActive) {
        cumulonimbus(
          lowY,
          cbAnvilY,
          Math.max(cover[0], cover[1]),
          lowTone,
          illumination[0] || illumination[1],
        );
      } else {
        if (visible[2]) {
          if (cover[2] > 62)
            texturedDeck(
              highY,
              cover[2] * 0.72,
              highTone,
              0.55,
              false,
              illumination[2],
            );
          else cirrus(highY, cover[2], highTone, illumination[2]);
        }
        if (visible[1]) {
          texturedDeck(midY, cover[1], midTone, 0.78, false, illumination[1]);
        }
        if (visible[0])
          texturedDeck(lowY, cover[0], lowTone, 1.18, true, illumination[0]);
      }
      const totalCover = 100 * (1 - (1-cover[0]/100)*(1-cover[1]/100)*(1-cover[2]/100));
      if (totalCover > 38) {
        const deck = x.createLinearGradient(0, highY - 28, 0, lowY + 70);
        deck.addColorStop(0, `rgba(${highTone.join(",")},${Math.max(0,.12+(totalCover-38)/360)})`);
        deck.addColorStop(1, `rgba(${midTone.join(",")},${Math.max(0,.08+(totalCover-38)/420)})`);
        x.fillStyle = deck;
        x.fillRect(-20, highY-30, w+40, Math.max(70, lowY-highY+100));
      }
      // —— 地形：DEM 双线性细分 + 多倍频分形山脊噪声，塑造层叠山峦
      //    预计算高程网格 + 远→近渐变着色，消除面片棱角
      //    防御：任何非有限高程（异常 DEM 数据）回退 500m，避免 NaN 路径导致地形消失
      const rawRows = dem.length
          ? dem
          : [
              [380, 560, 420, 640, 470],
              [520, 780, 560, 860, 610],
              [470, 700, 500, 780, 540],
              [610, 920, 640, 1000, 700],
              [540, 810, 570, 880, 620],
              [660, 980, 690, 1060, 740],
              [580, 860, 610, 940, 660],
            ],
        rows = rawRows.map((row) =>
          row.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 500)),
        ),
        flat = rows.flat(),
        mn = Math.min(...flat),
        mx = Math.max(...flat),
        span = Number.isFinite(mn) ? Math.max(120, mx - mn) : 120,
        SUB = 12,
        RU = (rows.length - 1) * SUB,
        CU = (rows[0].length - 1) * SUB,
        D0 = demDepths && demDepths.length > 1 ? demDepths : null,
        L0 = demLaterals && demLaterals.length > 1 ? demLaterals : null,
        stepLat = L0 ? (L0[1] - L0[0]) / SUB : 9 / SUB,
        dStep = (u: number) =>
          D0
            ? (D0[Math.min(rows.length - 2, Math.floor(u / SUB)) + 1] -
                D0[Math.min(rows.length - 2, Math.floor(u / SUB))]) /
              SUB
            : 9 / SUB,
        clampV = (v: number, lo: number, hi: number) =>
          Math.max(lo, Math.min(hi, v)),
        // 2D 值噪声 + 山脊变换：制造尖锐山脊与沟谷（复用 n() 哈希）
        tnoise = (u: number, v: number) => {
          const cell = (gx: number, gy: number) =>
              n(gx * 127.1 + gy * 311.7 + 7.3),
            g2 = (a: number, b: number) => {
              const ix = Math.floor(a),
                iy = Math.floor(b),
                tx = a - ix,
                ty = b - iy,
                sx = tx * tx * (3 - 2 * tx),
                sy = ty * ty * (3 - 2 * ty),
                p00 = cell(ix, iy),
                p10 = cell(ix + 1, iy),
                p01 = cell(ix, iy + 1),
                p11 = cell(ix + 1, iy + 1);
              return (
                p00 +
                (p10 - p00) * sx +
                (p01 - p00) * sy +
                (p00 - p10 - p01 + p11) * sx * sy
              );
            },
            ridge = (a: number, b: number) => {
              const v = g2(a, b);
              return 1 - Math.abs(2 * v - 1);
            };
          // 大山系 + 中山脊 + 细节纹理，山脊做高次幂锐化（更尖的刃脊、更深的沟谷）
          // 高频分量权重压低，避免相邻面片颜色跳变（消除"折纸感"）
          const big = ridge(u * 0.32 + 3.1, v * 0.32 - 1.7),
            mid = ridge(u * 0.9 - 5.3, v * 0.9 + 2.9),
            fine = g2(u * 2.4 + 11, v * 2.4 - 7),
            micro = g2(u * 5.2 - 13, v * 5.2 + 19);
          return (
            Math.pow(big, 2.2) * 0.5 +
            Math.pow(mid, 1.7) * 0.32 +
            fine * 0.1 +
            micro * 0.04
          );
        },
        elevAt = (u: number, v: number) => {
          const r = u / SUB,
            c = v / SUB,
            r0 = Math.max(0, Math.min(rows.length - 1, Math.floor(r))),
            c0 = Math.max(0, Math.min(rows[0].length - 1, Math.floor(c))),
            r1 = Math.min(rows.length - 1, r0 + 1),
            c1 = Math.min(rows[0].length - 1, c0 + 1),
            s = r - r0,
            t = c - c0,
            p00 = rows[r0][c0],
            p10 = rows[r0][c1],
            p01 = rows[r1][c0],
            p11 = rows[r1][c1],
            base =
              p00 * (1 - s) * (1 - t) +
              p10 * (1 - s) * t +
              p01 * s * (1 - t) +
              p11 * s * t;
          // 分形山脊细节：远山低频大尺度山脊，近山高频细节（自然大气透视）
          // 幅度随距离增大（近处山体起伏更明显）
          const near = u / RU,
            freq = 0.18 + 0.6 * near,
            detail = (tnoise(u * freq, v * freq) - 0.5) * 2;
          return base + detail * span * (0.22 + 0.8 * near);
        },
        // 预计算高程网格，避免每面片重复采样
        elevGrid: number[][] = [];
      for (let u = 0; u <= RU; u++) {
        const row: number[] = [];
        for (let v = 0; v <= CU; v++) row.push(elevAt(u, v));
        elevGrid.push(row);
      }
      const project = (u: number, v: number) => {
          const near = 1 - u / RU,
            width = w * (0.3 + 0.74 * near),
            left = (w - width) / 2,
            elevN = clampV((elevGrid[u][v] - mn) / span, 0, 1.3);
          return {
            x: left + (width * v) / CU,
            y:
              hor +
              (h - hor) * (0.06 + 0.8 * near ** 1.5) -
              elevN * (72 + 124 * near),
          };
        },
        tNorm = (e: number) => clampV((e - mn) / (span * 1.45), 0, 1),
        // 海拔分层配色：河谷深青 → 林线橄榄 → 草坡金褐 → 山岩暖灰 → 高岩亮褐 → 雪顶
        ELEV_STOPS: [number, number[]][] = [
          [0, [22, 52, 46]],
          [0.13, [52, 88, 60]],
          [0.29, [100, 114, 76]],
          [0.47, [144, 130, 90]],
          [0.65, [174, 150, 116]],
          [0.83, [198, 172, 142]],
          [1, [220, 196, 166]],
        ],
        ramp = (t: number) => {
          for (let i = 1; i < ELEV_STOPS.length; i++) {
            if (t <= ELEV_STOPS[i][0]) {
              const a = ELEV_STOPS[i - 1],
                b = ELEV_STOPS[i],
                k = (t - a[0]) / (b[0] - a[0]);
              return a[1].map((v, idx) => v + (b[1][idx] - v) * k);
            }
          }
          return ELEV_STOPS[ELEV_STOPS.length - 1][1];
        },
        // 太阳在视线坐标系下的方向
        sunLateral = Math.sin((azimuthOffset * Math.PI) / 180),
        sunDepth = Math.cos((azimuthOffset * Math.PI) / 180),
        sunAltW = clampV(solar.altitude * 0.2 + 0.3, -0.1, 1),
        dusk = clampV(0.62 + solar.altitude * 0.14, 0.28, 1),
        haze = [206, 156, 134],
        // 单点着色（渐变端点用）
        shade = (u: number, v: number) => {
          const e = elevGrid[u][v],
            u0 = Math.max(0, u - 1),
            u1 = Math.min(RU, u + 1),
            v0 = Math.max(0, v - 1),
            v1 = Math.min(CU, v + 1),
            sd = elevGrid[u1][v] - elevGrid[u0][v],
            sl = elevGrid[u][v1] - elevGrid[u][v0],
            sdAng = Math.atan2(sd, dStep(u) * 1000),
            slAng = Math.atan2(sl, stepLat * 1000),
            // 大气透视分层：深度方向带状雾，强化"层峦"分隔；远山保留轮廓
            layerFog = 0.5 + 0.5 * Math.sin((u / RU) * Math.PI * 2.6 + 1.1),
            fog =
              Math.pow(u / RU, 1.2) * (0.16 + murk * 0.5) +
              layerFog * 0.05 * (u / RU),
            jitter = (n(u * 37.1 + v * 13.7) - 0.5) * 0.05,
            // 山脊棱线检测：深度方向局部高点 → 轮廓光；陡坡面 → 侧光
            crest = clampV(
              (e - Math.max(elevGrid[u0][v], elevGrid[u1][v])) /
                (span * 0.1) +
                0.5,
              0,
              1,
            ),
            ridgeSteep = clampV(Math.abs(sd) / (span * 0.45), 0, 1),
            light = clampV(
              0.2 +
                -Math.sin(sdAng) * sunDepth * (0.5 + 0.55 * sunAltW) +
                -Math.sin(slAng) * sunLateral * 0.8 +
                tNorm(e) * 0.16 +
                jitter,
              -0.32,
              1.15,
            );
          let col = ramp(tNorm(e));
          // 雪顶：极高海拔混入冷白，强化山脊层次
          const snow = clampV((tNorm(e) - 0.86) / 0.14, 0, 1);
          col = mix(col, [235, 238, 240], snow * 0.8);
          col = mix(col, [255, 178, 100], clampV(light, 0, 1) * 0.62);
          // 背光面注入冷紫蓝，与暖色受光面形成互补对比
          col = mix(col, [26, 34, 62], clampV(-light, 0, 1) * 0.6);
          // 山脊轮廓光：棱线叠加暖色高光，强化层叠山峦（远山更强，勾勒天际线）
          const rim = (crest * 0.6 + ridgeSteep * 0.4) * (1 - fog * 0.3);
          col = mix(col, [255, 214, 152], rim * (0.42 + 0.3 * (u / RU)));
          // 谷地压暗：相对低洼处加深，分离相邻山体
          const valley = clampV(1 - tNorm(e) * 1.8, 0, 1);
          col = mix(col, [8, 20, 26], valley * 0.38 * (1 - fog * 0.4));
          // 大气透视：远山偏冷蓝紫、偏亮，与暖色天空分离；近山保留暖色
          const dist = u / RU,
            farCool = Math.pow(dist, 1.15);
          col = mix(col, [146, 154, 190], farCool * 0.42);
          col = mix(col, [235, 245, 250], farCool * 0.1);
          col = mix(col, haze, fog * 0.6);
          return col.map((c) => Math.round(c * dusk));
        },
        // 预计算着色网格（每点为 RGB 三元组）
        shadeGrid: number[][][] = [];
      for (let u = 0; u <= RU; u++) {
        const row: number[][] = [];
        for (let v = 0; v <= CU; v++) row.push(shade(u, v));
        shadeGrid.push(row);
      }
      for (let u = RU - 1; u >= 0; u--)
        for (let v = 0; v < CU; v++) {
          const a = project(u, v),
            b = project(u, v + 1),
            c2 = project(u + 1, v + 1),
            d2 = project(u + 1, v);
          x.beginPath();
          x.moveTo(a.x, a.y);
          x.lineTo(b.x, b.y);
          x.lineTo(c2.x, c2.y);
          x.lineTo(d2.x, d2.y);
          x.closePath();
          // 远边→近边线性渐变，平滑纵深与坡向过渡，消除面片棱角
          const ca = shadeGrid[u][v],
            cb = shadeGrid[u][v + 1],
            cc = shadeGrid[u + 1][v + 1],
            cd = shadeGrid[u + 1][v],
            farCol = [
              Math.round((ca[0] + cb[0]) / 2),
              Math.round((ca[1] + cb[1]) / 2),
              Math.round((ca[2] + cb[2]) / 2),
            ],
            nearCol = [
              Math.round((cc[0] + cd[0]) / 2),
              Math.round((cc[1] + cd[1]) / 2),
              Math.round((cc[2] + cd[2]) / 2),
            ],
            g = x.createLinearGradient(
              (a.x + b.x) / 2,
              (a.y + b.y) / 2,
              (c2.x + d2.x) / 2,
              (c2.y + d2.y) / 2,
            );
          g.addColorStop(0, `rgb(${farCol.join(",")})`);
          g.addColorStop(1, `rgb(${nearCol.join(",")})`);
          x.fillStyle = g;
          x.fill();
          // 同色描边填补相邻面片抗锯齿缝隙，消除网格线
          x.strokeStyle = g;
          x.lineWidth = 0.6;
          x.stroke();
        }
      // 地平线暖光混入：让最远山脊融入霞光雾气
      const hblend = x.createLinearGradient(0, hor - h * 0.05, 0, hor + h * 0.18);
      hblend.addColorStop(0, "rgba(232,176,152,0)");
      hblend.addColorStop(1, "rgba(214,158,138,0.2)");
      x.fillStyle = hblend;
      x.fillRect(0, hor - h * 0.05, w, h * 0.24);
      // 近景剪影：由山脊反射的天光渐变到画面底部的深色
      const front = Array.from({ length: CU + 1 }, (_, v) => project(0, v));
      x.beginPath();
      front.forEach((p, j) => (j ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
      x.lineTo(w, h);
      x.lineTo(0, h);
      x.closePath();
      const fg = x.createLinearGradient(0, hor + h * 0.04, 0, h);
      fg.addColorStop(
        0,
        `rgba(${mix(ramp(0), [34, 50, 52], 0.5).join(",")},0.88)`,
      );
      fg.addColorStop(0.35, "rgba(22,34,38,0.94)");
      fg.addColorStop(1, "#0a1014");
      x.fillStyle = fg;
      x.fill();
      x.restore();
      x.fillStyle = "rgba(7,14,16,.72)";
      x.fillRect(16, 16, 214, 54);
      x.fillStyle = "#e8f0ed";
      x.font = "600 12px system-ui";
      x.fillText(
        `太阳 ${solar.altitude.toFixed(2)}° / ${solar.azimuth.toFixed(1)}°`,
        30,
        38,
      );
      x.fillStyle = "#92a4a1";
      x.font = "11px system-ui";
      x.fillText(
        `全画幅视角 ${horizontalFov.toFixed(1)}° · ${focal} mm · DEM 网格`,
        30,
        57,
      );
      f += playing ? 1 : 0;
      id = requestAnimationFrame(draw);
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [
    solar,
    cover,
    visible,
    dem,
    demDepths,
    demLaterals,
    heights,
    focal,
    playing,
    look,
    pitch,
    viewBearing,
    scenario,
    wind500,
    event,
    lat,
    lon,
  ]);
  return (
    <canvas
      ref={ref}
      className="scene-canvas"
      onPointerDown={(e) => {
        drag.current = { on: true, x: e.clientX };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current.on) {
          const dx = e.clientX - drag.current.x;
          drag.current.x = e.clientX;
          setLook((v) => {
            const next = Math.max(-120, Math.min(120, v + dx * 0.1));
            onLookChange(next);
            return next;
          });
        }
      }}
      onPointerUp={() => (drag.current.on = false)}
    />
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("sunset"),
    [place, setPlace] = useState<PlaceKey>("成都·天府广场"),
    [customLocation, setCustomLocation] = useState({
      lat: places["成都·天府广场"].lat,
      lon: places["成都·天府广场"].lon,
    }),
    [mapOpen, setMapOpen] = useState(false),
    [selectedDate, setSelectedDate] = useState(beijingDateKey),
    [minute, setMinute] = useState(60),
    [playing, setPlaying] = useState(false),
    [focal, setFocal] = useState(85),
    [lookOffset, setLookOffset] = useState(0),
    [pitchOffset, setPitchOffset] = useState(0),
    [sceneView, setSceneView] = useState<"view" | "profile" | "sunpath">(
      "view",
    ),
    [visible, setVisible] = useState([true, true, true]),
    [demoCb, setDemoCb] = useState(false),
    [cloudsatZoom, setCloudsatZoom] = useState(false),
    [data, setData] = useState<SceneData | null>(null),
    [satSource, setSatSource] = useState<SatSource>("hima9-ir"),
    [satInfo, setSatInfo] = useState<SatelliteInfo | null>(null),
    [satError, setSatError] = useState(false),
    [satFrames, setSatFrames] = useState<SatelliteFrame[]>([]),
    [animFrame, setAnimFrame] = useState(0),
    [animPlaying, setAnimPlaying] = useState(false),
    [loading, setLoading] = useState(true),
    [clock, setClock] = useState<number | null>(null),
    [updatedAt, setUpdatedAt] = useState<number | null>(null),
    [nextRefreshAt, setNextRefreshAt] = useState(0),
    [error, setError] = useState(""),
    [cityRankOpen, setCityRankOpen] = useState(false),
    [cityRanks, setCityRanks] = useState<CityRank[]>([]),
    [cityRankKey, setCityRankKey] = useState(""),
    [cityRankLoading, setCityRankLoading] = useState(false),
    [cityRankError, setCityRankError] = useState(""),
    [cityRankSharing, setCityRankSharing] = useState(false),
    [shareReady, setShareReady] = useState(false),
    [searchQuery, setSearchQuery] = useState(""),
    [searchResults, setSearchResults] = useState<GeoResult[]>([]),
    [searching, setSearching] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [mobileSettings, setMobileSettings] = useState(false);
  const requestRef = useRef({
      id: 0,
      controller: null as AbortController | null,
    }),
    cacheRef = useRef(new Map<string, SceneData>()),
    searchRef = useRef({
      id: 0,
      controller: null as AbortController | null,
    }),
    shareFilesRef = useRef<File[]>([]);
  const loc = place === "地图选点" ? customLocation : places[place],
    bearing = mode === "sunset" ? 278 : 78;
  const load = async () => {
    const requestId = ++requestRef.current.id,
      key = `${loc.lat},${loc.lon},${bearing}`,
      cached = cacheRef.current.get(key),
      controller = new AbortController();
    requestRef.current.controller?.abort();
    requestRef.current.controller = controller;
    if (cached) setData(cached);
    setLoading(true);
    setError("");
    // 卫星影像与卫星云密度独立于 ECMWF：即使天气数据失败也能显示真实云
    const primarySat = await getPrimarySatellite(
      loc.lat,
      loc.lon,
      controller.signal,
    );
    if (requestId !== requestRef.current.id || controller.signal.aborted)
      return;
    setSatInfo(primarySat);
    setSatSource(primarySat.source);
    setSatError(false);
    // 异步加载多帧历史卫星云图，独立于主流程
    getSatelliteFrames(primarySat.source, loc.lat, loc.lon, controller.signal)
      .then((fs) => { if (!controller.signal.aborted) setSatFrames(fs); })
      .catch(() => {});
    setAnimFrame(0);
    setAnimPlaying(false);
    try {
      let next: SceneData | null = null;
      // 静态托管（GitHub Pages）没有 /api/scene 后端，直接浏览器直连 Open-Meteo
      if (!__STATIC__) {
        try {
          // API 路由 8 秒超时：服务端不可达时快速回退到浏览器直连
          const proxy = await fetch(
            `/api/scene?lat=${loc.lat}&lon=${loc.lon}&bearing=${bearing}`,
            {
              signal: withTimeout(controller.signal, 8000),
            },
          );
          if (proxy.ok) next = await proxy.json();
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (!next)
        next = await directSceneData(
          loc.lat,
          loc.lon,
          bearing,
          controller.signal,
        );
      if (requestId !== requestRef.current.id || controller.signal.aborted)
        return;
      cacheRef.current.set(key, next);
      setData(next);
      setUpdatedAt(Date.now());
      setNextRefreshAt(Date.now() + 600000);
    } catch (e) {
      if (controller.signal.aborted || requestId !== requestRef.current.id)
        return;
      setError(
        cached
          ? "新数据暂未更新，继续显示最近一次结果"
          : e instanceof Error
            ? e.message
            : "数据源暂不可用",
      );
      // 失败退避：60 秒后再自动重试，避免每秒无限重试导致 loading 弹跳
      setNextRefreshAt(Date.now() + 60000);
    } finally {
      if (requestId === requestRef.current.id) setLoading(false);
    }
  };
  const switchSat = async (s: SatSource) => {
    if (s === satSource) return;
    setSatSource(s);
    setSatError(false);
    setAnimPlaying(false);
    setAnimFrame(0);
    try {
      const info = await getSatelliteInfo(s, loc.lat, loc.lon);
      setSatInfo(info);
      // 切换源时也更新多帧数据
      const fs = await getSatelliteFrames(s, loc.lat, loc.lon);
      if (!requestRef.current.controller?.signal.aborted) setSatFrames(fs);
    } catch {
      setSatError(true);
    }
  };
  useEffect(() => {
    load();
    return () => requestRef.current.controller?.abort();
  }, [loc.lat, loc.lon, mode]);
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // 卫星云图动画间隔
  useEffect(() => {
    if (!animPlaying || satFrames.length < 2) return;
    const id = setInterval(() => {
      setAnimFrame((v) => (v + 1) % satFrames.length);
    }, 800);
    return () => clearInterval(id);
  }, [animPlaying, satFrames.length]);
  useEffect(() => {
    if (clock !== null && clock >= nextRefreshAt && !loading) load();
  }, [clock, nextRefreshAt, loading]);
  useEffect(() => {
    const dates = data?.weather.daily.time;
    if (dates?.length && !dates.includes(selectedDate)) {
      setSelectedDate(dates[0]);
      setMinute(60);
    }
  }, [data, selectedDate]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setMinute((v) => (v >= 120 ? 0 : v + 1)), 800);
    return () => clearInterval(id);
  }, [playing]);
  const availableDates = data?.weather.daily.time || [],
    selectedDayIndex = Math.max(0, availableDates.indexOf(selectedDate)),
    astronomicalTimes = getTimes(
      new Date(`${selectedDate}T12:00:00+08:00`),
      loc.lat,
      loc.lon,
    ),
    event =
      mode === "sunset" ? astronomicalTimes.sunset : astronomicalTimes.sunrise,
    date = event ? eventDate(event, minute - 60) : new Date(clock ?? 0),
    solar = solarPosition(date, loc.lat, loc.lon),
    hourly = data?.weather.hourly,
    idx = hourly
      ? hourly.time.reduce(
          (best, t, i) =>
            Math.abs(
              new Date(String(t) + "+08:00").getTime() - date.getTime(),
            ) <
            Math.abs(
              new Date(String(hourly.time[best]) + "+08:00").getTime() -
                date.getTime(),
            )
              ? i
              : best,
          0,
        )
      : 0,
    stationElevation = Number(data?.weather.elevation || 500),
    pm25 = Number(hourly?.pm2_5?.[idx] || 0);
  let cover = [
      Number(hourly?.cloud_cover_low?.[idx] || 0),
      Number(hourly?.cloud_cover_mid?.[idx] || 0),
      Number(hourly?.cloud_cover_high?.[idx] || 0),
    ],
    visibility = Number(hourly?.visibility?.[idx] || 15000),
    heights = [
      Math.max(
        0.5,
        (Number(hourly?.geopotential_height_850hPa?.[idx] || 2000) -
          stationElevation) /
          1000,
      ),
      Math.max(
        3,
        (Number(hourly?.geopotential_height_500hPa?.[idx] || 6000) -
          stationElevation) /
          1000,
      ),
      Math.max(
        7,
        (Number(hourly?.geopotential_height_250hPa?.[idx] || 10800) -
          stationElevation) /
          1000,
      ),
    ],
    aod = Number(hourly?.aerosol_optical_depth?.[idx] || 0.2),
    scaleHeight = Math.max(
      0.5,
      Math.min(4, Number(hourly?.boundary_layer_height?.[idx] || 1500) / 1000),
    );
  // 积雨云虚拟演示：注入强对流虚拟数据。覆盖发生在评分计算之前，
  // 使取景场景、左侧云层栏、右侧受光评分共用同一套值，保证联动更新。
  if (demoCb) {
    cover = [75, 55, 35];
    heights = [4.5, 9, 12];
    aod = 0.35;
    visibility = 12000;
    scaleHeight = 1.5;
  }
  const effectiveGround = Math.max(
      0,
      scaleHeight * Math.log(Math.max(0.001, aod) / (0.02 * scaleHeight)),
    ),
    effectiveHeights = heights.map((h) => Math.max(0.05, h - effectiveGround)),
    targetIndex = cover[2] >= cover[1] ? 2 : 1,
    corridorCover = (data?.corridor?.forecasts || []).map((f) => {
      const times = f.hourly?.time || [],
        ci = times.length
          ? times.reduce(
              (best, t, i) =>
                Math.abs(
                  new Date(String(t) + "+08:00").getTime() - date.getTime(),
                ) <
                Math.abs(
                  new Date(String(times[best]) + "+08:00").getTime() -
                    date.getTime(),
                )
                  ? i
                  : best,
              0,
            )
          : 0;
      return [
        Number(f.hourly?.cloud_cover_low?.[ci] || 0),
        Number(f.hourly?.cloud_cover_mid?.[ci] || 0),
        Number(f.hourly?.cloud_cover_high?.[ci] || 0),
      ];
    }),
    // 光路剖面：沿太阳方位细粒度云量（供「光路」视图）
    sunPathCover = (data?.sunPath?.forecasts || []).map((f) => {
      const times = f.hourly?.time || [],
        ci = times.length
          ? times.reduce(
              (best, t, i) =>
                Math.abs(
                  new Date(String(t) + "+08:00").getTime() - date.getTime(),
                ) <
                Math.abs(
                  new Date(String(times[best]) + "+08:00").getTime() -
                    date.getTime(),
                )
                  ? i
                  : best,
              0,
            )
          : 0;
      return [
        Number(f.hourly?.cloud_cover_low?.[ci] || 0),
        Number(f.hourly?.cloud_cover_mid?.[ci] || 0),
        Number(f.hourly?.cloud_cover_high?.[ci] || 0),
      ];
    }),
    edgeAt = corridorCover.findIndex((c, i) => i > 0 && c[targetIndex] < 15),
    cloudEdge =
      edgeAt > 0
        ? data?.corridor?.distances[edgeAt] || 320
        : data?.corridor?.distances.at(-1) || 320,
    maxDepth = 2 * Math.sqrt(2 * 6371 * effectiveHeights[targetIndex]),
    // 阴天遮光因子（供 illum 受光判断和评分用）
    parentOvercast = calcOvercast(cover, Number(hourly?.precipitation?.[idx] || 0), visibility),
    illum = effectiveHeights.map(
      (h, i) =>
        solar.altitude > -dip(h) - 0.57 &&
        cover[i] > 5 &&
        // 阴天遮光：低云量>70%+降水 或 overcast>0.5 时，云层不受光
         !(i === 0 && parentOvercast > 0.4) &&
         !(parentOvercast > 0.65),
    ),
    lowerBlock = corridorCover.length
      ? corridorCover
          .slice(1)
          .reduce(
            (sum, c) => sum + (targetIndex === 2 ? (c[0] + c[1]) / 2 : c[0]),
            0,
          ) / Math.max(1, corridorCover.length - 1)
      : cover[0],
    corridorTransmission = Math.exp(-lowerBlock / 70),
    trans =
      Math.max(0.08, Math.min(1, visibility / 30000)) *
      Math.exp(-aod * 1.2) *
      corridorTransmission,
    pot = effectiveHeights.map((_, i) =>
      Math.round(
        (illum[i] ? 1 : 0) *
          cover[i] *
          trans *
          (i === 2 ? 1.2 : i === 1 ? 1 : 0.7),
      ),
    ),
    geometryScore = !illum[targetIndex]
      ? 0
      : Math.min(
          100,
          Math.round(45 + 55 * Math.min(1, maxDepth / Math.max(1, cloudEdge))),
        ),
    cloudScore = Math.round(
      Math.min(100, cover[targetIndex] * 1.35) *
        Math.max(0.15, 1 - cover[0] / 115),
    ),
    airScore =
      aod <= 0.1
        ? 100
        : aod <= 0.2
          ? 88
          : aod <= 0.3
            ? 72
            : aod <= 0.5
              ? 48
              : aod <= 0.8
                ? 22
                : 6,
    corridorScore = Math.round(corridorTransmission * 100),
    comparisonHourly = data?.comparison?.hourly,
    comparisonIdx = comparisonHourly?.time?.length
      ? comparisonHourly.time.reduce(
          (best, t, i) =>
            Math.abs(
              new Date(String(t) + "+08:00").getTime() - date.getTime(),
            ) <
            Math.abs(
              new Date(
                String(comparisonHourly.time[best]) + "+08:00",
              ).getTime() - date.getTime(),
            )
              ? i
              : best,
          0,
        )
      : 0,
    comparisonCover = [
      Number(comparisonHourly?.cloud_cover_low?.[comparisonIdx] || cover[0]),
      Number(comparisonHourly?.cloud_cover_mid?.[comparisonIdx] || cover[1]),
      Number(comparisonHourly?.cloud_cover_high?.[comparisonIdx] || cover[2]),
    ],
    modelSpread = Math.round(
      comparisonCover.reduce((s, v, i) => s + Math.abs(v - cover[i]), 0) / 3,
    );
  let cape = Number(comparisonHourly?.cape?.[comparisonIdx] || 0),
    precipitation = Number(
      comparisonHourly?.precipitation?.[comparisonIdx] || 0,
    ),
    wind500 = Number(
      comparisonHourly?.wind_speed_500hPa?.[comparisonIdx] || 20,
    );
  // 阵风与多层风场（阵风/风切变面板）
  const gust10 = Number(comparisonHourly?.wind_gusts_10m?.[comparisonIdx] || 0),
    wind10 = Number(comparisonHourly?.wind_speed_10m?.[comparisonIdx] || 0),
    dir10 = Number(comparisonHourly?.wind_direction_10m?.[comparisonIdx] || 0),
    wind850 = Number(comparisonHourly?.wind_speed_850hPa?.[comparisonIdx] || 0),
    dir850 = Number(comparisonHourly?.wind_direction_850hPa?.[comparisonIdx] || 0),
    dir500 = Number(comparisonHourly?.wind_direction_500hPa?.[comparisonIdx] || 0),
    wind250 = Number(comparisonHourly?.wind_speed_250hPa?.[comparisonIdx] || 0),
    dir250 = Number(comparisonHourly?.wind_direction_250hPa?.[comparisonIdx] || 0),
    // 风矢量分解：u=东向分量(顺风向 sin)，v=北向分量(cos)
    windVec = (spd: number, dir: number) => ({
      u: spd * Math.sin((dir * Math.PI) / 180),
      v: spd * Math.cos((dir * Math.PI) / 180),
    }),
    // 垂直风切变：850→500 hPa（中高层）与 10m→850 hPa（低层）矢量差
    shearMid = (() => {
      const a = windVec(wind850, dir850),
        b = windVec(wind500, dir500);
      return Math.hypot(a.u - b.u, a.v - b.v);
    })(),
    shearLow = (() => {
      const a = windVec(wind10, dir10),
        b = windVec(wind850, dir850);
      return Math.hypot(a.u - b.u, a.v - b.v);
    })();
  // 云动态外推：基于当前低层风场，线性推测从现在到日出/日落，云会移动到哪个位置
  // 移动距离 = 平均风速 × 剩余时间（小时）
  const now = new Date();
  const targetTime = event || date;
  const hoursToGo = Math.max(0, (targetTime.getTime() - now.getTime()) / (1000 * 3600));
  // 使用 850hPa 风向风速（主导云系移动），如果没有数据则用 10m 风
  // Open-Meteo wind_direction 为「来向」（风从哪个方向吹来）；
  // 云团实际移动方向（去向）= 来向 + 180°，否则外推终点会指向云团来源而非去向
  const windFrom = wind850 > 5 ? dir850 : dir10,
    advectionDir = (windFrom + 180) % 360,
    advectionSpeed = wind850 > 5 ? wind850 : Math.max(5, wind10),
    totalKm = advectionSpeed * hoursToGo;
  // 计算云移动终点：当前位置沿风向移动 totalKm
  const [cloudEndLat, cloudEndLon] = destination(loc.lat, loc.lon, advectionDir, totalKm);
  // 计算相对于视线方向（bearing）的云移动：云从哪个方向来，会移向观测点哪边？
  // bearing = 用户当前视线方向（朝向日落/日出）
  // 相对方位：将 advectionDir 转为相对于 bearing 的角度
  const relDir = ((advectionDir - bearing) + 180 + 360) % 360 - 180;
  let cloudMoveDesc = "";
  if (Math.abs(relDir) < 30) {
    cloudMoveDesc = "云团从前方移入，逐渐接近观测点";
  } else if (Math.abs(relDir) > 150) {
    cloudMoveDesc = "云团向后方移出，逐渐离开观测区域";
  } else if (relDir > -90 && relDir < 0) {
    cloudMoveDesc = "云团向左侧移动，从右向左经过";
  } else if (relDir > 0 && relDir < 90) {
    cloudMoveDesc = "云团向右侧移动，从左向右经过";
  } else if (relDir <= -90) {
    cloudMoveDesc = "云团向左侧后方移动";
  } else {
    cloudMoveDesc = "云团向右侧后方移动";
  }
  // 云量变化趋势：从现在到目标时刻，云量会如何变化？
  let cloudTrend = 0, trendLabel = "";
  if (hourly?.cloud_cover && evolveIdx0 >= 2 && evolveIdx0 < (hourly.cloud_cover.length - 2)) {
    const nowCover = Number(hourly.cloud_cover[evolveIdx0] || 50);
    const futureCover = Number(hourly.cloud_cover[Math.min(hourly.cloud_cover.length - 1, evolveIdx0 + Math.max(1, Math.round(hoursToGo)))] || nowCover);
    cloudTrend = futureCover - nowCover;
    trendLabel = cloudTrend > 15 ? "云量逐渐增多，霞光机会↓" :
                 cloudTrend < -15 ? "云量逐渐减少，霞光机会↑" :
                 "云量基本稳定，变化不大";
  }
  // 云量演变曲线：以日出/日落时刻为中心，展示前后各 12h 的低/中/高云量趋势
  const evolveTimes = hourly?.time || [],
    evolveIdx0 = hourly
      ? hourly.time.reduce(
          (best, t, i) => {
            const tt = new Date(String(t) + "+08:00").getTime(),
              ev = event ? event.getTime() : date.getTime();
            return Math.abs(tt - ev) <
              Math.abs(
                new Date(String(hourly.time[best]) + "+08:00").getTime() - ev,
              )
              ? i
              : best;
          },
          0,
        )
      : 0,
    evolveStart = Math.max(0, evolveIdx0 - 6),
    evolveEnd = Math.min(evolveTimes.length - 1, evolveIdx0 + 18),
    evolveN = Math.max(1, evolveEnd - evolveStart),
    evolveSeries = [0, 1, 2].map((li) =>
      (hourly?.[["cloud_cover_low", "cloud_cover_mid", "cloud_cover_high"][li]] ||
        []
      ).slice(evolveStart, evolveEnd + 1),
    ),
    // 风向 16 方位标签
    dirLabel = (d: number) => {
      const dirs = [
        "北",
        "北东北",
        "东北",
        "东东北",
        "东",
        "东东南",
        "东南",
        "南东南",
        "南",
        "南西南",
        "西南",
        "西西南",
        "西",
        "西西北",
        "西北",
        "北西北",
      ];
      return dirs[Math.round(d / 22.5) % 16];
    },
    // 风切变定性
    shearLabel = (s: number) =>
      s < 8 ? "弱" : s < 16 ? "中" : "强",
    shearTone = (s: number) =>
      s < 8 ? "#7fae8f" : s < 16 ? "#e0b36a" : "#e07a6a";
  if (demoCb) {
    cape = 1200;
    precipitation = 0.8;
    wind500 = 30;
  }
  const genus = classifyGenus({
      cape,
      precipitation,
      wind: wind500,
      cover: [cover[0], cover[1], cover[2]],
      heights: [effectiveHeights[0], effectiveHeights[1], effectiveHeights[2]],
    }),
    // CloudSat 云剖面：把三层云属映射为垂直结构（云底/云顶/厚度）、
    // 水相与降水类型，供剖面视图与右侧面板联动展示。
    cloudProfileData: CloudLayerProfile[] = cloudProfile(
      [genus.low, genus.mid, genus.high],
      [effectiveHeights[0], effectiveHeights[1], effectiveHeights[2]],
      [cover[0], cover[1], cover[2]],
      precipitation,
    ),
    phaseLabel = { liquid: "液态", mixed: "混合相", ice: "冰相" } as const,
    precipLabel = { none: "无降水", rain: "雨", snow: "雪", mixed: "雨夹雪" } as const;
  const deterministicProbability = Math.min(
      99,
      Math.round(
        geometryScore * 0.45 + cloudScore * 0.35 + corridorScore * 0.2,
      ),
    ),
    monteCarlo = (() => {
      let seed = Math.round(loc.lat * 1000 + loc.lon * 100 + minute * 17),
        success = 0,
        quality = 0;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 320; i++) {
        const sampledHeight = Math.max(
            0.05,
            effectiveHeights[targetIndex] * (0.82 + random() * 0.36),
          ),
          sampledEdge = Math.max(
            20,
            cloudEdge + (random() - 0.5) * (60 + wind500 * 2),
          ),
          sampledAod = Math.max(0.01, aod * (0.72 + random() * 0.56)),
          sampledCover = Math.max(
            0,
            Math.min(
              100,
              cover[targetIndex] + (random() - 0.5) * (20 + modelSpread),
            ),
          ),
          depth = 2 * Math.sqrt(2 * 6371 * sampledHeight),
          lit = solar.altitude > -dip(sampledHeight) - 0.57;
        if (lit && depth >= sampledEdge && sampledCover > 15 && lowerBlock < 72)
          success++;
        quality += Math.max(
          0,
          Math.min(
            100,
            sampledCover * (1 - sampledAod * 0.75) * corridorTransmission,
          ),
        );
      }
      return {
        probability: Math.round(success / 3.2),
        quality: Math.round(quality / 320),
      };
    })(),
    probabilityScore = Math.round(
      deterministicProbability * 0.55 + monteCarlo.probability * 0.45,
    ),
    qualityScore = Math.min(
      99,
      Math.round(
        airScore * 0.35 +
          cloudScore * 0.3 +
          geometryScore * 0.15 +
          corridorScore * 0.1 +
          monteCarlo.quality * 0.1,
      ),
    ),
    score = Math.min(
      99,
      Math.round(probabilityScore * 0.55 + qualityScore * 0.45),
    ),
    forecastLeadHours = Math.max(0, (date.getTime() - (clock ?? 0)) / 3600000),
    confidenceScore = Math.max(
      35,
      Math.min(
        92,
        Math.round(
          90 -
            forecastLeadHours * 1.1 -
            (corridorCover.length < 6 ? 22 : 0) -
            (aod <= 0 ? 12 : 0) -
            modelSpread * 0.55,
        ),
      ),
    ),
    scenario = demoCb
      ? "积雨云 Cb"
      : cape > 700
        ? "对流云边缘型"
        : cover[2] > 58 && cover[1] < 48
          ? "高云幕型"
          : cover[1] > 50
            ? "中云层状型"
            : cover[0] > 48
              ? "低云遮挡型"
              : "云洞漏光型",
    cloudKinds = demoCb
      ? ["浓积云 Cu cong", "积雨云 Cb", "卷云 Ci"]
      : [
          cover[0] > 62 ? "层积云 Sc" : "碎层云 St",
          scenario === "中云层状型" || cover[1] > 68
            ? "高层云 As"
            : "高积云 Ac",
          cover[2] > 62 ? "卷层云 Cs" : "卷云 Ci",
        ],
    scan = event
      ? Array.from({ length: 25 }, (_, i) => {
          const m = i * 5,
            s = solarPosition(eventDate(event, m - 60), loc.lat, loc.lon),
            eligible = mode === "dawn" ? m <= 60 : m >= 60,
            lit = s.altitude > -dip(effectiveHeights[targetIndex]) - 0.57,
            geom = lit
              ? Math.min(
                  100,
                  45 + 55 * Math.min(1, maxDepth / Math.max(1, cloudEdge)),
                )
              : 0;
          return {
            minute: m,
            eligible,
            score: eligible
              ? Math.round(
                  geom * 0.48 + cloudScore * 0.32 + corridorScore * 0.2,
                )
              : -1,
            solar: s,
          };
        })
      : [],
    validScan = scan.filter((p) => p.eligible),
    bestPoint = validScan.reduce(
      (best, p) => (p.score > best.score ? p : best),
      validScan[0] || { minute: 60, score: 0, solar, eligible: true },
    ),
    goodPoints = validScan.filter(
      (p) => p.score >= Math.max(52, bestPoint.score - 12),
    ),
    windowStart = goodPoints[0]?.minute ?? bestPoint.minute,
    windowEnd = goodPoints.at(-1)?.minute ?? bestPoint.minute,
    bestDate = event ? eventDate(event, bestPoint.minute - 60) : date,
    bestTime = bestDate.toLocaleTimeString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    windowStartTime = event
      ? eventDate(event, windowStart - 60).toLocaleTimeString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "--:--",
    windowEndTime = event
      ? eventDate(event, windowEnd - 60).toLocaleTimeString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "--:--",
    formatShotMinute = (minuteValue: number) =>
      event
        ? eventDate(
            event,
            Math.max(0, Math.min(120, minuteValue)) - 60,
          ).toLocaleTimeString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : "--:--",
    setupTime = formatShotMinute(windowStart - 10),
    wrapTime = formatShotMinute(windowEnd + 5),
    recommendation =
      probabilityScore >= 72 && confidenceScore >= 62
        ? "值得专程拍摄"
        : probabilityScore >= 48
          ? "建议就近蹲守"
          : "不建议专程出发",
    risks = [
      maxDepth < cloudEdge ? "云边界可能过远" : null,
      aod > 0.5 ? "AOD偏高，颜色易发灰" : null,
      lowerBlock > 42 ? "太阳上游杂云遮光" : null,
      cover[0] > 45 ? "本地低云遮挡" : null,
      modelSpread > 22 ? "多模式分歧较大" : null,
      precipitation > 0.2 ? "附近存在降水云" : null,
    ].filter(Boolean) as string[],
    time = date.toLocaleTimeString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    hasData = Boolean(data) && !error,
    windowRule = mode === "dawn" ? "仅统计日出前" : "仅统计日落后",
    selectedDateLabel = new Date(
      `${selectedDate}T12:00:00+08:00`,
    ).toLocaleDateString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "short",
      day: "numeric",
      weekday: "short",
    }),
    selectDate = (next: string) => {
      if (!availableDates.includes(next)) return;
      setSelectedDate(next);
      setMinute(60);
      setPlaying(false);
    },
    shiftDate = (offset: number) => {
      const current = Math.max(0, availableDates.indexOf(selectedDate)),
        next = availableDates[current + offset];
      if (next) selectDate(next);
    },
    openCityRank = () => {
      setCityRankOpen(true);
      const key = `${selectedDate}|${mode}`;
      if (cityRankKey === key && cityRanks.length) return; // 同日期同模式缓存
      setCityRankKey(key);
      setCityRanks([]);
      setCityRankLoading(true);
      setCityRankError("");
      const day = new Date(`${selectedDate}T12:00:00+08:00`);
      rankCities(day, mode)
        .then((r) => setCityRanks(r.slice(0, 20)))
        .catch(() => setCityRankError("批量评分失败，请稍后重试"))
        .finally(() => setCityRankLoading(false));
    },
    pickCity = (c: CityRank) => {
      setPlaying(false);
      setMinute(60);
      setCustomLocation({ lat: c.lat, lon: c.lon });
      setPlace("地图选点");
      setCityRankOpen(false);
      load();
    },
    // 任意地名搜索：输入防抖后调用地理编码 API，展示候选列表
    onSearchInput = (q: string) => {
      setSearchQuery(q);
      const id = ++searchRef.current.id;
      searchRef.current.controller?.abort();
      if (!q.trim()) {
        setSearchResults([]);
        setSearchOpen(false);
        setSearching(false);
        return;
      }
      setSearching(true);
      setSearchOpen(true);
      const controller = new AbortController();
      searchRef.current.controller = controller;
      setTimeout(() => {
        if (searchRef.current.id !== id) return;
        searchPlace(q.trim(), controller.signal)
          .then((r) => {
            if (searchRef.current.id !== id) return;
            setSearchResults(r);
            setSearching(false);
          })
          .catch(() => {
            if (searchRef.current.id !== id) return;
            setSearchResults([]);
            setSearching(false);
          });
      }, 350);
    },
    // 选中搜索结果：更新坐标并联动刷新实况/预报
    pickSearchResult = (r: GeoResult) => {
      setPlaying(false);
      setMinute(60);
      setCustomLocation({ lat: r.latitude, lon: r.longitude });
      setPlace("地图选点");
      setSearchQuery(r.name);
      setSearchResults([]);
      setSearchOpen(false);
      load();
    },
    clearSearch = () => {
      setSearchQuery("");
      setSearchResults([]);
      setSearchOpen(false);
      searchRef.current.controller?.abort();
      searchRef.current.id++;
    },
    // 分享推荐城市图片：把 20 城拆成 2 组，分别渲染为高清 PNG（避免单张过长过紧凑），再分享/下载
    shareCityRank = async () => {
      // 第二次点击：已有生成好的文件，直接触发分享（手势还在）
      if (shareFilesRef.current.length > 0) {
        const files = shareFilesRef.current;
        shareFilesRef.current = [];
        setShareReady(false);
        if (navigator.canShare?.({ files })) {
          try {
            await withPromiseTimeout(
              navigator.share({ files, title: "推荐拍摄城市" }),
              5000,
              "share-timeout",
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : "";
            if (msg !== "share-timeout" && !(e as DOMException)?.name?.includes("Abort")) {
              throw e;
            }
            for (const f of files) downloadBlob(f);
          }
        } else {
          for (const f of files) downloadBlob(f);
        }
        return;
      }
      // 第一次点击：生成图片再让用户点一次分享（异步操作会丢失手势）
      const el = document.querySelector<HTMLElement>(".cityrank-dialog");
      if (!el || !cityRanks.length) return;
      setCityRankSharing(true);
      setCityRankError("");
      // 只分享「值得专程拍摄」的城市，其余移除
      const allItems = Array.from(
        el.querySelectorAll<HTMLElement>(".cityrank-item"),
      );
      allItems.forEach((item) => {
        const tag = item.querySelector(".cityrank-tag")?.textContent?.trim();
        if (tag !== "值得专程拍摄") item.remove();
      });
      // 重新统计剩下的城市数量
      const worthyItems = Array.from(
        el.querySelectorAll<HTMLElement>(".cityrank-item"),
      );
      if (!worthyItems.length) {
        setCityRankError("当前没有值得专程拍摄的城市");
        setCityRankSharing(false);
        return;
      }
      // 拆成 2 组：前一半 / 后一半
      const half = Math.ceil(worthyItems.length / 2);
      const groups = [
        { start: 0, end: half, label: `1-${half}` },
        { start: half, end: worthyItems.length, label: `${half + 1}-${worthyItems.length}` },
      ];
      const files: File[] = [];
      try {
        for (let gi = 0; gi < groups.length; gi++) {
          const { start, end, label } = groups[gi];
          const clone = el.cloneNode(true) as HTMLElement;
          clone.style.position = "fixed";
          clone.style.left = "-100000px";
          clone.style.top = "0";
          clone.style.maxHeight = "none";
          clone.style.overflow = "visible";
          clone.style.animation = "none";
          const title = clone.querySelector<HTMLElement>('[data-slot="dialog-title"]');
          if (title) title.textContent = `今日推荐拍摄城市（${label}）`;
          clone.querySelector('[data-slot="dialog-close"]')?.remove();
          clone.querySelector(".cityrank-share")?.remove();
          const items = Array.from(
            clone.querySelectorAll<HTMLElement>(".cityrank-item"),
          );
          items.forEach((item, idx) => {
            if (idx < start || idx >= end) item.remove();
          });
          const body = clone.querySelector<HTMLElement>(".cityrank-body");
          if (body) body.style.gap = "14px";
          document.body.appendChild(clone);
          try {
            const dataUrl = await withPromiseTimeout(
              toPng(clone, {
                pixelRatio: 1.5,
                backgroundColor: "#0c1719",
                cacheBust: true,
                style: {
                  position: "relative",
                  top: "auto",
                  left: "auto",
                  right: "auto",
                  bottom: "auto",
                  transform: "none",
                  translate: "none",
                  margin: "0",
                },
              }),
              30000,
              "截图生成超时，请重试",
            );
            const blob = await (await fetch(dataUrl)).blob();
            files.push(
              new File(
                [blob],
                `推荐拍摄城市-${selectedDate}-${mode === "sunset" ? "晚霞" : "朝霞"}-${gi + 1}.png`,
                { type: "image/png" },
              ),
            );
          } finally {
            clone.remove();
          }
        }
        // 生成完毕，存到 ref，让用户再点一次分享（保持手势）
        shareFilesRef.current = files;
        setShareReady(true);
        setCityRankSharing(false);
      } catch (e) {
        setCityRankError(
          e instanceof Error ? e.message : "分享失败，请重试",
        );
        setCityRankSharing(false);
        setShareReady(false);
      }
    };
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <CloudSun size={20} />
          </span>
          <div>
            <b>霞光三维场景</b>
            <small>SMART FORECAST · 3D LIGHT PATH</small>
          </div>
        </div>
        <div className="mode-switch">
          <button
            className={mode === "dawn" ? "active" : ""}
            onClick={() => {
              setPlaying(false);
              setMinute(60);
              setMode("dawn");
            }}
          >
            朝霞
          </button>
          <button
            className={mode === "sunset" ? "active" : ""}
            onClick={() => {
              setPlaying(false);
              setMinute(60);
              setMode("sunset");
            }}
          >
            晚霞
          </button>
        </div>
        <div className="live-pill">
          <span />
          ECMWF · 多模式 · 320次模拟
        </div>
      </header>
      <section className="workspace">
        <aside className={`left-panel panel${mobileSettings ? "" : " mob-collapsed"}`}>
          <div className="panel-title">
            <MapPin size={15} />
            观测位置
          </div>
          <select
            value={place}
            onChange={(e) => {
              setPlaying(false);
              setMinute(60);
              setPlace(e.target.value as PlaceKey);
            }}
          >
            {Object.keys(places).map((p) => (
              <option key={p}>{p}</option>
            ))}
            <option value="地图选点">地图选点</option>
          </select>
          <div className="place-search">
            <div className="place-search-input">
              <Search size={14} />
              <input
                type="text"
                value={searchQuery}
                placeholder="搜索任意地名…"
                aria-label="搜索任意地名"
                onChange={(e) => onSearchInput(e.target.value)}
                onFocus={() => searchQuery.trim() && setSearchOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults.length) {
                    pickSearchResult(searchResults[0]);
                  }
                  if (e.key === "Escape") {
                    setSearchOpen(false);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              {searchQuery ? (
                <button
                  className="place-search-clear"
                  aria-label="清空搜索"
                  onClick={clearSearch}
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
            {searchOpen && (
              <div className="place-search-dropdown">
                {searching ? (
                  <div className="place-search-empty">搜索中…</div>
                ) : searchResults.length ? (
                  searchResults.map((r, i) => (
                    <button
                      key={`${r.latitude},${r.longitude},${i}`}
                      className="place-search-item"
                      onClick={() => pickSearchResult(r)}
                    >
                      <span className="place-search-name">{r.name}</span>
                      <span className="place-search-sub">
                        {[r.admin2, r.admin1, r.country].filter(Boolean).join(" · ") ||
                          `${r.latitude.toFixed(2)}°, ${r.longitude.toFixed(2)}°`}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="place-search-empty">未找到匹配地点</div>
                )}
              </div>
            )}
          </div>
          <div className="coords">
            <span>{loc.lat.toFixed(4)}°N</span>
            <span>{loc.lon.toFixed(4)}°E</span>
            <span>{data?.weather.elevation ?? "--"}m</span>
          </div>
          <button className="map-pick-btn" onClick={() => setMapOpen(true)}>
            <MapPin size={15} />
            高德地图选点
          </button>
          <div className="date-picker">
            <label htmlFor="forecast-date">
              <CalendarDays size={14} />
              预报日期
            </label>
            <div>
              <button
                aria-label="前一天"
                disabled={selectedDayIndex <= 0}
                onClick={() => shiftDate(-1)}
              >
                <ChevronLeft size={15} />
              </button>
              <input
                id="forecast-date"
                type="date"
                value={selectedDate}
                min={availableDates[0]}
                max={availableDates.at(-1)}
                onChange={(e) => selectDate(e.target.value)}
                aria-label="选择预报日期"
              />
              <button
                aria-label="后一天"
                disabled={selectedDayIndex >= availableDates.length - 1}
                onClick={() => shiftDate(1)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <small>{selectedDateLabel} · 未来 7 天</small>
          </div>
          <button className="location-btn" onClick={load}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            {loading ? "正在读取真实数据" : "刷新实况/预报"}
          </button>
          <button
            className="location-btn"
            style={{ marginTop: 6 }}
            onClick={openCityRank}
          >
            <Trophy size={15} className={cityRankLoading ? "spin" : ""} />
            {cityRankLoading ? "评分计算中…" : "推荐拍摄城市"}
          </button>
          <div className="data-clock">
            <span>当前 {clock === null ? "--:--:--" : new Date(clock).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</span>
            <span>更新 {updatedAt ? new Date(updatedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }) : "--:--"}</span>
            <b>下次刷新 {clock === null ? "--" : `${Math.max(0, Math.ceil((nextRefreshAt - clock) / 1000))} 秒`}</b>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="divider" />
          <div className="panel-title">
            <Layers3 size={15} />
            ECMWF 分层云
          </div>
          {[
            ["低云", "0–3 km", "#7a8798"],
            ["中云", "3–8 km", "#d87778"],
            ["高云", "8 km+", "#f3c293"],
          ].map((c, i) => (
            <label className="layer" key={c[0]}>
              <i style={{ background: c[2] }} />
              <span>
                <b>
                  {c[0]} {cover[i]}%
                </b>
                <small>
                  {cloudProfileData[i].type} · 底
                  {cloudProfileData[i].base.toFixed(1)}–顶
                  {cloudProfileData[i].top.toFixed(1)}km · 厚
                  {cloudProfileData[i].thickness.toFixed(1)}km ·{" "}
                  {phaseLabel[cloudProfileData[i].phase]} ·{" "}
                  {precipLabel[cloudProfileData[i].precip]} ·{" "}
                  {illum[i] ? "已受光" : "未受光"} · 势能 {pot[i]}
                </small>
              </span>
              <Switch
                checked={visible[i]}
                onCheckedChange={() =>
                  setVisible((v) => v.map((x, j) => (j === i ? !x : x)))
                }
              />
            </label>
          ))}
          <div className="cloudsat-strip">
            <div className="panel-subtitle">
              <Activity size={13} />
              CloudSat 云剖面 · 垂直结构
              <small>2B-CLDCLASS</small>
              <button
                type="button"
                className="cloudsat-zoom"
                onClick={() => setCloudsatZoom(true)}
                aria-label="放大 CloudSat 云剖面"
              >
                <Maximize2 size={11} />
                放大
              </button>
            </div>
            <svg
              viewBox="0 0 320 168"
              className="cloudsat-svg"
              role="img"
              aria-label="CloudSat 式云剖面"
              onClick={() => setCloudsatZoom(true)}
              style={{ cursor: "zoom-in" }}
            >
              {/* 高度刻度：0–13 km，CloudSat CPR 毫米波雷达垂直剖面 */}
              <text x="26" y="8" fill="#5f7470" fontSize="7" letterSpacing="0.12em">
                高度 km
              </text>
              {[0, 3, 6, 9, 12].map((km) => {
                const yy = 16 + ((13 - km) / 13) * 120;
                return (
                  <g key={km}>
                    <line
                      x1="26"
                      y1={yy}
                      x2="318"
                      y2={yy}
                      stroke="rgba(120,140,150,0.14)"
                      strokeDasharray={km === 0 ? undefined : "2 3"}
                    />
                    <text x="22" y={yy + 3} fill="#7f9390" fontSize="8" textAnchor="end">
                      {km}
                    </text>
                  </g>
                );
              })}
              {cloudProfileData.map((p, i) => {
                const cx = [70, 160, 250][i],
                  topY = 16 + ((13 - Math.min(13, p.top)) / 13) * 120,
                  baseY = 16 + ((13 - Math.max(0, p.base)) / 13) * 120,
                  colH = Math.max(6, baseY - topY),
                  // 云属基准暖色：统一取自共享比色模块（依据文档比色卡分级），
                  // 高云金黄、中云橘黄、低云橘红、厚云深橘红。
                  // 阴天时褪为灰白
                  genusTone = GENUS_TONE[p.genus] || [240, 132, 80],
                  fadedGt = parentOvercast > 0.3
                    ? [
                        genusTone[0] + (140 - genusTone[0]) * parentOvercast,
                        genusTone[1] + (148 - genusTone[1]) * parentOvercast,
                        genusTone[2] + (155 - genusTone[2]) * parentOvercast,
                      ].map(Math.round)
                    : genusTone,
                  fill = `rgba(${fadedGt.join(",")},${
                    p.phase === "ice" ? 0.75 - parentOvercast * 0.2 : p.phase === "mixed" ? 0.62 - parentOvercast * 0.15 : 0.56 - parentOvercast * 0.12
                  })`;
                return (
                  <g key={i} opacity={visible[i] ? 1 : 0.3}>
                    {p.precip !== "none" && (
                      <line
                        x1={cx}
                        y1={baseY}
                        x2={cx + (p.precip === "snow" ? 4 : 3)}
                        y2={baseY + 16}
                        stroke={
                          p.precip === "snow"
                            ? "rgba(220,232,240,0.55)"
                            : "rgba(120,140,160,0.5)"
                        }
                        strokeWidth="1.4"
                        strokeDasharray={p.precip === "snow" ? "2 2" : undefined}
                      />
                    )}
                    <rect
                      x={cx - 18}
                      y={topY}
                      width="36"
                      height={colH}
                      rx="5"
                      fill={fill}
                    />
                    {/* 柱顶受光高光：与 3D 取景一致的"金顶" */}
                    <rect
                      x={cx - 18}
                      y={topY}
                      width="36"
                      height={Math.min(7, colH * 0.22)}
                      rx="5"
                      fill="rgba(255,232,196,0.4)"
                    />
                    <text
                      x={cx}
                      y={Math.max(12, topY - 4)}
                      fill="#eef4f6"
                      fontSize="9"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {p.type}
                    </text>
                    <text
                      x={cx}
                      y={Math.max(22, topY - 4 + 10)}
                      fill="#7f9390"
                      fontSize="7.5"
                      textAnchor="middle"
                    >
                      {p.base.toFixed(1)}–{p.top.toFixed(1)}km
                    </text>
                  </g>
                );
              })}
              {/* 图例：水相 + 降水 */}
              <g>
                <line x1="26" y1="150" x2="318" y2="150" stroke="rgba(120,140,150,0.18)" />
                <rect x="26" y="156" width="10" height="10" rx="2" fill="rgba(232,240,248,0.6)" />
                <text x="40" y="164" fill="#9db0ac" fontSize="8">
                  冰相
                </text>
                <rect x="78" y="156" width="10" height="10" rx="2" fill="rgba(205,214,222,0.55)" />
                <text x="92" y="164" fill="#9db0ac" fontSize="8">
                  混合
                </text>
                <rect x="130" y="156" width="10" height="10" rx="2" fill="rgba(158,176,189,0.55)" />
                <text x="144" y="164" fill="#9db0ac" fontSize="8">
                  液态
                </text>
                <line x1="188" y1="161" x2="204" y2="161" stroke="rgba(120,140,160,0.6)" strokeWidth="1.6" />
                <text x="208" y="164" fill="#9db0ac" fontSize="8">
                  雨
                </text>
                <line x1="238" y1="161" x2="254" y2="161" stroke="rgba(220,232,240,0.6)" strokeWidth="1.6" strokeDasharray="2 2" />
                <text x="258" y="164" fill="#9db0ac" fontSize="8">
                  雪
                </text>
              </g>
            </svg>
          </div>
          {/* CloudSat 云剖面放大弹窗：大尺寸垂直结构图 */}
          <Dialog open={cloudsatZoom} onOpenChange={setCloudsatZoom}>
            <DialogContent className="cloudsat-dialog sm:max-w-[760px]">
              <DialogHeader className="cloudsat-dialog-header">
                <DialogTitle>CloudSat 云剖面 · 垂直结构</DialogTitle>
                <DialogDescription>
                  CloudSat CPR 毫米波雷达垂直剖面思路 · 2B-CLDCLASS 云分类 · 云底/云顶/厚度/水相/降水
                </DialogDescription>
              </DialogHeader>
              <svg viewBox="0 0 680 360" className="cloudsat-dialog-svg" role="img" aria-label="CloudSat 云剖面放大图">
                <text x="58" y="22" fill="#5f7470" fontSize="13" letterSpacing="0.12em" textAnchor="end">
                  高度 km
                </text>
                {[0, 3, 6, 9, 12].map((km) => {
                  const yy = 34 + ((13 - km) / 13) * 250;
                  return (
                    <g key={km}>
                      <line
                        x1="64"
                        y1={yy}
                        x2="664"
                        y2={yy}
                        stroke="rgba(120,140,150,0.16)"
                        strokeDasharray={km === 0 ? undefined : "3 4"}
                      />
                      <text x="58" y={yy + 5} fill="#7f9390" fontSize="13" textAnchor="end">
                        {km}
                      </text>
                    </g>
                  );
                })}
                {cloudProfileData.map((p, i) => {
                  const cx = [170, 340, 510][i],
                    topY = 34 + ((13 - Math.min(13, p.top)) / 13) * 250,
                    baseY = 34 + ((13 - Math.max(0, p.base)) / 13) * 250,
                    colH = Math.max(8, baseY - topY),
                    // 云属基准暖色：统一取自共享比色模块（依据文档比色卡分级）
                    // 阴天时褪为灰白
                    genusTone = GENUS_TONE[p.genus] || [240, 132, 80],
                    fadedGt = parentOvercast > 0.3
                      ? [
                          genusTone[0] + (140 - genusTone[0]) * parentOvercast,
                          genusTone[1] + (148 - genusTone[1]) * parentOvercast,
                          genusTone[2] + (155 - genusTone[2]) * parentOvercast,
                        ].map(Math.round)
                      : genusTone,
                    fill = `rgba(${fadedGt.join(",")},${
                      p.phase === "ice" ? 0.78 - parentOvercast * 0.2 : p.phase === "mixed" ? 0.66 - parentOvercast * 0.15 : 0.6 - parentOvercast * 0.12
                    })`;
                  return (
                    <g key={i} opacity={visible[i] ? 1 : 0.3}>
                      {p.precip !== "none" && (
                        <line
                          x1={cx}
                          y1={baseY}
                          x2={cx + (p.precip === "snow" ? 8 : 6)}
                          y2={baseY + 34}
                          stroke={
                            p.precip === "snow"
                              ? "rgba(220,232,240,0.6)"
                              : "rgba(120,140,160,0.55)"
                          }
                          strokeWidth="2.4"
                          strokeDasharray={p.precip === "snow" ? "4 4" : undefined}
                        />
                      )}
                      <rect x={cx - 48} y={topY} width="96" height={colH} rx="10" fill={fill} />
                      <rect
                        x={cx - 48}
                        y={topY}
                        width="96"
                        height={Math.min(14, colH * 0.2)}
                        rx="10"
                        fill="rgba(255,232,196,0.42)"
                      />
                      <text
                        x={cx}
                        y={Math.max(30, topY - 10)}
                        fill="#eef4f6"
                        fontSize="17"
                        fontWeight="600"
                        textAnchor="middle"
                      >
                        {p.type}
                      </text>
                      <text
                        x={cx}
                        y={Math.max(52, topY - 10 + 22)}
                        fill="#7f9390"
                        fontSize="13"
                        textAnchor="middle"
                      >
                        底{p.base.toFixed(1)}–顶{p.top.toFixed(1)}km · 厚
                        {p.thickness.toFixed(1)}km
                      </text>
                      <text
                        x={cx}
                        y={Math.max(74, topY - 10 + 44)}
                        fill="#9db0ac"
                        fontSize="12"
                        textAnchor="middle"
                      >
                        {phaseLabel[p.phase]} · {precipLabel[p.precip]} · 云量
                        {Math.round(p.cover)}%
                      </text>
                    </g>
                  );
                })}
                {/* 图例：水相 + 降水 */}
                <g>
                  <line x1="64" y1="312" x2="664" y2="312" stroke="rgba(120,140,150,0.2)" />
                  <rect x="64" y="320" width="14" height="14" rx="3" fill="rgba(232,240,248,0.6)" />
                  <text x="84" y="331" fill="#9db0ac" fontSize="12">
                    冰相
                  </text>
                  <rect x="130" y="320" width="14" height="14" rx="3" fill="rgba(205,214,222,0.55)" />
                  <text x="150" y="331" fill="#9db0ac" fontSize="12">
                    混合
                  </text>
                  <rect x="196" y="320" width="14" height="14" rx="3" fill="rgba(158,176,189,0.55)" />
                  <text x="216" y="331" fill="#9db0ac" fontSize="12">
                    液态
                  </text>
                  <line x1="272" y1="327" x2="294" y2="327" stroke="rgba(120,140,160,0.65)" strokeWidth="2.4" />
                  <text x="300" y="331" fill="#9db0ac" fontSize="12">
                    雨
                  </text>
                  <line x1="336" y1="327" x2="358" y2="327" stroke="rgba(220,232,240,0.65)" strokeWidth="2.4" strokeDasharray="3 3" />
                  <text x="364" y="331" fill="#9db0ac" fontSize="12">
                    雪
                  </text>
                  <text x="664" y="331" fill="#5f7470" fontSize="11" textAnchor="end">
                    CloudSat CPR 垂直剖面 · 2B-CLDCLASS
                  </text>
                </g>
              </svg>
            </DialogContent>
          </Dialog>
          {/* 云量演变曲线：以日出/日落时刻为中心的未来 24h 云量趋势 */}
          <div className="divider" />
          <div className="panel-title">
            <TrendingUp size={15} />
            云量演变
            <small>以{mode === "sunset" ? "日落" : "日出"}为中心 ±12h</small>
          </div>
          {hasData && evolveTimes.length ? (
            <svg
              viewBox="0 0 320 118"
              className="evolve-svg"
              role="img"
              aria-label="云量演变曲线"
            >
              {/* 网格线 */}
              {[0, 25, 50, 75, 100].map((v) => {
                const yy = 12 + (1 - v / 100) * 86;
                return (
                  <g key={v}>
                    <line
                      x1="34"
                      y1={yy}
                      x2="314"
                      y2={yy}
                      stroke="rgba(120,140,150,0.14)"
                      strokeDasharray="2 3"
                    />
                    <text x="30" y={yy + 3} fill="#7f9390" fontSize="7" textAnchor="end">
                      {v}
                    </text>
                  </g>
                );
              })}
              {/* 事件时刻竖线（日落/日出） */}
              {(() => {
                const ex = 34 + ((evolveIdx0 - evolveStart) / evolveN) * 280;
                return (
                  <g>
                    <line
                      x1={ex}
                      y1="12"
                      x2={ex}
                      y2="98"
                      stroke="rgba(255,200,130,0.55)"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={ex}
                      y="8"
                      fill="rgba(255,210,150,0.85)"
                      fontSize="7"
                      textAnchor="middle"
                    >
                      {mode === "sunset" ? "日落" : "日出"}
                    </text>
                  </g>
                );
              })()}
              {/* 三层云量曲线 */}
              {[
                { key: "low", color: "#7a8798", label: "低" },
                { key: "mid", color: "#d87778", label: "中" },
                { key: "high", color: "#f3c293", label: "高" },
              ].map((s, li) => {
                const pts = evolveSeries[li]
                  .map((v, i) => {
                    const x = 34 + (i / evolveN) * 280,
                      y = 12 + (1 - Math.min(100, Math.max(0, v)) / 100) * 86;
                    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .join(" ");
                return (
                  <g key={s.key}>
                    <path
                      d={pts}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {/* 曲线末点小圆 */}
                    {evolveSeries[li].length ? (
                      <circle
                        cx={34 + ((evolveSeries[li].length - 1) / evolveN) * 280}
                        cy={
                          12 +
                          (1 -
                            Math.min(
                              100,
                              Math.max(
                                0,
                                evolveSeries[li][evolveSeries[li].length - 1],
                              ),
                            ) /
                              100) *
                            86
                        }
                        r="2"
                        fill={s.color}
                      />
                    ) : null}
                  </g>
                );
              })}
              {/* 时间刻度 */}
              {[0, 6, 12, 18, 24].map((h) => {
                const i = Math.min(evolveN, Math.round((h / 24) * evolveN)),
                  t = evolveTimes[evolveStart + i];
                if (!t) return null;
                const hh = String(t).slice(11, 13);
                return (
                  <text
                    key={h}
                    x={34 + (i / evolveN) * 280}
                    y="108"
                    fill="#7f9390"
                    fontSize="7"
                    textAnchor="middle"
                  >
                    {hh}时
                  </text>
                );
              })}
              {/* 图例 */}
              <g>
                {[
                  { c: "#7a8798", l: "低云" },
                  { c: "#d87778", l: "中云" },
                  { c: "#f3c293", l: "高云" },
                ].map((s, i) => (
                  <g key={s.l} transform={`translate(${150 + i * 58}, 112)`}>
                    <line x1="0" y1="0" x2="14" y2="0" stroke={s.c} strokeWidth="2" />
                    <text x="18" y="3" fill="#9db0ac" fontSize="7">
                      {s.l}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          ) : (
            <p className="error">云量演变数据尚未载入</p>
          )}
          {/* 阵风 / 风切变 */}
          <div className="divider" />
          <div className="panel-title">
            <Wind size={15} />
            阵风 / 风切变
            <small>ECMWF 多层风场</small>
          </div>
          <div className="wind-grid">
            <div>
              <small>10m 阵风</small>
              <b>{hasData ? gust10.toFixed(0) : "--"}</b>
              <em>km/h</em>
            </div>
            <div>
              <small>10m 风</small>
              <b>{hasData ? wind10.toFixed(0) : "--"}</b>
              <em>{hasData ? dirLabel(dir10) : ""}</em>
            </div>
            <div>
              <small>850hPa</small>
              <b>{hasData ? wind850.toFixed(0) : "--"}</b>
              <em>{hasData ? dirLabel(dir850) : ""}</em>
            </div>
            <div>
              <small>500hPa</small>
              <b>{hasData ? wind500.toFixed(0) : "--"}</b>
              <em>{hasData ? dirLabel(dir500) : ""}</em>
            </div>
            <div>
              <small>250hPa</small>
              <b>{hasData ? wind250.toFixed(0) : "--"}</b>
              <em>{hasData ? dirLabel(dir250) : ""}</em>
            </div>
          </div>
          <div className="shear-box">
            <div>
              <span>低层切变 10m→850hPa</span>
              <i>
                <b
                  style={{
                    width: `${Math.min(100, (shearLow / 30) * 100)}%`,
                    background: shearTone(shearLow),
                  }}
                />
              </i>
              <em style={{ color: shearTone(shearLow) }}>
                {hasData ? `${shearLabel(shearLow)} ${shearLow.toFixed(0)}` : "--"}
              </em>
            </div>
            <div>
              <span>中高层切变 850→500hPa</span>
              <i>
                <b
                  style={{
                    width: `${Math.min(100, (shearMid / 30) * 100)}%`,
                    background: shearTone(shearMid),
                  }}
                />
              </i>
              <em style={{ color: shearTone(shearMid) }}>
                {hasData ? `${shearLabel(shearMid)} ${shearMid.toFixed(0)}` : "--"}
              </em>
            </div>
          </div>
          <p className="wind-note">
            垂直风切变 = 两层风速矢量差（km/h）。切变强时云体易被撕裂、形态散乱；
            切变弱时云层稳定，利于霞光持续。
          </p>
          {/* 云动态外推：线性推测云团移动 */}
          <div className="divider" />
          <div className="panel-title">
            <Navigation size={15} />
            云动态外推
            <small>ECMWF 风场 → 线性推测</small>
          </div>
          {hasData ? (
            <div className="advection-box">
              <div className="adv-header">
                <span>距{mode === "sunset" ? "日落" : "日出"}还有</span>
                <b>{hoursToGo < 1 ? "＜1小时" : `${hoursToGo.toFixed(0)}小时${Math.round((hoursToGo % 1) * 60)}分`}</b>
              </div>
              <div className="adv-row">
                <span>主导风</span>
                <i>{dirLabel(windFrom)} {advectionSpeed.toFixed(0)} km/h</i>
              </div>
              <div className="adv-row">
                <span>云移动趋势</span>
                <i>{cloudMoveDesc}</i>
              </div>
              <div className="adv-row">
                <span>云量趋势</span>
                <i style={{ color: cloudTrend > 15 ? "#e0b36a" : cloudTrend < -15 ? "#7fae8f" : "#9db0ac" }}>
                  {trendLabel}
                </i>
              </div>
              <div className="adv-row">
                <span>外推终点</span>
                <i className="adv-coord">{cloudEndLat.toFixed(3)}°, {cloudEndLon.toFixed(3)}°</i>
              </div>
              <div className="adv-row">
                <span>移动距离</span>
                <i>{totalKm.toFixed(0)} km</i>
              </div>
              <p className="wind-note">
                基于 850hPa 风场推测云团轨迹。云随气流移动，当前风将该云团向 {dirLabel(advectionDir)} 方向推移。
                {hoursToGo > 1
                  ? `预计到${mode === "sunset" ? "日落" : "日出"}时，云区将移动约 ${totalKm.toFixed(0)} km。`
                  : `仅剩不到 1 小时，云层位置变化不大。`}
              </p>
            </div>
          ) : (
            <p className="error">风场数据尚未载入</p>
          )}
          <button
            type="button"
            className={`demo-btn${demoCb ? " active" : ""}`}
            onClick={() => setDemoCb((v) => !v)}
            aria-pressed={demoCb}
          >
            <CloudLightning size={14} />
            {demoCb ? "积雨云虚拟演示 · 进行中" : "积雨云虚拟演示"}
          </button>
          <div className="source-note">
            <span>实时数据链</span>
            <p>
              ECMWF IFS 分层云与辐射、Open‑Meteo 90m DEM、NOAA 太阳几何、NASA
              GIBS Himawari‑9 卫星云图（红外/可见光，10 分钟更新）。
            </p>
            <p>
              AOD {hasData ? aod.toFixed(2) : "--"} · PM2.5{" "}
              {hasData ? pm25.toFixed(1) : "--"} μg/m³
              <br />
              通用几何模型；AOD分级参考文档经验，四川盆地按边界层高度动态修正。
            </p>
          </div>
          {satInfo && <div>
            <div className="sat-card">
              <div className="sat-head">
                <Satellite size={14} />
                <span className="sat-title">实况卫星云图</span>
                <span className="sat-time">
                  {fmtObsTime(satInfo.time)}
                </span>
              </div>
              <div className="sat-src" role="group" aria-label="卫星数据源">
                {(
                  [
                    ["hima9-ir", "Himawari-9 红外"],
                    ["hima9-vis", "Himawari-9 可见光"],
                    ["fy4b", "FY-4B"],
                    ["viirs", "VIIRS"],
                  ] as [SatSource, string][]
                ).map(([s, label]) => (
                  <button
                    key={s}
                    className={satSource === s ? "active" : ""}
                    onClick={() => switchSat(s)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {satError ? (
                <div className="sat-fallback">卫星影像加载失败，可切换数据源重试</div>
              ) : (
                <img
                  key={satInfo.url}
                  src={satInfo.url}
                  alt={satInfo.label}
                  onError={() => setSatError(true)}
                />
              )}
            </div>
            {satFrames.length > 1 && <div className="sat-animate">
              <div className="sat-animate-head">
                <span>云动态演变 · 过去 3 小时</span>
                <div className="sat-animate-ctrl">
                  <button
                    className={animPlaying ? "" : "active"}
                    onClick={() => { setAnimPlaying(false); setAnimFrame(0); }}
                    title="暂停"
                  >||</button>
                  <button
                    className={animPlaying ? "active" : ""}
                    onClick={() => setAnimPlaying(!animPlaying)}
                    title="播放"
                  >{animPlaying ? "⏸" : "▶"}</button>
                </div>
              </div>
              <div className="sat-animate-track">
                <div className="sat-animate-overlay">
                  {satFrames.map((f, i) => (
                    <img key={f.url} src={f.url} alt={`${f.hoursAgo}h ago`}
                      className={i === animFrame ? "active" : ""} />
                  ))}
                </div>
                <input type="range" min="0" max={satFrames.length - 1} step="1"
                  value={animFrame}
                  onChange={(e) => { setAnimFrame(Number(e.target.value)); setAnimPlaying(false); }}
                  className="sat-animate-slider" />
                <div className="sat-animate-labels">
                  {satFrames.filter((_, i) => i % 2 === 0).map((f) => (
                    <span key={f.hoursAgo}>
                      {f.hoursAgo < 0.01
                        ? "现在"
                        : `${Math.round(f.hoursAgo * 60)} 分钟前`}
                    </span>
                  ))}
                </div>
              </div>
              <p className="sat-animate-note">
                30 分钟间隔 7 帧，过去 3 小时云团移动轨迹。点击播放按钮可动画
                演示演变过程，拖动滑块逐帧查看。根据轨迹可直观判断云团走向，
                结合风向外推验证。
              </p>
            </div>}
          </div>}
        </aside>
        <div className="scene-wrap">
          <div className="view-switch" role="group" aria-label="场景视图">
            <button
              className={sceneView === "view" ? "active" : ""}
              onClick={() => setSceneView("view")}
            >
              <Mountain size={13} />
              取景
            </button>
            <button
              className={sceneView === "profile" ? "active" : ""}
              onClick={() => setSceneView("profile")}
            >
              <Activity size={13} />
              剖面
            </button>
            <button
              className={sceneView === "sunpath" ? "active" : ""}
              onClick={() => setSceneView("sunpath")}
            >
              <Sunrise size={13} />
              光路
            </button>
          </div>
          <div className="pitch-ctrl">
            <span>仰角</span>
            <button
              onClick={() =>
                setPitchOffset((v) => Math.max(-20, v - 5))
              }
              title="下俯 5°"
            >
              <ArrowDown size={13} />
            </button>
            <b>{pitchOffset > 0 ? "+" : ""}{pitchOffset}°</b>
            <button
              onClick={() =>
                setPitchOffset((v) => Math.min(20, v + 5))
              }
              title="上仰 5°"
            >
              <ArrowUp size={13} />
            </button>
            <button
              className={pitchOffset === 0 ? "active" : ""}
              onClick={() => setPitchOffset(0)}
              title="复位水平视线"
            >
              复位
            </button>
          </div>
          {sceneView === "view" ? (
            <Scene
              solar={solar}
              cover={cover}
              visible={visible}
              dem={data?.dem.grid || []}
              demDepths={data?.dem.depths}
              demLaterals={data?.dem.laterals}
              heights={effectiveHeights}
              focal={focal}
              playing={playing}
              viewBearing={bearing}
              scenario={scenario}
              wind500={wind500}
              aod={aod}
              visibilityKm={visibility / 1000}
              illumination={illum}
              cb={demoCb}
              genus={genus}
              event={event}
              lat={loc.lat}
              lon={loc.lon}
              onLookChange={setLookOffset}
              pitch={pitchOffset}
            />
          ) : sceneView === "sunpath" ? (
            <div className="profile-frame">
              <SunPathProfile
                dem={data?.dem.grid || []}
                demDepths={data?.dem.depths}
                demLaterals={data?.dem.laterals}
                stationElev={data?.weather.elevation ?? 500}
                sunPathDistances={data?.sunPath?.distances}
                sunPathCover={sunPathCover}
                solar={solar}
                event={event}
                lat={loc.lat}
                lon={loc.lon}
                bearing={bearing}
                mode={mode}
                cover={cover}
                heights={effectiveHeights}
                profile={cloudProfileData}
                cloudEdge={cloudEdge}
                focal={focal}
                look={pitchOffset}
              />
            </div>
          ) : (
            <div className="profile-frame">
              <TerrainProfile
                dem={data?.dem.grid || []}
                demDepths={data?.dem.depths}
                demLaterals={data?.dem.laterals}
                stationElev={data?.weather.elevation ?? 500}
                solar={solar}
                event={event}
                lat={loc.lat}
                lon={loc.lon}
                bearing={bearing}
                look={lookOffset}
                pitch={pitchOffset}
                focal={focal}
                cover={cover}
                visible={visible}
                mode={mode}
                heights={effectiveHeights}
                illum={illum}
                profile={cloudProfileData}
                overcast={parentOvercast}
              />
            </div>
          )}
          <div className="viewfinder-guide" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <b />
          </div>
          {sceneView === "view" && (
            <div className="scene-top">
              <span className="viewfinder-label">取景模拟 · 拖动环顾</span>
              <span>
                <Compass size={14} />
                太阳方位 {solar.azimuth.toFixed(1)}°
              </span>
              <span>
                <Navigation size={14} />
                视线方位 {((bearing - lookOffset + 360) % 360).toFixed(1)}°
              </span>
              <span>
                <Mountain size={14} />
                {focal} mm · DEM 地形
              </span>
              <span>
                <ArrowUp size={13} />
                仰角 {pitchOffset > 0 ? "+" : ""}
                {pitchOffset}°
              </span>
            </div>
          )}
          <div className="smart-card">
            <div className="smart-head">
              <span>
                <Sparkles size={14} />
                智能判读 · {scenario}
              </span>
              <b>{recommendation}</b>
            </div>
            <div className="shot-plan">
              <div>
                <small>架机</small>
                <b>{setupTime}</b>
              </div>
              <div className="shot-peak">
                <small>主拍</small>
                <b>{bestTime}</b>
              </div>
              <div>
                <small>收尾</small>
                <b>{wrapTime}</b>
              </div>
            </div>
            <p>
              文档几何规则：{windowRule}；受光窗口 {windowStartTime}–
              {windowEndTime}， 朝{" "}
              <strong>{bestPoint.solar.azimuth.toFixed(0)}°</strong> 构图。
            </p>
            <div className="smart-actions">
              <button onClick={() => setMinute(bestPoint.minute)}>
                定位最佳时刻
              </button>
              <span>ECMWF/Best Match 分歧 {modelSpread}%</span>
            </div>
          </div>
          <div className="scene-bottom">
            <button className="play" onClick={() => setPlaying(!playing)}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <div className="time-read">
              <b>{time}</b>
              <small>北京时间</small>
            </div>
            <div className="timeline">
              <Slider
                value={[minute]}
                max={120}
                onValueChange={(v) => setMinute(v[0])}
              />
              <div>
                <span>-60 min</span>
                <span>
                  {selectedDate.slice(5)} ·{" "}
                  {mode === "sunset" ? "日落" : "日出"}{" "}
                  {event
                    ? event.toLocaleTimeString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })
                    : "--:--"}
                </span>
                <span>+60 min</span>
              </div>
            </div>
          </div>
          <div className="data-badge">
            <Database size={13} />
            {loading
              ? "数据同步中"
              : hasData
                ? "真实数据已接入"
                : "当前使用安全占位场景"}
          </div>
          <button
            className="mob-toggle"
            onClick={() => setMobileSettings(!mobileSettings)}
            aria-label="切换设置面板"
          >
            <Settings size={14} />
            <span>{mobileSettings ? "收起设置" : "观测设置"}</span>
          </button>
        </div>
        <aside className="right-panel panel">
          <div className="score-head">
            <span>云底受光指数</span>
            <small>文档定量模型</small>
          </div>
          <div className="score">
            <b>{hasData ? score : "--"}</b>
            <span>/ 100</span>
          </div>
          <div className="score-bar">
            <i style={{ width: `${hasData ? score : 0}%` }} />
          </div>
          <p className="verdict">
            {!hasData
              ? "真实气象数据尚未载入，暂不输出受光结论。"
              : illum[2]
                ? "高云仍位于地球阴影上方，具备霞光受光条件。"
                : "高云已进入地球阴影，霞光窗口正在结束。"}{" "}
            {hasData && <>光路透过率约 {Math.round(trans * 100)}%。</>}
          </p>
          <div className="factor-list">
            {[
              ["几何可照亮", geometryScore],
              ["目标云量", cloudScore],
              ["AOD通透", airScore],
              ["上游云廊", corridorScore],
            ].map(([name, value]) => (
              <div key={String(name)}>
                <span>{name}</span>
                <i>
                  <b style={{ width: `${value}%` }} />
                </i>
                <em>{value}</em>
              </div>
            ))}
          </div>
          <div className="dual-score">
            <div>
              <small>出现概率</small>
              <b>{hasData ? probabilityScore : "--"}</b>
            </div>
            <div>
              <small>预期质量</small>
              <b>{hasData ? qualityScore : "--"}</b>
            </div>
            <div>
              <small>预报置信度</small>
              <b>{hasData ? confidenceScore : "--"}</b>
            </div>
          </div>
          <div className="risk-box">
            <span>
              <AlertTriangle size={13} />
              主要翻车风险
            </span>
            {risks.length ? (
              <ul>
                {risks.slice(0, 3).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p>暂未识别到高权重风险，仍建议临近日落复核卫星云图。</p>
            )}
          </div>
          <div className="divider" />
          <div className="panel-title">
            <CloudSun size={15} />
            光路参数
          </div>
          <div className="stat-grid">
            <div>
              <small>太阳高度</small>
              <b>{solar.altitude.toFixed(2)}°</b>
            </div>
            <div>
              <small>AOD 550nm</small>
              <b>{hasData ? aod.toFixed(2) : "--"}</b>
            </div>
            <div>
              <small>等效目标云底</small>
              <b>
                {hasData
                  ? `${effectiveHeights[targetIndex].toFixed(2)} km`
                  : "--"}
              </b>
            </div>
            <div>
              <small>可照亮深入距离</small>
              <b>{hasData ? `${Math.round(maxDepth)} km` : "--"}</b>
            </div>
          </div>
          <div className="divider" />
          <div className="panel-title">
            <Camera size={15} />
            镜头焦段
          </div>
          <div className="metric-row">
            <span>焦段</span>
            <b>{focal} mm</b>
          </div>
          <Slider
            value={[focal]}
            min={24}
            max={600}
            onValueChange={(v) => setFocal(v[0])}
          />
          <div className="fov-readout">
            全画幅横向视场{" "}
            {Math.max(
              3.4,
              Math.min(74, (2 * Math.atan(36 / (2 * focal)) * 180) / Math.PI),
            ).toFixed(1)}
            °<span>拉动焦段即可同步改变取景范围与太阳大小</span>
          </div>
          <div className="light-path">
            <span>地球曲率受光判断</span>
            <div className="path-line">
              <i />
              <b />
            </div>
            <div className="path-label">
              <span>观测点</span>
              <span>云边界 {Math.round(cloudEdge)} km</span>
              <span>太阳</span>
            </div>
          </div>
        </aside>
      </section>
      <Dialog open={cityRankOpen} onOpenChange={setCityRankOpen}>
        <DialogContent className="cityrank-dialog sm:max-w-[840px]">
          <DialogHeader className="cityrank-header">
            <DialogTitle>
              <Trophy size={17} /> 今日推荐拍摄城市（前 20）
            </DialogTitle>
            <DialogDescription>
              {mode === "sunset" ? "晚霞" : "朝霞"} · {selectedDateLabel} · 按主程序判定规则（受光/云量/通透/走廊）综合评分，点击即可跳转查询
            </DialogDescription>
            <button
              className="cityrank-share"
              onClick={shareCityRank}
              disabled={cityRankSharing || !cityRanks.length}
            >
              <Share2 size={13} />
              {cityRankSharing ? "生成中…" : shareReady ? "点击分享" : "分享图片"}
            </button>
          </DialogHeader>
          <div className="cityrank-body">
            {cityRankLoading && (
              <p className="cityrank-empty">正在并发计算各城市拍摄价值…</p>
            )}
            {cityRankError && <p className="error">{cityRankError}</p>}
            {!cityRankLoading && !cityRankError && cityRanks.length === 0 && (
              <p className="cityrank-empty">暂无数据，请点击左侧按钮重新计算。</p>
            )}
            {!cityRankLoading &&
              cityRanks.map((c, rank) => (
                <div className="cityrank-item" key={c.name + c.province}>
                  <button
                    className="cityrank-row"
                    onClick={() => pickCity(c)}
                  >
                    <span className={`cityrank-rank r-${rank < 3 ? rank + 1 : ""}`}>
                      {rank + 1}
                    </span>
                    <span className="cityrank-name">
                      <b>{c.name}</b>
                      <small>{c.province}</small>
                    </span>
                    <span className="cityrank-tag">{c.tag}</span>
                    <span className="cityrank-scenario">{c.scenario}</span>
                    <span className="cityrank-window">{c.schedule}</span>
                    <span className="cityrank-score">
                      <b>{c.score}</b>
                      <i style={{ width: `${c.score}%` }} />
                    </span>
                  </button>
                  <div className="cityrank-profile">
                    <CityCloudProfile
                      profile={c.profile}
                      cover={c.cover}
                      mode={mode}
                      illum={c.illum}
                      overcast={c.overcast}
                    />
                  </div>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>
      <AmapPicker
        open={mapOpen}
        initial={loc}
        onOpenChange={setMapOpen}
        onConfirm={(point) => {
          setPlaying(false);
          setMinute(60);
          setCustomLocation(point);
          setPlace("地图选点");
        }}
      />
    </main>
  );
}
