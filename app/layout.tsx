import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata:Metadata={title:"霞光三维场景",description:"真实数据混合的朝霞晚霞三维摄影模拟器",icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"}};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}
