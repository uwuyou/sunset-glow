// GitHub Pages 静态版入口：直接把纯客户端页面组件挂载到 #root
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import Page from "../app/page";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}
