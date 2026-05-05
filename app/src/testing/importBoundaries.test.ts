import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const srcRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("order app import boundaries", () => {
  it("keeps evidence/proof on the task model public boundary instead of task internals", () => {
    const offenders = sourceFiles("evidence", "proof").filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["']\.\.\/tasks(?:\/[^"']*)?["']/.test(source);
    });

    assert.deepEqual(offenders.map(prettyPath), []);
  });

  it("keeps task runtime from importing evidence or proof panels", () => {
    const offenders = sourceFiles("tasks").filter((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["']\.\.\/(?:evidence|proof)(?:\/[^"']*)?["']/.test(source);
    });

    assert.deepEqual(offenders.map(prettyPath), []);
  });
});

function sourceFiles(...segments: readonly string[]): readonly string[] {
  return segments.flatMap((segment) => walk(join(srcRoot, segment)));
}

function walk(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return walk(path);
    }
    return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
  });
}

function prettyPath(path: string): string {
  return relative(srcRoot, path);
}
