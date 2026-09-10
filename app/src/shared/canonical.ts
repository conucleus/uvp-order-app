/**
 * 确定性序列化原语：内容身份（同内容 → 同字符串）的计算基础，供证据
 * 指纹与任务运行时共用。放在中立位置——tasks 与 evidence 之间的模块
 * 边界不允许单向依赖证据面板，而指纹原语不属于任何一方的私有实现。
 */

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareByCodePoint(left, right))
        .map(([key, nested]) => [key, sortJsonValue(nested)])
    );
  }
  return value;
}

// 码点序等价 UTF-8 字节序，与 uvp-core/uvp-protocol/zhixu-store 的 canonical
// 口径一致；localeCompare 依赖 ICU/locale，同一份内容在不同环境会哈希出
// 不同指纹。按码点而非 UTF-16 码元比较：增补平面字符的代理对在码元序里
// 会排到 U+E000..U+FFFF 之前，偏离字节序。
export function compareByCodePoint(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCode = left.codePointAt(leftIndex)!;
    const rightCode = right.codePointAt(rightIndex)!;
    if (leftCode !== rightCode) {
      return leftCode < rightCode ? -1 : 1;
    }
    leftIndex += leftCode > 0xffff ? 2 : 1;
    rightIndex += rightCode > 0xffff ? 2 : 1;
  }
  return leftIndex < left.length ? 1 : rightIndex < right.length ? -1 : 0;
}
