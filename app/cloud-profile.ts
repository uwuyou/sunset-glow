// CloudSat 云剖面/云分类借鉴：把云属映射为垂直结构（云底/云顶/厚度）、
// 水相（液态/冰/混合）与降水类型，供 3D 取景渲染与右侧「云剖面」面板使用。
// 思路源自 CloudSat CPR 毫米波雷达的垂直剖面观测与 2B-CLDCLASS 云分类：
// 云不只是"一层皮"，而是有云底、云顶、厚度与多层结构的垂直柱。

import type { CloudGenus } from "./cloud-genus";

export type WaterPhase = "liquid" | "ice" | "mixed";
export type PrecipType = "none" | "rain" | "snow" | "mixed";

export interface CloudLayerProfile {
  genus: CloudGenus;
  type: string; // CloudSat 2B-CLDCLASS 类型标签
  base: number; // 云底高度 km
  top: number; // 云顶高度 km
  thickness: number; // 厚度 km
  phase: WaterPhase; // 水相
  precip: PrecipType; // 降水类型
  cover: number; // 云量 %
}

// 各云属垂直结构配方：相对所在层基准高度的云底偏移与厚度（km）。
// 层状云薄而平、积状云厚而凸、雨层云/积雨云厚实，符合 CloudSat 剖面观测。
export const GENUS_PROFILE: Record<
  CloudGenus,
  { baseOffset: number; thickness: number }
> = {
  cirrus: { baseOffset: 0.3, thickness: 0.8 },
  cirrostratus: { baseOffset: 0.2, thickness: 0.7 },
  cirrocumulus: { baseOffset: 0.3, thickness: 0.9 },
  altostratus: { baseOffset: 0.5, thickness: 1.3 },
  altocumulus: { baseOffset: 0.6, thickness: 1.5 },
  stratus: { baseOffset: 0.1, thickness: 0.5 },
  stratocumulus: { baseOffset: 0.3, thickness: 1.0 },
  cumulus: { baseOffset: 0.4, thickness: 1.8 },
  nimbostratus: { baseOffset: 0.8, thickness: 3.0 },
  cumulonimbus: { baseOffset: 2.0, thickness: 6.0 }, // 塔状，由专属渲染接管
  none: { baseOffset: 0, thickness: 0 },
};

// CloudSat 2B-CLDCLASS 云型标签（映射自云属；积雨云对应其"深对流"类）。
export const CLOUDSAT_LABEL: Record<CloudGenus, string> = {
  cirrus: "卷云 Ci",
  cirrostratus: "卷层云 Cs",
  cirrocumulus: "卷积云 Cc",
  altostratus: "高层云 As",
  altocumulus: "高积云 Ac",
  stratus: "层云 St",
  stratocumulus: "层积云 Sc",
  cumulus: "积云 Cu",
  nimbostratus: "雨层云 Ns",
  cumulonimbus: "深对流 Cb",
  none: "无云",
};

// 按高度近似水相：高空冰晶、中层混合相、低空液态。
export function waterPhase(km: number): WaterPhase {
  if (km >= 7) return "ice";
  if (km >= 4) return "mixed";
  return "liquid";
}

// 由云属与降水判定降水类型：仅对流/层状降水云产生降水，冷云顶为雪。
export function precipType(
  genus: CloudGenus,
  precipitation: number,
  topKm: number,
): PrecipType {
  if (precipitation < 0.2) return "none";
  if (genus !== "cumulonimbus" && genus !== "nimbostratus") return "none";
  return topKm >= 5 ? "snow" : "rain";
}

// 计算三层云剖面：云底/云顶/厚度 + CloudSat 分类 + 水相 + 降水类型。
export function cloudProfile(
  genus: [CloudGenus, CloudGenus, CloudGenus],
  heights: number[],
  cover: number[],
  precipitation: number,
): CloudLayerProfile[] {
  return genus.map((g, i) => {
    const h = Math.max(0.2, heights[i] ?? 1.5),
      p = GENUS_PROFILE[g],
      base = Math.max(0.1, h - p.baseOffset),
      top = base + p.thickness,
      mid = (base + top) / 2;
    return {
      genus: g,
      type: CLOUDSAT_LABEL[g],
      base,
      top,
      thickness: p.thickness,
      phase: waterPhase(mid),
      precip: precipType(g, precipitation, top),
      cover: Math.max(0, Math.min(100, cover[i] ?? 0)),
    };
  });
}
