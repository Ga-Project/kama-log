import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TILE_FAQ, TILE_HEADLINE, TILE_LAYOUT, TILE_PATH, TILE_SHAPES, buildTileJsonLd } from "../lib/tile-guide.mjs";
import { GUIDE_PATH, jsonLdScript } from "../lib/guide.mjs";
import { absoluteUrl } from "../lib/site.mjs";
import { nextPieceCode } from "../lib/model.mjs";

const abs = (p) => `https://example.test/kama-log${p}`;
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("パスは末尾スラッシュ付きで、ガイド配下にある", () => {
  assert.ok(TILE_PATH.endsWith("/"));
  assert.ok(TILE_PATH.startsWith(GUIDE_PATH));
  assert.ok(absoluteUrl(TILE_PATH).endsWith("/guide/test-tile/"));
});

test("FAQ と形の表に欠けた文章がない", () => {
  for (const f of TILE_FAQ) assert.ok(f.q && f.a);
  for (const s of TILE_SHAPES) assert.ok(s.name && s.use && s.note);
});

test("JSON-LD の FAQ は画面の FAQ と同じ問答", () => {
  const faq = buildTileJsonLd(abs, "d").find((x) => x["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, TILE_FAQ.length);
  faq.mainEntity.forEach((q, i) => {
    assert.equal(q.name, TILE_FAQ[i].q);
    assert.equal(q.acceptedAnswer.text, TILE_FAQ[i].a);
  });
});

test("Article の URL・見出しと、パンくずが basePath 込みで正しい", () => {
  const ld = buildTileJsonLd(abs, "d");
  assert.equal(ld[0].headline, TILE_HEADLINE);
  assert.equal(ld[0].mainEntityOfPage, "https://example.test/kama-log/guide/test-tile/");
  const items = ld[1].itemListElement;
  assert.deepEqual(items.map((i) => i.position), [1, 2, 3]);
  assert.equal(items[1].item, "https://example.test/kama-log/guide/");
  assert.equal(items[2].item, ld[0].mainEntityOfPage);
});

test("更新日が公開日以降で、パンくずの先頭がサイト名", () => {
  const ld = buildTileJsonLd(abs, "d");
  assert.ok(ld[0].dateModified >= ld[0].datePublished);
  assert.equal(ld[1].itemListElement[0].name, "窯ログ");
});

test("jsonLdScript は script を閉じる文字列を埋め込まない", () => {
  assert.ok(!jsonLdScript(buildTileJsonLd(abs, "</script>")).includes("</script>"));
});

test("並べ方の例は番号が窯ログの採番に続き、変わるのは土灰だけ", () => {
  const codes = TILE_LAYOUT.map((r) => r.code);
  for (let i = 1; i < codes.length; i++) {
    assert.equal(nextPieceCode(codes.slice(0, i), "A"), codes[i]);
  }
  // 刻みが一定（本文の「一定の刻みで動かす」と一致）。基準の行は増分なし。
  const steps = TILE_LAYOUT.slice(1).map((r, i) => r.ash - TILE_LAYOUT[i].ash);
  assert.ok(steps.every((d) => d === steps[0] && d > 0));
});

test("sitemap と /guide/ からのリンクがある", () => {
  assert.match(read("../app/sitemap.ts"), /^\s+TILE_PATH,$/m);
  assert.ok(read("../app/guide/page.tsx").includes("href={TILE_PATH}"));
  assert.ok(read("../app/guide/test-tile/page.tsx").includes("href={GUIDE_PATH}"));
});

test("目次の href と section の id が一致する", () => {
  const src = read("../app/guide/test-tile/page.tsx");
  const hrefs = [...src.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1]);
  const ids = [...src.matchAll(/<section id="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 6);
  assert.deepEqual(hrefs, ids);
});

test("和文の途中の半角スペースが入らない書き方になっている", () => {
  const src = read("../app/guide/test-tile/page.tsx");
  assert.ok(!/[^\x00-\x7f]\n\s+[^\x00-\x7f]/.test(src));
});

// 対象は新規の2ファイルだけ（既存ガイドには「鉛筆」など原料名と同じ字を含む語があるため）。
test("安全・衛生・効能に関する語を含めない", () => {
  const all = read("../lib/tile-guide.mjs") + read("../app/guide/test-tile/page.tsx");
  for (const w of ["安全", "衛生", "毒", "健康", "食品", "有害", "鉛", "溶出"]) {
    assert.ok(!all.includes(w), w);
  }
});
