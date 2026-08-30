// 云属识别与形态配方：把预报变量映射到《国际云图》十云属，
// 并为每个云属给出纹理云层渲染所需的形态参数（噪声混合、频率、侵蚀、拉伸等）。
// 纯逻辑模块，便于单元测试。

export type CloudGenus =
  | "cumulus"
  | "cumulonimbus"
  | "stratocumulus"
  | "stratus"
  | "nimbostratus"
  | "altostratus"
  | "altocumulus"
  | "cirrus"
  | "cirrostratus"
  | "cirrocumulus"
  | "none";

export interface CloudMorphology {
  perlinMix: number; // Perlin-FBM 权重（平滑主体），Worley 权重 = 1 - perlinMix
  freq: number; // 噪声频率倍率
  erosionMul: number; // 边缘侵蚀倍率（相对基准低云 0.17 / 中高云 0.24）
  verticalExp: number; // 垂直渐变指数（>1 扁平铺展，<1 高耸厚实）
  anisotropy: number; // 水平拉伸倍率（>=1，越大越沿水平拉成丝条）
  alphaMul: number; // 不透明度倍率
}

export interface GenusEnv {
  cape: number; // 对流有效位能 J/kg
  precipitation: number; // 降水 mm
  wind: number; // 高空风速 m/s
  cover: [number, number, number]; // 低/中/高云量 %
  heights: [number, number, number]; // 低/中/高云高 km
}

export interface GenusResult {
  low: CloudGenus;
  mid: CloudGenus;
  high: CloudGenus;
}

// 云属中文标签（《国际云图》简写），用于右侧面板与详情展示。
export const GENUS_LABEL: Record<CloudGenus, string> = {
  cumulus: "淡积云 Cu",
  cumulonimbus: "积雨云 Cb",
  stratocumulus: "层积云 Sc",
  stratus: "层云 St",
  nimbostratus: "雨层云 Ns",
  altostratus: "高层云 As",
  altocumulus: "高积云 Ac",
  cirrus: "卷云 Ci",
  cirrostratus: "卷层云 Cs",
  cirrocumulus: "卷积云 Cc",
  none: "无云",
};

export const GENUS_MORPHOLOGY: Record<CloudGenus, CloudMorphology> = {
  cumulus: {
    perlinMix: 0.45,
    freq: 1.0,
    erosionMul: 1.35,
    verticalExp: 0.6,
    anisotropy: 1.0,
    alphaMul: 1.05,
  },
  cumulonimbus: {
    perlinMix: 0.4,
    freq: 0.85,
    erosionMul: 1.55,
    verticalExp: 0.4,
    anisotropy: 1.0,
    alphaMul: 1.1,
  },
  stratocumulus: {
    perlinMix: 0.55,
    freq: 1.15,
    erosionMul: 0.95,
    verticalExp: 0.95,
    anisotropy: 1.25,
    alphaMul: 0.95,
  },
  stratus: {
    perlinMix: 0.85,
    freq: 0.6,
    erosionMul: 0.4,
    verticalExp: 2.1,
    anisotropy: 1.5,
    alphaMul: 0.75,
  },
  nimbostratus: {
    perlinMix: 0.8,
    freq: 0.9,
    erosionMul: 0.75,
    verticalExp: 1.2,
    anisotropy: 1.4,
    alphaMul: 0.95,
  },
  altostratus: {
    perlinMix: 0.85,
    freq: 0.7,
    erosionMul: 0.45,
    verticalExp: 1.8,
    anisotropy: 1.4,
    alphaMul: 0.8,
  },
  altocumulus: {
    perlinMix: 0.5,
    freq: 1.9,
    erosionMul: 0.9,
    verticalExp: 1.0,
    anisotropy: 1.3,
    alphaMul: 0.95,
  },
  cirrus: {
    perlinMix: 0.7,
    freq: 1.4,
    erosionMul: 0.3,
    verticalExp: 1.5,
    anisotropy: 3.2,
    alphaMul: 0.65,
  },
  cirrostratus: {
    perlinMix: 0.85,
    freq: 1.0,
    erosionMul: 0.3,
    verticalExp: 2.0,
    anisotropy: 2.2,
    alphaMul: 0.55,
  },
  cirrocumulus: {
    perlinMix: 0.5,
    freq: 2.4,
    erosionMul: 0.7,
    verticalExp: 1.0,
    anisotropy: 1.6,
    alphaMul: 0.8,
  },
  none: {
    perlinMix: 0.7,
    freq: 1.0,
    erosionMul: 1.0,
    verticalExp: 1.0,
    anisotropy: 1.0,
    alphaMul: 0,
  },
};

const CONVECTIVE_CAPE = 700;
const RAIN_THRESHOLD = 0.2;
const OVERCAST = 85;
const STRONG_WIND = 25;

function classifyLow(cover: number, cape: number, precipitation: number): CloudGenus {
  if (cover <= 0) return "none";
  if (precipitation >= RAIN_THRESHOLD && cape >= CONVECTIVE_CAPE)
    return "cumulonimbus";
  if (precipitation >= RAIN_THRESHOLD) return "nimbostratus";
  if (cape >= CONVECTIVE_CAPE) return "cumulus";
  if (cover >= OVERCAST) return "stratus";
  return "stratocumulus";
}

function classifyMid(cover: number, cape: number, precipitation: number): CloudGenus {
  if (cover <= 0) return "none";
  if (precipitation >= RAIN_THRESHOLD && cape >= CONVECTIVE_CAPE)
    return "cumulonimbus";
  if (precipitation >= RAIN_THRESHOLD) return "nimbostratus";
  if (cover >= OVERCAST) return "altostratus";
  return "altocumulus";
}

function classifyHigh(cover: number, wind: number): CloudGenus {
  if (cover <= 0) return "none";
  if (cover >= OVERCAST) return "cirrostratus";
  if (wind >= STRONG_WIND) return "cirrus";
  if (cover <= 25) return "cirrocumulus";
  return "cirrus";
}

// 从预报反推三层云属：CAPE/降水区分对流与层状，
// 云量与高空风在各自高度层内细分具体云属。
export function classifyGenus(env: GenusEnv): GenusResult {
  const { cape, precipitation, wind, cover } = env;
  return {
    low: classifyLow(cover[0], cape, precipitation),
    mid: classifyMid(cover[1], cape, precipitation),
    high: classifyHigh(cover[2], wind),
  };
}
