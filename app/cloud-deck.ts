// 取景云层渲染的纯逻辑：把预报云量(0~100)映射到纹理云层的密度阈值与卷云线条数。
// 修复此前"无预报云也显示云"的问题：旧阈值在 amount=0 时仍为 0.59，
// 噪声像素中约 8% 会渲染成云；新映射保证 0% 云量完全不渲染。

// 纹理云层密度阈值。阈值越高云越少；噪声 shape 最大值约 0.9，
// 因此 0 云量取 0.9 以上即完全不渲染。阈值→覆盖率的对应近似指数
// （0.55→15%、0.45→42%、0.35→76%、0.25→92%），为抵消其陡峭性，
// 采用"前 12% 云量快速建立云形、之后线性扩展至满铺"的两段式映射：
// amount=0 → 0.9（无云），amount=100 → 0.25（满铺）。
export function deckThreshold(amount: number): number {
  const a = Math.max(0, Math.min(100, amount));
  return 0.9 - 0.33 * Math.min(1, a / 12) - 0.32 * Math.max(0, (a - 12) / 88);
}

// 卷云线条数：0 云量时完全不画，条数随云量增加（最高约 35 条）。
export function cirrusCount(amount: number): number {
  const a = Math.max(0, Math.min(100, amount));
  return a < 2 ? 0 : Math.round(a * 0.35);
}
