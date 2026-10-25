// Binding read parsers: fail closed on malformed/mismatched responses instead
// of degrading to an empty "no tranche" view. `dataState:"pending"` is carried
// through untouched; the UI decides how to render it, not this parser.

import {
  BINDING_DATA_STATES,
  BindingReadError,
  SETTLEMENT_INSTRUCTION_KINDS,
  SETTLEMENT_INSTRUCTION_STATUSES,
  TRANCHE_BINDING_STATES,
  type BindingDataState,
  type OrderBindingsReadResult,
  type OrderSettlementInstructionsReadResult,
  type InstructionSignerRole,
  type SettlementInstructionDTO,
  type SettlementInstructionKind,
  type SettlementInstructionStatus,
  type StageBindingReadResult,
  type TrancheBindingDTO,
  type TrancheBindingState
} from "./types";

const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

export function parseOrderBindings(expectedOrderId: string, body: unknown): OrderBindingsReadResult {
  const record = requireRecord(body, "binding list response is not a JSON object");
  const orderId = requireBytes32(record, "orderId", "binding list response is missing orderId");
  if (orderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new BindingReadError("order_id_mismatch", "binding list orderId does not match the request");
  }
  const dataState = parseDataState(record.dataState, "binding list dataState");
  if (!Array.isArray(record.bindings)) {
    throw new BindingReadError("invalid_response", "binding list response is missing bindings[]");
  }
  return {
    orderId,
    dataState,
    bindings: record.bindings.map((item, index) =>
      parseTrancheBinding(item, expectedOrderId, `binding list #${index + 1}`)
    ),
    foreignTrancheCount: requireNonNegativeInteger(
      record,
      "foreignTrancheCount",
      "binding list response is missing foreignTrancheCount"
    )
  };
}

export function parseStageBinding(expectedOrderId: string, body: unknown): StageBindingReadResult {
  const record = requireRecord(body, "stage binding response is not a JSON object");
  const orderId = requireBytes32(record, "orderId", "stage binding response is missing orderId");
  if (orderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new BindingReadError("order_id_mismatch", "stage binding orderId does not match the request");
  }
  const stageKey = requireText(record, "stageKey", "stage binding response is missing stageKey");
  return {
    orderId,
    stageKey,
    dataState: parseDataState(record.dataState, "stage binding dataState"),
    binding: parseTrancheBinding(record.binding, expectedOrderId, "stage binding"),
    foreignTrancheCount: requireNonNegativeInteger(
      record,
      "foreignTrancheCount",
      "stage binding response is missing foreignTrancheCount"
    )
  };
}

export function parseOrderSettlementInstructions(
  expectedOrderId: string,
  body: unknown
): OrderSettlementInstructionsReadResult {
  const record = requireRecord(body, "instruction list response is not a JSON object");
  const orderId = requireBytes32(record, "orderId", "instruction list response is missing orderId");
  if (orderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new BindingReadError("order_id_mismatch", "instruction list orderId does not match the request");
  }
  if (!Array.isArray(record.instructions)) {
    throw new BindingReadError("invalid_response", "instruction list response is missing instructions[]");
  }
  return {
    orderId,
    dataState: parseDataState(record.dataState, "instruction list dataState"),
    instructions: record.instructions.map((item, index) =>
      parseSettlementInstruction(item, expectedOrderId, `instruction list #${index + 1}`)
    )
  };
}

