import { isWalletIdentityRequired, ProductApiError } from "../api/productApi";
import { InjectedWalletError } from "../wallet/injectedWallet";

const ERROR_CODE_MESSAGES: Readonly<Record<string, string>> = {
  required_participant_missing: "还有必填参与方没有完成确认。请先生成邀请、等待对方确认，再刷新参与方状态。",
  trigger_executor_not_accepted: "开单确认人还没有完成本订单的角色确认，暂时不能创建订单。",
  trigger_submitter_not_authorized: "当前身份不是本订单的开单确认人，不能由这个身份创建订单。",
  create_order_trigger_missing: "这条秩序没有声明开单入口，暂时不能在这里开单。",
  draft_not_ready: "订单还没有就绪（可能仍有参与方未确认）。请刷新参与方状态后再创建。",
  draft_not_editable: "订单已进入创建流程，内容不能再修改。",
  trigger_already_exists: "这张订单已经发起过创建，请到订单页查看结果，不要重复创建。",
  trigger_retry_payload_changed: "本次内容与上次失败记录不一致，不能复用同一订单重新创建；请重新生成订单内容。",
  trigger_record_incomplete: "上次创建记录不完整，无法继续；请到订单页核对，或重新生成订单内容。",
  invalid_trigger_signature: "本人确认没有通过校验，订单未创建。",
  state_machine_deployment_missing: "当前部署尚未就绪，暂时不能创建订单。",
  no_active_version: "这条秩序当前没有可用的发布版本，暂时不能开单。",
  version_not_active: "这条秩序的发布版本已停用，暂时不能开单。",
  zhixu_not_found: "所选秩序已不可用，请重新选择。",
  draft_not_found: "订单内容已失效（可能已被清理），请重新生成。",
  invite_already_active: "该参与方已有有效邀请，请直接使用已生成的邀请链接，或等待其过期后再发。",
  role_already_filled: "该角色已经完成确认，无需再邀请。",
  invite_not_found: "邀请不存在或已被撤销，请重新生成邀请。",
  invite_expired: "邀请已过期，请重新生成邀请。",
  invalid_body: "提交的内容不完整或格式不对，请检查后重试。",
  immutable_field: "本次提交包含了不能由开单人设置的内容，请刷新页面后重试。"
};

export function orderFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof InjectedWalletError) {
    switch (error.code) {
      case "wallet_rejected":
        return "你取消了本次本人确认，订单未创建，可以重新发起。";
      case "missing_wallet":
        return "未检测到可用的身份确认工具，无法完成本人确认。请安装或启用后刷新页面。";
      case "typed_data_mismatch":
        return `本次确认内容与预期不一致，已拒绝确认：${error.message}`;
      default:
        return error.message.trim().length > 0 ? error.message : "本人确认没有完成。";
    }
  }
  if (isWalletIdentityRequired(error)) {
    return "登录状态已失效，请重新完成身份确认后再试。";
  }
  if (error instanceof ProductApiError) {
    if (error.status === 0) {
      return `请求超时，结果未知：服务端可能已处理本次操作。请先刷新页面或到订单页核对，再决定是否重试。`;
    }
    const mapped = error.errorCode ? ERROR_CODE_MESSAGES[error.errorCode] : undefined;
    if (mapped) {
      return mapped;
    }
    if (error.status === 401) {
      return "登录状态已失效，请重新完成身份确认后再试。";
    }
    if (error.status === 403) {
      return `当前身份没有执行这次操作的权限：${error.message}`;
    }
    return error.message.trim().length > 0 ? error.message : fallback;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}
