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

const { highCloudPlan, totalHazePlan, averageModels } =
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

test("totalHazePlan 高 AOD 的晴朗天也显示薄幕", () => {
  assert.equal(totalHazePlan(20, 0.8).visible, true);
  assert.equal(totalHazePlan(20, 0.2).visible, false);
});

test("totalHazePlan 气溶胶增强薄幕透明度", () => {
  assert.ok(totalHazePlan(40, 0.8).alphaTop > totalHazePlan(40, 0.2).alphaTop);
  assert.ok(totalHazePlan(40, 0.8).alphaBottom > totalHazePlan(40, 0.2).alphaBottom);
});

test("totalHazePlan 透明度有上限", () => {
  const p = totalHazePlan(100, 3);
  assert.ok(p.alphaTop <= 0.5);
  assert.ok(p.alphaBottom <= 0.4);
});

test("averageModels 空输入返回空数组", () => {
  assert.deepEqual(averageModels(undefined), []);
  assert.deepEqual(averageModels([]), []);
});

test("averageModels 单模型原样返回", () => {
  assert.deepEqual(averageModels([[10, 20, 30]]), [10, 20, 30]);
});

test("averageModels 多模型逐时平均", () => {
  assert.deepEqual(averageModels([[10, 20, 30], [30, 40, 50]]), [20, 30, 40]);
});

test("averageModels 忽略缺失并按可用模型平均", () => {
  assert.deepEqual(averageModels([[10, 20], [NaN, 80]]), [10, 50]);
});

test("averageModels 兼容扁平数组", () => {
  assert.deepEqual(averageModels([10, 20, 30]), [10, 20, 30]);
});

test("averageModels 全部缺失时回退默认值", () => {
  assert.deepEqual(averageModels([[NaN], [NaN]], 15), [15]);
});
