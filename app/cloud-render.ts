// 取景云层渲染的判定纯逻辑：高云绘制模式、总云薄幕层强度、多模型集合平均。
// 高云阈值、薄幕层触发、CAMS 气溶胶校准、集合平均均在此保持单一事实来源。

// 高云改为纹理云层的阈值：大于该值走 texturedDeck，否则用卷云。
export const HIGH_DECK_MIN = 30;

// 总云薄幕层触发阈值。
export const TOTAL_HAZE_MIN = 25;

// CAMS AOD 校准薄幕层的触发阈值：AOD 达到该值即使云量很低也画薄幕。
export const HAZE_AOD_MIN = 0.45;

export type HighCloudPlan = { mode: "deck" | "cirrus"; amount: number };

// 高云分支：cover[2] > 30 画成有形态的纹理云层，用量在 40%~95% 间随云量线性提升；
// 更低仍用卷云表现稀碎高云。
export function highCloudPlan(cover2: number): HighCloudPlan {
  if (cover2 <= HIGH_DECK_MIN) return { mode: "cirrus", amount: cover2 };
  const t = Math.min(1, Math.max(0, (cover2 - HIGH_DECK_MIN) / (100 - HIGH_DECK_MIN)));
  return { mode: "deck", amount: Math.round(40 + t * 55) };
}

export type TotalHazePlan = {
  visible: boolean;
  alphaTop: number;
  alphaBottom: number;
};

// 总云薄幕层：总云 25 起触发，透明度随总云量增强；
// 用 CAMS AOD 校准：AOD >= 0.45 时晴朗天也显示薄幕，气溶胶浓度越高透明度越高。
export function totalHazePlan(totalCover: number, aod = 0): TotalHazePlan {
  const t =
    totalCover >= TOTAL_HAZE_MIN
      ? Math.min(1, Math.max(0, (totalCover - TOTAL_HAZE_MIN) / 75))
      : 0;
  const cloudTop = totalCover >= TOTAL_HAZE_MIN ? 0.12 + t * 0.18 : 0,
    cloudBottom = totalCover >= TOTAL_HAZE_MIN ? 0.08 + t * 0.14 : 0;
  const aeroT =
    aod >= HAZE_AOD_MIN ? Math.min(1, Math.max(0, (aod - HAZE_AOD_MIN) / 1.2)) : 0;
  const alphaTop = Math.min(0.5, cloudTop + aeroT * 0.2);
  const alphaBottom = Math.min(0.4, cloudBottom + aeroT * 0.14);
  return {
    visible: alphaTop > 0.02,
    alphaTop: Math.round(alphaTop * 1000) / 1000,
    alphaBottom: Math.round(alphaBottom * 1000) / 1000,
  };
}

// 多模型集合平均：把 Open-Meteo 多模型响应（每个变量是"模型数组的数组"）
// 按时间逐点平均，忽略 NaN/缺失值；兼容单模型扁平数组；全缺失回退 fallback。
export function averageModels(
  series: (number[] | undefined)[] | number[] | undefined,
  fallback = 0,
): number[] {
  if (!Array.isArray(series) || series.length === 0) return [];
  const models = Array.isArray(series[0])
    ? (series as (number[] | undefined)[])
    : ([series] as (number[] | undefined)[]);
  const n = Math.max(0, ...models.map((m) => m?.length || 0));
  const out = new Array(n).fill(fallback);
  for (let i = 0; i < n; i++) {
    let sum = 0,
      count = 0;
    for (const m of models) {
      const v = m?.[i];
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    if (count) out[i] = Math.round((sum / count) * 10) / 10;
  }
  return out;
}
