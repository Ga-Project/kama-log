import { Suspense } from "react";
import type { Metadata } from "next";
import { absoluteUrl } from "../../../lib/site.mjs";
import PieceForm from "../../components/PieceForm";
import Disclaimer from "../../components/Disclaimer";

export const metadata: Metadata = {
  title: "テストピースを記録 — 窯ログ",
  description:
    "自作釉薬のテストピースを記録します。配合・所見・結果・写真・棚位置を残せます。写真がなくても所見だけで保存できます。",
  // sitemap に個別に載せる経路なので、canonical もこの経路自身を指す
  // （ルートの canonical を継承すると、全ページがトップの重複として扱われる）。
  alternates: { canonical: absoluteUrl("/pieces/new/") },
};

export default function NewPiecePage() {
  return (
    <>
      {/* useSearchParams は static export では Suspense 境界が要る。 */}
      <Suspense fallback={<LoadingShell />}>
        <PieceForm />
      </Suspense>
      <Disclaimer />
    </>
  );
}

function LoadingShell() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="section"
      style={{ maxWidth: 760 }}
      aria-busy="true"
    >
      <h1 className="t-h1">テストピースを記録</h1>
      <p className="muted t-small" style={{ marginTop: 16 }}>
        読み込んでいます…
      </p>
    </main>
  );
}
