/**
 * 实体注册表单的本地校验：服务端没有可对照的写入契约（见 blockers.ts），
 * 这里只校验"登记信息是否填写完整"（必填与长度上限），不发明注册号格式
 * 规则；格式规则等 A 层/服务端接口给出后再单源。
 */
import type {
  EntityRegistrationDraft,
  EntityRegistrationErrors,
  EntityRegistrationField,
  EntityRegistrationValidation,
} from "./types";

const limits: Readonly<Record<EntityRegistrationField, { readonly label: string; readonly maxLength: number }>> = {
  entityName: { label: "企业名称", maxLength: 120 },
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
