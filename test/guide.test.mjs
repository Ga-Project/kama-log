import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FAQ, GUIDE_HEADLINE, GUIDE_PATH, MINIMUM_ITEMS, RECORD_ITEMS, buildGuideJsonLd, jsonLdScript } from "../lib/guide.mjs";
import { absoluteUrl } from "../lib/site.mjs";

const abs = (p) => `https://example.test/kama-log${p}`;

test("記録項目は8つで、欠けた文章がない", () => {
  assert.equal(RECORD_ITEMS.length, 8);
  for (const i of RECORD_ITEMS) {
    assert.ok(i.name && i.what && i.tip, `incomplete: ${i.name}`);
  }
});

test("JSON-LD の FAQ は画面の FAQ と同じ問答", () => {
  const faq = buildGuideJsonLd(abs, "d").find((x) => x["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, FAQ.length);
  faq.mainEntity.forEach((q, i) => {
    assert.equal(q.name, FAQ[i].q);
    assert.equal(q.acceptedAnswer.text, FAQ[i].a);
  });
});

test("JSON-LD の URL は basePath 込みの絶対 URL", () => {
  const ld = buildGuideJsonLd(abs, "d");
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

test("最低限の項目は項目表に実在し、FAQ の答えと件数・名前が一致する", () => {
  const names = RECORD_ITEMS.map((i) => i.name);
  for (const m of MINIMUM_ITEMS) assert.ok(names.includes(m), m);
  const a = FAQ[0].a;
  assert.ok(a.startsWith(`${MINIMUM_ITEMS.join("・")}の${MINIMUM_ITEMS.length}つ`));
});

test("Article.headline は画面の h1 と同じ", () => {
  assert.equal(buildGuideJsonLd(abs, "d")[0].headline, GUIDE_HEADLINE);
});

test("sitemap にガイドが入っている", () => {
  const src = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
  assert.match(src, /^\s+GUIDE_PATH,$/m);
});

test("目次の href と section の id が一致する", () => {
  const src = readFileSync(new URL("../app/guide/page.tsx", import.meta.url), "utf8");
  const hrefs = [...src.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1]);
  const ids = [...src.matchAll(/<section id="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 6);
  assert.deepEqual(hrefs, ids);
});

test("本文に和文の途中の半角スペースが入らない書き方になっている", () => {
  const src = readFileSync(new URL("../app/guide/page.tsx", import.meta.url), "utf8");
  // 和文の行末で改行し、次行も和文で始まる書き方は JSX で半角スペースになる。
  assert.ok(!/[^\x00-\x7f]\n\s+[^\x00-\x7f]/.test(src));
});

test("JSON-LD の構造（共通化後も変わらない）: 日付・パンくず・種別", () => {
  const ld = buildGuideJsonLd(abs, "d");
  assert.deepEqual(ld.map((x) => x["@type"]), ["Article", "BreadcrumbList", "FAQPage"]);
  assert.equal(ld[0].datePublished, "2026-11-16");
  assert.ok(ld[0].dateModified >= ld[0].datePublished);
  assert.deepEqual(ld[1].itemListElement.map((i) => [i.position, i.name]), [[1, "窯ログ"], [2, "記録のつけ方"]]);
});
