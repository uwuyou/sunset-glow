"use client";
// 巧摄式「地形剖面」：沿视线方位的地形天际线 + 太阳轨迹弧线叠加
// 联动焦段（FOV 窗口随焦距变化）、天空云层（低/中/高云带）、日出日落模式。
import { useMemo } from "react";
import { getPosition } from "suncalc";
import type { CloudLayerProfile } from "./cloud-profile";

const PI = Math.PI;
const rad = (v: number) => (v * PI) / 180;
const deg = (v: number) => (v * 180) / PI;
const normDeg = (v: number) => ((v % 360) + 360) % 360;
// 确定性伪随机噪声（同参同值，保证跨渲染稳定）
const noise = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

type Solar = { altitude: number; azimuth: number };

export default function TerrainProfile({
  dem,
  demDepths,
  demLaterals,
  stationElev,
  solar,
  event,
  lat,
  lon,
  bearing,
  look,
  focal,
  cover,
  visible,
  mode,
  heights,
  illum,
  profile,
}: {
  dem: number[][];
  demDepths?: number[];
  demLaterals?: number[];
  stationElev: number;
  solar: Solar;
  event: Date | null;
  lat: number;
  lon: number;
  bearing: number;
  look: number;
  focal: number;
  cover: number[];
  visible: boolean[];
  mode: "sunset" | "dawn";
  heights?: number[];
  illum?: boolean[];
  profile?: CloudLayerProfile[];
}) {
  const rows = dem.length
    ? dem
    : [
        [500, 510, 495, 505, 500],
        [510, 520, 500, 515, 508],
        [520, 530, 510, 525, 515],
      ];
  const depths =
      demDepths && demDepths.length > 1 ? demDepths : [2, 8, 18, 32, 48, 65, 82],
    lats =
      demLaterals && demLaterals.length > 1
        ? demLaterals
        : [-18, -9, 0, 9, 18],
    // 焦段联动：水平视场半宽，剖面窗口随焦距伸缩（带安全边距）
    fov = 2 * deg(Math.atan(36 / (2 * Math.max(8, focal)))),
    fovHalf = fov / 2,
    azHalf = Math.min(45, Math.max(22, fovHalf + 8)),
    cloudLow = Math.max(0, Math.min(100, cover[0] || 0)),
    cloudMid = Math.max(0, Math.min(100, cover[1] || 0)),
    cloudHigh = Math.max(0, Math.min(100, cover[2] || 0));

  // 地形天际线：每个方位角取各深度距离上的最大仰角（阻挡山脊线），显示放大、判阻挡用真值
  const skyline = useMemo(() => {
    const STEPS = 120,
      EXAG = 1.8;
    const pts: { az: number; elev: number; elevTrue: number }[] = [];
    for (let s = 0; s <= STEPS; s++) {
      const az = -azHalf + (2 * azHalf * s) / STEPS,
        tanA = Math.tan(rad(az));
      let maxT = -60,
        maxTrue = -60;
      for (let i = 0; i < rows.length; i++) {
        const d = depths[i],
          lateral = d * tanA,
          row = rows[i];
        let elev: number;
        if (lateral <= lats[0]) elev = row[0];
        else if (lateral >= lats[lats.length - 1]) elev = row[row.length - 1];
        else {
          let lo = 0;
          while (lo < lats.length - 2 && lats[lo + 1] < lateral) lo++;
          const t = (lateral - lats[lo]) / (lats[lo + 1] - lats[lo]);
          elev = row[lo] + (row[lo + 1] - row[lo]) * t;
        }
        const thetaTrue = deg(Math.atan2(elev - stationElev, d * 1000)),
          theta = thetaTrue * EXAG;
        if (theta > maxT) maxT = theta;
        if (thetaTrue > maxTrue) maxTrue = thetaTrue;
      }
      pts.push({ az, elev: maxT, elevTrue: maxTrue });
    }
    return pts;
  }, [rows, depths, lats, stationElev, azHalf]);

  const skylineAt = (az: number) => {
      if (az <= skyline[0].az) return skyline[0].elevTrue;
      if (az >= skyline[skyline.length - 1].az)
        return skyline[skyline.length - 1].elevTrue;
      let lo = 0,
        hi = skyline.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (skyline[mid].az < az) lo = mid;
        else hi = mid;
      }
      return (
        skyline[lo].elevTrue +
        ((skyline[hi].elevTrue - skyline[lo].elevTrue) *
          (az - skyline[lo].az)) /
          (skyline[hi].az - skyline[lo].az)
      );
    },
    sunAz = normDeg(solar.azimuth - bearing + 180) - 180,
    currentSun = { az: sunAz, alt: solar.altitude },
    blocked = currentSun.alt < skylineAt(currentSun.az) - 0.15,
    eventPoint = useMemo(() => {
      if (!event) return null;
      const p = getPosition(event, lat, lon),
        rel = normDeg(p.azimuth - bearing + 180) - 180;
      return { az: rel, time: event };
    }, [event, lat, lon, bearing]),
    // 太阳轨迹：以日出/日落为锚点，前后 150 分钟逐点采样
    sunPath = useMemo(() => {
      if (!event) return [];
      const pts: { az: number; alt: number }[] = [];
      for (let m = -150; m <= 150; m += 4) {
        const t = new Date(event.getTime() + m * 60000),
          p = getPosition(t, lat, lon),
          rel = normDeg(p.azimuth - bearing + 180) - 180;
        if (Math.abs(rel) <= azHalf + 2)
          pts.push({ az: rel, alt: p.altitude });
      }
      return pts;
    }, [event, lat, lon, bearing, azHalf]),
    skyMax = skyline.reduce((m, p) => Math.max(m, p.elev), 0),
    sunMax = sunPath.reduce((m, p) => Math.max(m, p.alt), -90),
    peak = skyline.reduce(
      (best, p) => (p.elevTrue > best.elevTrue ? p : best),
      { az: 0, elev: -90, elevTrue: -90 },
    ),
    maxAlt = Math.min(60, Math.max(10, Math.ceil(Math.max(skyMax, sunMax) + 4))),
    minAlt = -2;

  const W = 660,
    H = 420,
    padL = 48,
    padR = 16,
    padT = 20,
    padB = 32,
    plotW = W - padL - padR,
    plotH = H - padT - padB,
    X = (az: number) =>
      padL + Math.max(0, Math.min(plotW, ((az + azHalf) / (2 * azHalf)) * plotW)),
    Y = (alt: number) => padT + plotH - ((alt - minAlt) / (maxAlt - minAlt)) * plotH;

  const azTicks: number[] = [];
  for (let a = -azHalf; a <= azHalf; a += 10) azTicks.push(a);
  const altTicks: number[] = [];
  for (let a = Math.ceil(minAlt / 5) * 5; a <= maxAlt; a += 5) altTicks.push(a);

  const skyPath = skyline
      .map((p, i) => `${i ? "L" : "M"}${X(p.az).toFixed(1)},${Y(p.elev).toFixed(1)}`)
      .join(" "),
    skyFill = `${skyPath} L${X(azHalf).toFixed(1)},${Y(minAlt).toFixed(1)} L${X(-azHalf).toFixed(1)},${Y(minAlt).toFixed(1)} Z`,
    sunD = sunPath
      .map((p, i) => `${i ? "L" : "M"}${X(p.az).toFixed(1)},${Y(p.alt).toFixed(1)}`)
      .join(" "),
    sunX = X(currentSun.az),
    // 云高联动：与取景界面同一套 13km 线性映射，真实云高(km) → 剖面仰角带
    cloudElev = (km: number) => {
      const f = Math.min(13, Math.max(0.2, km || 3)) / 13;
      return Math.max(0.6, Math.min(maxAlt - 1.2, f * maxAlt * 0.92));
    },
    // 单簇云：主体多子斑堆叠 + 底部暗影（体积感）+ 朝向太阳一侧暖色银边
    cloudCluster = (
      key: number,
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      warm: number,
      filt: string,
      fill: string,
    ) => {
      const dir = sunX >= cx ? 1 : -1;
      const lumps = 3 + Math.floor(noise(cx * 0.1, cy * 0.1) * 3);
      const kids: React.ReactNode[] = [];
      for (let k = 0; k < lumps; k++) {
        const ox = (noise(cx * 0.1 + k * 3.1, cy * 0.1) - 0.5) * rx * 1.15,
          oy = (noise(cx * 0.1, cy * 0.1 + k * 7.7) - 0.5) * ry * 1.35,
          kr = rx * (0.42 + noise(cx * 0.1 + k, cy * 0.1 + k) * 0.52),
          krh = ry * (0.5 + noise(cx * 0.1, cy * 0.1 + k * 3) * 0.72);
        kids.push(
          <ellipse key={k} cx={cx + ox} cy={cy + oy} rx={kr} ry={krh} fill={fill} />,
        );
      }
      return (
        <g key={key} filter={filt}>
          <ellipse
            cx={cx}
            cy={cy + ry * 0.95}
            rx={rx * 0.86}
            ry={ry * 0.7}
            fill="rgba(38,28,42,0.32)"
          />
          {kids}
          {warm > 0.12 && (
            <ellipse
              cx={cx + dir * rx * 0.42}
              cy={cy - ry * 0.3}
              rx={rx * 0.6}
              ry={ry * 0.45}
              fill="rgba(255,216,150,0.55)"
              opacity={Math.min(1, warm * 1.25)}
            />
          )}
        </g>
      );
    },
    // CloudSat 式垂直云柱：借鉴 CPR 毫米波雷达的垂直剖面观测——
    // 云不再是一层皮，而是有云底/云顶/厚度的垂直柱。
    // 每层按 profile 的 base→top 绘制柱体，顶部按水相着色，
    // 降水云在柱底垂下雨幡，柱顶标注 CloudSat 2B-CLDCLASS 云型。
    cloudColumn = (
      layer: "high" | "mid" | "low",
      prof: CloudLayerProfile,
      seed: number,
      lit = true,
    ) => {
      if (prof.cover <= 0) return null;
      const baseY = Y(cloudElev(prof.base)),
        topY = Y(cloudElev(prof.top)),
        colH = Math.max(10, baseY - topY),
        cfg =
          layer === "high"
            ? { filt: "url(#cldHi)", fill: "url(#cldGradHi)", ry: 3.4, ryAmp: 2.6, n: 7 }
            : layer === "mid"
              ? { filt: "url(#cldMi)", fill: "url(#cldGradMi)", ry: 5.2, ryAmp: 3.4, n: 8 }
              : { filt: "url(#cldLo)", fill: "url(#cldGradLo)", ry: 7, ryAmp: 4.6, n: 8 },
        wisp =
          prof.genus === "cirrus" ||
          prof.genus === "cirrostratus" ||
          prof.genus === "cirrocumulus",
        count = Math.max(
          2,
          Math.round((wisp ? cfg.n * 0.72 : cfg.n) * (0.55 + (prof.cover / 100) * 0.55)),
        ),
        op = (0.3 + (prof.cover / 100) * 0.55) * (lit ? 1 : 0.5),
        // 水相着色：冰白 / 混合灰 / 液态暗
        phaseFill =
          prof.phase === "ice"
            ? "rgba(232,240,248,0.5)"
            : prof.phase === "mixed"
              ? "rgba(205,214,222,0.42)"
              : "rgba(158,176,189,0.38)";
      const items: React.ReactNode[] = [];
      // 1) 垂直柱体：云底到云顶的 CloudSat 剖面柱（半透明，带模糊）
      items.push(
        <rect
          key="col"
          x={padL}
          y={topY}
          width={plotW}
          height={colH}
          rx={7}
          fill={phaseFill}
          opacity={lit ? 1 : 0.5}
          filter="url(#cldMi)"
        />,
      );
      // 2) 云泡簇：沿柱体高度分布，顶部更密（云顶凸起）
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count,
          cx =
            padL +
            t * plotW +
            (noise(t * 9.3 + seed, 3.1) - 0.5) * 30,
          cy =
            topY +
            colH * (0.3 + 0.55 * noise(t * 5.7 + seed, 1.3)) +
            Math.sin(t * 6.28 + seed * 1.7) * 3,
          rx = (plotW / count) * (0.66 + noise(t * 7.1 + seed, 5.5) * 0.55),
          ry = (wisp ? cfg.ry * 0.6 : cfg.ry) + noise(t * 11.3 + seed, 1.7) * cfg.ryAmp,
          dist = Math.abs(cx - sunX) / plotW,
          warm = lit ? Math.max(0, 1 - dist * 2.2) : 0,
          jit = 0.8 + noise(t * 5.3 + seed, 7.7) * 0.4;
        items.push(
          <g key={`c${i}`} opacity={jit}>
            {cloudCluster(i, cx, cy, rx, ry, warm, cfg.filt, cfg.fill)}
          </g>,
        );
      }
      // 3) 降水雨幡：降水云在云底下方垂落（雪为虚线、雨为实线）
      if (prof.precip !== "none") {
        const sn = 4 + Math.round(prof.cover / 25);
        for (let s = 0; s < sn; s++) {
          const x0 =
              padL +
              ((s + 0.5) / sn) * plotW +
              (noise(s * 3.7, seed) - 0.5) * 24,
            len = Math.min(46, colH * (0.5 + noise(s * 7.1, seed + 2) * 0.5)),
            sway = (noise(s * 9.3, seed + 5) - 0.5) * 8;
          items.push(
            <path
              key={`p${s}`}
              d={`M${x0},${baseY} q${sway},${len * 0.5} ${sway * 1.6},${len}`}
              stroke={
                prof.precip === "snow"
                  ? "rgba(220,232,240,0.5)"
                  : "rgba(120,140,160,0.45)"
              }
              strokeWidth={1.1}
              strokeDasharray={prof.precip === "snow" ? "2 2" : undefined}
              fill="none"
              opacity={lit ? 0.55 : 0.3}
            />,
          );
        }
      }
      // 4) 高云附加纤薄丝缕：卷云感（wisp 时更密）
      if (layer === "high") {
        const sn = wisp ? 6 : 3;
        for (let s = 0; s < sn; s++) {
          const y0 = topY + colH * (0.2 + noise(s * 4.1, 9.1) * 0.6),
            x0 = padL + noise(s * 8.3, 2.2) * plotW * 0.35,
            len = plotW * (0.3 + noise(s * 3.7, 6.4) * 0.32);
          items.push(
            <path
              key={`w${s}`}
              d={`M${x0},${y0} q${len * 0.3},${2 + noise(s, 7.7) * 3} ${len * 0.6},0 q${len * 0.25},-2 ${len * 0.4},0`}
              stroke={cfg.fill}
              strokeWidth={wisp ? 1.1 : 1.4}
              fill="none"
              opacity={lit ? 0.5 : 0.28}
              filter="url(#cldHi)"
            />,
          );
        }
      }
      // 5) CloudSat 云型标注：柱顶上方（云型 + 云底–云顶高度）
      if (prof.cover >= 18) {
        const labelX =
          padL + plotW * 0.5 + (noise(seed, 4.2) - 0.5) * plotW * 0.4;
        items.push(
          <g key="lab">
            <text
              x={labelX}
              y={Math.max(12, topY - 4)}
              fill={lit ? "#e8f0f4" : "#9fb0b8"}
              fontSize="9"
              textAnchor="middle"
              opacity={0.85}
            >
              {prof.type}
            </text>
            <text
              x={labelX}
              y={Math.max(22, topY - 4 + 9)}
              fill="#7f9390"
              fontSize="7.5"
              textAnchor="middle"
              opacity={0.7}
            >
              {prof.base.toFixed(1)}–{prof.top.toFixed(1)}km
            </text>
          </g>,
        );
      }
      return (
        <g key={layer} opacity={op}>
          {items}
        </g>
      );
    };

  return (
    <svg
      className="terrain-profile"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="地形剖面与太阳轨迹"
    >
      <defs>
        <linearGradient
          id="tprofSky"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          {mode === "dawn" ? (
            <>
              <stop offset="0" stopColor="#10182e" />
              <stop offset="0.55" stopColor="#243a4d" />
              <stop offset="0.85" stopColor="#6d4a5b" />
              <stop offset="1" stopColor="#b06a4b" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#1c1426" />
              <stop offset="0.5" stopColor="#4a2330" />
              <stop offset="0.82" stopColor="#9a4a33" />
              <stop offset="1" stopColor="#e08a45" />
            </>
          )}
        </linearGradient>
        <linearGradient id="tprofGround" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a6a50" />
          <stop offset="0.55" stopColor="#3c4238" />
          <stop offset="1" stopColor="#101b1d" />
        </linearGradient>
        <radialGradient id="tprofGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgba(255,240,180,0.95)" />
          <stop offset="0.4" stopColor="rgba(255,170,80,0.32)" />
          <stop offset="1" stopColor="rgba(255,120,40,0)" />
        </radialGradient>
        {/* 云层分形滤镜：高云水平丝缕 / 中云层状 / 低云厚重块状 */}
        <filter id="cldHi" x="-40%" y="-80%" width="180%" height="260%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.1" numOctaves="3" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="10" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
        <filter id="cldMi" x="-40%" y="-80%" width="180%" height="260%">
          <feTurbulence type="fractalNoise" baseFrequency="0.014 0.05" numOctaves="3" seed="23" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="13" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="1" />
        </filter>
        <filter id="cldLo" x="-40%" y="-80%" width="180%" height="260%">
          <feTurbulence type="fractalNoise" baseFrequency="0.01 0.028" numOctaves="4" seed="37" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="17" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="1.3" />
        </filter>
        {/* 云层渐变：顶部冷灰、底部被日出/日落低角度暖光映亮 */}
        {mode === "sunset" ? (
          <>
            <linearGradient id="cldGradHi" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e2e9ec" stopOpacity="0.95" />
              <stop offset="0.5" stopColor="#d3d5d2" stopOpacity="0.92" />
              <stop offset="1" stopColor="#e3a26a" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="cldGradMi" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#d3dcde" stopOpacity="0.95" />
              <stop offset="0.55" stopColor="#c5bcb4" stopOpacity="0.92" />
              <stop offset="1" stopColor="#e8944e" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="cldGradLo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#bfcbcd" stopOpacity="0.95" />
              <stop offset="0.6" stopColor="#ab9c8a" stopOpacity="0.92" />
              <stop offset="1" stopColor="#e3843f" stopOpacity="0.9" />
            </linearGradient>
          </>
        ) : (
          <>
            <linearGradient id="cldGradHi" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#dfe6ec" stopOpacity="0.95" />
              <stop offset="0.5" stopColor="#d0d4da" stopOpacity="0.92" />
              <stop offset="1" stopColor="#e08aa0" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="cldGradMi" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#cdd6dc" stopOpacity="0.95" />
              <stop offset="0.55" stopColor="#bcbec6" stopOpacity="0.92" />
              <stop offset="1" stopColor="#e2788e" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="cldGradLo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#b9c5cc" stopOpacity="0.95" />
              <stop offset="0.6" stopColor="#a5a3ac" stopOpacity="0.92" />
              <stop offset="1" stopColor="#e0687c" stopOpacity="0.9" />
            </linearGradient>
          </>
        )}
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="url(#tprofSky)" />
      {/* 焦段视场带：当前焦距对应的相机水平视场 */}
      <rect
        x={X(-fovHalf)}
        y={padT}
        width={X(fovHalf) - X(-fovHalf)}
        height={plotH}
        fill="rgba(255,190,120,0.06)"
      />
      {azTicks.map((a) => (
        <g key={`az${a}`}>
          <line
            x1={X(a)}
            y1={padT}
            x2={X(a)}
            y2={padT + plotH}
            stroke="rgba(220,238,232,0.08)"
          />
          <text x={X(a)} y={H - 10} fill="#5f7470" fontSize="10" textAnchor="middle">
            {a > 0 ? `+${a}` : a}
          </text>
        </g>
      ))}
      {altTicks.map((a) => (
        <g key={`al${a}`}>
          <line
            x1={padL}
            y1={Y(a)}
            x2={W - padR}
            y2={Y(a)}
            stroke="rgba(220,238,232,0.08)"
          />
          <text x={padL - 6} y={Y(a) + 3} fill="#5f7470" fontSize="10" textAnchor="end">
            {a}°
          </text>
        </g>
      ))}
      {/* CloudSat 云剖面：低/中/高云垂直柱，云底/云顶/厚度驱动仰角带，
          水相着色、降水雨幡、2B-CLDCLASS 云型标注；受光状态联动取景界面 */}
      {(() => {
        const profOf = (i: number): CloudLayerProfile =>
          profile?.[i] ?? {
            genus: (["stratocumulus", "altocumulus", "cirrus"] as const)[i],
            type: ["层积云 Sc", "高积云 Ac", "卷云 Ci"][i],
            base: Math.max(0.5, (heights?.[i] ?? [1.5, 5.5, 10][i]) - 0.4),
            top: (heights?.[i] ?? [1.5, 5.5, 10][i]) + 0.8,
            thickness: 1.2,
            phase: i === 2 ? "ice" : i === 1 ? "mixed" : "liquid",
            precip: "none",
            cover: [cloudLow, cloudMid, cloudHigh][i],
          };
        return (
          <>
            {visible[2] &&
              cloudHigh > 0 &&
              cloudColumn("high", profOf(2), 11, illum?.[2])}
            {visible[1] &&
              cloudMid > 0 &&
              cloudColumn("mid", profOf(1), 23, illum?.[1])}
            {visible[0] &&
              cloudLow > 0 &&
              cloudColumn("low", profOf(0), 37, illum?.[0])}
          </>
        );
      })()}
      <line
        x1={padL}
        y1={Y(0)}
        x2={W - padR}
        y2={Y(0)}
        stroke="rgba(255,214,160,0.3)"
        strokeDasharray="4 4"
      />
      <path d={skyFill} fill="url(#tprofGround)" />
      <path d={skyPath} fill="none" stroke="#d9a077" strokeWidth="1.6" />
      {peak.elevTrue > 0.4 && (
        <g>
          <circle cx={X(peak.az)} cy={Y(peak.elev)} r="2.6" fill="#ffcf9a" />
          <text
            x={X(peak.az)}
            y={Y(peak.elev) - 8}
            fill="#e6b98c"
            fontSize="9"
            textAnchor="middle"
          >
            {peak.elevTrue.toFixed(1)}° 最高阻挡
          </text>
        </g>
      )}
      {sunD && (
        <path
          d={sunD}
          fill="none"
          stroke="rgba(255,196,120,0.78)"
          strokeWidth="1.3"
          strokeDasharray="5 5"
        />
      )}
      {/* 日出/日落时刻点 */}
      {eventPoint &&
        (Math.abs(eventPoint.az) <= azHalf ? (
          <g>
            <circle cx={X(eventPoint.az)} cy={Y(0)} r="4" fill="#ffd9a0" />
            <text
              x={X(eventPoint.az)}
              y={Y(0) + 17}
              fill="#ffd9a0"
              fontSize="10"
              textAnchor="middle"
            >
              {eventPoint.time.toLocaleTimeString("zh-CN", {
                timeZone: "Asia/Shanghai",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </text>
          </g>
        ) : (
          <g>
            <text
              x={eventPoint.az < 0 ? padL + 2 : W - padR - 2}
              y={Y(0) - 8}
              fill="#ffd9a0"
              fontSize="9"
              textAnchor={eventPoint.az < 0 ? "start" : "end"}
            >
              {eventPoint.az < 0 ? "◀" : "▶"} {mode === "sunset" ? "日落" : "日出"}{" "}
              {Math.abs(eventPoint.az).toFixed(0)}°外
            </text>
          </g>
        ))}
      {/* 当前太阳：被山遮挡时降格显示 */}
      {Math.abs(currentSun.az) <= azHalf ? (
        <g>
          <circle cx={X(currentSun.az)} cy={Y(currentSun.alt)} r="22" fill="url(#tprofGlow)" />
          <circle
            cx={X(currentSun.az)}
            cy={Y(currentSun.alt)}
            r="5"
            fill={blocked ? "#9aa5a1" : "#fff1b3"}
          />
          <text
            x={X(currentSun.az)}
            y={Y(currentSun.alt) - 26}
            fill={blocked ? "#b8c2bd" : "#ffe0b0"}
            fontSize="10"
            textAnchor="middle"
          >
            {solar.altitude.toFixed(1)}° {blocked ? "被山遮挡" : ""}
          </text>
        </g>
      ) : (
        <g>
          <text
            x={currentSun.az < 0 ? padL + 2 : W - padR - 2}
            y={padT + 14}
            fill={blocked ? "#9aa5a1" : "#ffe0b0"}
            fontSize="9"
            textAnchor={currentSun.az < 0 ? "start" : "end"}
          >
            {currentSun.az < 0 ? "◀" : "▶"} 太阳{" "}
            {Math.abs(currentSun.az).toFixed(0)}°外
          </text>
        </g>
      )}
      <line
        x1={X(0)}
        y1={padT}
        x2={X(0)}
        y2={padT + plotH}
        stroke="rgba(255,190,120,0.22)"
        strokeDasharray="2 4"
      />
      <text x={padL} y={padT + 13} fill="#9db0ac" fontSize="10">
        视线 {(bearing - look + 360) % 360}° · {focal}mm 视场 ±
        {fovHalf.toFixed(0)}° · 纵向 ×1.8
      </text>
      <text x={W - padR} y={padT + 13} fill="#7f9390" fontSize="9" textAnchor="end">
        {mode === "sunset" ? "日落" : "日出"} · 云 低{Math.round(cloudLow)}
        % 中{Math.round(cloudMid)}% 高{Math.round(cloudHigh)}%
      </text>
      {/* CloudSat 云剖面图例：水相 + 降水 */}
      <g>
        <text x={padL} y={H - 10} fill="#7f9390" fontSize="8">
          CloudSat 云剖面
        </text>
        <rect x={padL + 76} y={H - 14} width={9} height={9} rx={2} fill="rgba(232,240,248,0.55)" />
        <text x={padL + 89} y={H - 6} fill="#9db0ac" fontSize="8">
          冰相
        </text>
        <rect x={padL + 116} y={H - 14} width={9} height={9} rx={2} fill="rgba(205,214,222,0.5)" />
        <text x={padL + 129} y={H - 6} fill="#9db0ac" fontSize="8">
          混合
        </text>
        <rect x={padL + 156} y={H - 14} width={9} height={9} rx={2} fill="rgba(158,176,189,0.5)" />
        <text x={padL + 169} y={H - 6} fill="#9db0ac" fontSize="8">
          液态
        </text>
        <line x1={padL + 200} y1={H - 9} x2={padL + 216} y2={H - 9} stroke="rgba(120,140,160,0.5)" strokeWidth="1.4" />
        <text x={padL + 220} y={H - 6} fill="#9db0ac" fontSize="8">
          雨
        </text>
        <line x1={padL + 236} y1={H - 9} x2={padL + 252} y2={H - 9} stroke="rgba(220,232,240,0.5)" strokeWidth="1.4" strokeDasharray="2 2" />
        <text x={padL + 256} y={H - 6} fill="#9db0ac" fontSize="8">
          雪
        </text>
      </g>
    </svg>
  );
}
