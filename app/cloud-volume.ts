// 体积云噪声/密度函数：基于 Horizon: Zero Dawn / GPU Pro 7 方案，
// 为 2D 剖面视图（方位×仰角、距离×仰角）提供连续、自然的云密度场。
// 代替原有的 CloudSat 离散柱体 + 椭圆簇方案。

import type { CloudLayerProfile } from "./cloud-profile";
import { GENUS_TONE } from "./cloud-color";

// ─── 2D 确定性噪声基础 ───────────────────────────────────────

function hash2(ix: number, iy: number): number {
  const s = Math.sin(ix * 12.9898 + iy * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// 双线性插值值噪声
function valNoise(x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(ix, iy),
    n10 = hash2(ix + 1, iy);
  const n01 = hash2(ix, iy + 1),
    n11 = hash2(ix + 1, iy + 1);
  return n00 + (n10 - n00) * sx + ((n01 + (n11 - n01) * sx) - (n00 + (n10 - n00) * sx)) * sy;
}

// 分形布朗运动（FBM）：多 octave 叠加，产生云状连续起伏
function fbm(x: number, y: number, octaves: number): number {
  let v = 0,
    amp = 0.5,
    freq = 1,
    maxV = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * valNoise(x * freq, y * freq);
    maxV += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return v / maxV;
}

// 简化 Worley（细胞）噪声：每个整数格点一个随机特征点，返回到最近特征点的距离
function worley(x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let minD = 999;
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const cx = ix + ox + 0.5,
        cy = iy + oy + 0.5;
      // 每个格点的特征点位置加随机偏移
      const offX = (hash2(ix + ox, iy + oy) - 0.5) * 0.8,
        offY = (hash2(ix + ox + 1, iy + oy) - 0.5) * 0.8;
      const dx = x - (cx + offX),
        dy = y - (cy + offY);
      const d = dx * dx + dy * dy;
      if (d < minD) minD = d;
    }
  }
  return Math.min(1, minD / 0.45);
}

// ─── 密度-高度梯度 ───────────────────────────────────────────

// cloudType: 0=层云(flat), 0.5=层积云(rounded), 1.0=积云(billowy)
// h: 0~1 归一化高度（云层内，0=云底, 1=云顶）
function densityGradient(h: number, cloudType: number): number {
  // 层云：底部稍密，均匀
  const stratus = 0.55 + 0.45 * (1 - h);
  // 层积云：中间最密，两头渐薄
  const stratocumulus = 4.0 * h * (1 - h);
  // 积云：底部密实，顶部陡峭过渡
  const cumulus = h < 0.6 ? 0.8 + 0.2 * (1 - h / 0.6) : 2.0 * (1 - h) * (1 - h);

  // 按 cloudType 加权混合
  const t = Math.max(0, Math.min(1, cloudType));
  if (t < 0.4) {
    const s = t / 0.4;
    return stratus * (1 - s) + stratocumulus * s;
  } else {
    const s = (t - 0.4) / 0.6;
    return stratocumulus * (1 - s) + cumulus * s;
  }
}

// ─── 主密度采样函数 ──────────────────────────────────────────

