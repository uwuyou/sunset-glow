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

const { classifyGenus, GENUS_MORPHOLOGY, GENUS_LABEL } =
  await vite.ssrLoadModule("/app/cloud-genus.ts");

const env = (over = {}) => ({
  cape: 0,
  precipitation: 0,
  wind: 20,
  cover: [0, 0, 0],
  heights: [1.5, 5.5, 10],
  ...over,
});

test("无云时三层均为 none", () => {
  const g = classifyGenus(env());
  assert.equal(g.low, "none");
  assert.equal(g.mid, "none");
  assert.equal(g.high, "none");
});

test("CAPE 高且低云存在 → 积云", () => {
  const g = classifyGenus(env({ cape: 1200, cover: [40, 0, 0] }));
  assert.equal(g.low, "cumulus");
});

test("CAPE 高且有降水 → 积雨云", () => {
  const g = classifyGenus(
    env({ cape: 1200, precipitation: 0.8, cover: [60, 50, 30] }),
  );
  assert.equal(g.low, "cumulonimbus");
  assert.equal(g.mid, "cumulonimbus");
});

test("CAPE 低 + 满层低云 → 层云", () => {
  const g = classifyGenus(env({ cover: [95, 0, 0] }));
  assert.equal(g.low, "stratus");
});

test("CAPE 低 + 部分低云 → 层积云", () => {
  const g = classifyGenus(env({ cover: [55, 0, 0] }));
  assert.equal(g.low, "stratocumulus");
});

test("有降水但 CAPE 低 → 雨层云", () => {
  const g = classifyGenus(env({ precipitation: 1.2, cover: [80, 70, 40] }));
  assert.equal(g.low, "nimbostratus");
  assert.equal(g.mid, "nimbostratus");
});

test("满层中云 + 稳定 → 高层云", () => {
  const g = classifyGenus(env({ cover: [0, 90, 0] }));
  assert.equal(g.mid, "altostratus");
});

test("部分中云 → 高积云", () => {
  const g = classifyGenus(env({ cover: [0, 50, 0] }));
  assert.equal(g.mid, "altocumulus");
});

test("大风 + 高云 → 卷云（丝状）", () => {
  const g = classifyGenus(env({ wind: 30, cover: [0, 0, 40] }));
  assert.equal(g.high, "cirrus");
});

test("满层高云 → 卷层云", () => {
  const g = classifyGenus(env({ cover: [0, 0, 95] }));
  assert.equal(g.high, "cirrostratus");
});

test("稀少高云 → 卷积云", () => {
  const g = classifyGenus(env({ cover: [0, 0, 15] }));
  assert.equal(g.high, "cirrocumulus");
});

test("形态库：积云比层云更团块、卷云水平拉伸最强", () => {
  const cu = GENUS_MORPHOLOGY.cumulus,
    st = GENUS_MORPHOLOGY.stratus,
    ci = GENUS_MORPHOLOGY.cirrus;
  assert.ok(cu.perlinMix < st.perlinMix, "积云 perlin 权重应更低（更团块）");
  assert.ok(ci.anisotropy > 2, "卷云应有强水平拉伸");
  assert.ok(st.anisotropy < ci.anisotropy);
  assert.ok(st.verticalExp > 1.5, "层云应扁平");
  assert.ok(cu.erosionMul > st.erosionMul, "积云边缘侵蚀应更强");
});

test("形态参数齐全且取值范围合法", () => {
  for (const [k, m] of Object.entries(GENUS_MORPHOLOGY)) {
    assert.ok(m.freq > 0, `${k} freq`);
    assert.ok(m.erosionMul >= 0, `${k} erosionMul`);
    assert.ok(m.verticalExp > 0, `${k} verticalExp`);
    assert.ok(m.anisotropy >= 1, `${k} anisotropy`);
    assert.ok(m.alphaMul >= 0 && m.alphaMul <= 1.2, `${k} alphaMul`);
    assert.ok(m.perlinMix >= 0 && m.perlinMix <= 1, `${k} perlinMix`);
  }
});

test("云属标签：十云属均有非空中文标签", () => {
  const known = new Set([
    "cumulus",
    "cumulonimbus",
    "stratocumulus",
    "stratus",
    "nimbostratus",
    "altostratus",
    "altocumulus",
    "cirrus",
    "cirrostratus",
    "cirrocumulus",
    "none",
  ]);
  for (const [k, label] of Object.entries(GENUS_LABEL)) {
    assert.ok(known.has(k), `未知云属 ${k}`);
    assert.ok(typeof label === "string" && label.length > 0, `${k} 标签为空`);
  }
});
