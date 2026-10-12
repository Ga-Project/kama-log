import type { Metadata } from "next";
import type { ReactNode } from "react";
import { absoluteUrl } from "../lib/site.mjs";
import TopBar from "./components/TopBar";
import "./globals.css";

const TITLE = "窯ログ — 陶芸のテストピースと窯焼きの記録ノート";
const DESCRIPTION =
  "自作釉薬のテストピースと窯焼きの条件を記録して、同じ調合の結果を並べて見比べるためのノートです。配合・所見・写真・識別番号と、温度カーブ・酸化還元・棚位置を残せます。記録はこの端末のブラウザの中にだけ保存され、アカウント登録は要りません。";

export const metadata: Metadata = {
  metadataBase: new URL(absoluteUrl("/")),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/") },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: absoluteUrl("/"),
    type: "website",
    locale: "ja_JP",
    siteName: "窯ログ",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// テーマの復元をレンダリング前に済ませ、初回描画のちらつきを避ける。
// localStorage に入れるのは "light" / "dark" の1語だけ（記録データは一切入れない）。
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("kama-log:theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {/* アクセス解析（cookieless・秘密キー不要）: 全プロダクト共通の単一 GoatCounter サイト
            「ga-project」に集約する。製品ごとの数値は path（/kama-log/）で区別されるので、
            GoatCounter 側でサイトを新規作成しない。 */}
        <script
          data-goatcounter="https://ga-project.goatcounter.com/count"
          async
          src="//gc.zgo.at/count.js"
        />
        <a className="skip-link" href="#main">
          本文へスキップ
        </a>
        <TopBar />
        {children}
      </body>
    </html>
  );
}
