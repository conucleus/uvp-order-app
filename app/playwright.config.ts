import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import {
  assertOrderAppFullModeGate,
  isProductionLikeRuntime
} from "./src/testing/orderAppFullModeGate";

const host = "127.0.0.1";
const port = process.env.UVP_ORDER_APP_E2E_PORT ?? "4183";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`;
const profile = (process.env.UVP_ORDER_APP_E2E_PROFILE ?? "demo").trim().toLowerCase();
const includeMobile = process.env.UVP_ORDER_APP_E2E_MOBILE === "1";
const runtimeProfile = (
  process.env.VITE_UVP_RUNTIME_ENV ??
  process.env.VITE_UVP_CHAIN_SERVICES_ENV ??
  process.env.VITE_CHAIN_SERVICES_ENV
)?.trim().toLowerCase();
const fullModeGate = profile === "full" ? assertOrderAppFullModeGate(process.env) : undefined;

if (
  isProductionLikeRuntime(runtimeProfile) &&
  (profile === "demo" || profile === "api-stub" || process.env.VITE_UVP_ORDER_APP_DEMO === "1")
) {
  throw new Error("production-like Order App E2E runtime cannot enable demo fixtures or API stubs");
}
if (fullModeGate && !existsSync(fullModeGate.flowSummaryPath)) {
  throw new Error(`Order App full-mode flow summary does not exist: ${fullModeGate.flowSummaryPath}`);
}

function webServerCommand(): string {
  if (profile === "fail-closed") {
    return `pnpm dev --host ${host} --port ${port} --strictPort`;
  }
  if (profile === "api-stub") {
    return `VITE_PRODUCT_API_BASE_URL=http://product-api.test pnpm dev --host ${host} --port ${port} --strictPort`;
  }
  if (profile === "full") {
    return `pnpm dev --host ${host} --port ${port} --strictPort`;
  }
  return `pnpm dev:demo --host ${host} --port ${port} --strictPort`;
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
    },
    ...(includeMobile
      ? [
          {
            name: "mobile-smoke",
            use: {
              ...devices["Pixel 5"]
            }
          }
        ]
      : [])
  ]
});
