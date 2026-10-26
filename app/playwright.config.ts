// e2e 配置：两个 profile——fail-closed（未配置参与者服务）与 configured
// （指向假服务地址，渲染登录门与工作台外壳）。两者都不启动真实后端。

import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = process.env.UVP_ORDER_APP_E2E_PORT ?? "4183";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`;
const profile = (process.env.UVP_ORDER_APP_E2E_PROFILE ?? "fail-closed").trim().toLowerCase();

if (profile !== "fail-closed" && profile !== "configured") {
  throw new Error(`Unsupported UVP_ORDER_APP_E2E_PROFILE "${profile}". Use "fail-closed" or "configured".`);
}

function webServerCommand(): string {
  const dev = `pnpm dev --host ${host} --port ${port} --strictPort`;
  if (profile === "fail-closed") {
    return dev;
  }
  return `VITE_UVP_CHAIN_SERVICES_URL=http://product-api.test ${dev}`;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 6_000
  },
  use: {
    baseURL,
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: webServerCommand(),
        url: baseURL,
        reuseExistingServer: process.env.UVP_ORDER_APP_E2E_REUSE_SERVER === "1",
        timeout: 90_000
      },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
