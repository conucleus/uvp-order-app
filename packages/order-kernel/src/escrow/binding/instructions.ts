// instructionRef 派生：A adapter 公式 keccak256(abi.encode(domain, planId, orderId, stageId))。
// 与 UVPFactSource.INSTRUCTION_REF_DOMAIN 和 chain-services settlement 同口径；纯函数，
// 不读环境、不接触私钥，供宿主在签名/核对前复算。

import { encodeAbiParameters, keccak256, type Hex } from "viem";

export const INSTRUCTION_REF_DOMAIN = "uvp.factsource.instruction.v1";

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

export interface ExpectedInstructionRefInput {
  readonly planId: string;
  readonly orderId: string;
  readonly stageId: string;
}

export function expectedInstructionRef(input: ExpectedInstructionRefInput): Hex {
  for (const field of ["planId", "orderId", "stageId"] as const) {
    if (!BYTES32_PATTERN.test(input[field])) {
      throw new Error(`${field} must be a 0x-prefixed 32-byte hex value`);
    }
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [INSTRUCTION_REF_DOMAIN, input.planId as Hex, input.orderId as Hex, input.stageId as Hex]
    )
  );
}
