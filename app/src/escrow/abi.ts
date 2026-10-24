// StageEscrow 动作与读视图 ABI：函数/自定义错误逐条镜像
// uvp-periphery/smart_contracts/escrow/src/StageEscrow.sol（合约是唯一
// 语义源）；本文件只供前端编码调用与解码 revert，不新增合约语义。

import { parseAbi } from "viem";

export const STAGE_ESCROW_ABI = parseAbi([
  "function approve(bytes32 trancheId)",
  "function reject(bytes32 trancheId)",
  "function payNow(bytes32 trancheId)",
  "function refundByPayer(bytes32 trancheId)",
  "function refundByPayee(bytes32 trancheId)",
  "function suspend(bytes32 trancheId)",
  "function consentSettlement(bytes32 trancheId, uint256 payerAmount, uint256 payeeAmount)",
  "function getTranche(bytes32 trancheId) view returns ((address payer, address payee, address verifier, address feeRecipient, uint256 amount, uint32 observationDays, uint16 feeBps, uint64 approvedAt, uint64 rejectedAt, uint8 state, (uint256 payerAmount, uint256 payeeAmount, bool submitted) payerAllocation, (uint256 payerAmount, uint256 payeeAmount, bool submitted) payeeAllocation))",
  "error TrancheNotFound(bytes32 trancheId)",
  "error TrancheAlreadyExists(bytes32 trancheId)",
  "error InvalidTrancheState(bytes32 trancheId, uint8 actual)",
  "error NotVerifier(address caller, address verifier)",
  "error NotPayer(address caller, address payer)",
  "error NotPayee(address caller, address payee)",
  "error NotPayerOrPayee(address caller)",
  "error ReleaseNotYetAvailable(bytes32 trancheId, uint64 releaseTime)",
  "error RejectionWindowClosed(bytes32 trancheId, uint64 refundTime)",
  "error RefundWindowNotElapsed(bytes32 trancheId, uint64 refundTime)",
  "error InvalidSettlement(uint256 payerAmount, uint256 payeeAmount, uint256 amount)",
  "error TokenTransferFailed()",
  "error Reentrancy()"
]);
