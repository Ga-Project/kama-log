import { test } from "node:test";
import assert from "node:assert/strict";
import { FAQ, GUIDE_PATH, RECORD_ITEMS, buildGuideJsonLd, jsonLdScript } from "../lib/guide.mjs";
import { absoluteUrl } from "../lib/site.mjs";

const abs = (p) => `https://example.test/kama-log${p}`;

test("記録項目は8つで、欠けた文章がない", () => {
  assert.equal(RECORD_ITEMS.length, 8);
  for (const i of RECORD_ITEMS) {
    assert.ok(i.name && i.what && i.tip, `incomplete: ${i.name}`);
  }
});

test("JSON-LD の FAQ は画面の FAQ と同じ問答", () => {
  const faq = buildGuideJsonLd(abs, "t", "d").find((x) => x["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, FAQ.length);
  faq.mainEntity.forEach((q, i) => {
    assert.equal(q.name, FAQ[i].q);
    assert.equal(q.acceptedAnswer.text, FAQ[i].a);
  });
});

test("JSON-LD の URL は basePath 込みの絶対 URL", () => {
  const ld = buildGuideJsonLd(abs, "t", "d");
  assert.equal(ld[0].mainEntityOfPage, "https://example.test/kama-log/guide/");
  assert.equal(ld[1].itemListElement[0].item, "https://example.test/kama-log/");
});

test("jsonLdScript は script を閉じる文字列を埋め込まない", () => {
  const out = jsonLdScript({ a: "</script><b>" });
  assert.ok(!out.includes("</script>"));
  assert.deepEqual(JSON.parse(out), { a: "</script><b>" });
});

test("ガイドの絶対 URL は末尾スラッシュ付き（trailingSlash 設定と一致）", () => {
  assert.ok(GUIDE_PATH.endsWith("/"));
  assert.ok(absoluteUrl(GUIDE_PATH).endsWith("/guide/"));
});
