/**
 * 实体注册表单的本地校验：只做必填快速反馈；长度/格式契约由服务端拥有。
 */
import type {
  EntityRegistrationDraft,
  EntityRegistrationErrors,
  EntityRegistrationField,
  EntityRegistrationValidation,
} from "./types";

const labels: Readonly<Record<EntityRegistrationField, string>> = {
  legalName: "企业名称",
  registrationNumber: "注册号",
  contactName: "联系人",
};

export function validateEntityRegistrationDraft(draft: EntityRegistrationDraft): EntityRegistrationValidation {
  const errors: Partial<Record<EntityRegistrationField, string>> = {};
  for (const field of Object.keys(labels) as EntityRegistrationField[]) {
    const value = draft[field].trim();
    const label = labels[field];
    if (value.length === 0) {
      errors[field] = `请填写${label}。`;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true };
}
