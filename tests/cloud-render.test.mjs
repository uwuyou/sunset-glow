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

const { highCloudPlan, totalHazePlan } =
  await vite.ssrLoadModule("/app/cloud-render.ts");

test("highCloudPlan 中等高云(>30)改走纹理云层，不再退化为极淡卷云", () => {
  assert.equal(highCloudPlan(45).mode, "deck");
});

test("highCloudPlan 很低的高云(<=30)仍用卷云表现碎云", () => {
  assert.equal(highCloudPlan(25).mode, "cirrus");
});

test("highCloudPlan 纹理云层用量随云量提升且更饱满", () => {
  const low = highCloudPlan(35).amount;
  const high = highCloudPlan(80).amount;
  assert.ok(high > low);
  assert.ok(highCloudPlan(100).amount >= 85);
});

test("totalHazePlan 总云 25 起触发薄幕层", () => {
  assert.equal(totalHazePlan(25).visible, true);
  assert.equal(totalHazePlan(24).visible, false);
});

test("totalHazePlan 薄幕层透明度随总云量增强", () => {
  assert.ok(totalHazePlan(80).alphaTop > totalHazePlan(30).alphaTop);
  assert.ok(totalHazePlan(80).alphaBottom > totalHazePlan(30).alphaBottom);
});

test("totalHazePlan 未触发时透明度为 0", () => {
  const p = totalHazePlan(20);
  assert.equal(p.alphaTop, 0);
  assert.equal(p.alphaBottom, 0);
});