export function parseTrancheBinding(value: unknown, expectedOrderId: string, context: string): TrancheBindingDTO {
  const record = requireRecord(value, `${context} is not a JSON object`);
  const orderId = requireBytes32(record, "orderId", `${context} is missing orderId`);
  if (orderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new BindingReadError("order_id_mismatch", `${context} orderId does not match the request`);
  }
  const state = requireText(record, "state", `${context} is missing state`);
  if (!(TRANCHE_BINDING_STATES as readonly string[]).includes(state)) {
    throw new BindingReadError("unknown_binding_state", `${context} has unknown state ${state}`);
  }
  return {
    bindingId: requireText(record, "bindingId", `${context} is missing bindingId`),
    orderId,
    stageKey: requireText(record, "stageKey", `${context} is missing stageKey`),
    stageId: requireBytes32(record, "stageId", `${context} is missing stageId`),
    trancheId: requireBytes32(record, "trancheId", `${context} is missing trancheId`),
    chainId: requireNonNegativeInteger(record, "chainId", `${context} is missing chainId`),
    escrowAddress: requireAddress(record, "escrowAddress", `${context} has an invalid escrowAddress`),
    state: state as TrancheBindingState,
    origin: record.origin === "event_only" ? "event_only" : "intent",
    ...optionalAddressField(record, "payer"),
    ...optionalAddressField(record, "payee"),
    ...optionalBaseUnitsField(record, "amount"),
    ...optionalNumberField(record, "feeBps"),
    ...optionalAddressField(record, "feeRecipient"),
    ...optionalBytes32Field(record, "depositTxHash"),
    ...optionalTextField(record, "depositBlock"),
    ...optionalBaseUnitsField(record, "payerAmount"),
    ...optionalBaseUnitsField(record, "payeeAmount"),
    ...optionalBaseUnitsField(record, "feeAmount"),
    ...optionalBytes32Field(record, "settledTxHash"),
    ...optionalBytes32Field(record, "instructionRef"),
    updatedAt: requireText(record, "updatedAt", `${context} is missing updatedAt`)
  };
}

export function parseSettlementInstruction(
  value: unknown,
  expectedOrderId: string,
  context: string
): SettlementInstructionDTO {
  const record = requireRecord(value, `${context} is not a JSON object`);
  const orderId = requireBytes32(record, "orderId", `${context} is missing orderId`);
  if (orderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new BindingReadError("order_id_mismatch", `${context} orderId does not match the request`);
  }
  const kind = requireText(record, "kind", `${context} is missing kind`);
  if (!(SETTLEMENT_INSTRUCTION_KINDS as readonly string[]).includes(kind)) {
    throw new BindingReadError("invalid_response", `${context} has unknown kind ${kind}`);
  }
  const status = requireText(record, "status", `${context} is missing status`);
  if (!(SETTLEMENT_INSTRUCTION_STATUSES as readonly string[]).includes(status)) {
    throw new BindingReadError("unknown_instruction_status", `${context} has unknown status ${status}`);
  }
  if (!Array.isArray(record.requiredSigners) || !Array.isArray(record.signatures)) {
    throw new BindingReadError("invalid_response", `${context} is missing requiredSigners[]/signatures[]`);
  }
  return {
    instructionId: requireText(record, "instructionId", `${context} is missing instructionId`),
    idempotencyKey: requireText(record, "idempotencyKey", `${context} is missing idempotencyKey`),
    chainId: requireNonNegativeInteger(record, "chainId", `${context} is missing chainId`),
    escrowAddress: requireAddress(record, "escrowAddress", `${context} has an invalid escrowAddress`),
    planId: requireBytes32(record, "planId", `${context} is missing planId`),
    orderId,
    stageKey: requireText(record, "stageKey", `${context} is missing stageKey`),
    stageId: requireBytes32(record, "stageId", `${context} is missing stageId`),
    trancheId: requireBytes32(record, "trancheId", `${context} is missing trancheId`),
    kind: kind as SettlementInstructionKind,
    payerAmount: requireBaseUnitsValue(record, "payerAmount", `${context} is missing payerAmount`),
    payeeAmount: requireBaseUnitsValue(record, "payeeAmount", `${context} is missing payeeAmount`),
    sourceFactId: requireBytes32(record, "sourceFactId", `${context} is missing sourceFactId`),
    ...optionalAddressField(record, "payer"),
    ...optionalAddressField(record, "payee"),
    ...optionalAddressField(record, "verifier"),
    requiredSigners: record.requiredSigners.map((role, index) => {
      if (typeof role !== "string" || !["payer", "payee", "verifier"].includes(role)) {
        throw new BindingReadError("invalid_response", `${context} requiredSigners[${index}] is invalid`);
      }
      return role as InstructionSignerRole;
    }),
    signatures: record.signatures.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new BindingReadError("invalid_response", `${context} signatures[${index}] is invalid`);
      }
      const signature = entry as Record<string, unknown>;
      const role = signature.role;
      if (role !== "payer" && role !== "payee" && role !== "verifier") {
        throw new BindingReadError("invalid_response", `${context} signatures[${index}].role is invalid`);
      }
      return {
        role,
        signer: requireAddress(signature, "signer", `${context} signatures[${index}].signer is invalid`),
        signature: requireBytes32Or65(signature, "signature", `${context} signatures[${index}].signature is invalid`)
      };
    }),
    instructionRef: requireBytes32(record, "instructionRef", `${context} is missing instructionRef`),
    typedDataHash: requireBytes32(record, "typedDataHash", `${context} is missing typedDataHash`),
    nonce: requireBaseUnitsValue(record, "nonce", `${context} is missing nonce`),
    deadline: requireBaseUnitsValue(record, "deadline", `${context} is missing deadline`),
    status: status as SettlementInstructionStatus,
    ...optionalTextField(record, "executeEligibleAt"),
    ...(typeof record.blockedByDispute === "boolean" ? { blockedByDispute: record.blockedByDispute } : {}),
    ...optionalBytes32Field(record, "txHash"),
    ...optionalTextField(record, "blockNumber"),
    ...optionalTextField(record, "errorCode"),
    attempts: requireNonNegativeInteger(record, "attempts", `${context} is missing attempts`),
    createdAt: requireText(record, "createdAt", `${context} is missing createdAt`),
    updatedAt: requireText(record, "updatedAt", `${context} is missing updatedAt`)
  };
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value as Record<string, unknown>;
}

