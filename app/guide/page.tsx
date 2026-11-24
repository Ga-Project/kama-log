import type { Metadata } from "next";
import Link from "next/link";
import { absoluteUrl } from "../../lib/site.mjs";
import {
  FAQ,
  GUIDE_HEADLINE,
  GUIDE_PATH,
  MINIMUM_ITEMS,
  RECORD_ITEMS,
  buildGuideJsonLd,
  jsonLdScript,
} from "../../lib/guide.mjs";
import { TILE_PATH } from "../../lib/tile-guide.mjs";
import Disclaimer from "../components/Disclaimer";

const TITLE = "テストピースと窯焼きの記録のつけ方 — 自作釉薬を再現するために";
const DESCRIPTION =
  "自作釉薬のテストピースで、何を記録しておけば同じ焼きを再現できるのか。識別番号・調合・素地・施釉・焼成・棚位置・結果・写真の8項目と、続けるための進め方をまとめた入門ガイドです。";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(GUIDE_PATH) },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: absoluteUrl(GUIDE_PATH),
    type: "article",
    locale: "ja_JP",
    siteName: "窯ログ",
  },
  // 共有画像は用意していないので、大きな画像カードは指定しない。
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export default function GuidePage() {
  const jsonLd = buildGuideJsonLd(absoluteUrl, DESCRIPTION);
  return (
    <>
      <main id="main" tabIndex={-1} className="section guide">
        <p className="t-label">記録のつけ方</p>
        <h1 className="t-h1 guide__title">{GUIDE_HEADLINE}</h1>
        <p className="guide__lead">
          自作釉薬の試験では、良い焼きが出ても「どうやったか」が残っていなければ再現しにくくなります。ここでは、あとで同じ焼きを再現したり、違いを見比べたりするために、何を残しておくとよいかを順に説明します。ピースの形や識別番号の付け方は
          <Link href={TILE_PATH}>テストピースを作る前に決めること</Link>
          で説明しています。
        </p>

        <nav className="guide__toc" aria-label="このページの内容">
          <ol>
            <li><a href="#why">なぜ記録が要るのか</a></li>
            <li><a href="#items">残しておきたい{RECORD_ITEMS.length}項目</a></li>
            <li><a href="#one">変えるのは1回に1つ</a></li>
            <li><a href="#curve">焼成の記録と温度カーブ</a></li>
            <li><a href="#steps">窯ログでの進め方</a></li>
            <li><a href="#faq">よくある質問</a></li>
          </ol>
        </nav>

        <section id="why" className="guide__block">
          <h2 className="t-h2">なぜ記録が要るのか</h2>
          <p>
            同じ調合でも、素地の土、原料のロット、窯の癖、酸化か還元か、棚の位置、昇温と降温の経過によって、焼き上がりは変わります。調合のメモだけでは、うまくいった焼きを再現できないのはこのためです。
          </p>
          <p>
            一方で実際の記録は、手帳のメモ、スマホの写真、頭の中に散らばりがちです。窯出しの直後に、条件と結果を同じ場所へ残しておくと、数か月後でも読み返せます。
          </p>
        </section>

        <section id="items" className="guide__block">
          <h2 className="t-h2">残しておきたい{RECORD_ITEMS.length}項目</h2>
          <p>
            すべてを完璧に書く必要はありません。まず{MINIMUM_ITEMS.join("・")}の{MINIMUM_ITEMS.length}つから始めて、続けるうちに増やしていけば十分です。
          </p>
          <div className="guide__table">
            <table role="table" aria-label="残しておきたい記録項目">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">項目</th>
                  <th scope="col" role="columnheader">何を書くか</th>
                  <th scope="col" role="columnheader">書き方のコツ</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {RECORD_ITEMS.map((item) => (
                  <tr key={item.name} role="row">
                    <th scope="row" role="rowheader">{item.name}</th>
                    <td role="cell" data-label="何を書くか">{item.what}</td>
                    <td role="cell" data-label="書き方のコツ">{item.tip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="one" className="guide__block">
          <h2 className="t-h2">変えるのは1回に1つ</h2>
          <p>
            調合を少しずつ変えながら試すときは、1回に変える材料を1つにします。材料を同時に2つ以上動かすと、結果が変わった原因がどちらなのか分からなくなります。
          </p>
          <p>
            同じ調合を、素地や焼成を変えて焼いた場合も同じです。前回から変えた条件に印を付けておくと、並べたときに「どこが違ったか」がすぐ読み取れます。
          </p>
          <p>
            調合を変えながら並べる具体例は、
            <Link href={TILE_PATH}>テストピースを作る前に決めること</Link>
            にあります。
          </p>
        </section>

        <section id="curve" className="guide__block">
          <h2 className="t-h2">焼成の記録と温度カーブ</h2>
          <p>
            焼成では、最高温度だけでなく「どう上げて、どれだけ保って、どう下げたか」が結果に効きます。窯の前にいる間に、一定の間隔で経過時間と温度を控えておくと、あとから温度カーブとして描き直せます。
          </p>
          <p>
            還元焼成の場合は、雰囲気を切り替えた時刻も残します。棚の段数と、各ピースをどの棚に置いたかも一緒に記録しておくと、同じ窯の中での差も見比べられます。
          </p>
        </section>

        <section id="steps" className="guide__block">
          <h2 className="t-h2">窯ログでの進め方</h2>
          <ol className="guide__steps">
            <li>
              <strong>焼成を記録する。</strong>
              窯の前で、経過時間と温度の点を打っていきます。
              <Link href="/firings/">焼成の記録へ</Link>
            </li>
            <li>
              <strong>テストピースを記録する。</strong>
              識別番号・調合・所見・写真を入れ、どの焼成のどの棚に置いたかを選びます。
              <Link href="/pieces/new/">テストピースの記録へ</Link>
            </li>
            <li>
              <strong>同じ調合を並べて比べる。</strong>
              同じ調合のテストピースを横に並べ、前回と変わった条件に印を付けて表示します。
              <Link href="/compare/">並べて比べる</Link>
            </li>
            <li>
              <strong>書き出して保管する。</strong>
              記録はこの端末のブラウザの中にだけあるので、CSV に書き出して別の場所にも置いておきます。
              <Link href="/export/">書き出し</Link>
            </li>
          </ol>
          <p className="guide__note">
            アカウント登録は要りません。無料で、すべての機能が使えます。
          </p>
        </section>

        <section id="faq" className="guide__block">
          <h2 className="t-h2">よくある質問</h2>
          <dl className="guide__faq">
            {FAQ.map((f) => (
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
          <Link className="btn btn--secondary" href="/">
            炉前へ戻る
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
