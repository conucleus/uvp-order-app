import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductTaskDTO } from "@uvp-eth/product-dto";
import {
  EVIDENCE_MAX_FILE_BYTES,
  acceptAllowsFile,
  acceptAttribute,
  acceptHint,
  acceptIncludesPdf,
  evidenceMetadataFields,
  evidenceMetadataSignature,
  fieldSlots,
  fileSlots,
  frameworkEvidenceMetadataFields,
  missingEvidenceSlotLabels,
  planTaskEvidence,
  validateEvidenceFileForSlot,
  type EvidenceFileLike
} from "./evidenceSpec.js";

function taskFixture(overrides: Partial<ProductTaskDTO> = {}): ProductTaskDTO {
  return {
    taskId: "task-1",
    orderId: "order-1",
    orderTitle: "订单",
    zhixuId: "zhixu-1",
    title: "任务",
    subtitle: "",
    assigneeRole: "参与方",
    stageId: "stage-1",
    stageName: "阶段",
    deadline: "2026-05-01 18:00",
    fundingImpact: "无",
    status: "open",
    responsibilityStatements: [],
    proofRows: [],
    ...overrides
  } as ProductTaskDTO;
}

function fileLike(input: { readonly name: string; readonly type: string; readonly size: number; readonly head?: string }): EvidenceFileLike {
  return {
    name: input.name,
    type: input.type,
    size: input.size,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => {
        const text = input.head ?? "";
        return new TextEncoder().encode(text.slice(start, end)).buffer as ArrayBuffer;
      }
    })
  };
}

describe("evidence spec single-track planning", () => {
  it("builds slots strictly from the delivered evidenceSpec, including text and date fields", () => {
    const task = taskFixture({
      evidenceSpec: [
        { key: "customs_pdf", label: "报关单", accept: ["pdf"], required: true },
        { key: "invoice_no", label: "发票号", inputKind: "text", required: true },
        { key: "shipped_on", label: "发货日期", inputKind: "date", required: false }
      ]
    });

    const plan = planTaskEvidence(task);

    assert.equal(plan.mode, "spec");
    assert.deepEqual(plan.slots.map((slot) => slot.slotId), ["customs_pdf", "invoice_no", "shipped_on"]);
    // spec key 即上传 documentType，前端不再维护关键词→documentType 猜测表。
    assert.equal(plan.slots[0]?.documentType, "customs_pdf");
    // accept 原样保留下发值，归一化在匹配/快检时进行。
    assert.deepEqual(plan.slots[0]?.accept, ["pdf"]);
    assert.equal(plan.slots[0]?.inputKind, "file");
    assert.equal(plan.slots[1]?.inputKind, "text");
    assert.equal(plan.slots[2]?.required, false);
    assert.deepEqual(fileSlots(plan).map((slot) => slot.slotId), ["customs_pdf"]);
    assert.deepEqual(fieldSlots(plan).map((slot) => slot.slotId), ["invoice_no", "shipped_on"]);
  });

  it("yields no evidence slots without a spec: no synthesized generic slot", () => {
    const task = taskFixture();

    const plan = planTaskEvidence(task);

    // 无 spec 即无凭证槽位（与 zhixu-store 同口径）：不从声明文本臆造通用槽位。
    assert.equal(plan.mode, "none");
    assert.deepEqual(plan.slots, []);
  });

  it("keeps structured resource requirement slots when no spec is delivered", () => {
    const task = taskFixture({
      resourceRequirements: [
        {
          resourceId: "inspection_report",
          resourceKey: "inspection_report",
          label: "第三方检验证明",
          required: true,
          source: "resource_patch"
        }
      ]
    });

    const plan = planTaskEvidence(task);

    // 资源要求是服务端结构化数据，不是 requiredEvidence 声明文本，槽位保留。
    assert.equal(plan.mode, "none");
    assert.deepEqual(plan.slots.map((slot) => slot.slotId), ["resource-requirement:inspection_report"]);
    assert.equal(plan.slots[0]?.documentType, "inspection_report");
  });

  it("drops an invalid evidenceSpec entirely instead of rendering duplicate slots", () => {
    const task = taskFixture({
      evidenceSpec: [
        { key: "", label: "空 key" },
        { key: "dup", label: "重复" },
        { key: "dup", label: "重复" }
      ]
    });

    const plan = planTaskEvidence(task);

    assert.equal(plan.mode, "none");
    assert.deepEqual(plan.slots, []);
  });

  it("checks required file slots by upload and text/date slots by field value", () => {
    const slots = [
      { slotId: "file-1", label: "报关单", documentType: "file-1", required: true, inputKind: "file" as const, accept: [] },
      { slotId: "text-1", label: "发票号", documentType: "text-1", required: true, inputKind: "text" as const, accept: [] },
      { slotId: "date-1", label: "日期", documentType: "date-1", required: true, inputKind: "date" as const, accept: [] },
      { slotId: "opt-1", label: "可选备注", documentType: "opt-1", required: false, inputKind: "text" as const, accept: [] }
    ];

    assert.deepEqual(missingEvidenceSlotLabels(slots, {}, []), ["报关单", "发票号", "日期"]);
    assert.deepEqual(missingEvidenceSlotLabels(slots, { "text-1": "INV-1" }, ["file-1"]), ["日期"]);
    assert.deepEqual(missingEvidenceSlotLabels(slots, { "text-1": "INV-1", "date-1": "2026-05-01" }, ["file-1"]), []);
  });
});

