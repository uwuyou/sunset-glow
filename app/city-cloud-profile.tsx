"use client";
// 城市推荐·迷你云剖面：CloudSat 式垂直云柱（云底/云顶/厚度）
// 水相着色、降水雨幡、2B-CLDCLASS 云型标注，受光层高亮、阴天压暗。
import type { CloudLayerProfile } from "./cloud-profile";
import { GENUS_TONE } from "./cloud-color";

const MAX_KM = 12;
const LAYER_ORDER = ["low", "mid", "high"] as const;

export default function CityCloudProfile({
  profile,
  cover,
  mode,
  illum,
  overcast,
}: {
  profile: CloudLayerProfile[];
  cover: number[];
  mode: "sunset" | "dawn";
  illum?: boolean[];
  overcast?: number;
}) {
  const W = 900,
    H = 115,
    padL = 50,
    padR = 16,
    padT = 14,
    padB = 20,
    plotW = W - padL - padR,
    plotH = H - padT - padB;
  const Y = (km: number) =>
    padT + plotH - (Math.min(MAX_KM, Math.max(0, km)) / MAX_KM) * plotH;
  const ov = overcast ?? 0;
  const kmTicks = [0, 3, 6, 9, 12];
  const layerMeta: Record<
    (typeof LAYER_ORDER)[number],
    { label: string; ry: number }
  > = {
    low: { label: "低云", ry: 4 },
    mid: { label: "中云", ry: 4 },
    high: { label: "高云", ry: 3 },
  };

  // 每层云带：云底→云顶的垂直柱 + 云型/云量标注 + 降水雨幡
  const bands = LAYER_ORDER.map((layer, li) => {
    const prof = profile?.[li];
    const cv = Math.max(0, Math.min(100, cover[li] ?? 0));
    if (!prof || cv <= 0) return null;
    const lit = illum?.[li] ?? true;
    const baseY = Y(prof.base),
      topY = Y(prof.top),
      colH = Math.max(4, baseY - topY),
      tone = GENUS_TONE[prof.genus] || [240, 132, 80],
      // 水相着色：冰白 / 混合灰 / 液态暗
      phaseFill =
        prof.phase === "ice"
          ? `rgba(${tone[0]},${tone[1]},${tone[2]},${lit ? 0.72 : 0.4})`
          : prof.phase === "mixed"
            ? `rgba(${tone[0]},${tone[1]},${tone[2]},${lit ? 0.62 : 0.34})`
            : `rgba(${tone[0]},${tone[1]},${tone[2]},${lit ? 0.55 : 0.3})`,
      meta = layerMeta[layer],
      labelX = padL + plotW / 2;
    return (
      <g key={layer}>
        {/* 云柱：半透明色带，受光层更亮，阴天整体压暗 */}
        <rect
          x={padL}
          y={topY}
          width={plotW}
          height={colH}
          rx={meta.ry}
          fill={phaseFill}
          opacity={lit ? 1 - ov * 0.35 : 0.55 - ov * 0.2}
        />
        {/* 云泡纹理：沿柱体分布的小椭圆，模拟云体起伏 */}
        {Array.from({ length: 6 }).map((_, k) => {
          const t = (k + 0.5) / 6,
            cx = padL + t * plotW + ((k * 37 + li * 53) % 17) - 8,
            cy = topY + colH * (0.25 + 0.5 * ((k * 29 + li * 41) % 10) / 10);
          return (
            <ellipse
              key={k}
              cx={cx}
              cy={cy}
              rx={plotW / 6 / 2 + 4}
              ry={Math.max(2, colH * 0.22)}
              fill={phaseFill}
              opacity={0.5}
            />
          );
        })}
        {/* 降水雨幡：雨实线 / 雪虚线 */}
        {prof.precip !== "none" && (
          <g>
            {[0.25, 0.5, 0.75].map((fx, k) => (
              <line
                key={k}
                x1={padL + plotW * fx}
                y1={baseY}
                x2={padL + plotW * fx + 3}
                y2={Math.min(H - padB, baseY + 14)}
                stroke={
                  prof.precip === "snow"
                    ? "rgba(220,232,240,0.6)"
                    : "rgba(120,140,160,0.55)"
                }
                strokeWidth={1.2}
                strokeDasharray={prof.precip === "snow" ? "2 2" : undefined}
              />
            ))}
          </g>
        )}
        {/* 云型 + 云量标注 */}
        {cv >= 8 && (
          <text
            x={labelX}
            y={Math.max(11, topY - 3)}
            fill={lit ? "#e8f0f4" : "#8fa0a8"}
            fontSize="11"
            textAnchor="middle"
            opacity={0.9}
          >
            {prof.type} {Math.round(cv)}%
          </text>
        )}
      </g>
    );
  });

  return (
    <svg
      className="city-cloud-profile"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="城市云剖面"
    >
      <defs>
        <linearGradient id="ccpSky" x1="0" y1="0" x2="0" y2="1">
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
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="url(#ccpSky)" />
      {/* 高度网格 + 左侧刻度 */}
      {kmTicks.map((km) => (
        <g key={km}>
          <line
            x1={padL}
            y1={Y(km)}
            x2={W - padR}
            y2={Y(km)}
            stroke="rgba(220,238,232,0.09)"
          />
          <text
            x={padL - 5}
            y={Y(km) + 3}
            fill="#5f7470"
            textAnchor="end"
          >
            {km}
          </text>
        </g>
      ))}
      {/* 云带 */}
      {bands}
      {/* 底部图例 */}
      <text x={padL} y={H - 4} fill="#7f9390" fontSize="10">
        云剖面 · 低/中/高云高 km
      </text>
      <text x={W - padR} y={H - 4} fill="#7f9390" fontSize="10" textAnchor="end">
        {mode === "sunset" ? "日落" : "朝霞"} · 阴天因子 {Math.round(ov * 100)}%
      </text>
    </svg>
  );
}
