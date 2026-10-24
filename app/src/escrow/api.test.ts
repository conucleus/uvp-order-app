import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProductApiError, createProductApiClient, type ProductApiClientOptions } from "../api/productApi.js";

const orderId = `0x${"11".repeat(32)}`;
const stageId = `0x${"33".repeat(32)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("order app escrow API boundary", () => {
  it("treats an empty tranche list as empty and surfaces the stage 404 code", async () => {
    const requested: string[] = [];
    const fetcher: ProductApiClientOptions["fetcher"] = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith(`/escrow/${stageId}`)) {
        return jsonResponse({ error: "escrow_tranche_not_found" }, 404);
      }
      return jsonResponse({ orderId, tranches: [] });
    };
    const client = createProductApiClient({ baseUrl: "http://service.local", fetcher });

    assert.deepEqual(await client.getOrderEscrow(orderId), { orderId, tranches: [] });
    await assert.rejects(
      client.getOrderEscrow(orderId, stageId),
      (error: unknown) =>
        error instanceof ProductApiError &&
        error.status === 404 &&
        error.errorCode === "escrow_tranche_not_found"
    );
    assert.equal(requested[0], `http://service.local/product/orders/${orderId}/escrow`);
    assert.equal(requested[1], `http://service.local/product/orders/${orderId}/escrow/${stageId}`);
  });
});
