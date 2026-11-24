// 链身份与签名前计划身份：读面必须先钉 eth_chainId（错链不得返回“不存在/空”），
// 写面前先重读钱包链并确认目标地址有代码；commitPlan 前必须用链上 planIdFor/
// planRuntimeHash 派生并核对 artifact 身份，否则会留下孤儿 finalized plan。

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import test from "node:test";
import type { Address, Hex } from "viem";
import { buildSubmitStateMachineSignalCall } from "@uvp-eth/uvp-client/core";
import type { Eip1193Provider } from "@uvp-eth/uvp-client/browser";
import { createChainReader, submitSignal } from "./client";
import type { ChainConfig } from "./config";
import {
  parseCompiledPlanArtifact,
  planRegistrationHashesOf,
  resolveRegistrationPlanId
} from "./plan";

const H = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const WALLET = `0x${"ab".repeat(20)}` as Address;
const STATE_MACHINE = `0x${"ef".repeat(20)}` as Address;
const PLAN = H(0x11);
const ORDER = H(0x12);
const TX = H(0xaa);
const BLOCK = H(0xbb);

type RpcResult = string | Record<string, unknown> | readonly unknown[] | null;

interface RpcServer {
  readonly url: string;
  readonly methods: string[];
  close(): Promise<void>;
}

async function rpcServer(results: Readonly<Record<string, RpcResult>>): Promise<RpcServer> {
  const methods: string[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      const payload = JSON.parse(body) as { readonly id?: unknown; readonly method?: string };
      const method = payload.method ?? "";
      methods.push(method);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: results[method] ?? "0x"
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("rpc test server did not bind a port");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    methods,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))))
  };
}

function chainConfig(rpcUrl: string): ChainConfig {
  return {
    stateMachine: STATE_MACHINE,
    chainId: 31_337,
    rpcUrl,
    fromBlock: 0n,
    chunkSize: 50_000n
  };
}

function walletProvider(chainId: string): {
  readonly provider: Eip1193Provider;
  readonly sent: unknown[];
} {
  const sent: unknown[] = [];
  return {
    sent,
    provider: {
      request: async (args) => {
        if (args.method === "eth_chainId") {
          return chainId;
        }
        if (args.method === "eth_sendTransaction") {
          sent.push(args.params);
          return TX;
        }
        throw new Error(`unexpected wallet method ${args.method}`);
      }
    }
  };
}

const signalCall = buildSubmitStateMachineSignalCall(
  { stateMachineAddress: STATE_MACHINE, chainId: 31_337, rpcUrl: "http://127.0.0.1:1" },
  {
    planId: PLAN,
    orderId: ORDER,
    sourceId: H(0x21),
    signalId: H(0x22),
    payloadHash: H(0x23),
    idempotencyKey: H(0x24),
    deadline: 1n << 40n
  },
  WALLET
);

test("读面先钉 RPC eth_chainId：错链直接拒绝，不发 eth_call、不返回假的“不存在”", async (t) => {
  const rpc = await rpcServer({
    eth_chainId: "0x14a34",
    eth_call: "0x"
  });
  t.after(async () => {
    await rpc.close();
  });

  const result = await createChainReader(chainConfig(rpc.url)).readOrder(PLAN, ORDER);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "wrong_chain");
  assert.match(result.failure.message, /31337/u);
  assert.match(result.failure.message, /84532|14a34/u);
  assert.equal(rpc.methods.includes("eth_call"), false);
});

test("读面在链 ID 匹配后照常返回链上事实（不把校验变成新的失败面）", async (t) => {
  const rpc = await rpcServer({
    eth_chainId: "0x7a69",
    eth_call: H(0)
  });
  t.after(async () => {
    await rpc.close();
  });

  const result = await createChainReader(chainConfig(rpc.url)).readOrder(PLAN, ORDER);

  assert.deepEqual(result, { ok: true, value: { planExists: false, orderExists: false } });
  assert.equal(rpc.methods.includes("eth_call"), true);
});

test("写面前重读钱包 eth_chainId：连接后切链会拦截，不广播交易", async () => {
  const wallet = walletProvider("0x14a34");
  const result = await submitSignal(
    chainConfig("http://127.0.0.1:1"),
    { address: WALLET, provider: wallet.provider, chainId: 31_337 },
    signalCall
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "wrong_chain");
  assert.equal(wallet.sent.length, 0);
});

test("无代码地址在发送前被具名拒绝，不会产生“成功空转账”", async (t) => {
  const rpc = await rpcServer({
    eth_chainId: "0x7a69",
    eth_getCode: "0x",
    eth_call: "0x"
  });
  t.after(async () => {
    await rpc.close();
  });
  const wallet = walletProvider("0x7a69");
  const result = await submitSignal(
    chainConfig(rpc.url),
    { address: WALLET, provider: wallet.provider, chainId: 31_337 },
    signalCall
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "contract_missing");
  assert.equal(wallet.sent.length, 0);
});

