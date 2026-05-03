export const orderAppFullModeRequiredEvents = [
  "StageExecutorPatchApplied",
  "StageExecutorActivated",
  "StageResourcePatchApplied",
  "SignalSubmitted"
] as const;

export type OrderAppFullModeEventName = typeof orderAppFullModeRequiredEvents[number];

export interface OrderAppFullModeEnv {
  readonly UVP_ORDER_APP_E2E_PROFILE?: string;
  readonly UVP_ORDER_APP_E2E_INSTALL_API_STUB?: string;
  readonly UVP_ORDER_APP_E2E_USE_API_STUB?: string;
  readonly UVP_ORDER_APP_API_STUB?: string;
  readonly UVP_ORDER_APP_FULL_FLOW_SUMMARY?: string;
  readonly UVP_ORDER_APP_BROWSER_E2E_FLOW_SUMMARY?: string;
  readonly VITE_PRODUCT_API_BASE_URL?: string;
  readonly VITE_UVP_CHAIN_SERVICES_URL?: string;
  readonly VITE_UVP_ORDER_APP_DEMO?: string;
  readonly VITE_UVP_RUNTIME_ENV?: string;
  readonly VITE_UVP_CHAIN_SERVICES_ENV?: string;
  readonly VITE_CHAIN_SERVICES_ENV?: string;
}

export interface OrderAppFullModeGate {
  readonly productApiBaseUrl: string;
  readonly flowSummaryPath: string;
  readonly runtimeProfile?: string;
}

export function assertOrderAppFullModeGate(env: OrderAppFullModeEnv): OrderAppFullModeGate {
  const result = validateOrderAppFullModeGate(env);
  if (!result.ok) {
    throw new Error(`Order App full-mode gate failed:\n- ${result.errors.join("\n- ")}`);
  }
  return result.gate;
}

export type OrderAppFullModeGateResult =
  | {
      readonly ok: true;
      readonly gate: OrderAppFullModeGate;
      readonly errors: readonly [];
    }
  | {
      readonly ok: false;
      readonly errors: readonly string[];
    };

export function validateOrderAppFullModeGate(env: OrderAppFullModeEnv): OrderAppFullModeGateResult {
  const errors: string[] = [];
  const productApiBaseUrl = firstConfigured(env.VITE_PRODUCT_API_BASE_URL, env.VITE_UVP_CHAIN_SERVICES_URL);
  const flowSummaryPath = firstConfigured(
    env.UVP_ORDER_APP_FULL_FLOW_SUMMARY,
    env.UVP_ORDER_APP_BROWSER_E2E_FLOW_SUMMARY
  );
  const runtimeProfile = normalizeRuntimeProfile(
    env.VITE_UVP_RUNTIME_ENV ?? env.VITE_UVP_CHAIN_SERVICES_ENV ?? env.VITE_CHAIN_SERVICES_ENV
  );

  if (normalizeProfile(env.UVP_ORDER_APP_E2E_PROFILE) !== "full") {
    errors.push("UVP_ORDER_APP_E2E_PROFILE must be full");
  }
  if (!productApiBaseUrl) {
    errors.push("full mode requires VITE_PRODUCT_API_BASE_URL or VITE_UVP_CHAIN_SERVICES_URL");
  } else if (isStubProductApiUrl(productApiBaseUrl)) {
    errors.push(`full mode cannot use demo/API-stub Product API URL: ${productApiBaseUrl}`);
  }
  if (!flowSummaryPath) {
    errors.push("full mode requires UVP_ORDER_APP_FULL_FLOW_SUMMARY or UVP_ORDER_APP_BROWSER_E2E_FLOW_SUMMARY");
  }
  if (env.VITE_UVP_ORDER_APP_DEMO === "1") {
    errors.push("full mode cannot run with VITE_UVP_ORDER_APP_DEMO=1");
  }
  const stubFlags = [
    "UVP_ORDER_APP_E2E_INSTALL_API_STUB",
    "UVP_ORDER_APP_E2E_USE_API_STUB",
    "UVP_ORDER_APP_API_STUB"
  ] as const;
  for (const name of stubFlags) {
    if (env[name] === "1") {
      errors.push(`full mode cannot run with ${name}=1`);
    }
  }

  if (errors.length > 0 || !productApiBaseUrl || !flowSummaryPath) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    gate: {
      productApiBaseUrl: trimTrailingSlash(productApiBaseUrl),
      flowSummaryPath,
      ...(runtimeProfile ? { runtimeProfile } : {})
    },
    errors: []
  };
}

export function isProductionLikeRuntime(runtime: string | undefined): boolean {
  const normalized = normalizeRuntimeProfile(runtime);
  return normalized === "production" || normalized === "staging" || normalized === "testnet";
}

export function isStubProductApiUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return true;
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "product-api.test" || hostname.endsWith(".product-api.test")) {
    return true;
  }
  return /\b(api-stub|stub|fixture|demo)\b/u.test(hostname);
}

function firstConfigured(...values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function normalizeProfile(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeRuntimeProfile(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}
