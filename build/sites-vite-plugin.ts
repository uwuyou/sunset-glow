// 本地开发环境的 Sites 插件。
// 生产环境由 OpenAI Sites 托管平台在构建期注入本模块；本地开发时，
// 直接转发官方包 @openai/sites-vite-plugin，行为与平台完全一致：
//  - vite build：把 .openai/hosting.json 与 drizzle/** 打包进 dist/.openai/
//  - vite dev：在 localhost 提供模拟的「Sign in with ChatGPT」
//    （/signin-with-chatgpt?return_to=/ 登录，/signout-with-chatgpt?return_to=/ 退出）
export { sites } from "@openai/sites-vite-plugin";
