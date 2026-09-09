import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages 静态构建：把纯客户端应用打包成可静态托管的产物。
// 注意：静态版没有 /api/scene 服务端代理，页面会自动降级为直连 Open-Meteo 拉数据。
export default defineConfig({
  root: "static",
  base: "/sunset-glow/",
  publicDir: "../public",
  plugins: [react()],
  define: {
    // 静态托管标记：跳过 /api/scene 代理请求，直接浏览器直连 Open-Meteo
    __STATIC__: JSON.stringify(true),
  },
  build: {
    outDir: "../pages-dist",
    emptyOutDir: true,
  },
});
