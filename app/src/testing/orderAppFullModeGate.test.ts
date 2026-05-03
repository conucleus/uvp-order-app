import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOrderAppFullModeGate,
  isStubProductApiUrl,
  validateOrderAppFullModeGate
} from "./orderAppFullModeGate.js";

describe("Order App full-mode gate", () => {
  it("accepts explicit full mode with real Product API URL and flow summary", () => {
    const result = validateOrderAppFullModeGate({
      UVP_ORDER_APP_E2E_PROFILE: "full",
      VITE_PRODUCT_API_BASE_URL: "http://127.0.0.1:4100/",
      UVP_ORDER_APP_FULL_FLOW_SUMMARY: "/tmp/phase2-customs-full-flow-summary.json",
      VITE_UVP_RUNTIME_ENV: "testnet"
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.gate.productApiBaseUrl, "http://127.0.0.1:4100");
    assert.equal(result.ok && result.gate.flowSummaryPath, "/tmp/phase2-customs-full-flow-summary.json");
  });

  it("fails closed without Product API URL and flow summary", () => {
    const result = validateOrderAppFullModeGate({
      UVP_ORDER_APP_E2E_PROFILE: "full"
    });

    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.errors.join("\n"), /VITE_PRODUCT_API_BASE_URL/u);
    assert.match(result.ok ? "" : result.errors.join("\n"), /FLOW_SUMMARY/u);
  });

  it("rejects demo and API-stub inputs in full mode", () => {
    const result = validateOrderAppFullModeGate({
      UVP_ORDER_APP_E2E_PROFILE: "full",
      VITE_PRODUCT_API_BASE_URL: "http://product-api.test",
      UVP_ORDER_APP_FULL_FLOW_SUMMARY: "/tmp/summary.json",
      VITE_UVP_ORDER_APP_DEMO: "1",
      UVP_ORDER_APP_E2E_INSTALL_API_STUB: "1"
    });

    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.errors.join("\n"), /API-stub Product API URL/u);
    assert.match(result.ok ? "" : result.errors.join("\n"), /VITE_UVP_ORDER_APP_DEMO=1/u);
    assert.match(result.ok ? "" : result.errors.join("\n"), /UVP_ORDER_APP_E2E_INSTALL_API_STUB=1/u);
  });

  it("requires the full profile when evaluating full-mode evidence", () => {
    assert.throws(
      () => assertOrderAppFullModeGate({
        UVP_ORDER_APP_E2E_PROFILE: "api-stub",
        VITE_PRODUCT_API_BASE_URL: "http://127.0.0.1:4100",
        UVP_ORDER_APP_FULL_FLOW_SUMMARY: "/tmp/summary.json"
      }),
      /UVP_ORDER_APP_E2E_PROFILE must be full/u
    );
  });

  it("identifies known stub-style Product API URLs", () => {
    assert.equal(isStubProductApiUrl("http://product-api.test"), true);
    assert.equal(isStubProductApiUrl("https://api-stub.local"), true);
    assert.equal(isStubProductApiUrl("stub-offchain://orders"), true);
    assert.equal(isStubProductApiUrl("http://127.0.0.1:4100"), false);
    assert.equal(isStubProductApiUrl("https://staging.example.com/product"), false);
  });
});
