// 404。static export では out/404.html に書き出される（GitHub Pages の 404 として使われる）。
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ページが見つかりません — 窯ログ",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="section" style={{ maxWidth: 640 }}>
      <p className="t-label">404</p>
      <h1 className="t-h1" style={{ marginTop: 8 }}>
        この棚には何も置かれていません。
      </h1>
      <p style={{ marginTop: 16 }}>
        お探しのページは見つかりませんでした。アドレスが変わったか、削除された可能性があります。
        記録そのものはこの端末の中に残っていますので、炉前から開き直してください。
      </p>
      <div className="row-gap" style={{ marginTop: 32 }}>
        <Link className="btn btn--primary" href="/">
          炉前へ戻る
        </Link>
        <Link className="btn btn--secondary" href="/compare/">
          並べて比べる
        </Link>
      </div>
    </main>
  );
}