// 基于 Horizon: Zero Dawn 的 Perlin-Worley 密度 + 高频细节
// az: 归一化方位角（-1~1）
// h: 归一化高度（0~1，云层内）
// coverage: 覆盖度 0~100
// cloudType: 0=层云, 0.5=层积云, 1.0=积云
// seed: 每层随机种子偏移
export function sampleCloudDensity(
  az: number,
  h: number,
  coverage: number,
  cloudType: number,
  seed: number,
): number {
  const cov = coverage / 100;
  if (cov <= 0.01) return 0;

  // 坐标映射：水平方向拉伸使云形自然，垂直方向压缩保持层状感
  const scaleX = 3.5,
    scaleY = 2.0;
  const x = az * scaleX + seed * 137.5,
    y = h * scaleY + seed * 53.1;

  // 1) 低频 Perlin-Worley 噪声（基础云形）
  //    对比拉伸：fbm 3-octave 值集中在 0.3~0.7，直接使用会导致
  //    云芯密度不足、低覆盖度下被覆盖度重映射全部压灭。拉伸到 0~1。
  const perlinRaw = fbm(x, y, 3),
    perlinWorley = Math.max(0, Math.min(1, (perlinRaw - 0.3) / 0.4));

  // 2) 低频 Worley FBM（倒置，用于翻滚边缘）
  const wFbm =
    (1 - worley(x * 1.5, y * 1.5)) * 0.625 +
    (1 - worley(x * 3.0, y * 3.0)) * 0.25 +
    (1 - worley(x * 6.0, y * 6.0)) * 0.125;

  // 3) Remap：用 Worley 翻滚细节重新映射 Perlin-Worley 边缘
  const oldMin = -(1.0 - wFbm);
  const baseCloud = Math.max(0, Math.min(1, (perlinWorley - oldMin) / (1 - oldMin)));

  // 4) 密度-高度梯度
  const dhg = densityGradient(h, cloudType);
  let density = baseCloud * Math.max(0.08, dhg);

  // 5) 覆盖度控制：基于密度场分位数经验拟合的线性阈值。
  //    阈值 ≈ 密度场的 (1-cov) 分位（0.78 为拟合系数，经 cloud-sim3 标定），
  //    使渲染像素占比接近覆盖度，同时保留云芯高密度、低覆盖度下也能看到
  //    成团云层。旧公式 (density - cov)/(1 - cov) 与 (density - (1-cov))/cov
  //    在低覆盖度下要么压灭整片云、要么只剩极淡的边角，均已废弃。
  //    注：0.85→0.78 下调是为抵消低密度云的半透明叠加带来的"视觉偏少"，
  //    86% 覆盖度下填充率由 64~71% 提升至 72~93%，与分层云面板观感对齐。
  const threshold = Math.max(0.02, 0.78 * (1 - cov));
  density = Math.max(
    0,
    Math.min(1, (density - threshold) / (1 - threshold)),
  );

  // 6) 高频细节（Worley 高 octave）扰动边缘
  //    hfErode 0.25→0.16（标定）：减小高频侵蚀对边缘的削减，进一步补回云量
  const hfDetail =
    (1 - worley(x * 10, y * 10)) * 0.5 +
    (1 - worley(x * 20, y * 20)) * 0.3 +
    (1 - worley(x * 40, y * 40)) * 0.2;
  density = Math.max(0, Math.min(1, (density - hfDetail * 0.16) / (1 - hfDetail * 0.16)));

  // 7) 密度固化：gamma<1 提亮中低密度。
  //    仅做覆盖率→填充率标定后，幸存像素密度普遍偏低（0.1~0.4），
  //    再叠加渲染端的 alpha≈density×0.35 后几乎隐形，导致观感"云量偏少"。
  //    0.62 次幂把 0.2→0.37、0.4→0.56、0.6→0.72，让云芯成块、边缘清晰。
  density = Math.pow(Math.max(0, density), 0.62);

  // 8) 低密度截断：避免雾状拖尾（阈值降低，保留更多边缘云）
  if (density < 0.012) {
    // 用平滑台阶替代硬裁剪，避免边缘割裂
    density = density < 0.004 ? 0 : density * (density - 0.004) / (0.012 - 0.004);
  }

  return Math.max(0, Math.min(1, density));
}

// ─── Canvas 渲染 ─────────────────────────────────────────────

export interface VolLayer {
  base: number;  // km
  top: number;   // km
  coverage: number;
  genus: string;
  phase: string;
  illum: boolean;
  precip: string;
  seed: number;
}

// 将云层高度转换为剖面仰角
function elevOf(km: number, maxAlt: number): number {
  const f = Math.min(13, Math.max(0.2, km || 3)) / 13;
  return Math.max(0.6, Math.min(maxAlt - 1.2, f * maxAlt * 0.92));
}

