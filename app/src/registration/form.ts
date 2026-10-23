/**
 * 实体注册表单的本地校验：与服务端 `store/registration/service.ts` 的
 * 必填/长度上限同口径，只做提交前的快速反馈；注册号格式仍未定义（服务端
 * 也没有格式契约），这里不发明格式规则。
 */
import type {
  EntityRegistrationDraft,
  EntityRegistrationErrors,
  EntityRegistrationField,
  EntityRegistrationValidation,
} from "./types";

const limits: Readonly<Record<EntityRegistrationField, { readonly label: string; readonly maxLength: number }>> = {
  legalName: { label: "企业名称", maxLength: 120 },
  registrationNumber: { label: "注册号", maxLength: 64 },
  contactName: { label: "联系人", maxLength: 40 },
};

export function validateEntityRegistrationDraft(draft: EntityRegistrationDraft): EntityRegistrationValidation {
  const errors: Partial<Record<EntityRegistrationField, string>> = {};
  for (const field of Object.keys(limits) as EntityRegistrationField[]) {
    const value = draft[field].trim();
    const { label, maxLength } = limits[field];
    if (value.length === 0) {
      errors[field] = `请填写${label}。`;
      continue;
    }
    if (value.length > maxLength) {
      errors[field] = `${label}不超过 ${maxLength} 个字符。`;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true };
}
