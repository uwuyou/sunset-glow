// 云色比色模块：依据《火烧云定量预报》晚霞比色卡（page 54-55）与各云属
// 云底高度分级，定义每属云的基准色与受光后可达的"最高红度"。
//
// 文档核心比色规则：
//   - 云底高度越高，火烧云颜色变化越全面：金黄 → 橘红 → 绯红；
//   - 云底低则只能呈橘红色，且更易受气溶胶（米散射）消光而发灰；
//   - 瑞利散射滤蓝成功 → 颜色越红越纯（饱和升高）；米散射 → 发灰褪色。
//
// 本模块为 3D 取景、CloudSat 剖面、右侧面板共用的唯一来源，避免各处漂移。

import type { CloudGenus } from "./cloud-genus";

// 云属基准色（受光面、黄昏、弱消光时的"本底色"）。
// 按云底高度分级：高云金黄、中云橘黄、低云橘红、厚云深橘红。
// 各值取自文档比色卡的定性区间。
export const GENUS_TONE: Record<CloudGenus, number[]> = {
  // 高云：云底 >6km，冰晶薄透，色域最全（金黄→绯红）
  cirrus: [255, 232, 200],
  cirrostratus: [252, 226, 188],
  cirrocumulus: [252, 218, 172],
  // 中云：云底 2.5km+，混合相，色域居中（橘黄→橘红）
  altostratus: [246, 174, 112],
  altocumulus: [247, 168, 106],
  // 低云：云底低，只能橘红
  stratus: [232, 124, 74],
  stratocumulus: [236, 128, 78],
  cumulus: [240, 132, 80],
  // 厚降水云：深橘红、最易受气溶胶发灰
  nimbostratus: [178, 92, 60],
  cumulonimbus: [208, 96, 60],
  none: [240, 132, 80],
};

// 消光后可染上的"最高红度"目标（绯红）：高云可至极绯，低云则不到绯红。
// 值越大代表可染越红。云底越高该目标越完整，符合"色域越全面"。
const genusMaxRed: Record<CloudGenus, number[]> = {
  cirrus: [204, 44, 40],
  cirrostratus: [206, 40, 38],
  cirrocumulus: [205, 42, 40],
  altostratus: [210, 52, 42],
  altocumulus: [208, 56, 46],
  stratus: [196, 70, 48], // 低云只能到深橘，到不了绯红
  stratocumulus: [198, 68, 48],
  cumulus: [200, 66, 46],
  nimbostratus: [150, 66, 52],
  cumulonimbus: [170, 60, 48],
  none: [200, 66, 46],
};

// 均色插值（数值数组），用于消光演化。
function mix(a: number[], b: number[], t: number): number[] {
  // 非有限插值因子（上游 NaN 兜底）按 0 处理，保证 Canvas 渐变颜色始终可解析
  const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 云属 + 消光 + 阴天遮光驱动的受光云色。
 * @param km       云底高度（km），越高光程越大、可越红
 * @param g        云属
 * @param sunlit   是否受光（背光则压暗为冷灰蓝）
 * @param sunLow   太阳近地程度 0~1（太阳越低光程越长）
 * @param aodHaze  气溶胶光学厚度 0~1（米散射发灰，削弱饱和度）
 * @param overcast 阴天遮光程度 0~1（厚低云/降水遮挡阳光→褪为灰白，0=晴空，1=全阴）
 */
export function cloudTone(
  km: number,
  g: CloudGenus,
  sunlit: boolean,
  sunLow: number,
  aodHaze: number,
  overcast = 0,
): number[] {
  // 阴天时即使 sunlit 为 true，温暖感也被遮光削弱
  const effectiveSun = sunlit ? Math.max(0, 1 - overcast * 0.85) : 0;

  if (!sunlit || overcast > 0.6) {
    // 背光或重阴天：冷灰蓝 / 灰白，随厚实度与气溶胶加深
    // 轻度阴天(overcast 0~0.6)做渐变过渡，不直接跳到全暗
    if (overcast > 0.6) {
      // 重阴天→灰白/铅灰，降水越强越暗
      const darken = overcast > 0.8 ? 0.25 : 0.35;
      return mix(
        [160, 162, 170],
        [100, 104, 118],
        Math.min(1, (overcast - 0.6) / 0.4 + aodHaze * 0.15),
      );
    }
    return mix(
      [96, 110, 130],
      [74, 74, 92],
      (g === "nimbostratus" || g === "cumulonimbus" ? 0.32 : 0.18) +
        aodHaze * 0.18 +
        overcast * 0.25,
    );
  }
  const base = GENUS_TONE[g] || [240, 132, 80],
    // 光程因子：太阳越低、云底越高 → 阳光穿越大气越厚，瑞利滤蓝越充分
    pathLen = clamp(sunLow, 0, 1) * (0.42 + Math.max(1, km) * 0.06),
    // 瑞利散射主导的"纯净红染"：干净大气下更饱和，随 AOD 削弱，也随阴天削弱
    rayleigh = clamp(pathLen * (1 - aodHaze * 0.6) * (1 - overcast * 0.7), 0, 1),
    // 米散射（气溶胶）导致的发灰褪色，阴天增强
    mie = clamp(pathLen * (aodHaze * 0.8 + overcast * 0.5), 0, 1),
    redTarget = genusMaxRed[g] || [200, 66, 46],
    gray = [184, 168, 166];
  let color = mix(base, redTarget, rayleigh * 0.92);
  color = mix(color, gray, mie);
  // 阴天时整体压暗更多
  const darkFactor = (1 - clamp(sunLow, 0, 1)) * 0.34 + aodHaze * 0.12 + overcast * 0.18;
  return mix(color, [58, 66, 84], darkFactor);
}

/**
 * 阴天遮光因子：从降水、低云量、能见度融合估算。
 * 返回值 0~1，0=晴空通透，1=完全阴天遮光。
 */
export function calcOvercast(
  cover: number[],       // 低/中/高云量 0~100
  precipitation: number, // 降水 mm
  visibility: number,    // 能见度 m
): number {
  const low = Math.min(1, (cover[0] || 0) / 100),
    mid = Math.min(1, (cover[1] || 0) / 100),
    high = Math.min(1, (cover[2] || 0) / 100),
    // 有效遮光云量：低云权重最高，中云次之，高云透光好权重低
    totalBlock = low * 0.65 + mid * 0.25 + high * 0.1,
    // 降水因子：有降水时遮光大幅增强
    rainFactor = Math.min(1, Math.max(0, precipitation) / 2),
    // 能见度因子：<5km 视为阴天遮光
    visFactor = Math.max(0, Math.min(1, (10 - visibility / 1000) / 8));
  let o = totalBlock * 0.6 + rainFactor * 0.25 + visFactor * 0.15;
  // 低云量>70%且降水>0.2mm → 强制高阴天
  if (low > 0.7 && precipitation > 0.2) o = Math.max(o, 0.7);
  return Math.min(1, o);
}