// 在 canvas 上逐像素渲染云密度，返回 data URL
export function renderCloudCanvas(
  W: number,           // canvas 像素宽
  H: number,           // canvas 像素高
  azHalf: number,      // 方位半宽
  minAlt: number,      // 最低仰角
  maxAlt: number,      // 最高仰角
  layers: VolLayer[],  // 云层（低/中/高）
  mode: "sunset" | "dawn",
  overcast: number,
  sunAz: number,       // 太阳方位角（相对）
): string {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;

  // 每个云层的颜色缓存
  const layerColors = layers.map((l) => {
    const genus = l.genus || "cumulus";
    const tone = GENUS_TONE[genus] || [240, 132, 80];
    // 阴天遮光
    const oc = overcast || 0;
    const isLit = l.illum !== false;
    return { tone, isLit, oc };
  });

  // 找出各层在 canvas 上的垂直范围
  const layerRanges = layers.map((l) => {
    const baseElev = elevOf(l.base, maxAlt);
    const topElev = elevOf(l.top, maxAlt);
    // 像素坐标 Y
    const yBase = Math.round(H - ((baseElev - minAlt) / (maxAlt - minAlt)) * H);
    const yTop = Math.round(H - ((topElev - minAlt) / (maxAlt - minAlt)) * H);
    return { y0: Math.max(0, yTop), y1: Math.min(H - 1, yBase) };
  });

  // 日暖方向：太阳在画面左侧/右侧
  const sunDir = sunAz >= 0 ? 1 : -1;
  // 暖色偏移：越靠近太阳越暖
  const warmByX = (px: number) => {
    const t = sunDir > 0 ? px / W : (W - px) / W;
    return Math.max(0, Math.min(1, t));
  };

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const idx = (py * W + px) * 4;
      // 像素 → 仰角
      const alt = minAlt + ((H - py) / H) * (maxAlt - minAlt);
      // 像素 → 方位角
      const az = -azHalf + (px / W) * 2 * azHalf;

      let rAcc = 0,
        gAcc = 0,
        bAcc = 0,
        aAcc = 0;

      for (let li = 0; li < layers.length; li++) {
        const l = layers[li];
        const range = layerRanges[li];
        if (py < range.y0 || py > range.y1) continue;

        // 归一化高度（层内）
        const h = (py - range.y0) / (range.y1 - range.y0);
        if (h < 0 || h > 1) continue;

        // 云类型：根据 genus 推断
        let cloudType = 0.5; // 默认层积云
        const g = l.genus || "";
        if (g === "stratus" || g === "cirrostratus" || g === "nimbostratus") cloudType = 0.0;
        else if (g === "stratocumulus" || g === "altostratus" || g === "cirrostratus") cloudType = 0.5;
        else if (g === "cumulus" || g === "cumulonimbus" || g === "altocumulus" || g === "cirrocumulus") cloudType = 0.8;
        else if (g === "cirrus") cloudType = 0.3;

        const density = sampleCloudDensity(
          az / Math.max(1, azHalf),
          h,
          l.coverage,
          cloudType,
          l.seed,
        );

        if (density <= 0.005) continue;

        // 颜色计算
        const { tone, isLit, oc } = layerColors[li];
        const warm = isLit ? Math.max(0, 1 - Math.abs(az - sunAz) / (azHalf * 2)) : 0;
        const warmFactor = isLit ? (0.4 + 0.6 * warm) : 0.25;

        // 基础色：从云属色调出发，根据光照和高度微调
        let r = tone[0] * (0.5 + 0.5 * warmFactor);
        let greenComp = tone[1] * (0.45 + 0.55 * warmFactor);
        let b = tone[2] * (0.35 + 0.65 * warmFactor);

        // 阴天遮光：褪为灰白
        if (oc > 0) {
          const grayMix = Math.min(1, oc * 0.7);
          r = r * (1 - grayMix) + (160 + oc * 40) * grayMix;
          greenComp = greenComp * (1 - grayMix) + (162 + oc * 30) * grayMix;
          b = b * (1 - grayMix) + (170 - oc * 20) * grayMix;
        }

        // 冷暖色调随日出/日落模式
        if (mode === "dawn") {
          r *= 0.92;
          greenComp *= 0.88;
          b *= 1.05;
        }

        // 密度决定不透明度（0.5 基准较旧 0.35 更实，云量观感与分层云面板对齐；
        // 未受光层基准 0.3→0.42，边缘云不再隐形）
        const alpha =
          density *
          (0.5 + 0.5 * warmFactor) *
          (isLit ? 1 - oc * 0.3 : 0.42 - oc * 0.12);

        // Alpha 混合
        const a = alpha * 255;
        const invA = 1 - a / 255;
        rAcc = rAcc * invA + r * (a / 255);
        gAcc = gAcc * invA + greenComp * (a / 255);
        bAcc = bAcc * invA + b * (a / 255);
        aAcc = aAcc + (1 - aAcc) * alpha;
      }

      // 最终颜色
      data[idx] = Math.round(Math.min(255, rAcc));
      data[idx + 1] = Math.round(Math.min(255, gAcc));
      data[idx + 2] = Math.round(Math.min(255, bAcc));
      data[idx + 3] = Math.round(Math.min(255, aAcc * 255));
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL();
}