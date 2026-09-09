"use client";
// 值得专程拍摄范围地图：以当前观测点为中心做网格评分（复用 rankGrid/scoreCity 算法），
// 在高德瓦片上叠加色块，绿=值得专程拍摄(≥72)、黄=建议就近蹲守(≥48)、灰=不建议。
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, MapPin, RefreshCw } from "lucide-react";
import { rankGrid, type GridRank } from "./cities";
import { gcjToWgs, lonLatToWorld, wgsToGcj, worldToLonLat } from "./geo";

const RADII = [
  { label: "100km", km: 100 },
  { label: "200km", km: 200 },
  { label: "400km", km: 400 },
];

function tagColor(rank: GridRank["rank"]): { bg: string; text: string } {
  if (rank.tag === "值得专程拍摄")
    return { bg: "rgba(38,178,116,0.92)", text: "#03331f" };
  if (rank.tag === "建议就近蹲守")
    return { bg: "rgba(224,173,68,0.92)", text: "#2a1e02" };
  if (rank.score <= 0)
    return { bg: "rgba(96,110,107,0.55)", text: "#d7dfdc" };
  return { bg: "rgba(96,112,108,0.78)", text: "#e6eeeb" };
}

export default function WorthMapDialog({
  open,
  onOpenChange,
  center,
  date,
  mode,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  center: { lat: number; lon: number };
  date: Date;
  mode: "dawn" | "sunset";
  onPick: (lat: number, lon: number) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null),
    dragRef = useRef({
      active: false,
      moved: false,
      x: 0,
      y: 0,
      worldX: 0,
      worldY: 0,
    }),
    cacheRef = useRef<Map<string, GridRank[]>>(new Map());
  const [centerGcj, setCenterGcj] = useState(() => {
    const [lat, lon] = wgsToGcj(center.lat, center.lon);
    return { lat, lon };
  });
  const [zoom, setZoom] = useState(10);
  const [size, setSize] = useState({ width: 760, height: 470 });
  const [radiusKm, setRadiusKm] = useState(200);
  const [grid, setGrid] = useState<GridRank[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [hover, setHover] = useState<GridRank | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
    cacheKey = `${dateKey}|${mode}|${radiusKm}|${center.lat.toFixed(2)}|${center.lon.toFixed(2)}`;

  // 打开时同步地图中心（GCJ‑02 瓦片坐标系）并监听尺寸
  useEffect(() => {
    if (!open) return;
    const [lat, lon] = wgsToGcj(center.lat, center.lon);
    setCenterGcj({ lat, lon });
    setHover(null);
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
  }, [open, center.lat, center.lon]);

  // 网格评分：打开对话框或切换半径/日期时计算，结果按 key 缓存
  useEffect(() => {
    if (!open) return;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setGrid(cached);
      setError("");
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError("");
    setProgress("");
    const radiusDeg = radiusKm / 111,
      stepDeg = Math.max(0.25, radiusDeg / 6);
    rankGrid(
      center,
      radiusDeg,
      stepDeg,
      date,
      mode,
      ctrl.signal,
      (done, total) => setProgress(`第 ${done}/${total} 批`),
    )
      .then((r) => {
        cacheRef.current.set(cacheKey, r);
        setGrid(r);
      })
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError")
          setError("网格评分失败，请稍后重试");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [open, cacheKey, center, date, mode, radiusKm, retryTick]);

  const centerWorld = lonLatToWorld(centerGcj.lon, centerGcj.lat, zoom),
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

  const cells = grid.map((g) => {
    const [glat, glon] = wgsToGcj(g.lat, g.lon),
      w = lonLatToWorld(glon, glat, zoom);
    return {
      g,
      left: w.x - centerWorld.x + size.width / 2,
      top: w.y - centerWorld.y + size.height / 2,
    };
  });

  const [wgsLat, wgsLon] = gcjToWgs(centerGcj.lat, centerGcj.lon),
    worthCount = grid.filter((g) => g.rank.tag === "值得专程拍摄").length,
    stayCount = grid.filter((g) => g.rank.tag === "建议就近蹲守").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="amap-dialog sm:max-w-[860px]"
      >
        <DialogHeader className="amap-header">
          <DialogTitle>值得专程拍摄范围</DialogTitle>
          <DialogDescription>
            基于当前评分算法（受光/云量/通透/走廊），沿 {mode === "sunset" ? "日落" : "日出"}{" "}
            {dateKey} 计算观测点周边网格拍摄价值。拖动地图查看，点击色块设为观测点。
          </DialogDescription>
        </DialogHeader>
        <div
          ref={mapRef}
          className="amap-canvas"
          role="application"
          aria-label="值得专程拍摄范围地图"
          onPointerDown={(e) => {
            const world = lonLatToWorld(centerGcj.lon, centerGcj.lat, zoom);
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
            setCenterGcj(
              worldToLonLat(drag.worldX - dx, drag.worldY - dy, zoom),
            );
          }}
          onPointerUp={(e) => {
            const drag = dragRef.current;
            if (!drag.active) return;
            drag.active = false;
            if (!drag.moved) {
              const rect = e.currentTarget.getBoundingClientRect(),
                world = lonLatToWorld(centerGcj.lon, centerGcj.lat, zoom);
              setCenterGcj(
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
            setZoom((v) => Math.max(4, Math.min(15, v + (e.deltaY < 0 ? 1 : -1))));
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
          {cells.map(({ g, left, top }) => {
            const c = tagColor(g.rank),
              isHover = hover?.lat === g.lat && hover?.lon === g.lon;
            return (
              <button
                key={`${g.lat},${g.lon}`}
                type="button"
                title={`${g.rank.tag} · 评分 ${g.rank.score} · ${g.rank.schedule}`}
                aria-label={`${g.lat.toFixed(2)},${g.lon.toFixed(2)} 评分 ${g.rank.score}`}
                onMouseEnter={() => setHover(g)}
                onMouseLeave={() => setHover(null)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onPick(g.lat, g.lon)}
                className="worth-cell"
                style={{
                  left: left - 23,
                  top: top - 23,
                  background: c.bg,
                  color: c.text,
                  borderColor: isHover ? "#ffffff" : "rgba(255,255,255,0.6)",
                  opacity: g.rank.score <= 0 ? 0.55 : 1,
                  zIndex: isHover ? 5 : 3,
                }}
              >
                {g.rank.score}
              </button>
            );
          })}
          <div className="worth-center">
            <MapPin size={22} />
          </div>
          <div className="amap-zoom">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setZoom((v) => Math.min(15, v + 1))}
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
          {loading && (
            <div className="worth-loading">
              <Loader2 size={16} className="spin" />
              <span>评分计算中 {progress}</span>
            </div>
          )}
          <span className="amap-attribution">高德地图 · 直连瓦片</span>
        </div>
        <div className="worth-bar">
          <span className="worth-key">
            <i className="worth-dot" style={{ background: "#26b274" }} />
            值得专程拍摄 ≥72
          </span>
          <span className="worth-key">
            <i className="worth-dot" style={{ background: "#e0ad44" }} />
            建议就近蹲守 ≥48
          </span>
          <span className="worth-key">
            <i className="worth-dot" style={{ background: "#60706c" }} />
            不建议专程
          </span>
          <span className="worth-count">
            值得 <b style={{ color: "#7fd9b2" }}>{worthCount}</b> · 蹲守{" "}
            <b style={{ color: "#f0cf8a" }}>{stayCount}</b>
          </span>
          <span className="worth-grow" />
          {RADII.map((r) => (
            <button
              key={r.km}
              type="button"
              disabled={loading}
              onClick={() => setRadiusKm(r.km)}
              className={`worth-btn ${radiusKm === r.km ? "active" : ""}`}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            className="worth-btn"
            disabled={loading}
            onClick={() => {
              cacheRef.current.delete(cacheKey);
              setGrid([]);
              setRetryTick((t) => t + 1);
            }}
            title="重新计算当前范围"
          >
            <RefreshCw size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
            重算
          </button>
        </div>
        <div className="worth-bar worth-bar2">
          {hover ? (
            <span>
              <b>
                {hover.lat.toFixed(2)}°, {hover.lon.toFixed(2)}°
              </b>{" "}
              · {hover.rank.tag} · 评分 {hover.rank.score} ·{" "}
              {hover.rank.schedule}
            </span>
          ) : (
            <span>
              中心 {wgsLat.toFixed(3)}°, {wgsLon.toFixed(3)}°（WGS‑84，已校正
              GCJ‑02）
            </span>
          )}
          <span className="worth-grow" />
          <button onClick={() => onOpenChange(false)} className="worth-btn">
            关闭
          </button>
        </div>
        {error && <div className="worth-error">{error}</div>}
      </DialogContent>
    </Dialog>
  );
}
