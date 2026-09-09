"use client";
// 巧摄式「地形剖面」：沿视线方位的地形天际线 + 太阳轨迹弧线叠加
// 联动焦段（FOV 窗口随焦距变化）、天空云层（低/中/高云带）、日出日落模式。
import { useMemo } from "react";
import { getPosition } from "suncalc";
import type { CloudLayerProfile } from "./cloud-profile";
import { renderCloudCanvas, type VolLayer } from "./cloud-volume";

const PI = Math.PI;
const rad = (v: number) => (v * PI) / 180;
const deg = (v: number) => (v * 180) / PI;
const normDeg = (v: number) => ((v % 360) + 360) % 360;

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
  pitch,
  focal,
  cover,
  visible,
  mode,
  heights,
  illum,
  profile,
  overcast,
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
  pitch?: number;
  focal: number;
  cover: number[];
  visible: boolean[];
  mode: "sunset" | "dawn";
  heights?: number[];
  illum?: boolean[];
  profile?: CloudLayerProfile[];
  overcast?: number;
}) {
  // DEM 高程清洗：异常/非有限值回退 500m，避免 NaN 导致地形天际线消失
  const rows = (dem.length ? dem : [
        [500, 510, 495, 505, 500],
        [510, 520, 500, 515, 508],
        [520, 530, 510, 525, 515],
      ]).map((row) =>
        row.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 500)),
      );
  const pitchVal = Math.max(-18, Math.min(18, pitch ?? 0)),
    overcastVal = overcast ?? 0,
    // 焦段联动缩放：85mm 为基准 1.0，长焦 → 云层/太阳同步放大（视场同步收窄）
    focalScale = Math.max(0.55, Math.min(2.6, focal / 85)),
    depths =
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
    // 仰角调节：pitch > 0 上仰 → 视线中心上抬、天空占比增大（内容整体下移）。
    // 每 1° 对应一个明显的像素偏移，切换时视图同步响应。
    pitchShift = (pitchVal * plotH) / (maxAlt - minAlt),
    Y = (alt: number) =>
      padT + plotH - ((alt - minAlt) / (maxAlt - minAlt)) * plotH + pitchShift;

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
    // 体积云 Canvas 渲染：基于 Horizon: Zero Dawn 的 Perlin-Worley 噪声密度场，
    // 取代原有的 CloudSat 离散柱体 + 椭圆簇方案
    cloudCanvasUrl = useMemo(() => {
      const W = 300,
        H = 200;
      const volLayers: VolLayer[] = [
        {
          base: Math.max(0.5, (heights?.[0] ?? 1.5) - 0.4),
          top: (heights?.[0] ?? 1.5) + 0.8,
          coverage: cloudLow,
          genus: profile?.[0]?.genus ?? "stratocumulus",
          phase: profile?.[0]?.phase ?? "liquid",
          illum: illum?.[0] ?? true,
          precip: profile?.[0]?.precip ?? "none",
          seed: 37,
        },
        {
          base: Math.max(3, (heights?.[1] ?? 5.5) - 0.5),
          top: (heights?.[1] ?? 5.5) + 1.3,
          coverage: cloudMid,
          genus: profile?.[1]?.genus ?? "altocumulus",
          phase: profile?.[1]?.phase ?? "mixed",
          illum: illum?.[1] ?? true,
          precip: profile?.[1]?.precip ?? "none",
          seed: 23,
        },
        {
          base: Math.max(7, (heights?.[2] ?? 10) - 0.3),
          top: (heights?.[2] ?? 10) + 0.8,
          coverage: cloudHigh,
          genus: profile?.[2]?.genus ?? "cirrus",
          phase: profile?.[2]?.phase ?? "ice",
          illum: illum?.[2] ?? true,
          precip: profile?.[2]?.precip ?? "none",
          seed: 11,
        },
      ].filter((l, i) => visible[i] !== false && l.coverage > 0);

      if (!volLayers.length) return null;
      return renderCloudCanvas(
        W,
        H,
        azHalf,
        minAlt,
        maxAlt,
        volLayers,
        mode,
        overcastVal,
        sunAz,
      );
    }, [heights, cloudLow, cloudMid, cloudHigh, profile, illum, visible, azHalf, minAlt, maxAlt, overcastVal, sunAz, mode]),
    // 获取云层信息的辅助函数（用于保留的降水/标注）
    profOf = (i: number): CloudLayerProfile =>
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
              <stop offset="0.55" stopColor="#1f3345" />
              <stop offset="0.85" stopColor="#57394b" />
              <stop offset="1" stopColor="#8d5739" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#1c1426" />
              <stop offset="0.5" stopColor="#3f1f2c" />
              <stop offset="0.82" stopColor="#7c3a2c" />
              <stop offset="1" stopColor="#b96f3c" />
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
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="url(#tprofSky)" />
      {/* 体积云 Canvas 图层：基于 Perlin-Worley 噪声密度场的连续体积渲染 */}
      {cloudCanvasUrl && (
        <image
          href={cloudCanvasUrl}
          x={padL}
          y={padT}
          width={plotW}
          height={plotH}
          preserveAspectRatio="none"
          opacity={0.85}
        />
      )}
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
      {/* 体积云已在 Canvas 图层中渲染，云型标注可在后续版本叠加 */}
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
          <circle cx={X(currentSun.az)} cy={Y(currentSun.alt)} r={22 * focalScale} fill="url(#tprofGlow)" />
          <circle
            cx={X(currentSun.az)}
            cy={Y(currentSun.alt)}
            r={5 * focalScale}
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
        {pitchVal !== 0 ? ` · 仰角 ${pitchVal > 0 ? "+" : ""}${pitchVal.toFixed(0)}°` : ""}
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
