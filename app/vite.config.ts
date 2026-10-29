// order-app Vite 配置：React 入口 + dev server 端口；业务/协议依赖来自
// @uvp-eth/uvp-client（core/browser 均无 node-only 导入，浏览器 bundle 不需要
// node 能力 shim）。

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4183
  }
});
