/* 相对方合意的失败文案：合意签名消息本身由 @uvp-eth/product-dto 单源导出、
 * 随要求包读面下发，本模块不自拼消息格式；只把服务端错误码映射为参与者
 * 可读的失败原因，密钥/凭据不进入 UI 或状态。
 */
import { ProductApiError } from "../api/productApi";

/**
 * 合意失败按服务端错误码给因：无权限/非相对方、hash 已变、未声明、
 * 签名不符、会话问题分别呈现，不把失败说成成功。
 */
export function consentFailureCopy(error: unknown): string {
  if (!(error instanceof ProductApiError)) {
    return error instanceof Error ? error.message : "合意失败，请重试。";
  }
  switch (error.errorCode) {
    case "not_a_counterparty":
      return "只有已接受邀请的相对方可以合意（not_a_counterparty）；开单人不能对自己的要求包合意。";
    case "requirements_hash_mismatch":
      return "要求包已变更（requirements_hash_mismatch）：请刷新后对新 hash 重新签名。";
    case "requirements_not_found":
      return "该草稿尚未声明要求包（requirements_not_found），无法合意。";
    case "consent_signature_invalid":
      return "签名未通过校验（consent_signature_invalid：与当前要求包不符），请重新签名。";
    case "draft_access_denied":
      return "当前钱包无权读取或合意该要求包（draft_access_denied）。";
    case "wallet_identity_required":
      return "需要钱包登录后才能合意。";
    case "wrong_wallet":
      return "钱包会话地址与签名钱包不一致，请重新登录。";
    case "invalid_body":
      return `合意参数被服务端拒绝（invalid_body）：${error.message}`;
    default:
      return error.errorCode
        ? `合意失败（${error.errorCode}）：${error.message}`
        : `合意失败：${error.message}`;
  }
}
