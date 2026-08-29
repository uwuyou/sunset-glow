// 太阳日面图片的纯逻辑：从采样像素估算日面占比与饱和度，用于：
// 1) 按日面实际大小精确铺满圆形裁剪（不同 NASA 图源的日面占比不同）；
// 2) 白光日面（低饱和）叠加更强的暖色着色，使其融入日落色调。

// 亮度阈值：低于该值视为 SDO 全盘图的黑色背景。
export const DISK_LUMA = 55;

export type SunDiskStats = {
  frac: number;
  saturation: number;
  disk: boolean;
};

// 从一张已缩放的 RGBA 像素数据估算日面占比与平均饱和度（0~1）。
// frac 为日面宽度占整图宽度的比例；saturation 为日面亮区平均饱和度。
// 背景像素不足时返回 disk:false，调用方应沿用默认值。
export function sunDiskStats(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): SunDiskStats {
  let minX = width,
    maxX = -1,
    minY = height,
    maxY = -1,
    sumSat = 0,
    diskPx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2],
        luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma <= DISK_LUMA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      sumSat += mx === 0 ? 0 : (mx - mn) / mx;
      diskPx++;
    }
  }
  if (diskPx === 0) return { frac: 0.9, saturation: 0.6, disk: false };
  const frac =
    ((maxX - minX + 1) / width + (maxY - minY + 1) / height) / 2;
  return { frac, saturation: sumSat / diskPx, disk: true };
}

// 白光日面（低饱和）需更强的暖色叠加才能融入日落；已呈暖色/假色的图则轻着色。
// 返回叠加暖色径向渐变的总透明度（0.14 ~ 0.5）。
export function sunTintAlpha(saturation: number): number {
  const t = Math.max(0, Math.min(1, 1 - saturation));
  return 0.14 + t * 0.36;
}