function requireText(record: Record<string, unknown>, key: string, message: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}

function requireTextValue(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BindingReadError("invalid_response", "optional text field has an invalid value");
  }
  return value;
}

function requireBaseUnitsValue(record: Record<string, unknown>, key: string, message: string): string {
  return requireBaseUnits(record[key], message);
}

function requireBaseUnits(value: unknown, message: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}

function requireBytes32(record: Record<string, unknown>, key: string, message: string): string {
  return requireBytes32Value(record[key], message);
}

function requireBytes32Value(value: unknown, message: string): string {
  if (typeof value !== "string" || !BYTES32.test(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}

function requireAddress(record: Record<string, unknown>, key: string, message: string): string {
  return requireAddressValue(record[key], message);
}

function requireAddressValue(value: unknown, message: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}

function requireNonNegativeInteger(record: Record<string, unknown>, key: string, message: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}

function parseDataState(value: unknown, message: string): BindingDataState {
  if (typeof value !== "string" || !(BINDING_DATA_STATES as readonly string[]).includes(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value as BindingDataState;
}

function optionalBytes32Field(record: Record<string, unknown>, key: string): Record<string, string> {
  return optionalValue(record, key, (value) => requireBytes32Value(value, `optional field ${key} is invalid`));
}

function optionalAddressField(record: Record<string, unknown>, key: string): Record<string, string> {
  return optionalValue(record, key, (value) => requireAddressValue(value, `optional field ${key} is invalid`));
}

function optionalBaseUnitsField(record: Record<string, unknown>, key: string): Record<string, string> {
  return optionalValue(record, key, (value) => requireBaseUnits(value, `optional field ${key} is invalid`));
}

function optionalTextField(record: Record<string, unknown>, key: string): Record<string, string> {
  return optionalValue(record, key, (value) => requireTextValue(value));
}

function optionalValue<T>(
  record: Record<string, unknown>,
  key: string,
  parse: (value: unknown) => T
): Record<string, T> {
  const value = record[key];
  if (value === undefined || value === null) {
    return {};
  }
  return { [key]: parse(value) };
}

function requireBytes32Or65(record: Record<string, unknown>, key: string, message: string): string {
  const value = record[key];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/u.test(value)) {
    throw new BindingReadError("invalid_response", message);
  }
  return value;
}

function optionalNumberField(record: Record<string, unknown>, key: string): Record<string, number> {
  const value = record[key];
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BindingReadError("invalid_response", `optional field ${key} is invalid`);
  }
  return { [key]: value };
}
