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

const { forecastUpdateAt, sceneUrls, HISTORY_DAYS, nextSunUrl, NASA_SUN_URLS } =
  await vite.ssrLoadModule("/app/scene-urls.ts");

const base = {
  lat: 30.657,
  lon: 104.066,
  lats: "30.6,30.6",
  lons: "104.0,104.1",
  corridorLats: "30.6",
  corridorLons: "104.0",
};

test("forecastUpdateAt 将任意时刻回落到最近一次 6 小时数值预报时次", () => {
  assert.equal(
    forecastUpdateAt(new Date("2026-08-30T05:30:00Z")).toISOString(),
    "2026-08-30T00:00:00.000Z",
  );
});

test("forecastUpdateAt 恰逢整点时次时原样保留", () => {
  assert.equal(
    forecastUpdateAt(new Date("2026-08-30T12:00:00Z")).toISOString(),
    "2026-08-30T12:00:00.000Z",
  );
});

test("forecastUpdateAt 跨日时次正确回落到前一时次", () => {
  assert.equal(
    forecastUpdateAt(new Date("2026-08-30T23:59:00Z")).toISOString(),
    "2026-08-30T18:00:00.000Z",
  );
});

test("sceneUrls 为所有预报类端点加入 past_days 历史回溯参数", () => {
  const urls = sceneUrls(base);
  for (const u of [urls.wf, urls.vis, urls.air, urls.corridor]) {
    assert.match(u, new RegExp(`past_days=${HISTORY_DAYS}`));
    assert.match(u, /timezone=Asia%2FShanghai/);
  }
});

test("sceneUrls 高程端点不包含 past_days", () => {
  const urls = sceneUrls(base);
  assert.doesNotMatch(urls.dem, /past_days/);
});

test("sceneUrls 保留原有 7 天预报与所需变量字段", () => {
  const urls = sceneUrls(base);
  assert.match(urls.wf, /forecast_days=7/);
  assert.match(urls.wf, /daily=sunrise,sunset/);
  assert.match(urls.wf, /cloud_cover_low,cloud_cover_mid,cloud_cover_high/);
  assert.match(urls.air, /aerosol_optical_depth,pm2_5/);
  assert.match(urls.corridor, /cloud_cover_low,cloud_cover_mid,cloud_cover_high/);
});

test("sceneUrls 支持自定义历史回溯天数", () => {
  const urls = sceneUrls({ ...base, historyDays: 92 });
  assert.match(urls.wf, /past_days=92/);
});

test("nextSunUrl 优先返回首个未尝试的 NASA 图源", () => {
  assert.equal(nextSunUrl([]), NASA_SUN_URLS[0]);
});

test("nextSunUrl 已尝试首个后返回备选图源", () => {
  assert.equal(nextSunUrl([NASA_SUN_URLS[0]]), NASA_SUN_URLS[1]);
});

test("nextSunUrl 全部尝试后返回 null", () => {
  assert.equal(nextSunUrl([...NASA_SUN_URLS]), null);
});

test("NASA_SUN_URLS 首选 HMI 白光日面（肉眼可见的真实太阳）", () => {
  assert.match(NASA_SUN_URLS[0], /HMIIF/);
});

test("NASA_SUN_URLS 均为 https 实时图源且含备选", () => {
  assert.ok(NASA_SUN_URLS.length >= 2);
  for (const u of NASA_SUN_URLS) assert.match(u, /^https:\/\//);
});
