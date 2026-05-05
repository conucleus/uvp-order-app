export function cleanString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseEvidenceIds(value: string): readonly string[] {
  return value
    .split(/[\s,，;；]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
