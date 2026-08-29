import { NextRequest, NextResponse } from "next/server";
import { forecastUpdateAt, sceneUrls } from "../../scene-urls";
import { averageModels } from "../../cloud-render";

const R = 6371;
function destination(lat: number, lon: number, bearing: number, km: number) {
  const p1 = (lat * Math.PI) / 180,
    l1 = (lon * Math.PI) / 180,
    b = (bearing * Math.PI) / 180,
    d = km / R;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return [(p2 * 180) / Math.PI, (((l2 * 180) / Math.PI + 540) % 360) - 180];
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams,
    lat = Number(q.get("lat")),
    lon = Number(q.get("lon")),
    bearing = Number(q.get("bearing") || 275);
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    return NextResponse.json({ error: "invalid coordinates" }, { status: 400 });
  const depths = [2, 8, 18, 32, 48, 65, 82],
    laterals = [-18, -9, 0, 9, 18],
    points: number[][] = [];
  for (const depth of depths)
    for (const lateral of laterals) {
      const center = destination(lat, lon, bearing, depth),
        p = destination(center[0], center[1], bearing + 90, lateral);
      points.push(p);
    }
  const lats = points.map((p) => p[0].toFixed(5)).join(","),
    lons = points.map((p) => p[1].toFixed(5)).join(",");
  const corridorDistances = [0, 80, 160, 240, 320, 400, 520, 640];
  const corridorPoints = corridorDistances.map((km) =>
    destination(lat, lon, bearing, km),
  );
  const corridorLats = corridorPoints.map((p) => p[0].toFixed(5)).join(",");
  const corridorLons = corridorPoints.map((p) => p[1].toFixed(5)).join(",");
  const {
    wf: forecast,
    dem: elevation,
    vis: visibility,
    air,
    corridor,
    ens,
  } = sceneUrls({ lat, lon, lats, lons, corridorLats, corridorLons });
  try {
    const [wfResult, demResult, visResult, aqResult, corResult, ensResult] =
      await Promise.allSettled([
        fetch(forecast),
        fetch(elevation),
        fetch(visibility),
        fetch(air),
        fetch(corridor),
        fetch(ens),
      ]);
    if (wfResult.status !== "fulfilled" || !wfResult.value.ok)
      throw new Error(
        `forecast upstream ${
          wfResult.status === "fulfilled" ? wfResult.value.status : "offline"
        }`,
      );
    const weather = await wfResult.value.json();
    let elevations = Array(points.length).fill(weather.elevation || 0);
    if (demResult.status === "fulfilled" && demResult.value.ok) {
      const elevationData = await demResult.value.json();
      if (Array.isArray(elevationData.elevation))
        elevations = elevationData.elevation;
    }
    let comparison = null;
    if (visResult.status === "fulfilled" && visResult.value.ok) {
      const v = await visResult.value.json();
      comparison = v;
      weather.hourly.visibility = v.hourly?.visibility || [];
    }
    if (aqResult.status === "fulfilled" && aqResult.value.ok) {
      const a = await aqResult.value.json();
      weather.hourly.aerosol_optical_depth =
        a.hourly?.aerosol_optical_depth || [];
      weather.hourly.pm2_5 = a.hourly?.pm2_5 || [];
    }
    if (ensResult.status === "fulfilled" && ensResult.value.ok) {
      const eh = (await ensResult.value.json())?.hourly;
      if (eh) {
        weather.hourly.cloud_cover_low = averageModels(eh.cloud_cover_low, 0);
        weather.hourly.cloud_cover_mid = averageModels(eh.cloud_cover_mid, 0);
        weather.hourly.cloud_cover_high = averageModels(eh.cloud_cover_high, 0);
      }
    }
    const corridorData =
      corResult.status === "fulfilled" && corResult.value.ok
        ? await corResult.value.json()
        : [];
    const grid = depths.map((_, di) =>
      laterals.map((__, li) => elevations[di * laterals.length + li]),
    );
    const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      bbox = `${lon - 4},${lat - 3},${lon + 4},${lat + 3}`;
    const satellite = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&STYLES=&FORMAT=image/jpeg&TRANSPARENT=false&HEIGHT=300&WIDTH=420&SRS=EPSG:4326&BBOX=${bbox}&TIME=${d}`;
    return NextResponse.json(
      {
        weather,
        comparison,
        dem: { grid, depths, laterals, source: "Open-Meteo 90m DEM" },
        corridor: {
          distances: corridorDistances,
          forecasts: Array.isArray(corridorData) ? corridorData : [],
        },
        satellite,
        updated: new Date().toISOString(),
        modelUpdate: forecastUpdateAt(new Date()).toISOString(),
      },
      { headers: { "Cache-Control": "public, max-age=900" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "data unavailable" },
      { status: 502 },
    );
  }
}
