"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Compass,
  Database,
  Layers3,
  MapPin,
  Mountain,
  Navigation,
  Pause,
  Play,
  RefreshCw,
  Satellite,
  Sparkles,
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
import TerrainProfile from "./terrain-profile";
import { HISTORY_DAYS, forecastUpdateAt, sceneUrls, nextSunUrl } from "./scene-urls";
import { highCloudPlan, totalHazePlan } from "./cloud-render";
import { sunDiskStats, sunTintAlpha } from "./sun-image";

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
  comparison?: { hourly: Record<string, (number | string)[]> } | null;
  satellite: string;
  updated: string;
  modelUpdate: string;
};
const places = {
  "成都·天府广场": { lat: 30.657, lon: 104.066 },
  "德阳·旌阳": { lat: 31.129, lon: 104.346 },
  "成都·龙泉山": { lat: 30.52, lon: 104.31 },
};
type PlaceKey = keyof typeof places | "地图选点";
const rad = (v: number) => (v * Math.PI) / 180,
  deg = (v: number) => (v * 180) / Math.PI;
function solarPosition(date: Date, lat: number, lon: number): Solar {
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
  const corridorLats = corridorPoints.map((p) => p[0].toFixed(5)).join(","),
    corridorLons = corridorPoints.map((p) => p[1].toFixed(5)).join(",");
  const {
    wf: wfUrl,
    dem: demUrl,
    vis: visUrl,
    air: airUrl,
    corridor: corridorUrl,
  } = sceneUrls({ lat, lon, lats, lons, corridorLats, corridorLons });
  const [wfResult, demResult, visResult, aqResult, corResult] =
    await Promise.allSettled([
      fetch(wfUrl, { signal }),
      fetch(demUrl, { signal }),
      fetch(visUrl, { signal }),
      fetch(airUrl, { signal }),
      fetch(corridorUrl, { signal }),
    ]);
  if (wfResult.status !== "fulfilled" || !wfResult.value.ok)
    throw new Error("ECMWF 暂时无法连接");
  const weather = await wfResult.value.json();
  let elevations = Array(points.length).fill(weather.elevation || 0);
  if (demResult.status === "fulfilled" && demResult.value.ok) {
    const elevationData = await demResult.value.json();
    if (Array.isArray(elevationData.elevation))
      elevations = elevationData.elevation;
  }
  let comparison = null;
  if (visResult.status === "fulfilled" && visResult.value.ok) {
    const v = await visResult.value.json();
    comparison = v;
    weather.hourly.visibility = v.hourly?.visibility || [];
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
  const grid = depths.map((_, di) =>
    laterals.map((__, li) => elevations[di * laterals.length + li]),
  );
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    bbox = `${lon - 4},${lat - 3},${lon + 4},${lat + 3}`;
  const satellite = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&STYLES=&FORMAT=image/jpeg&TRANSPARENT=false&HEIGHT=300&WIDTH=420&SRS=EPSG:4326&BBOX=${bbox}&TIME=${day}`;
  return {
    weather,
    comparison,
    dem: { grid, depths, laterals, source: "Open-Meteo 90m DEM" },
    corridor: {
      distances: corridorDistances,
      forecasts: Array.isArray(corridorData) ? corridorData : [],
    },
    satellite,
    updated: new Date().toISOString(),
    modelUpdate: forecastUpdateAt(new Date()).toISOString(),
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
  illumination,
  event,
  lat,
  lon,
  onLookChange,
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
  illumination: boolean[];
  event: Date | null;
  lat: number;
  lon: number;
  onLookChange: (look: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    drag = useRef({ on: false, x: 0 }),
    sunImg = useRef<HTMLImageElement | null>(null),
    sunTried = useRef<string[]>([]),
    sunFrac = useRef(0.9),
    sunSat = useRef(0.7);
  const [look, setLook] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      const url = nextSunUrl(sunTried.current);
      if (!url) return;
      sunTried.current.push(url);
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        sunImg.current = img;
        // 采样日面占比与饱和度：白光日面占比约 95%、饱和度很低（几乎纯白），
        // 极紫外假色占比约 89% 且偏暖；据此精确铺满并决定暖色着色强度。
        try {
          const s = 48,
            cv = document.createElement("canvas");
          cv.width = s;
          cv.height = s;
          const cx = cv.getContext("2d", { willReadFrequently: true });
          if (cx) {
            cx.drawImage(img, 0, 0, s, s);
            const stats = sunDiskStats(cx.getImageData(0, 0, s, s).data, s, s);
            if (stats.disk) {
              sunFrac.current = stats.frac;
              sunSat.current = stats.saturation;
            }
          }
        } catch {
          /* 保留默认值 */
        }
      };
      img.onerror = () => {
        if (alive) load();
      };
      img.src = url;
    };
    load();
    return () => {
      alive = false;
    };
  }, []);
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
      const hor = h * 0.61,
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
        sky = x.createLinearGradient(0, 0, 0, hor);
      sky.addColorStop(
        0,
        `rgb(${29 + warm * 35 + aerosol * 42 + cloudiness * 18},${45 + warm * 12 + aerosol * 34 + cloudiness * 14},${84 + warm * 12 + aerosol * 18 + cloudiness * 8})`,
      );
      sky.addColorStop(
        0.65,
        `rgb(${104 + warm * 95},${91 + warm * 35},${124 - warm * 38})`,
      );
      sky.addColorStop(
        1,
        `rgb(${220 + warm * 32},${116 + warm * 58},${70 + warm * 18})`,
      );
      x.fillStyle = sky;
      x.fillRect(0, 0, w, h);
      if (cloudiness > 0.12) {
        x.fillStyle = `rgba(56,67,91,${cloudiness * (0.13 + murk * 0.16)})`;
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
        sy = hor - solar.altitude * 9,
        g = x.createRadialGradient(sx, sy, 1, sx, sy, 150);
      g.addColorStop(0, "rgba(255,244,185,.95)");
      g.addColorStop(0.1, "rgba(255,190,100,.65)");
      g.addColorStop(1, "rgba(255,120,50,0)");
      x.fillStyle = g;
      x.fillRect(0, 0, w, hor);
      const sunR = Math.max(
          3,
          Math.min(w * 0.16, (0.53 / referenceFov) * w * 0.5),
        ),
        sImg = sunImg.current;
      x.beginPath();
      x.arc(sx, sy, sunR, 0, Math.PI * 2);
      if (sImg && sImg.naturalWidth > 0) {
        x.save();
        x.clip();
        // 按实测日面占比铺满圆形（避免硬编码 0.8 导致日面被裁或露黑边）
        const k = (sunR * 2) / (sImg.naturalWidth * sunFrac.current);
        x.drawImage(
          sImg,
          sx - sunR,
          sy - sunR,
          sImg.naturalWidth * k,
          sImg.naturalHeight * k,
        );
        // 白光日面（低饱和）叠加暖色径向渐变，使其融入日落氛围并保留黑子等表面细节
        const tintA = sunTintAlpha(sunSat.current),
          warm = x.createRadialGradient(sx, sy, sunR * 0.08, sx, sy, sunR);
        warm.addColorStop(0, `rgba(255,240,195,${tintA})`);
        warm.addColorStop(0.55, `rgba(255,180,100,${tintA * 0.92})`);
        warm.addColorStop(1, `rgba(255,120,52,${tintA})`);
        x.fillStyle = warm;
        x.fill();
        x.restore();
      } else {
        x.fillStyle = "#fff1b3";
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
        redProgress = clamp((-solar.altitude - 0.15) / 5.4),
        lowSun = clamp(1 - Math.abs(solar.altitude + 1.2) / 8);
      const cloudTone = (km: number, layer: number, sunlit: boolean) => {
        if (!sunlit)
          return mix(
            [91, 105, 127],
            [72, 73, 91],
            layer * 0.18 + aodHaze * 0.16,
          );
        // 文档比色卡：低云主要橘红；云底越高，金黄→橘红的色域越完整；AOD升高则褪灰、变暗。
        const gold = [255, 198, 102],
          orange = [245, 105, 57],
          crimson = [198, 53, 48],
          lowCloud = [229, 96, 55];
        let color = km < 2.7 ? lowCloud : mix(gold, orange, redProgress);
        if (km >= 4.2) color = mix(color, crimson, redProgress * 0.7);
        if (km >= 8) color = mix(gold, crimson, redProgress * 0.9);
        color = mix(color, [185, 166, 164], aodHaze * 0.72);
        return mix(color, [56, 66, 84], (1 - lowSun) * 0.38 + aodHaze * 0.13);
      };
      const highTone = cloudTone(heights[2] || 10, 2, illumination[2]),
        midTone = cloudTone(heights[1] || 5.5, 1, illumination[1]),
        lowTone = cloudTone(heights[0] || 1.5, 0, illumination[0]);
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
        x.globalAlpha = (sunlit ? 0.18 : 0.1) + amount / 350;
        x.strokeStyle = `rgb(${mix(tone, [255, 236, 197], sunlit ? 0.55 : 0.12).join(",")})`;
        for (let i = 0; i < Math.round(16 + amount / 5); i++) {
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
          threshold = 0.59 - Math.min(0.34, amount / 260),
          flow = drift * (low ? 0.011 : 0.016);
        for (let py = 0; py < oh; py++)
          for (let px = 0; px < ow; px++) {
            const u = (px / ow) * (low ? 5.6 : 7.4) + flow,
              v = (py / oh) * (low ? 2.4 : 3.3),
              perlin = fbm(u, v),
              cellular =
                1 -
                worley(u * (low ? 2.1 : 2.8) + 7, v * (low ? 2.1 : 2.8) - 5),
              // Nubis式双层密度：Perlin-FBM 定主体，Worley 侵蚀云缘并制造孔洞。
              shape = perlin * 0.7 + cellular * 0.3,
              height01 = py / oh,
              vertical = low
                ? Math.pow(Math.sin(Math.PI * height01), 0.72)
                : Math.pow(Math.sin(Math.PI * height01), 1.3),
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
      const highY = cloudY(heights[2] || 10),
        midY = cloudY(heights[1] || 5.5),
        lowY = cloudY(heights[0] || 1.5);
      if (visible[2]) {
        const hp = highCloudPlan(cover[2]);
        if (hp.mode === "deck")
          texturedDeck(
            highY,
            hp.amount,
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
      const totalCover = 100 * (1 - (1-cover[0]/100)*(1-cover[1]/100)*(1-cover[2]/100)),
        totalHaze = totalHazePlan(totalCover);
      if (totalHaze.visible) {
        const deck = x.createLinearGradient(0, highY - 28, 0, lowY + 70);
        deck.addColorStop(0, `rgba(${highTone.join(",")},${totalHaze.alphaTop.toFixed(3)})`);
        deck.addColorStop(1, `rgba(${midTone.join(",")},${totalHaze.alphaBottom.toFixed(3)})`);
        x.fillStyle = deck;
        x.fillRect(-20, highY-30, w+40, Math.max(70, lowY-highY+100));
      }
      // —— 地形：对 7×5 的粗糙 DEM 做双线性细分得到平滑曲面，再叠加海拔配色、太阳侧光与大气透视。
      const rows = dem.length
          ? dem
          : [
              [500, 510, 495, 505, 500],
              [510, 520, 500, 515, 508],
              [520, 530, 510, 525, 515],
            ],
        flat = rows.flat(),
        mn = Math.min(...flat),
        mx = Math.max(...flat),
        span = Math.max(120, mx - mn),
        SUB = 4,
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
            p11 = rows[r1][c1];
          return (
            p00 * (1 - s) * (1 - t) +
            p10 * (1 - s) * t +
            p01 * s * (1 - t) +
            p11 * s * t
          );
        },
        project = (u: number, v: number) => {
          const near = 1 - u / RU,
            width = w * (0.28 + 0.76 * near),
            left = (w - width) / 2;
          return {
            x: left + (width * v) / CU,
            y:
              hor +
              (h - hor) * (0.08 + 0.78 * near ** 1.6) -
              ((elevAt(u, v) - mn) / span) * (22 + 72 * near),
          };
        };
      const clampV = (v: number, lo: number, hi: number) =>
          Math.max(lo, Math.min(hi, v)),
        tNorm = (e: number) => clampV((e - mn) / span, 0, 1),
        // 海拔配色：河谷深绿 → 林线橄榄 → 草坡黄褐 → 山岩暖灰
        ELEV_STOPS: [number, number[]][] = [
          [0, [23, 46, 44]],
          [0.2, [46, 74, 56]],
          [0.45, [92, 104, 76]],
          [0.65, [128, 118, 90]],
          [0.85, [150, 128, 108]],
          [1, [168, 140, 122]],
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
        haze = [206, 156, 134];
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
          // 面元中心高程与坡向（横向/纵深差分），用于太阳侧光
          const eC = elevAt(u + 0.5, v + 0.5),
            sd = elevAt(u + 1, v + 0.5) - elevAt(u, v + 0.5),
            sl = elevAt(u + 0.5, v + 1) - elevAt(u + 0.5, v),
            sdAng = Math.atan2(sd, dStep(u) * 1000),
            slAng = Math.atan2(sl, stepLat * 1000),
            fog = Math.pow(u / RU, 1.3) * (0.3 + murk * 0.75),
            jitter = (n(u * 37.1 + v * 13.7) - 0.5) * 0.07,
            light = clampV(
              0.2 +
                -Math.sin(sdAng) * sunDepth * (0.45 + 0.55 * sunAltW) +
                -Math.sin(slAng) * sunLateral * 0.75 +
                tNorm(eC) * 0.12 +
                jitter,
              -0.32,
              1.15,
            );
          let col = ramp(tNorm(eC));
          col = mix(col, [255, 174, 96], clampV(light, 0, 1) * 0.62);
          col = mix(col, [15, 34, 50], clampV(-light, 0, 1) * 0.6);
          col = mix(col, haze, fog * 0.82);
          x.fillStyle = `rgb(${col.map((v) => Math.round(v * dusk)).join(",")})`;
          x.fill();
          if (fog < 0.72) {
            x.strokeStyle =
              light > 0.15
                ? `rgba(255,196,140,${(0.1 * (1 - fog)).toFixed(3)})`
                : `rgba(14,32,42,${(0.12 * (1 - fog)).toFixed(3)})`;
            x.lineWidth = 0.5;
            x.stroke();
          }
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
        `rgba(${mix(ramp(0), [30, 46, 48], 0.6).join(",")},0.9)`,
      );
      fg.addColorStop(0.35, "rgba(15,27,31,0.97)");
      fg.addColorStop(1, "#060b0e");
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
    [sceneView, setSceneView] = useState<"view" | "profile">("view"),
    [visible, setVisible] = useState([true, true, true]),
    [dataPanel, setDataPanel] = useState(false),
    [data, setData] = useState<SceneData | null>(null),
    [loading, setLoading] = useState(true),
    [clock, setClock] = useState<number | null>(null),
    [nextRefreshAt, setNextRefreshAt] = useState(0),
    [error, setError] = useState("");
  const requestRef = useRef({
      id: 0,
      controller: null as AbortController | null,
    }),
    cacheRef = useRef(new Map<string, SceneData>());
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
    try {
      let next: SceneData | null = null;
      try {
        const proxy = await fetch(
          `/api/scene?lat=${loc.lat}&lon=${loc.lon}&bearing=${bearing}`,
          { signal: controller.signal },
        );
        if (proxy.ok) next = await proxy.json();
      } catch {
        if (controller.signal.aborted) return;
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
    } finally {
      if (requestId === requestRef.current.id) setLoading(false);
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
    cover = [
      Number(hourly?.cloud_cover_low?.[idx] || 0),
      Number(hourly?.cloud_cover_mid?.[idx] || 0),
      Number(hourly?.cloud_cover_high?.[idx] || 0),
    ],
    totalCloud = Math.round(
      100 * (1 - (1 - cover[0] / 100) * (1 - cover[1] / 100) * (1 - cover[2] / 100)),
    ),
    visibility = Number(hourly?.visibility?.[idx] || 15000),
    stationElevation = Number(data?.weather.elevation || 500),
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
    pm25 = Number(hourly?.pm2_5?.[idx] || 0),
    scaleHeight = Math.max(
      0.5,
      Math.min(4, Number(hourly?.boundary_layer_height?.[idx] || 1500) / 1000),
    ),
    effectiveGround = Math.max(
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
    edgeAt = corridorCover.findIndex((c, i) => i > 0 && c[targetIndex] < 15),
    cloudEdge =
      edgeAt > 0
        ? data?.corridor?.distances[edgeAt] || 320
        : data?.corridor?.distances.at(-1) || 320,
    maxDepth = 2 * Math.sqrt(2 * 6371 * effectiveHeights[targetIndex]),
    illum = effectiveHeights.map(
      (h, i) => solar.altitude > -dip(h) - 0.57 && cover[i] > 5,
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
    ),
    cape = Number(comparisonHourly?.cape?.[comparisonIdx] || 0),
    precipitation = Number(
      comparisonHourly?.precipitation?.[comparisonIdx] || 0,
    ),
    wind500 = Number(
      comparisonHourly?.wind_speed_500hPa?.[comparisonIdx] || 20,
    ),
    deterministicProbability = Math.min(
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
    scenario =
      cape > 700
        ? "对流云边缘型"
        : cover[2] > 58 && cover[1] < 48
          ? "高云幕型"
          : cover[1] > 50
            ? "中云层状型"
            : cover[0] > 48
              ? "低云遮挡型"
              : "云洞漏光型",
    cloudKinds = [
      cover[0] > 62 ? "层积云 Sc" : "碎层云 St",
      scenario === "中云层状型" || cover[1] > 68 ? "高层云 As" : "高积云 Ac",
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
    modelUpdateLabel = data?.modelUpdate
      ? new Date(data.modelUpdate).toLocaleTimeString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "--:--",
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
        <aside className="left-panel panel">
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
            <small>{selectedDateLabel} · 回溯 {HISTORY_DAYS} 天 · 未来 7 天</small>
          </div>
          <button className="location-btn" onClick={load}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            {loading ? "正在读取真实数据" : "刷新实况/预报"}
          </button>
          <div className="data-clock">
            <span>当前 {clock === null ? "--:--:--" : new Date(clock).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</span>
            <span title="ECMWF 数值预报更新时次">数据更新 {modelUpdateLabel}</span>
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
                  {cloudKinds[i]} · {effectiveHeights[i].toFixed(1)}km ·{" "}
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
          <div className="source-note">
            <span>实时数据链</span>
            <p>
              ECMWF IFS 分层云与辐射、Open‑Meteo 90m DEM、NOAA 太阳几何、NASA
              VIIRS 卫星真彩色。
            </p>
            <p>
              AOD {hasData ? aod.toFixed(2) : "--"} · PM2.5{" "}
              {hasData ? pm25.toFixed(1) : "--"} μg/m³
              <br />
              通用几何模型；AOD分级参考文档经验，四川盆地按边界层高度动态修正。
            </p>
          </div>
          {data && (
            <div className="sat-card">
              <div>
                <Satellite size={14} />
                昨日卫星云图
              </div>
              <img src={data.satellite} alt="NASA VIIRS 卫星真彩色云图" />
            </div>
          )}
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
              event={event}
              lat={loc.lat}
              lon={loc.lon}
              onLookChange={setLookOffset}
            />
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
                focal={focal}
                cover={cover}
                visible={visible}
                mode={mode}
                heights={effectiveHeights}
                illum={illum}
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
        </div>
        <aside className={`right-panel panel${dataPanel ? " open" : ""}`}>
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
              ["总云量", totalCloud],
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
      <div
        className={`panel-backdrop${dataPanel ? " open" : ""}`}
        onClick={() => setDataPanel(false)}
        aria-hidden="true"
      />
      <button
        className="mobile-data-btn"
        onClick={() => setDataPanel((v) => !v)}
        aria-expanded={dataPanel}
      >
        <Database size={13} />
        {dataPanel ? "收起" : "数据"}
      </button>
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
