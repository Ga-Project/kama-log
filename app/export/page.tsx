import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site.mjs";
import ExportView from "../components/ExportView";
import Disclaimer from "../components/Disclaimer";

export const metadata: Metadata = {
  title: "書き出し — 窯ログ",
  description:
    "記録を CSV に書き出して保管します。端末の保存領域の使用状況も確認できます。",
  // sitemap に個別に載せる経路なので、canonical もこの経路自身を指す
  // （ルートの canonical を継承すると、全ページがトップの重複として扱われる）。
  alternates: { canonical: absoluteUrl("/export/") },
};

export default function ExportPage() {
  return (
    <>
      <ExportView />
      <Disclaimer />
    </>
  );
}
