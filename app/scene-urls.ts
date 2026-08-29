// 数值预报相关的纯逻辑：ECMWF 更新时次计算与带历史回溯的取数 URL 构建。
// 供 app/api/scene/route.ts 与 app/page.tsx（直连降级）共用，保持单一事实来源。

// 历史回溯天数：预报日期可选择过去的最近 30 天（Open-Meteo 支持最多 92 天）。
export const HISTORY_DAYS = 30;

// NASA SDO 实时太阳图源（约每 15 分钟更新一张；官方允许热链，但无 CORS 头，
// 仅用于画布 drawImage 显示）。首个为经典的 0304 极紫外假色，备选为连续光谱白光日面。
export const NASA_SUN_URLS = [
  "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0304.jpg",
  "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIIF.jpg",
];

// 返回下一个未尝试过的 NASA 图源；全部失败后返回 null（调用方回退到程序化太阳）。
export function nextSunUrl(tried: string[]): string | null {
  return NASA_SUN_URLS.find((u) => !tried.includes(u)) ?? null;
}

// ECMWF IFS 数值预报每 6 小时更新一个时次（00/06/12/18 UTC）。
// 数据更新时间跟随数值预报的结果：回落到 now 之前最近一次已发布的模型时次。
export function forecastUpdateAt(now: Date): Date {
  const utc = new Date(now.getTime());
  utc.setUTCHours(Math.floor(utc.getUTCHours() / 6) * 6, 0, 0, 0);
  return utc;
}

export type SceneUrls = {
  wf: string;
  dem: string;
  vis: string;
  air: string;
  corridor: string;
};

export function sceneUrls(params: {
  lat: number;
  lon: number;
  lats: string;
  lons: string;
  corridorLats: string;
  corridorLons: string;
  historyDays?: number;
}): SceneUrls {
  const historyDays = params.historyDays ?? HISTORY_DAYS,
    { lat, lon, lats, lons, corridorLats, corridorLons } = params,
    query = `timezone=Asia%2FShanghai&forecast_days=7&past_days=${historyDays}`,
    cloudVars = "cloud_cover_low,cloud_cover_mid,cloud_cover_high",
    wfVars =
      `${cloudVars},direct_radiation,diffuse_radiation,boundary_layer_height,` +
      "geopotential_height_850hPa,geopotential_height_500hPa,geopotential_height_250hPa";
  return {
    wf: `https://api.open-meteo.com/v1/ecmwf?latitude=${lat}&longitude=${lon}&hourly=${wfVars}&daily=sunrise,sunset&${query}`,
    dem: `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`,
    vis: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=visibility,${cloudVars},precipitation,cape,wind_speed_500hPa,wind_direction_500hPa&${query}`,
    air: `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=aerosol_optical_depth,pm2_5&${query}`,
    corridor: `https://api.open-meteo.com/v1/ecmwf?latitude=${corridorLats}&longitude=${corridorLons}&hourly=${cloudVars}&${query}`,
  };
}
