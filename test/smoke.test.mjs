// kama-log — smoke test（node:test 標準ランナー・追加の依存なし）
// 外部テストランナー（jest/vitest）は導入しない。Node 22+ 同梱の node:test を使う。
// 実行: pnpm test (= node --test)
import { test } from "node:test";
import assert from "node:assert/strict";

test("slug is a non-empty string", () => {
  const slug = "kama-log";
  assert.ok(typeof slug === "string" && slug.length > 0);
});
