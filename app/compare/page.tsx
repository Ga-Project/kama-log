import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site.mjs";
import CompareView from "../components/CompareView";
import Disclaimer from "../components/Disclaimer";

export const metadata: Metadata = {
  title: "同じ調合を並べて比べる — 窯ログ",
  description:
    "同じ配合のテストピースを横一列に並べ、焼成条件と結果を見比べます。前回と変わった条件には印が付きます。",
  // sitemap に個別に載せる経路なので、canonical もこの経路自身を指す
  // （ルートの canonical を継承すると、全ページがトップの重複として扱われる）。
  alternates: { canonical: absoluteUrl("/compare/") },
};

export default function ComparePage() {
  return (
    <>
      <CompareView />
      <Disclaimer />
    </>
  );
}
