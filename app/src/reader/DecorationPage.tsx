import { ClipboardList, FileCheck2, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";
import type { TaskEvidenceInputKind, ZhixuDetailDTO, ZhixuStageDTO } from "@uvp-eth/product-dto";
import type { ProductApiClient } from "../api/productApi";
import {
  decorationSlotsForStage,
  decorationTheme,
  stageExecutorSelectionNote
} from "../decoration/decorationSupport";
import { useOrderAppDecorations } from "../decoration/useZhixuDecorations";
import "./reader.css";

/**
 * Reader 装修页（被邀请的客户视角）：theme + 阶段 / 角色 / 证据要求。
 *
 * 数据来源：Product API 的秩序详情（公共读）+ Store API 的装修数据。
 * 页面用产业语言，不出现哈希、钱包、等链语言；装修"取不到"与"没有装修"
 * 分开呈现（取不到不得坍缩成没有）。
 */
export function DecorationPage({
  api,
  zhixuId,
  onEnterTasks
}: {
  readonly api: ProductApiClient;
  readonly zhixuId: string;
  /** 进入参与者待办（有邀请/会话时可用；reader 页本身不要求登录）。 */
  readonly onEnterTasks?: (() => void) | undefined;
}) {
  const { status, byZhixuId } = useOrderAppDecorations(api, [zhixuId], zhixuId.trim().length > 0);
  const snapshot = byZhixuId[zhixuId];
  const zhixu = snapshot?.zhixu;

  return (
    <section className="reader-page workspace-block" data-testid="decoration-page">
      <div className="section-heading reader-heading">
        <ClipboardList aria-hidden="true" />
        <div>
          <span className="overline">服务说明</span>
          <h1>{zhixu ? decorationTheme(snapshot?.decoration)?.displayName ?? zhixu.title : "服务说明"}</h1>
          {zhixu ? <p>{decorationTheme(snapshot?.decoration)?.description ?? zhixu.subtitle}</p> : null}
        </div>
        {onEnterTasks ? (
          <button className="primary-button" onClick={onEnterTasks} type="button" data-testid="decoration-enter-app">
            进入我的待办
          </button>
        ) : null}
      </div>

      {status === "loading" ? (
        <section className="empty-state" aria-busy="true">
          <RefreshCw className="spin" aria-hidden="true" />
          <h2>正在加载服务说明</h2>
          <p>正在读取这条秩序的阶段、角色和材料要求。</p>
        </section>
      ) : null}

      {snapshot && !zhixu ? (
        <section className="system-banner system-banner-error" role="alert" data-testid="decoration-error">
          <strong>服务说明加载失败</strong>
          <span>{snapshot.decorationError ?? "无法读取这条秩序的服务说明，请稍后重试。"}</span>
        </section>
      ) : null}

      {zhixu ? (
        <>
          {snapshot?.decorationError ? (
            <section className="system-banner system-banner-warn" role="alert" data-testid="decoration-error">
              <strong>装修内容暂时取不到</strong>
              <span>
                阶段与角色按秩序定义显示；主题、亮点和任务材料要求可能不完整（{snapshot.decorationError}）。
              </span>
            </section>
          ) : null}
          {!snapshot?.decorationError && !decorationTheme(snapshot?.decoration) ? (
            <p className="muted-copy" data-testid="decoration-missing-note">
              这条秩序尚未提供展示装修；以下内容按秩序定义显示。
            </p>
          ) : null}
          <ThemeBlock decoration={snapshot?.decoration} zhixu={zhixu} />
          <RoleBlock zhixu={zhixu} />
          <StageBlock zhixu={zhixu} decoration={snapshot?.decoration} />
        </>
      ) : null}
    </section>
  );
}

function ThemeBlock({
  decoration,
  zhixu
}: {
  readonly decoration: Parameters<typeof decorationTheme>[0];
  readonly zhixu: ZhixuDetailDTO;
}) {
  const theme = decorationTheme(decoration);
  const tags = theme?.tags ?? [];
  const highlights = theme?.highlights ?? [];
  if (tags.length === 0 && highlights.length === 0) {
    return null;
  }
  return (
    <section className="reader-block" aria-labelledby="reader-theme-title">
      <div className="section-heading compact">
        <ShieldCheck aria-hidden="true" />
        <h2 id="reader-theme-title">这条服务适合什么</h2>
      </div>
      {tags.length > 0 ? (
        <div className="reader-tags" data-testid="decoration-tags">
          {tags.map((tag) => <span className="reader-tag" data-testid="decoration-tag" key={tag}>{tag}</span>)}
        </div>
      ) : null}
      {highlights.length > 0 ? (
        <ul className="reader-highlights" data-testid="decoration-highlights">
          {highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
        </ul>
      ) : null}
      <p className="muted-copy">
        以上由发布方提供，只描述服务与流程，不替代约定文本与验收结论。
      </p>
      <p className="muted-copy">维护方：{zhixu.maintainer}</p>
    </section>
  );
}

function RoleBlock({ zhixu }: { readonly zhixu: ZhixuDetailDTO }) {
  if (zhixu.roleSlots.length === 0) {
    return null;
  }
  return (
    <section className="reader-block" aria-labelledby="reader-roles-title">
      <div className="section-heading compact">
        <UsersRound aria-hidden="true" />
        <h2 id="reader-roles-title">参与方与责任</h2>
      </div>
      <div className="reader-role-grid">
        {zhixu.roleSlots.map((role) => (
          <article className="reader-role-card" data-testid="decoration-role" key={role.slotId}>
            <div className="reader-role-heading">
              <strong>{role.title}</strong>
              <span>{role.label}</span>
            </div>
            <p>{role.duty}</p>
            {role.evidence.length > 0 ? (
              <small>交付：{role.evidence.join("、")}</small>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function StageBlock({
  zhixu,
  decoration
}: {
  readonly zhixu: ZhixuDetailDTO;
  readonly decoration: Parameters<typeof decorationSlotsForStage>[0];
}) {
  const orderedStages = [...zhixu.stages].sort((left, right) => left.index - right.index);
  return (
    <section className="reader-block" aria-labelledby="reader-stages-title">
      <div className="section-heading compact">
        <FileCheck2 aria-hidden="true" />
        <h2 id="reader-stages-title">阶段与需要提交的材料</h2>
      </div>
      <ol className="reader-stage-list">
        {orderedStages.map((stage) => (
          <ReaderStage
            decoration={decoration}
            key={stage.stageId}
            stage={stage}
            zhixu={zhixu}
          />
        ))}
      </ol>
    </section>
  );
}

function ReaderStage({
  decoration,
  stage,
  zhixu
}: {
  readonly decoration: Parameters<typeof decorationSlotsForStage>[0];
  readonly stage: ZhixuStageDTO;
  readonly zhixu: ZhixuDetailDTO;
}) {
  const slots = decorationSlotsForStage(decoration, stage.stageId);
  const executorNote = stageExecutorSelectionNote(zhixu, stage);
  return (
    <li className="reader-stage" data-testid="decoration-stage">
      <div className="reader-stage-heading">
        <span className="reader-stage-index">{stage.index + 1}</span>
        <div>
          <strong>{stage.name}</strong>
          <small>负责：{stage.ownerRole}</small>
        </div>
        {executorNote ? (
          <span className="reader-stage-executor" data-testid="decoration-executor-note">{executorNote}</span>
        ) : null}
      </div>
      {slots.length > 0 ? (
        <ul className="reader-evidence-list" data-testid="decoration-stage-evidence">
          {slots.map((slot) => (
            <li key={slot.key}>
              <span className={"reader-input-kind reader-input-" + (slot.inputKind ?? "file")}>
                {inputKindLabel(slot.inputKind)}
              </span>
              <strong>{slot.label}</strong>
              {slot.required === false ? <small>选填</small> : <small>必填</small>}
              {slot.description ? <p>{slot.description}</p> : null}
            </li>
          ))}
        </ul>
      ) : stage.evidence.length > 0 ? (
        <p className="muted-copy">材料：{stage.evidence.join("、")}（明细由发布方线下约定）</p>
      ) : (
        <p className="muted-copy">本阶段按双方约定提交阶段确认。</p>
      )}
    </li>
  );
}

function inputKindLabel(kind: TaskEvidenceInputKind | undefined): string {
  switch (kind) {
    case "text":
      return "填写";
    case "date":
      return "日期";
    default:
      return "文件";
  }
}
