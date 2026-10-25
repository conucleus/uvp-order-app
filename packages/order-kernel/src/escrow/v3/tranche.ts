// V3 tranche 键：payer 参与 key，与合约 trancheIdFor 一致。服务端 binding
// 只认合法 payer 对应的 trancheId；外来自费 tranche 落在不同 key 上，不能
// 阻塞买方，settle 也只按传入的 trancheId 结算。

import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export function trancheIdFor(orderId: Hex, stageId: Hex, payer: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
      [orderId, stageId, payer]
    )
  );
}
