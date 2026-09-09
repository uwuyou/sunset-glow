"use client";
// 日出/日落光路取景器：模拟相机取景器真实视角
// 你看到的画面 ≈ 拿起相机对准日落方向时看到的真实场景
// 天空色彩、云层位置、地形轮廓、太阳运动轨迹，全部按真实物理计算
import type { CloudLayerProfile } from "./cloud-profile";

const CLOUD_THRESHOLD = 15;
const DEG = 180 / Math.PI;
const noise = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export default function SunPathProfile({
  dem,
  demDepths,
  demLaterals,
  stationElev,
  sunPathDistances,
  sunPathCover,
  solar,
  event,
  lat,
  lon,
  bearing,
  mode,
  cover,
  heights,
  profile,
  cloudEdge,
  focal,
  look,
}: {
  dem: number[][];
  demDepths?: number[];
  demLaterals?: number[];
  stationElev: number;
  sunPathDistances?: number[];
  sunPathCover?: number[][];
  solar: { altitude: number; azimuth: number };
  event: Date | null;
  lat: number;
  lon: number;
  bearing: number;
  mode: "sunset" | "dawn";
  cover: number[];
  heights: number[];
  profile?: CloudLayerProfile[];
  cloudEdge: number;
  focal?: number;
  look?: number;
}) {
  const horizonKm = Math.max(
      20,
      Math.min(200, 3.57 * Math.sqrt(Math.max(1, stationElev))),
    ),
    distances = sunPathDistances?.length
      ? sunPathDistances
      : [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100, 120, 150, 180, 200],
    pathCover = sunPathCover?.length
      ? sunPathCover
      : distances.map(() => cover),
    // DEM 高程清洗：异常/非有限值回退 500m，避免 NaN 导致地形天际线消失
    rows = (dem.length
      ? dem
      : [
          [500, 510, 495, 505, 500],
          [510, 520, 500, 515, 508],
          [520, 530, 510, 525, 515],
        ]).map((row) =>
        row.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 500)),
      ),
    depths = demDepths?.length ? demDepths : [2, 8, 18, 32, 48, 65, 82],
    lats = demLaterals?.length ? demLaterals : [-18, -9, 0, 9, 18],
    alt = solar.altitude,
    focalVal = focal ?? 85,
    // 焦段缩放：以地平线为锚点整体变焦。长焦（focal 大）→ 云层/太阳/地形
    // 在画面中更大、视场更窄；广角 → 视野更广、物像更小。85mm 为基准 1.0。
    frameScale = Math.max(0.55, Math.min(2.8, Math.pow(focalVal / 85, 0.92))),
    // 仰角调节：look > 0 上仰 → 地平线下移、天空占比增大；look < 0 下俯反之。
    // 每 1° 对应约 2.6px 的画面平移，切换时视图明显同步响应。
    pitchDeg = Math.max(-22, Math.min(22, look ?? 0)),
    // 真实 DEM 地形：对每个距离 d，在横向 (laterals) 上扫描全部采样点，
    // 计算相对观测站的仰角并取最大值 —— 即该距离处能遮挡太阳的阻挡山脊线。
    demInterp = (d: number, latKm: number): number => {
      if (!rows.length || !depths.length) return 500;
      const dl = Math.max(0, Math.min(depths[depths.length - 1], d));
      let lo = 0;
      while (lo < depths.length - 2 && depths[lo + 1] < dl) lo++;
      const t =
          (dl - depths[lo]) / Math.max(0.001, depths[lo + 1] - depths[lo]),
        rowInterp = (row: number[]) => {
          if (!row.length) return 500;
          if (latKm <= lats[0]) return row[0];
          if (latKm >= lats[lats.length - 1])
            return row[row.length - 1];
          let li = 0;
          while (li < lats.length - 2 && lats[li + 1] < latKm) li++;
          const lt =
            (latKm - lats[li]) / Math.max(0.001, lats[li + 1] - lats[li]);
          return row[li] + (row[li + 1] - row[li]) * lt;
        };
      return (
        rowInterp(rows[lo]) +
        (rowInterp(rows[lo + 1]) - rowInterp(rows[lo])) * t
      );
    },
    terrainElevAt = (d: number): number => {
      let maxE = -90;
      const N = 48;
      for (let s = 0; s <= N; s++) {
        const latKm = -18 + (36 * s) / N,
          elev = demInterp(d, latKm),
          theta = Math.atan2(elev - stationElev, d * 1000) * DEG;
        if (theta > maxE) maxE = theta;
      }
      return maxE;
    },
    layerMeta = [
      {
        key: "low" as const,
        label: "低云",
        base: profile?.[0]?.base ?? Math.max(0.5, (heights[0] ?? 1.5) - 0.4),
        top: profile?.[0]?.top ?? (heights[0] ?? 1.5) + 0.8,
        genus: profile?.[0]?.genus ?? ("stratocumulus" as const),
      },
      {
        key: "mid" as const,
        label: "中云",
        base: profile?.[1]?.base ?? Math.max(3, (heights[1] ?? 5.5) - 0.5),
        top: profile?.[1]?.top ?? (heights[1] ?? 5.5) + 1.3,
        genus: profile?.[1]?.genus ?? ("altocumulus" as const),
      },
      {
        key: "high" as const,
        label: "高云",
        base: profile?.[2]?.base ?? Math.max(7, (heights[2] ?? 10) - 0.3),
        top: profile?.[2]?.top ?? (heights[2] ?? 10) + 0.8,
        genus: profile?.[2]?.genus ?? ("cirrus" as const),
      },
    ];

  const coverAt = (li: number, d: number) => {
    if (!pathCover.length) return cover[li] ?? 0;
    if (d <= distances[0]) return pathCover[0]?.[li] ?? 0;
    if (d >= distances[distances.length - 1])
      return pathCover[pathCover.length - 1]?.[li] ?? 0;
    let lo = 0;
    while (lo < distances.length - 2 && distances[lo + 1] < d) lo++;
    const t = (d - distances[lo]) / (distances[lo + 1] - distances[lo]),
      a = pathCover[lo]?.[li] ?? 0,
      b = pathCover[lo + 1]?.[li] ?? 0;
    return a + (b - a) * t;
  };

  const boundaries: { d: number; layer: string }[] = [];
  layerMeta.forEach((layer, li) => {
    let prev = pathCover[0]?.[li] ?? 0;
    for (let i = 1; i < distances.length; i++) {
      const cur = pathCover[i]?.[li] ?? 0,
        prevOn = prev >= CLOUD_THRESHOLD,
        curOn = cur >= CLOUD_THRESHOLD;
      if (prevOn !== curOn && cur !== prev) {
        const t = (CLOUD_THRESHOLD - prev) / (cur - prev);
        boundaries.push({
          d: distances[i - 1] + (distances[i] - distances[i - 1]) * t,
          layer: layer.key,
        });
      }
      prev = cur;
    }
  });

  // 取景器尺寸：16:9 宽屏构图
  const W = 720,
    H = 400,
    // 地平线默认在画面约 16% 高度处（天空占 84%），随仰角调节上下偏移
    horizonY = H * 0.16 + pitchDeg * 2.6,
    // 视高度角范围：-2°（地平线以下）~ 50°（天空顶部）
    maxElev = 50,
    minElev = -2,
    // 以地平线为锚点的焦段缩放：长焦放大（天空顶部/地面底部超出画面被裁剪）
    Y = (elev: number) =>
      horizonY -
      ((Math.max(minElev, Math.min(maxElev, elev)) - minElev) /
        (maxElev - minElev)) *
        horizonY *
        frameScale,
    X = (d: number) =>
      Math.max(0, Math.min(W, (d / horizonKm) * W)),
    sunX = X(horizonKm),
    sunElev = Math.max(minElev, Math.min(maxElev, alt)),
    sunY = Y(sunElev);

  // 抛物线轨迹：从左到右的真实太阳运动轨迹
  const arcStartX = 10,
    arcStartY = Y(42),
    arcEndX = sunX,
    arcEndY = sunY,
    arcMidX = (arcStartX + arcEndX) / 2,
    arcMidY = (arcStartY + arcEndY) / 2,
    arcCtrlX = arcMidX + 6,
    arcCtrlY = arcMidY - 28,
    arcPath = `M${arcStartX.toFixed(1)},${arcStartY.toFixed(1)} Q${arcCtrlX.toFixed(1)},${arcCtrlY.toFixed(1)} ${arcEndX.toFixed(1)},${arcEndY.toFixed(1)}`,
    bezier = (t: number) => {
      const t1 = 1 - t;
      return {
        x: t1 * t1 * arcStartX + 2 * t1 * t * arcCtrlX + t * t * arcEndX,
        y: t1 * t1 * arcStartY + 2 * t1 * t * arcCtrlY + t * t * arcEndY,
      };
    };

  const avgCovers = [0, 1, 2].map((li) => {
    let sum = 0;
    for (let i = 0; i < distances.length; i++) sum += pathCover[i]?.[li] ?? 0;
    return sum / distances.length;
  });

  // 太阳高度因子：越低越暖
  const altFactor = Math.max(0, Math.min(1, 1 - Math.abs(alt) / 30));

  // 真实的暮光天空渐变（6 层，模拟大气散射）
  const skyStops = [
    { offset: 0, color: "#0a0e28" },
    {
      offset: 0.22,
      color: `rgb(${Math.round(30 + 20 * altFactor)},${Math.round(28 + 15 * altFactor)},${Math.round(75 + 25 * altFactor)})`,
    },
    {
      offset: 0.44,
      color: `rgb(${Math.round(70 + 30 * altFactor)},${Math.round(50 + 25 * altFactor)},${Math.round(90 + 15 * altFactor)})`,
    },
    {
      offset: 0.66,
      color: `rgb(${Math.round(140 + 40 * altFactor)},${Math.round(80 + 35 * altFactor)},${Math.round(90 + 10 * altFactor)})`,
    },
    {
      offset: 0.84,
      color: `rgb(${Math.round(220 + 30 * altFactor)},${Math.round(130 + 50 * altFactor)},${Math.round(90 + 20 * altFactor)})`,
    },
    {
      offset: 0.95,
      color: `rgb(${Math.round(250 + 5 * altFactor)},${Math.round(165 + 55 * altFactor)},${Math.round(100 + 35 * altFactor)})`,
    },
    { offset: 1, color: `rgb(255,${Math.round(185 + 55 * altFactor)},${Math.round(115 + 40 * altFactor)})` },
  ];

  // 太阳方向暖色叠加（右侧更暖）
  const sunSideColor = `rgba(255,${Math.round(160 + 60 * altFactor)},${Math.round(100 + 40 * altFactor)},0.18)`;

  // ===== 云层消光物理模型 =====
  const sunIllum = (d: number) => {
    const frac = Math.max(0, Math.min(1, d / horizonKm));
    return 0.25 + 0.75 * Math.pow(frac, 1.2);
  };
  const extinction = (d: number) => {
    const frac = Math.max(0, Math.min(1, d / horizonKm));
    return Math.exp(-0.5 * frac);
  };
  const cloudColorAt = (li: number, d: number) => {
    const cv = coverAt(li, d) / 100,
      illum = sunIllum(d),
      ext = extinction(d),
      thick = 1 - 0.35 * cv,
      warmBoost = 0.75 + 0.25 * altFactor,
      isHigh = li === 2,
      isMid = li === 1,
      baseR = isHigh ? 255 : isMid ? 250 : 235,
      baseG = isHigh ? 248 : isMid ? 236 : 212,
      baseB = isHigh ? 242 : isMid ? 220 : 190;
    let r = baseR * (0.42 + 0.58 * illum) * (0.55 + 0.45 * ext) * thick,
      g = baseG * (0.4 + 0.6 * illum) * (0.52 + 0.48 * ext) * thick,
      b = baseB * (0.34 + 0.66 * illum) * (0.45 + 0.55 * ext) * thick;
    r = r * (0.85 + 0.15 * ext) * warmBoost;
    b = b * (0.5 + 0.5 * ext);
    return `rgba(${Math.round(Math.min(255, r))},${Math.round(Math.min(255, g))},${Math.round(Math.min(255, b))},${(0.38 + cv * 0.52).toFixed(2)})`;
  };
  const cloudGradStops = layerMeta.map((_, li) => ({
    id: `spCldPhys${li}`,
    stops: [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1].map((f) => ({
      offset: f,
      color: cloudColorAt(li, horizonKm * f),
    })),
  }));

  // 云层：按真实视位置渲染，只在云量 ≥ 阈值的区间出现
  const cloudBands = layerMeta.map((layer, li) => {
    if (avgCovers[li] < 2) return null;
    const S = 100,
      gradId = `url(#spCldPhys${li})`,
      segs: { s0: number; s1: number; top: string[] }[] = [];
    let cur: { s0: number; s1: number; top: string[] } | null = null;
    for (let s = 0; s <= S; s++) {
      const d = (horizonKm * s) / S,
        cv = coverAt(li, d);
      if (cv >= CLOUD_THRESHOLD) {
        const dd = Math.max(0.3, d),
          baseElev = Math.atan(layer.base / dd) * DEG,
          topElev = Math.atan(layer.top / dd) * DEG,
          thick =
            0.55 + (cv / 100) * 0.9 + (noise(d * 0.27, li * 7.3) - 0.5) * 0.5,
          topElevAt = baseElev + (topElev - baseElev) * thick;
        if (!cur) cur = { s0: s, s1: s, top: [] };
        cur.s1 = s;
        cur.top.push(
          `${cur.top.length ? "L" : "M"}${X(d).toFixed(1)},${Y(topElevAt).toFixed(1)}`,
        );
      } else if (cur) {
        segs.push(cur);
        cur = null;
      }
    }
    if (cur) segs.push(cur);
    if (!segs.length) return null;

    const bandPaths = segs.map((seg) => {
      const bot: string[] = [];
      for (let s = seg.s1; s >= seg.s0; s--) {
        const d = (horizonKm * s) / S,
          dd = Math.max(0.3, d),
          baseElev = Math.atan(layer.base / dd) * DEG;
        bot.push(`L${X(d).toFixed(1)},${Y(baseElev).toFixed(1)}`);
      }
      return `${seg.top.join(" ")} ${bot.join(" ")} Z`;
    });

    let sumCv = 0;
    for (let s = 0; s <= 40; s++) sumCv += coverAt(li, (horizonKm * s) / 40);
    const avgCv = sumCv / 41,
      op = 0.4 + (avgCv / 100) * 0.45;

    const puffData: {
      x: number;
      y: number;
      rx: number;
      ry: number;
      o: number;
      fill: string;
    }[] = [];
    for (let k = 0; k < 22; k++) {
      const d = Math.min(
          horizonKm,
          Math.max(
            0.3,
            (horizonKm * (k + 0.5)) / 22 +
              (noise(k * 1.7, li * 9.1) - 0.5) * (horizonKm / 7),
          ),
        ),
        dd = Math.max(0.3, d),
        cv = coverAt(li, d);
      if (cv < 8) continue;
      const baseElev = Math.atan(layer.base / dd) * DEG,
        topElev = Math.atan(layer.top / dd) * DEG,
        t = noise(k * 3.7, li * 11.3),
        elev = baseElev + (topElev - baseElev) * (0.15 + t * 0.7),
        px = X(d) + (noise(k, li + 9) - 0.5) * 30,
        py = Y(elev),
        size =
          Math.max(2, 28 * (1 - d / horizonKm) * (0.5 + cv / 120)) *
          frameScale;
      puffData.push({
        x: px,
        y: py,
        rx: size,
        ry: size * 0.45,
        o: 0.3 + cv / 250,
        fill: cloudColorAt(li, d),
      });
    }

    return (
      <g key={layer.key}>
        {bandPaths.map((p, i) => (
          <path key={i} d={p} fill={gradId} opacity={op} />
        ))}
        {puffData.map((pd, i) => (
          <ellipse
            key={`p${i}`}
            cx={pd.x}
            cy={pd.y}
            rx={pd.rx}
            ry={pd.ry}
            fill={pd.fill}
            opacity={pd.o}
          />
        ))}
      </g>
    );
  });

  // 真实地形天际线：沿视线方向逐距离取 DEM 阻挡山脊线，
  // 高差映射到画面（0~3200m 相对高差 → 地平线下方），随焦段同步缩放。
  const groundPts: { d: number; elev: number }[] = [];
  for (let s = 0; s <= 80; s++) {
    const d = (horizonKm * s) / 80;
    groundPts.push({ d, elev: terrainElevAt(d) });
  }
  const groundH = H - horizonY,
    groundTop = groundPts
      .map((p, i) => {
        const t = Math.max(
            0,
            Math.min(1, (p.elev - stationElev + 150) / 3200),
          ),
          y = horizonY + (groundH / frameScale) * (1 - t) * 0.93 + 2;
        return `${i ? "L" : "M"}${X(p.d).toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const groundFill = `${groundTop} L${X(horizonKm).toFixed(1)},${H.toFixed(0)} L${0},${H.toFixed(0)} Z`;

  // 距离刻度（底部取景器栏）
  const dTicks: number[] = [];
  for (let d = 0; d <= horizonKm; d += horizonKm > 120 ? 50 : 20) dTicks.push(d);
  if (dTicks[dTicks.length - 1] !== Math.floor(horizonKm))
    dTicks.push(Math.floor(horizonKm));

  // 云边界标注（取景器底部栏）
  const boundaryLabels = boundaries
    .map((b) => {
      const layer = layerMeta.find((l) => l.key === b.layer);
      if (!layer) return null;
      const bx = X(b.d);
      if (bx < 0 || bx > W) return null;
      return { x: bx, d: b.d, label: layer.label };
    })
    .filter(Boolean);

  // 云量摘要
  const coverSummary = layerMeta
    .map((l, i) => `${l.label}${Math.round(avgCovers[i])}%`)
    .join(" · ");

  return (
    <svg
      className="sun-path-profile"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="日出日落取景器"
      style={{ borderRadius: "10px", overflow: "hidden" }}
    >
      <defs>
        {/* 天空渐变 */}
        <linearGradient id="spSky" x1="0" y1="0" x2="0" y2="1">
          {skyStops.map((s, i) => (
            <stop key={i} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
        {/* 太阳方向暖色叠加 */}
        <linearGradient id="spSunSide" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(255,160,90,0)" />
          <stop offset="0.5" stopColor="rgba(255,160,90,0)" />
          <stop offset="1" stopColor={sunSideColor} />
        </linearGradient>
        {/* 地平线辉光 */}
        <linearGradient id="spHorizonGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,170,90,0)" />
          <stop offset="0.4" stopColor="rgba(255,190,110,0.35)" />
          <stop offset="1" stopColor="rgba(255,150,80,0)" />
        </linearGradient>
        {/* 太阳光晕 */}
        <radialGradient id="spGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,225,170,0.95)" />
          <stop offset="0.25" stopColor="rgba(255,195,125,0.45)" />
          <stop offset="0.5" stopColor="rgba(255,155,85,0.16)" />
          <stop offset="1" stopColor="rgba(255,120,60,0)" />
        </radialGradient>
        {/* 轨迹渐变 */}
        <linearGradient id="spArcGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(255,220,160,0)" />
          <stop offset="0.25" stopColor="rgba(255,210,150,0.4)" />
          <stop offset="0.6" stopColor="rgba(255,190,120,0.65)" />
          <stop offset="0.9" stopColor="rgba(255,170,90,0.3)" />
          <stop offset="1" stopColor="rgba(255,150,70,0)" />
        </linearGradient>
        {/* 云层物理渐变 */}
        {cloudGradStops.map((g) => (
          <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="1" y2="0">
            {g.stops.map((s, i) => (
              <stop key={i} offset={s.offset} stopColor={s.color} />
            ))}
          </linearGradient>
        ))}
        {/* 地面渐变 */}
        <linearGradient id="spGround" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e1814" />
          <stop offset="1" stopColor="#080605" />
        </linearGradient>
      </defs>

      {/* ====== 天空背景 ====== */}
      <rect x="0" y="0" width={W} height={H} fill="url(#spSky)" />
      {/* 太阳方向暖色叠加 */}
      <rect x="0" y="0" width={W} height={horizonY} fill="url(#spSunSide)" />
      {/* 地平线辉光 */}
      <rect x="0" y={horizonY - 12} width={W} height={24} fill="url(#spHorizonGlow)" />

      {/* ====== 云层（真实视位置） ====== */}
      {cloudBands}

      {/* ====== 太阳（光晕与实心盘随焦段缩放） ====== */}
      <circle cx={sunX} cy={sunY} r={30 * frameScale} fill="url(#spGlow)" />
      <circle cx={sunX} cy={sunY} r={7.5 * frameScale} fill="#ffd27a" />
      <circle cx={sunX} cy={sunY} r={5 * frameScale} fill="#ffe9b0" />

      {/* ====== 太阳抛物线轨迹 ====== */}
      <path
        d={arcPath}
        stroke="rgba(255,200,120,0.08)"
        strokeWidth="10"
        fill="none"
      />
      <path
        d={arcPath}
        stroke="url(#spArcGrad)"
        strokeWidth="1.8"
        strokeDasharray="5 6"
        fill="none"
        opacity={0.7}
      />
      {[0.12, 0.28, 0.44, 0.6, 0.76, 0.92].map((t, i) => {
        const pt = bezier(t);
        if (pt.y > horizonY + 6) return null;
        const dist = Math.abs(t - 0.6) * 2,
          op = 0.1 + (1 - dist) * 0.2;
        return (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={2.8}
            fill="rgba(255,215,165,0.45)"
            opacity={op}
          />
        );
      })}

      {/* ====== 地面天际线 ====== */}
      <path d={groundFill} fill="url(#spGround)" />
      <path
        d={groundTop}
        fill="none"
        stroke="rgba(255,180,120,0.2)"
        strokeWidth="0.8"
      />

      {/* ====== 取景器底部信息栏（半透明黑底） ====== */}
      <rect x="0" y={H - 32} width={W} height={32} fill="rgba(0,0,0,0.55)" />

      {/* 距离刻度 */}
      {dTicks.map((d) => (
        <g key={`dt${d}`}>
          <line
            x1={X(d)}
            y1={H - 32}
            x2={X(d)}
            y2={H - 24}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="0.6"
          />
          <text
            x={X(d)}
            y={H - 10}
            fill="rgba(255,255,255,0.5)"
            fontSize="7.5"
            textAnchor="middle"
          >
            {d}km
          </text>
        </g>
      ))}

      {/* 云边界标注浮标 */}
      {boundaryLabels.map((b, i) => {
        if (!b) return null;
        return (
          <g key={`bl${i}`}>
            <line
              x1={b.x}
              y1={H - 32}
              x2={b.x}
              y2={H - 26}
              stroke="rgba(255,225,180,0.5)"
              strokeWidth="1"
            />
            <text
              x={b.x}
              y={H - 14}
              fill="rgba(255,225,180,0.7)"
              fontSize="7"
              textAnchor="middle"
            >
              {b.label}△{Math.round(b.d)}km
            </text>
          </g>
        );
      })}

      {/* ====== 取景器顶部信息栏 ====== */}
      <rect
        x="0"
        y="0"
        width={W}
        height="22"
        fill="rgba(0,0,0,0.4)"
        rx="0"
      />
      <text
        x="8"
        y="15"
        fill="rgba(255,255,255,0.85)"
        fontSize="9"
        letterSpacing="0.5"
      >
        {mode === "sunset" ? "🌅 日落" : "🌄 日出"} 方位 {Math.round(bearing)}°
      </text>
      <text
        x={W / 2}
        y="15"
        fill="rgba(255,255,255,0.7)"
        fontSize="8.5"
        textAnchor="middle"
      >
        太阳高度 {alt.toFixed(1)}° · {Math.round(focalVal)}mm 焦段 · 仰角{" "}
        {pitchDeg > 0 ? "+" : ""}
        {pitchDeg.toFixed(0)}°
      </text>
      <text
        x={W - 8}
        y="15"
        fill="rgba(255,255,255,0.6)"
        fontSize="8"
        textAnchor="end"
      >
        {coverSummary}
      </text>
    </svg>
  );
}