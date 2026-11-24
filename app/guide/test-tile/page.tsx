import type { Metadata } from "next";
import Link from "next/link";
import { absoluteUrl } from "../../../lib/site.mjs";
import { GUIDE_PATH, jsonLdScript } from "../../../lib/guide.mjs";
import {
  TILE_FAQ,
  TILE_HEADLINE,
  TILE_LAYOUT,
  TILE_PATH,
  TILE_SHAPES,
  buildTileJsonLd,
} from "../../../lib/tile-guide.mjs";
import Disclaimer from "../../components/Disclaimer";

const TITLE = "自作釉薬のテストピースを作る前に決めること — 形・識別番号・並べ方";
const DESCRIPTION =
  "自作釉薬のテストピースを作る前に決めておきたい、形と大きさの考え方、識別番号の付け方、調合を少しずつ変えるときの並べ方、記録のしかたをまとめたガイドです。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(TILE_PATH) },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: absoluteUrl(TILE_PATH),
    type: "article",
    locale: "ja_JP",
    siteName: "窯ログ",
  },
  // 共有画像は用意していないので、大きな画像カードは指定しない。
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export default function TestTilePage() {
  const jsonLd = buildTileJsonLd(absoluteUrl, DESCRIPTION);
  return (
    <>
      <main id="main" tabIndex={-1} className="section guide">
        <nav className="t-label guide__crumb" aria-label="パンくず">
          <Link href={GUIDE_PATH}>記録のつけ方</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">作る前に決めること</span>
        </nav>
        <h1 className="t-h1 guide__title">{TILE_HEADLINE}</h1>
        <p className="guide__lead">
          テストピースは、釉薬の調合を小さく試して、結果を比べて残すための試験片です。ここでは成形の手順ではなく、作る前に決めておくことを順に説明します。形と大きさの考え方、識別番号、調合を変えながら並べる方法、記録のしかたです。大きさは窯や素地によって変わるため、数値では決めていません。
        </p>

        <nav className="guide__toc" aria-label="このページの内容">
          <ol>
            <li><a href="#role">テストピースの役割</a></li>
            <li><a href="#shape">形と大きさの決め方</a></li>
            <li><a href="#number">識別番号の付け方</a></li>
            <li><a href="#layout">調合を変えながら並べる</a></li>
            <li><a href="#record">窯ログでの記録</a></li>
            <li><a href="#faq">よくある質問</a></li>
          </ol>
        </nav>

        <section id="role" className="guide__block">
          <h2 className="t-h2">テストピースの役割</h2>
          <p>
            結果は調合だけでなく、素地や焼成、棚の位置でも変わります。そのため、ピースと一緒にその条件を残します。ピースに書いた番号が、そのピースの記録を探す主な手がかりになります。
          </p>
        </section>

        <section id="shape" className="guide__block">
          <h2 className="t-h2">形と大きさの決め方</h2>
          <p>
            大きさは窯や素地で適したものが変わるため、使っているものに合わせて決めます。形は、何を見たいかで選びます。
          </p>
          <div className="guide__table">
            <table role="table" aria-label="形の種類と向いている見方">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">形</th>
                  <th scope="col" role="columnheader">向いている見方</th>
                  <th scope="col" role="columnheader">気をつけること</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {TILE_SHAPES.map((s) => (
                  <tr key={s.name} role="row">
                    <th scope="row" role="rowheader">{s.name}</th>
                    <td role="cell" data-label="向いている見方">{s.use}</td>
                    <td role="cell" data-label="気をつけること">{s.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            毎回同じ形・同じ大きさにそろえると、並べたときに違いの原因を読み取りやすくなります。
          </p>
        </section>

        <section id="number" className="guide__block">
          <h2 className="t-h2">識別番号の付け方</h2>
          <p>
            識別番号は、ピースと記録を1対1で結ぶ番号です。「A-01」「A-02」のように、接頭辞と連番を組み合わせると、増えても並びが分かります。窯ログでは、既にある番号の続きを自動で提案します。
          </p>
          <p>
            番号はピースの裏の、釉薬が掛からない面へ書きます。焼くと消える筆記具は使えないので、刻印や、焼いても残る筆書きにします。
          </p>
        </section>

        <section id="layout" className="guide__block">
          <h2 className="t-h2">調合を変えながら並べる</h2>
          <p>
            調合を少しずつ変えるときは、変える材料を1つに決め、その部数だけを一定の刻みで動かします。ほかの材料と、素地・施釉・焼成は同じにそろえます。考え方は
            <Link href={`${GUIDE_PATH}#one`}>変えるのは1回に1つ</Link>
            と同じです。
          </p>
          <div className="guide__table">
            <table role="table" aria-label="調合を変えながら並べる例">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">識別番号</th>
                  <th scope="col" role="columnheader">土灰（部）</th>
                  <th scope="col" role="columnheader">メモ</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {TILE_LAYOUT.map((r) => (
                  <tr key={r.code} role="row">
                    <th scope="row" role="rowheader">{r.code}</th>
                    <td role="cell" data-label="土灰（部）">{r.ash}</td>
                    <td role="cell" data-label="メモ">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="guide__note">
            数値は説明のための例です。ほかの材料の部数は同じにします。
          </p>
          <p>
            並べたピースは同じ焼成で焼きます。比べたいピースは同じ段に置き、置いた棚も記録します。
          </p>
        </section>

        <section id="record" className="guide__block">
          <h2 className="t-h2">窯ログでの記録</h2>
          <p>
            焼いたあとの入力は
            <Link href="/pieces/new/">テストピースを記録</Link>
            の画面から始めます。同じ調合のピースは、
            <Link href="/compare/">並べて比べる</Link>
            画面で見比べられます。
          </p>
        </section>

        <section id="faq" className="guide__block">
          <h2 className="t-h2">よくある質問</h2>
          <dl className="guide__faq">
            {TILE_FAQ.map((f) => (
              <div key={f.q} className="guide__faq-item">
                <dt className="t-h3">{f.q}</dt>
                <dd>{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="row-gap guide__cta">
          <Link className="btn btn--primary" href="/pieces/new/">
            テストピースを記録する
          </Link>
          <Link className="btn btn--secondary" href={GUIDE_PATH}>
            記録のつけ方へ戻る
          </Link>
        </div>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
        />
      </main>
      <Disclaimer />
    </>
  );
}
