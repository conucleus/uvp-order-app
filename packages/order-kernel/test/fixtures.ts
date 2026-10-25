// V3 内核测试夹具：一个三阶段配置版本 + 一份邀请预览/typed data。地址与
// hash 都是固定的公开测试值，不含任何私钥或凭据。

import type {
  ConfigBundleV3,
  ConfigVersionV3,
  StageInvitePreviewV3,
  StageTermsV3
} from "@uvp-eth/product-dto";
import { buildUVPStageInviteAcceptTypedData } from "../src/product/v3/typedData";

export const BUYER = "0x1111111111111111111111111111111111111111";
export const PERFORMER = "0x2222222222222222222222222222222222222222";
export const VERIFIER = "0x3333333333333333333333333333333333333333";
export const STATE_MACHINE = "0x4444444444444444444444444444444444444444";
export const CHAIN_ID = 31337;
export const STANDARD_HASH = `0x${"dd".repeat(32)}`;
export const INSPECTION_HASH = `sha256:${"ee".repeat(32)}`;
export const CONFIG_HASH = `0x${"cc".repeat(32)}`;
export const PLAN_ID = `0x${"0a".repeat(32)}`;
export const PLAN_HASH = `0x${"0b".repeat(32)}`;
export const STAGE_ID_REQUIREMENTS = `0x${"a1".repeat(32)}`;
export const STAGE_ID_SOURCING = `0x${"b2".repeat(32)}`;
export const STAGE_ID_INSPECTION = `0x${"c3".repeat(32)}`;

export function configBundleFixture(): ConfigBundleV3 {
  return {
    schema: "uvp.order-config/v3",
    configId: "used-car/proxy_buy",
    version: "3.0.0",
    status: "published",
    title: "代买",
    currency: "USDT",
    chain: { chainId: CHAIN_ID, network: "local-anvil" },
    slots: [
      { key: "buyer", label: "买方", kind: "participant" },
      { key: "performer", label: "履约方", kind: "participant" },
      { key: "verifier", label: "验收方", kind: "participant" },
      { key: "escrow", label: "托管合约", kind: "contract" }
    ],
    stages: [
      {
        key: "requirements",
        name: "需求与标准",
        index: 1,
        optional: false,
        funded: false,
        slots: { performer: "buyer" },
        senders: ["buyer"],
        signals: [{ name: "completed", by: "buyer" }],
        acceptance: { mode: "none" },
        time: [{ name: "requirements_window", expr: "completed +3d" }]
      },
      {
        key: "sourcing",
        name: "采购",
        index: 2,
        optional: true,
        funded: true,
        slots: { payee: "performer" },
        senders: ["buyer", "performer"],
        acceptance: { mode: "self" },
        time: [{ name: "sourcing_window", expr: "approved +14d" }],
        fileResources: ["std/sourcing"],
        feeBps: 100
      },
      {
        key: "inspection",
        name: "验车",
        index: 3,
        optional: true,
        funded: true,
        slots: { payee: "performer", verifier: "verifier" },
        senders: ["buyer", "performer"],
        acceptance: { mode: "third_party", verifierSlot: "verifier" },
        fileResources: [{ ref: "std/inspection" }],
        feeBps: 100
      }
    ],
    defaults: { feeBps: 100, acceptance: { mode: "self" } },
    fileResources: [
      { name: "std/sourcing", version: "3.0.0", hash: STANDARD_HASH, ref: "standards/sourcing.md" },
      { name: "std/inspection", version: "3.0.0", hash: INSPECTION_HASH, ref: "standards/inspection.md" }
    ],
    stageProfiles: { default3: ["requirements", "sourcing", "inspection"] },
    defaultProfile: "default3"
  };
}

export function configVersionFixture(): ConfigVersionV3 {
  return {
    configId: "used-car/proxy_buy",
    version: "3.0.0",
    status: "published",
    configHash: CONFIG_HASH,
    planId: PLAN_ID,
    planHash: PLAN_HASH,
    title: "代买",
    currency: "USDT",
    createdBy: BUYER,
    createdAt: "2026-10-25T00:00:00.000Z",
    publishedAt: "2026-10-25T00:00:00.000Z",
    bundle: configBundleFixture()
  };
}

export function stageTermsFixture(): StageTermsV3 {
  const bundle = configBundleFixture();
  return {
    orderDraftId: "draft-1",
    configId: bundle.configId,
    configVersion: bundle.version,
    configHash: CONFIG_HASH,
    stageKey: "sourcing",
    stageId: STAGE_ID_SOURCING,
    payer: BUYER,
    payee: PERFORMER,
    verifier: null,
    amount: "1200000000",
    feeBps: 100,
    feeRecipient: null,
    standard: { name: "std/sourcing", version: "3.0.0", hash: STANDARD_HASH, ref: "standards/sourcing.md" },
    finalStandardHash: STANDARD_HASH,
    inviteDeadline: "2026-11-01T00:00:00.000Z",
    workDeadline: "2026-11-20T00:00:00.000Z",
    termsHash: `0x${"f0".repeat(32)}`
  };
}

export function inviteTypedDataFixture() {
  return buildUVPStageInviteAcceptTypedData({
    chainId: CHAIN_ID,
    verifyingContract: STATE_MACHINE,
    draftId: "draft-1",
    inviteId: "invite-1",
    stageKey: "sourcing",
    stageId: STAGE_ID_SOURCING,
    slotKey: "performer",
    invitee: PERFORMER,
    payee: PERFORMER,
    verifier: "0x0000000000000000000000000000000000000000",
    amount: "1200000000",
    feeBps: 100,
    finalStandardHash: STANDARD_HASH,
    workDeadline: Math.floor(Date.parse("2026-11-20T00:00:00.000Z") / 1000),
    termsHash: `0x${"f0".repeat(32)}`,
    nonce: "123456789",
    deadline: Math.floor(Date.parse("2026-11-01T00:00:00.000Z") / 1000)
  });
}

export function invitePreviewFixture(): StageInvitePreviewV3 {
  const terms = stageTermsFixture();
  return {
    invite: {
      inviteId: "invite-1",
      draftId: "draft-1",
      stageKey: "sourcing",
      stageId: STAGE_ID_SOURCING,
      slotKey: "performer",
      subjectLabel: "某某车商",
      status: "active",
      expiresAt: "2026-11-01T00:00:00.000Z",
      createdAt: "2026-10-25T00:00:00.000Z"
    },
    draftId: "draft-1",
    title: "代买一台车",
    stageId: STAGE_ID_SOURCING,
    terms,
    typedData: inviteTypedDataFixture(),
    chainId: CHAIN_ID,
    stateMachineAddress: STATE_MACHINE,
    signNonce: "123456789",
    termsHash: terms.termsHash!
  };
}
