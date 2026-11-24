// tile-guide.mjs — 「テストピースの作り方」ページ（/guide/test-tile/）の内容と構造化データ。
//
// 画面の FAQ と FAQPage JSON-LD を同じ配列から作る（guide.mjs と同じ方針）。

import { GUIDE_PATH, buildArticleJsonLd } from "./guide.mjs";

export const TILE_PATH = "/guide/test-tile/";

/** 画面の h1 と Article.headline を同じ値にする。 */
export const TILE_HEADLINE = "自作釉薬のテストピースを作る前に決めること";

/** 形の選び方。画面の表と同じ配列。大きさは窯や素地で変わるため数値は断定しない。 */
export const TILE_SHAPES = [
  {
    name: "平らな板",
    use: "色・つや・肌合いを見比べる。",
    note: "棚に何枚も並べやすい。流れを見たいときは別の形が向く。",
  },
  {
    name: "立てて焼ける形",
    use: "釉薬の流れや溜まりを見る。",
    note: "垂れた先が棚板に付かないよう、窯の中での置き方を決めておく。",
  },
  {
    name: "くぼみ・段差のある形",
    use: "厚みの違いによる色の差を見る。",
    note: "施釉の厚さを変えたものは、そのことを記録に書く。",
  },
];

/** 並べ方の例（数値は説明のための架空の部数）。 */
export const TILE_LAYOUT = [
  { code: "A-01", ash: 35, note: "基準" },
  { code: "A-02", ash: 40, note: "土灰だけ +5" },
  { code: "A-03", ash: 45, note: "土灰だけ +10" },
];

export const TILE_FAQ = [
  {
    q: "テストピースの大きさは、どう決めればよいですか。",
    a: "窯や素地の土によって適した大きさが変わるため、決まった大きさはありません。使っている窯の棚に、見比べたい枚数が並べられるかを基準にして、何度か試しながら自分の窯に合う大きさを決めてください。",
  },
  {
    q: "識別番号を途中で付け替えてもよいですか。",
    a: "付け替えると、ピースに書いた番号と記録の対応が崩れるので、避けてください。調合の系列ごとに分けたいときは、「A-01」「B-01」のように接頭辞を変える方法があります。",
  },
  {
    q: "同じ調合のテストピースは何枚作ればよいですか。",
    a: "決まった枚数はありません。素地や焼成の条件を変えて比べたいときは、同じ調合を条件ごとに1枚ずつ作ると、違いを見比べやすくなります。",
  },
  {
    q: "並べて焼くとき、棚の位置は気にしたほうがよいですか。",
    a: "位置が違うと、その差が結果に混ざることがあります。調合を比べたいピースは同じ段に置き、置けないときは置いた段を記録に残しておくと読み取りやすくなります。",
  },
  {
    q: "テストピースの形は、毎回そろえたほうがよいですか。",
    a: "そろえると、並べたときに違いの原因を読み取りやすくなります。形を変えるときは、変えたことを所見に書いておくと、あとで見比べるときに迷いません。",
  },
];

/**
 * 構造化データ（JSON-LD）。Article / BreadcrumbList / FAQPage。
 * @param {(path: string) => string} abs 絶対 URL を作る関数（basePath 込み）
 * @param {string} description ページの説明
 */
export function buildTileJsonLd(abs, description) {
  return buildArticleJsonLd(abs, {
    headline: TILE_HEADLINE,
    description,
    path: TILE_PATH,
    modified: "2026-11-25",
    crumbs: [
      { name: "記録のつけ方", path: GUIDE_PATH },
      { name: "作る前に決めること", path: TILE_PATH },
    ],
    faq: TILE_FAQ,
  });
}