test("回执成功但没有匹配 SignalSubmitted 事件时不得报告已上链", async (t) => {
  const rpc = await rpcServer({
    eth_chainId: "0x7a69",
    eth_getCode: "0x6001600055",
    eth_call: "0x",
    eth_blockNumber: "0x2",
    eth_getBlockByNumber: {
      number: "0x1",
      hash: BLOCK,
      parentHash: H(0xbc),
      nonce: "0x0000000000000000",
      sha3Uncles: H(0xbd),
      logsBloom: `0x${"0".repeat(512)}`,
      transactionsRoot: H(0xbe),
      stateRoot: H(0xbf),
      receiptsRoot: H(0xc0),
      miner: WALLET,
      difficulty: "0x0",
      totalDifficulty: "0x0",
      extraData: "0x",
      size: "0x1",
      gasLimit: "0x1c9c380",
      gasUsed: "0x1",
      timestamp: "0x1",
      transactions: [],
      uncles: [],
      baseFeePerGas: "0x1",
      mixHash: H(0xc1)
    },
    eth_getTransactionReceipt: {
      transactionHash: TX,
      transactionIndex: "0x0",
      blockHash: BLOCK,
      blockNumber: "0x1",
      from: WALLET,
      to: STATE_MACHINE,
      cumulativeGasUsed: "0x1",
      gasUsed: "0x1",
      contractAddress: null,
      logs: [],
      logsBloom: `0x${"0".repeat(512)}`,
      status: "0x1",
      effectiveGasPrice: "0x1",
      type: "0x2"
    }
  });
  t.after(async () => {
    await rpc.close();
  });
  const wallet = walletProvider("0x7a69");
  const result = await submitSignal(
    chainConfig(rpc.url),
    { address: WALLET, provider: wallet.provider, chainId: 31_337 },
    signalCall
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "signal_event_missing");
  assert.equal(result.failure.txHash, TX);
  assert.equal(wallet.sent.length, 1);
});

const CONTENT_PLAN_ID = H(0x31);
const REGISTRATION_PLAN_ID = H(0x32);
const RUNTIME_PLAN_HASH = H(0x33);

function resolution(overrides: Partial<Parameters<typeof resolveRegistrationPlanId>[0]> = {}) {
  return resolveRegistrationPlanId({
    declaredRuntimePlanHash: RUNTIME_PLAN_HASH,
    derivedRuntimePlanHash: RUNTIME_PLAN_HASH,
    derivedRegistrationPlanId: REGISTRATION_PLAN_ID,
    ...overrides
  });
}

test("artifact 用 content planId 标注时，签名前解析成 publisher 的注册 planId", () => {
  const resolved = resolution({ onchainPlanId: CONTENT_PLAN_ID });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value, REGISTRATION_PLAN_ID);
});

test("registerArgs 的 hashes 与链上 planRuntimeHash 不一致时不签名 commitPlan", () => {
  const wrong = resolution({ derivedRuntimePlanHash: H(0x35) });
  assert.equal(wrong.ok, false);
  if (wrong.ok) return;
  assert.equal(wrong.code, "plan_hash_mismatch");
});

function artifactText(overrides: {
  readonly topPlanId?: string;
  readonly sourcePlanId?: string;
  readonly onchainPlanId?: string;
} = {}): string {
  return JSON.stringify({
    definition: { apiVersion: "uvp/zhixu/v1", kind: "Zhixu", metadata: {}, spec: { stages: [] } },
    onchain: {
      ...(overrides.onchainPlanId === undefined ? {} : { planId: overrides.onchainPlanId }),
      compiledHooks: [
        {
          hookId: H(1),
          stageId: H(2),
          stageIdentifier: "birth",
          hookName: "req",
          kind: "receive",
          orderTriggerKind: "trigger",
          dependencies: []
        }
      ],
      triggers: [
        {
          hookId: H(1),
          stageIdentifier: "birth",
          stageId: H(2),
          hookName: "req",
          orderTriggerKind: "trigger",
          source: "platform",
          signalName: "birth.req",
          sourceId: H(3),
          signalId: H(4)
        }
      ],
      signalCapabilities: [],
      selectorBindings: [],
      supplierBindings: [
        { stageIdentifier: "birth", stageId: H(2), supplierID: "supplier", supplierId: H(5), kind: 0 }
      ],
      supplierBindingsRoot: H(6)
    },
    registerArgs: {
      schemaVersion: "uvp.onchainHookPlan.v1",
      sourcePlanId: overrides.sourcePlanId ?? H(0x31),
      zhixuId: "used-car/step@1",
      planHash: H(0x33),
      artifactHash: H(7),
      hooksHash: H(8),
      capabilitiesRoot: H(9),
      supplierBindingsRoot: H(6),
      fileWritersHash: H(10),
      fileWriters: [],
      hooks: [
        {
          hookId: H(1),
          stageId: H(2),
          hookName: H(11),
          flags: 4,
          instructions: [],
          dependencyKeys: [H(12)]
        }
      ],
      supplierBindings: [{ stageId: H(2), supplierId: H(5), kind: 0 }]
    },
    planId: overrides.topPlanId ?? H(0x31)
  });
}

test("artifact 解析要求 registerArgs.sourcePlanId / planHash，缺字段即具名拒绝", () => {
  const missingSource = parseCompiledPlanArtifact(artifactText({ sourcePlanId: "" }));
  assert.equal(missingSource.ok, false);
  if (!missingSource.ok) assert.match(missingSource.message, /sourcePlanId/u);

  const parsed = parseCompiledPlanArtifact(artifactText({ onchainPlanId: H(0x31) }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.onchainPlanId, H(0x31));

  const hashes = planRegistrationHashesOf(parsed.value);
  assert.equal(hashes.ok, true);
  if (!hashes.ok) return;
  assert.equal(hashes.value.planHash, H(0x33));
  assert.equal(hashes.value.capabilitiesRoot, H(9));
});