describe("evidence accept constraints", () => {
  it("normalizes bare extensions and matches by mime or extension", () => {
    const pdf = fileLike({ name: "doc.pdf", type: "application/pdf", size: 10 });
    assert.equal(acceptAllowsFile(["pdf"], pdf), true);
    assert.equal(acceptAllowsFile(["application/pdf"], pdf), true);
    assert.equal(acceptAllowsFile([".png"], pdf), false);
    // 空 accept 表示不限制，替代旧硬编码白名单。
    assert.equal(acceptAllowsFile([], fileLike({ name: "data.bin", type: "application/octet-stream", size: 10 })), true);
  });

  it("expands wildcard MIME entries so image/* slots are uploadable", () => {
    const png = fileLike({ name: "照片.png", type: "image/png", size: 10 });
    const jpeg = fileLike({ name: "照片.jpg", type: "image/jpeg", size: 10 });
    const pdf = fileLike({ name: "凭证.pdf", type: "application/pdf", size: 10 });
    assert.equal(acceptAllowsFile(["image/*"], png), true);
    assert.equal(acceptAllowsFile(["image/*"], jpeg), true);
    assert.equal(acceptAllowsFile(["image/*"], pdf), false);
    assert.equal(acceptAllowsFile(["*/*"], png), true);
  });

  it("derives input accept attribute and hint from the delivered accept list", () => {
    assert.equal(acceptAttribute([]), undefined);
    assert.equal(acceptAttribute(["pdf", "image/png"]), ".pdf,image/png");
    assert.equal(acceptHint([]), "不限格式");
    assert.match(acceptHint(["pdf"]), /PDF/);
  });

  it("detects pdf requirements for the %PDF- magic check", () => {
    assert.equal(acceptIncludesPdf(["pdf"]), true);
    assert.equal(acceptIncludesPdf(["application/pdf"]), true);
    assert.equal(acceptIncludesPdf([".png"]), false);
    assert.equal(acceptIncludesPdf([]), false);
  });
});

describe("evidence file validation before upload", () => {
  it("rejects empty and oversized files regardless of accept", async () => {
    const slot = { accept: [] };
    assert.match((await validateEvidenceFileForSlot(fileLike({ name: "a.pdf", type: "application/pdf", size: 0 }), slot)) ?? "", /内容为空/);
    assert.match(
      (await validateEvidenceFileForSlot(fileLike({ name: "a.pdf", type: "application/pdf", size: EVIDENCE_MAX_FILE_BYTES + 1 }), slot)) ?? "",
      /10 MB/
    );
  });

  it("rejects files outside the delivered accept list", async () => {
    const slot = { accept: [".png"] };
    assert.match(
      (await validateEvidenceFileForSlot(fileLike({ name: "doc.pdf", type: "application/pdf", size: 10 }), slot)) ?? "",
      /PNG/
    );
  });

  it("runs the %PDF- magic check when the slot requires pdf", async () => {
    const slot = { accept: ["pdf"] };
    const forged = fileLike({ name: "fake.pdf", type: "application/pdf", size: 100, head: "<html>not a pdf" });
    assert.match((await validateEvidenceFileForSlot(forged, slot)) ?? "", /%PDF-/);

    const genuine = fileLike({ name: "real.pdf", type: "application/pdf", size: 100, head: "%PDF-1.7" });
    assert.equal(await validateEvidenceFileForSlot(genuine, slot), undefined);
  });

  it("skips the magic check for unrestricted slots", async () => {
    const slot = { accept: [] };
    const notPdf = fileLike({ name: "note.txt", type: "text/plain", size: 10, head: "hello" });
    assert.equal(await validateEvidenceFileForSlot(notPdf, slot), undefined);
  });
});

describe("evidence metadata fields", () => {
  it("carries spec field values into upload metadata without synthetic keys", () => {
    const fields = evidenceMetadataFields({ invoice_no: " INV-1 ", empty: "  " });
    assert.deepEqual(fields, { invoice_no: "INV-1" });
  });

  it("namespaces framework-injected keys so spec fields with colliding names survive", () => {
    const fields = frameworkEvidenceMetadataFields(
      { fileName: "spec 声明的文件名", notes: "备注" },
      { label: "装箱单", fileName: "实际文件.pdf", size: 1024 }
    );
    assert.equal(fields.fileName, "spec 声明的文件名");
    assert.equal(fields["uvp_framework_fileName"], "实际文件.pdf");
    assert.equal(fields["uvp_framework_fileSize"], "1024");
    assert.equal(fields["uvp_framework_publicLabel"], "装箱单");
    assert.equal(fields.notes, "备注");
  });

  it("signs metadata fields order-independently for staleness checks", () => {
    assert.equal(
      evidenceMetadataSignature({ a: "1", b: "2" }),
      evidenceMetadataSignature({ b: "2", a: "1" })
    );
    assert.notEqual(
      evidenceMetadataSignature({ a: "1" }),
      evidenceMetadataSignature({ a: "2" })
    );
  });

  it("orders signature keys by code point, not UTF-16 code units", () => {
    const astral = "\u{1F600}键";
    const bmp = "\uFFFF键";
    assert.equal(
      evidenceMetadataSignature({ [astral]: "1", [bmp]: "2" }),
      JSON.stringify([[bmp, "2"], [astral, "1"]])
    );
  });
});
