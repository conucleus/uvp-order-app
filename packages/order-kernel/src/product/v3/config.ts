// V3 配置便利读面：把服务端 ConfigVersionV3（bundle）摊平成宿主可直接渲染的
// stage 列表（每段验收方式/必须邀请的 slot/标准句柄/时间表达式）。派生规则
// 与 chain-services order/v3/canonical.ts 同口径；stageId 只能来自服务端事实
// （草稿/订单），本模块绝不自算 keccak。

import type {
  ConfigAcceptanceModeV3,
  ConfigBundleV3,
  ConfigSlotV3,
  ConfigStageV3,
  ConfigVersionV3,
  StageStandardRefV3
} from "@uvp-eth/product-dto";

/** 服务端 parseTerm 接受的验收方式全集（订单可覆写；不在配置里预筛）。 */
export const CONFIG_ACCEPTANCE_MODES: readonly ConfigAcceptanceModeV3[] = [
  "self",
  "third_party",
  "mutual",
  "none"
];

const STANDARD_HASH_PATTERN = /^(0x[0-9a-fA-F]{64}|sha256:[0-9a-fA-F]{64})$/u;

/** 标准 hash 的两种可接受形态（服务端 normalizeFinalStandardHash 同口径）。 */
export function isStandardHash(value: string | undefined): boolean {
  return value !== undefined && STANDARD_HASH_PATTERN.test(value);
}

/** 常见稳定币/主币的 token 小数位；未知币种不猜默认值。 */
export const KNOWN_TOKEN_DECIMALS: Readonly<Record<string, number>> = {
  USDT: 6,
  USDC: 6,
  DAI: 18,
  WETH: 18,
  ETH: 18
};

export interface FlatStandardV3 {
  readonly name: string;
  readonly version?: string;
  /** 0x 32 字节摘要；缺失即不可解析（服务端会拒绝无 hash 的条款）。 */
  readonly hash?: string;
  readonly ref?: string;
  readonly resolvable: boolean;
}

export interface FlatStageSlotV3 {
  readonly slotKey: string;
  readonly label?: string;
  readonly role: "performer" | "verifier" | "participant";
  readonly required: boolean;
}

export interface FlatStageTimeV3 {
  readonly name: string;
  readonly expr?: string;
}

export interface FlatStageV3 {
  readonly stageKey: string;
  /** 仅当调用方从草稿/订单拿到服务端派生的 stageId 时存在。 */
  readonly stageId?: string;
  readonly name: string;
  readonly index?: number;
  readonly optional: boolean;
  readonly funded: boolean;
  /** 服务端接受的验收方式（订单可覆写，服务端按配置与覆写解析最终值）。 */
  readonly acceptanceModes: readonly ConfigAcceptanceModeV3[];
  readonly defaultAcceptance: ConfigAcceptanceModeV3;
  readonly verifierSlot?: string;
  readonly verifierSlotDeclared: boolean;
  readonly performerSlots: readonly FlatStageSlotV3[];
  readonly verifierSlots: readonly FlatStageSlotV3[];
  readonly requiredSlotKeys: readonly string[];
  readonly timeExpression?: string;
  readonly timeExpressions: readonly FlatStageTimeV3[];
  readonly standards: readonly FlatStandardV3[];
  readonly defaultStandard?: FlatStandardV3;
  readonly feeBps?: number;
}

export interface FlatConfigV3 {
  readonly configId: string;
  readonly version: string;
  readonly status: ConfigVersionV3["status"];
  readonly configHash: string;
  /** 该配置版本发布时登记的 UVP plan；同一配置的所有订单复用它。 */
  readonly planId?: string;
  readonly planHash?: string;
  readonly title?: string;
  readonly currency?: string;
  /** 未知币种时缺失，宿主必须显式提示而不是按 6 位显示。 */
  readonly tokenDecimals?: number;
  readonly tokenDecimalsSource: "currency" | "override" | "unknown";
  readonly tokenDecimalsProblem?: string;
  readonly feeBpsDefault?: number;
  readonly slots: readonly ConfigSlotV3[];
  readonly stages: readonly FlatStageV3[];
  readonly profiles: Readonly<Record<string, readonly string[]>>;
  readonly defaultProfile?: string;
  readonly chain?: Readonly<Record<string, unknown>>;
}

export interface FlattenConfigOptions {
  /** 显式 token 小数位（优先于币种表）。 */
  readonly tokenDecimals?: number | undefined;
  /** 币种 → 小数位覆写表。 */
  readonly tokenDecimalsByCurrency?: Readonly<Record<string, number>> | undefined;
  /** 服务端已派生的 stageId（来自草稿/订单读面）；不传则 stageId 缺失。 */
  readonly stageIds?: Readonly<Record<string, string>> | undefined;
}

