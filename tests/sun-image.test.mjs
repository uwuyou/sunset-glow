import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

const { sunDiskStats, sunTintAlpha } =
  await vite.ssrLoadModule("/app/sun-image.ts");

// 构造 RGBA 像素缓冲：全黑背景 + 以 (cx,cy,r) 为界的白色/暖色圆形日面。
function makeBuffer(width, height, diskColor, cx, cy, r) {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
      if (inside && diskColor) {
        px[i] = diskColor[0];
        px[i + 1] = diskColor[1];
        px[i + 2] = diskColor[2];
      }
      px[i + 3] = 255;
    }
  }
  return px;
}

test("sunDiskStats 白色日面: 占比按包围盒估算, 饱和度为 0", () => {
  const px = makeBuffer(10, 10, [255, 255, 255], 4.5, 4.5, 3);
  const s = sunDiskStats(px, 10, 10);
  assert.equal(s.disk, true);
  // 离散像素网格下圆盘包围盒 x:2..7 -> 宽 6/10=0.6
  assert.equal(s.frac, 0.6);
  assert.equal(s.saturation, 0);
});

test("sunDiskStats 暖色日面: 饱和度反映偏暖程度", () => {
  const px = makeBuffer(10, 10, [255, 120, 60], 4.5, 4.5, 3);
  const s = sunDiskStats(px, 10, 10);
  assert.ok(s.saturation > 0.5);
  assert.ok(s.saturation <= 1);
});

test("sunDiskStats 全黑背景返回 disk:false 并给默认占比", () => {
  const px = makeBuffer(8, 8, null, 0, 0, 0);
  const s = sunDiskStats(px, 8, 8);
  assert.equal(s.disk, false);
  assert.equal(s.frac, 0.9);
});

test("sunTintAlpha 白光日面(低饱和)着色更强, 暖色日面更轻", () => {
  assert.ok(sunTintAlpha(0) > sunTintAlpha(0.8));
  assert.ok(sunTintAlpha(0) >= 0.45);
  assert.ok(sunTintAlpha(1) >= 0.14);
});

test("sunTintAlpha 输出限定在 0.14~0.5 区间", () => {
  for (const sat of [0, 0.3, 0.6, 1, -1, 2]) {
    const a = sunTintAlpha(sat);
    assert.ok(a >= 0.14 && a <= 0.5, `sat=${sat} -> ${a}`);
  }
});
