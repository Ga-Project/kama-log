import { Suspense } from "react";
import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site.mjs";
import FiringsView from "../components/FiringsView";
import Disclaimer from "../components/Disclaimer";

export const metadata: Metadata = {
  title: "焼成の記録 — 窯ログ",
  description:
    "窯焼きの温度カーブ・酸化還元・棚位置を記録します。手で打った点がそのままカーブになります。",
  // sitemap に個別に載せる経路なので、canonical もこの経路自身を指す
  // （ルートの canonical を継承すると、全ページがトップの重複として扱われる）。
  alternates: { canonical: absoluteUrl("/firings/") },
};

export default function FiringsPage() {
  return (
    <>
      <Suspense fallback={<LoadingShell />}>
        <FiringsView />
      </Suspense>
      <Disclaimer />
    </>
  );
}

function LoadingShell() {
  return (
    <main id="main" tabIndex={-1} className="section" aria-busy="true">
      <h1 className="t-h1">焼成</h1>
      <p className="muted t-small" style={{ marginTop: 16 }}>
        読み込んでいます…
      </p>
    </main>
  );
}