export type TokenDecimalsResolution =
  | { readonly ok: true; readonly decimals: number; readonly source: "currency" | "override" }
  | { readonly ok: false; readonly reason: string };

export function resolveTokenDecimals(
  currency: string | undefined,
  overrides: Readonly<Record<string, number>> = {}
): TokenDecimalsResolution {
  const key = currency?.trim().toUpperCase();
  if (!key) {
    return { ok: false, reason: "配置没有声明 currency，无法确定 token 小数位" };
  }
  const override = overrides[key];
  if (override !== undefined) {
    return Number.isSafeInteger(override) && override >= 0
      ? { ok: true, decimals: override, source: "override" }
      : { ok: false, reason: `token 小数位覆写不是非负整数：${key}=${String(override)}` };
  }
  const known = KNOWN_TOKEN_DECIMALS[key];
  if (known === undefined) {
    return { ok: false, reason: `未知币种 ${key}：没有可信的 token 小数位来源，请显式提供` };
  }
  return { ok: true, decimals: known, source: "currency" };
}

export function flattenConfigVersion(
  version: ConfigVersionV3,
  options: FlattenConfigOptions = {}
): FlatConfigV3 {
  const bundle = version.bundle;
  const currency = version.currency ?? bundle.currency;
  const slotLabels = new Map(bundle.slots.map((slot) => [slot.key, slot.label]));
  const tokenDecimals = options.tokenDecimals !== undefined
    ? ({ ok: true, decimals: options.tokenDecimals, source: "override" } as const)
    : resolveTokenDecimals(currency, options.tokenDecimalsByCurrency ?? {});
  const profiles: Record<string, readonly string[]> = {
    ...(bundle.stageSubsets ?? {}),
    ...(bundle.stageProfiles ?? {})
  };
  const stages = bundle.stages.map((stage) => {
    const stageId = options.stageIds?.[stage.key];
    return flattenStage({
      stage,
      bundle,
      slotLabels,
      ...(stageId !== undefined ? { stageId } : {})
    });
  });
  const feeDefault = feeBpsDefault(bundle);
  const title = version.title ?? bundle.title;
  return {
    configId: version.configId,
    version: version.version,
    status: version.status,
    configHash: version.configHash,
    ...(version.planId !== undefined ? { planId: version.planId } : {}),
    ...(version.planHash !== undefined ? { planHash: version.planHash } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(tokenDecimals.ok
      ? { tokenDecimals: tokenDecimals.decimals, tokenDecimalsSource: tokenDecimals.source }
      : { tokenDecimalsSource: "unknown" as const, tokenDecimalsProblem: tokenDecimals.reason }),
    ...(feeDefault !== undefined ? { feeBpsDefault: feeDefault } : {}),
    slots: bundle.slots,
    stages,
    profiles,
    ...(bundle.defaultProfile !== undefined ? { defaultProfile: bundle.defaultProfile } : {}),
    ...(bundle.chain !== undefined ? { chain: bundle.chain } : {})
  };
}

function flattenStage(input: {
  readonly stage: ConfigStageV3;
  readonly bundle: ConfigBundleV3;
  readonly slotLabels: ReadonlyMap<string, string | undefined>;
  readonly stageId?: string;
}): FlatStageV3 {
  const { stage, bundle } = input;
  const payerSlot = stage.slots?.payer ?? "buyer";
  const payeeSlot = stage.slots?.payee;
  const acceptance = resolveAcceptance(bundle, stage);
  const verifierSlot = acceptance.verifierSlot;
  const senderSlots = (stage.senders ?? []).map((sender) =>
    typeof sender === "string" ? sender : sender.slot
  );
  const requiredKeys = new Set<string>();
  for (const slotKey of senderSlots) {
    if (slotKey !== payerSlot) {
      requiredKeys.add(slotKey);
    }
  }
  if (stage.funded === true && payeeSlot !== undefined && payeeSlot !== payerSlot) {
    requiredKeys.add(payeeSlot);
  }
  if ((acceptance.mode === "third_party" || acceptance.mode === "mutual") && verifierSlot !== undefined) {
    if (verifierSlot !== payerSlot) {
      requiredKeys.add(verifierSlot);
    }
  }
  requiredKeys.delete(payerSlot);
  const slotEntry = (slotKey: string, role: FlatStageSlotV3["role"]): FlatStageSlotV3 => {
    const label = input.slotLabels.get(slotKey);
    return {
      slotKey,
      ...(label !== undefined ? { label } : {}),
      role,
      required: true
    };
  };
  const performerSlots = [...requiredKeys]
    .sort()
    .filter((slotKey) => slotKey !== verifierSlot)
    .map((slotKey) => slotEntry(slotKey, slotKey === payeeSlot ? "performer" : "participant"));
  const verifierSlots = verifierSlot !== undefined ? [slotEntry(verifierSlot, "verifier")] : [];
  const standards = resolveStandards(bundle, stage);
  const timeExpressions = (stage.time ?? []).map((time) => ({
    name: time.name,
    ...(time.expr !== undefined ? { expr: time.expr } : {})
  }));
  const defaultStandard = standards.find((standard) => standard.resolvable);
  const stageFeeBps = stage.feeBps;
  return {
    stageKey: stage.key,
    ...(input.stageId !== undefined ? { stageId: input.stageId } : {}),
    name: stage.name ?? stage.key,
    ...(stage.index !== undefined ? { index: stage.index } : {}),
    optional: stage.optional === true,
    funded: stage.funded === true,
    acceptanceModes: CONFIG_ACCEPTANCE_MODES,
    defaultAcceptance: acceptance.mode,
    ...(verifierSlot !== undefined ? { verifierSlot } : {}),
    verifierSlotDeclared: acceptance.verifierSlotDeclared,
    performerSlots,
    verifierSlots,
    requiredSlotKeys: [...requiredKeys].sort(),
    ...(timeExpressions[0]?.expr !== undefined ? { timeExpression: timeExpressions[0].expr } : {}),
    timeExpressions,
    standards,
    ...(defaultStandard !== undefined ? { defaultStandard } : {}),
    ...(stageFeeBps !== undefined ? { feeBps: stageFeeBps } : {})
  };
}

function resolveAcceptance(
  bundle: ConfigBundleV3,
  stage: ConfigStageV3
): { readonly mode: ConfigAcceptanceModeV3; readonly verifierSlot?: string; readonly verifierSlotDeclared: boolean } {
  const mode = stage.acceptance?.mode ?? bundle.defaults?.acceptance?.mode ?? "self";
  const declared =
    stage.acceptance?.verifierSlot ??
    stage.slots?.verifier ??
    bundle.defaults?.acceptance?.verifierSlot;
  return {
    mode,
    ...(declared !== undefined ? { verifierSlot: declared } : {}),
    verifierSlotDeclared: declared !== undefined
  };
}

function resolveStandards(bundle: ConfigBundleV3, stage: ConfigStageV3): readonly FlatStandardV3[] {
  const hashes = bundle.hashes?.fileResources;
  const hashTable = typeof hashes === "object" && hashes !== null && !Array.isArray(hashes)
    ? hashes as Readonly<Record<string, unknown>>
    : undefined;
  return (stage.fileResources ?? []).map((resource) => {
    const refName = typeof resource === "string" ? resource : resource.ref;
    const declared = (bundle.fileResources ?? []).find(
      (candidate) => candidate.name === refName || candidate.ref === refName
    );
    const declaredHash = typeof resource === "string" ? undefined : resource.hash;
    const hashed = hashTable?.[refName] ?? declaredHash ?? declared?.hash;
    const hash = typeof hashed === "string" ? hashed : undefined;
    return {
      name: (typeof resource === "string" ? undefined : resource.name) ?? declared?.name ?? refName,
      ...(declared?.version !== undefined ? { version: declared.version } : {}),
      ...(hash !== undefined ? { hash } : {}),
      ...(declared?.ref !== undefined ? { ref: declared.ref } : {}),
      resolvable: isStandardHash(hash)
    };
  });
}

function feeBpsDefault(bundle: ConfigBundleV3): number | undefined {
  if (typeof bundle.defaults?.feeBps === "number") {
    return bundle.defaults.feeBps;
  }
  const nested = bundle.defaults?.fees?.feeBps;
  return typeof nested === "number" ? nested : undefined;
}

/** 从已摊平配置取单段；缺失返回 undefined（由调用方显式报错，不造默认段）。 */
export function flatStageByKey(config: FlatConfigV3, stageKey: string): FlatStageV3 | undefined {
  return config.stages.find((stage) => stage.stageKey === stageKey);
}

/** 把服务端已给的标准引用转成宿主形状（hash 缺失即不可解析）。 */
export function flatStandardFromRef(ref: StageStandardRefV3): FlatStandardV3 {
  return {
    name: ref.name,
    ...(ref.version !== undefined ? { version: ref.version } : {}),
    ...(ref.hash !== undefined ? { hash: ref.hash } : {}),
    ...(ref.ref !== undefined ? { ref: ref.ref } : {}),
    resolvable: isStandardHash(ref.hash)
  };
}

/** slot 的展示标签（配置声明优先）。 */
export function slotLabel(config: FlatConfigV3, slotKey: string): string | undefined {
  const slot: ConfigSlotV3 | undefined = config.slots.find((candidate) => candidate.key === slotKey);
  return slot?.label;
}
