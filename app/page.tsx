import Link from "next/link";
import KilnHome from "./components/KilnHome";
import Disclaimer from "./components/Disclaimer";

export default function Home() {
  return (
    <>
      {/* 炉口。下辺の 3px がそのまま断面スタックの小口として続く＝hero と本体が同じ構造物。 */}
      <div className="hero coursing">
        <div className="hero__inner">
          <h1 className="t-display hero__title">
            冷めた窯を、あとで読み返せるように。
          </h1>
          <p className="hero__lead">
            自作釉薬のテストピースと焼成の条件を、この端末の中だけに記録します。
            うまくいかなかった焼きほど、あとで効きます。
          </p>
          <div className="hero__actions">
            <Link className="btn btn--primary" href="/pieces/new/">
              テストピースを記録
            </Link>
            <Link className="btn btn--secondary" href="/firings/">
              焼成を記録
            </Link>
          </div>
          <p className="hero__meta t-small">
            アカウント不要 ・ 端末内保存 ・ 無料 ・ 記録は外部に送信しません
          </p>
        </div>
      </div>

      <main id="main" tabIndex={-1}>
        <KilnHome />
      </main>

      <Disclaimer />
    </>
  );
}
