// 取景云层渲染的判定纯逻辑：高云绘制模式与总云薄幕层强度。
// 让画面总云更贴近数值并集总云量（此前高云 ≤62% 只画极淡卷云，画面偏空）。

// 高云改为纹理云层的阈值：大于该值走 texturedDeck，否则用卷云。
export const HIGH_DECK_MIN = 30;

// 总云薄幕层触发阈值。
export const TOTAL_HAZE_MIN = 25;

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

// 总云薄幕层：总云 25 起触发，透明度随总云量增强。
export function totalHazePlan(totalCover: number): TotalHazePlan {
  const visible = totalCover >= TOTAL_HAZE_MIN;
  if (!visible) return { visible: false, alphaTop: 0, alphaBottom: 0 };
  const t = Math.min(1, Math.max(0, (totalCover - TOTAL_HAZE_MIN) / 75));
  return {
    visible: true,
    alphaTop: 0.12 + t * 0.18,
    alphaBottom: 0.08 + t * 0.14,
  };
}
