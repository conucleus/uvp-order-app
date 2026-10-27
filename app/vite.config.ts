// order-app Vite 配置：uvp-client core barrel 会带出 evidence 的 node:fs/promises
// import；浏览器 bundle 用空 readFile shim 隔离该 node-only 模块（真实文件读取只在
// Node/CLI 侧）。其余只保留 React 与 dev server 端口。

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function browserNodeFsShim(): Plugin {
  const id = "\0uvp-node-fs-promises-browser-shim";
  return {
    name: "uvp-node-fs-promises-browser-shim",
    enforce: "pre",
    resolveId(source) {
      return source === "node:fs/promises" ? id : undefined;
    },
    load(moduleId) {
      return moduleId === id
        ? "export async function readFile() { throw new Error('node:fs/promises is unavailable in the browser'); }"
        : undefined;
    }
  };
}

export default defineConfig({
  plugins: [browserNodeFsShim(), react()],
  server: {
    port: 4183
  }
});
