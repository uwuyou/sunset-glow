import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

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

const { deckThreshold, cirrusCount } = await vite.ssrLoadModule(
  "/app/cloud-deck.ts",
);

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("0% cloud cover renders no texture deck", () => {
  // 0 云量时阈值必须取到 0.9 以上，保证没有任何噪声像素成云。
  assert.ok(near(deckThreshold(0), 0.9));
  assert.ok(deckThreshold(-5) >= 0.9, "负值按 0 处理");
});

test("100% cloud cover renders a near-full deck", () => {
  // 满铺阈值 0.25，与模拟结果约 92% 覆盖一致。
  assert.ok(near(deckThreshold(100), 0.25));
  assert.ok(near(deckThreshold(120), 0.25), "超过 100 按 100 处理");
});

test("threshold decreases monotonically with cover", () => {
  const samples = [0, 5, 12, 25, 50, 75, 100];
  for (let i = 1; i < samples.length; i++) {
    assert.ok(
      deckThreshold(samples[i]) < deckThreshold(samples[i - 1]),
      `${samples[i]}% 的阈值应小于 ${samples[i - 1]}%`,
    );
  }
});

test("0% and low cloud cover draw no cirrus lines", () => {
  assert.equal(cirrusCount(0), 0);
  assert.equal(cirrusCount(1), 0, "2% 以下不画卷云线");
});

test("cirrus line count grows with cover", () => {
  assert.ok(cirrusCount(50) > 0);
  assert.ok(cirrusCount(100) > cirrusCount(50));
  assert.ok(cirrusCount(100) <= 40, "卷云线数量有上限");
});
