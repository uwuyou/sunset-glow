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

const { forecastUpdateAt, sceneUrls, HISTORY_DAYS } =
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
