// 发信号输入校验 + uvp-client core 构造 calldata：bytes32/attribution JSON/
// idempotencyKey；不做网络。attribution 只解析 stageId + proof[]（proof 语义不解析），
// 其余字段由表单的 sourceId/signalId 填充；submitSignal 的 ABI/参数编码、
// patchHash 计算与空签名直发（submitter = 钱包）不在本文件复制。

import type { Address } from "viem";
import {
  buildSubmitStateMachineSignalCall,
  type SubmitStateMachineSignalCall
} from "@uvp-eth/uvp-client/core";

export type Bytes32 = `0x${string}`;

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

export interface Attribution {
  readonly stageId: Bytes32;
  readonly proof: readonly Bytes32[];
}

export interface SignalFormInput {
  readonly planId: string;
  readonly orderId: string;
  readonly sourceId: string;
  readonly signalId: string;
  readonly payloadHash: string;
  readonly idempotencyKey?: string | undefined;
  readonly attributionRaw?: string | undefined;
}

export interface SignalCallConfig {
  readonly stateMachine: Bytes32;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly submitter: Address;
}

export type FieldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly field: string; readonly message: string };

export function parseBytes32(raw: string, field: string): FieldResult<Bytes32> {
  const value = raw.trim();
  if (value === "") {
    return { ok: false, field, message: `${field} 不能为空` };
  }
  if (!BYTES32_PATTERN.test(value)) {
    return { ok: false, field, message: `${field} 必须是 0x + 64 hex` };
  }
  return { ok: true, value: value as Bytes32 };
}

export function parseAttributionJson(
  raw: string
): FieldResult<Attribution | undefined> {
  const value = raw.trim();
  if (value === "") {
    return { ok: true, value: undefined };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    return {
      ok: false,
      field: "attribution",
      message: `attribution 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, field: "attribution", message: "attribution 必须是 JSON 对象" };
  }
  const record = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => key !== "stageId" && key !== "proof"
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      field: "attribution",
      message: `attribution 不支持字段：${unknownKeys.join(", ")}（只接受 stageId/proof）`
    };
  }
  const stageId = parseBytes32(
    typeof record["stageId"] === "string" ? record["stageId"] : "",
    "attribution.stageId"
  );
  if (!stageId.ok) {
    return stageId;
  }
  const proofRaw = record["proof"];
  const proof: Bytes32[] = [];
  if (proofRaw !== undefined) {
    if (!Array.isArray(proofRaw)) {
      return { ok: false, field: "attribution.proof", message: "attribution.proof 必须是数组" };
    }
    for (let index = 0; index < proofRaw.length; index += 1) {
      const item = proofRaw[index];
      if (typeof item !== "string") {
        return {
          ok: false,
          field: `attribution.proof[${index}]`,
          message: "attribution.proof 每项必须是 0x + 64 hex"
        };
      }
      const parsedProof = parseBytes32(item, `attribution.proof[${index}]`);
      if (!parsedProof.ok) {
        return parsedProof;
      }
      proof.push(parsedProof.value);
    }
  }
  return { ok: true, value: { stageId: stageId.value, proof } };
}

export function randomBytes32(
  random: (bytes: Uint8Array) => Uint8Array = defaultRandom
): Bytes32 {
  const bytes = random(new Uint8Array(32));
  if (bytes.length !== 32) {
    throw new Error("random generator must return 32 bytes");
  }
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function buildSignalCall(
  config: SignalCallConfig,
  input: SignalFormInput
): FieldResult<SubmitStateMachineSignalCall> {
  const planId = parseBytes32(input.planId, "planId");
  if (!planId.ok) {
    return planId;
  }
  const orderId = parseBytes32(input.orderId, "orderId");
  if (!orderId.ok) {
    return orderId;
  }
  const sourceId = parseBytes32(input.sourceId, "sourceId");
  if (!sourceId.ok) {
    return sourceId;
  }
  const signalId = parseBytes32(input.signalId, "signalId");
  if (!signalId.ok) {
    return signalId;
  }
  const payloadHash = parseBytes32(input.payloadHash, "payloadHash");
  if (!payloadHash.ok) {
    return payloadHash;
  }

  const idempotencyRaw = (input.idempotencyKey ?? "").trim();
  let idempotencyKey: Bytes32;
  if (idempotencyRaw === "") {
    idempotencyKey = randomBytes32();
  } else {
    const parsed = parseBytes32(idempotencyRaw, "idempotencyKey");
    if (!parsed.ok) {
      return parsed;
    }
    idempotencyKey = parsed.value;
  }

  const attribution = parseAttributionJson(input.attributionRaw ?? "");
  if (!attribution.ok) {
    return attribution;
  }

  try {
    const call = buildSubmitStateMachineSignalCall(
      {
        stateMachineAddress: config.stateMachine,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl
      },
      {
        planId: planId.value,
        orderId: orderId.value,
        sourceId: sourceId.value,
        signalId: signalId.value,
        payloadHash: payloadHash.value,
        idempotencyKey,
        ...(attribution.value === undefined
          ? {}
          : {
              attribution: {
                sourceId: sourceId.value,
                signalId: signalId.value,
                stageId: attribution.value.stageId,
                capabilityProof: attribution.value.proof
              }
            })
      },
      config.submitter
    );
    return { ok: true, value: call };
  } catch (error) {
    return {
      ok: false,
      field: "signal",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export function mapWalletError(error: unknown): {
  readonly code: "user_rejected" | "reverted" | "network" | "unknown";
  readonly message: string;
} {
  const record =
    typeof error === "object" && error !== null
      ? (error as {
          readonly code?: unknown;
          readonly name?: unknown;
          readonly shortMessage?: unknown;
          readonly message?: unknown;
          readonly cause?: unknown;
        })
      : undefined;
  const code = record?.code;
  const name = record?.name;
  if (code === 4001 || name === "UserRejectedRequestError") {
    return { code: "user_rejected", message: "钱包拒绝了签名/交易" };
  }
  const detail = readErrorDetail(error);
  if (/revert|reverted|execution reverted/iu.test(detail)) {
    return { code: "reverted", message: detail };
  }
  if (/network|fetch|timeout|failed to fetch/iu.test(`${name ?? ""} ${detail}`)) {
    return { code: "network", message: detail };
  }
  return { code: "unknown", message: detail };
}

function readErrorDetail(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as {
      readonly shortMessage?: unknown;
      readonly message?: unknown;
      readonly cause?: unknown;
    };
    if (typeof record.shortMessage === "string" && record.shortMessage.trim() !== "") {
      return record.shortMessage;
    }
    if (typeof record.message === "string" && record.message.trim() !== "") {
      return record.message;
    }
    if (record.cause !== undefined) {
      return readErrorDetail(record.cause);
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function defaultRandom(bytes: Uint8Array): Uint8Array {
  if (typeof globalThis.crypto === "undefined") {
    throw new Error("crypto.getRandomValues is unavailable");
  }
  return globalThis.crypto.getRandomValues(bytes);
}

