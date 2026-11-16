// guide.mjs — 入門ガイド（/guide/）の内容と構造化データ。
//
// 画面に出す文章と JSON-LD（FAQPage）を同じ配列から作る。
// 別々に書くと、画面と検索結果に出る内容がずれる。

export const GUIDE_PATH = "/guide/";

/** ガイドの見出し（画面の h1 と Article.headline を同じ値にする）。 */
export const GUIDE_HEADLINE = "テストピースと窯焼きの記録のつけ方";

/** まず始めるときに残す項目（本文と FAQ が同じ配列を使う）。RECORD_ITEMS の name と一致させる。 */
export const MINIMUM_ITEMS = ["識別番号", "配合", "焼成", "結果"];

/** 残しておきたい記録項目。画面の表と同じ配列。 */
export const RECORD_ITEMS = [
  {
    name: "識別番号",
    what: "ピースと記録を1対1で結ぶ番号。",
    tip: "ピースの裏に、釉薬が掛からない面へ番号を書く（刻印・酸化金属での筆書き）。焼くと消える鉛筆やペンは使えない。",
  },
  {
    name: "配合",
    what: "材料の名前と、それぞれの部数。",
    tip: "合計を100に揃えなくてよい。ただし毎回同じ量り方（乾燥重量など）にする。",
  },
  {
    name: "素地",
    what: "土の種類と、素焼きの有無。",
    tip: "同じ釉薬でも土が変わると色が変わる。土の名前は省略せず書く。",
  },
  {
    name: "施釉",
    what: "掛け方（浸し掛け・吹き掛け・刷毛塗り）と厚さ。",
    tip: "厚さは「薄い・普通・厚い」の3段階でも、続けて同じ基準なら十分に使える。",
  },
  {
    name: "焼成",
    what: "最高温度、昇温・保持・降温の経過、酸化か還元か。",
    tip: "温度は窯の表示だけでなく、記録した時刻とセットで残す。途中で雰囲気を変えたなら、その時刻も書く。",
  },
  {
    name: "棚位置",
    what: "窯のどの段の、どのあたりに置いたか。",
    tip: "同じ窯でも、上段と下段、奥と手前で温度や炎の当たり方が違う。",
  },
  {
    name: "結果",
    what: "色・つや・流れ・縮れ・ピンホール・貫入など。",
    tip: "失敗も同じ重さで書く。「何をしたら出なくなったか」が次の配合の手がかりになる。",
  },
  {
    name: "写真",
    what: "窯出しした状態の写真。",
    tip: "同じ場所・同じ光・同じ背景で撮る。色を見比べるのが目的なので、毎回の条件をそろえる。",
  },
];

/** よくある質問。画面と FAQPage JSON-LD の両方に使う。 */
export const FAQ = [
  {
    q: "テストピースの記録には、何を最低限残せばよいですか。",
    a: `${MINIMUM_ITEMS.join("・")}の${MINIMUM_ITEMS.length}つです。焼成は最高温度と酸化・還元まで、結果は所見の文章で足ります。素地、施釉の厚さ、棚位置、写真が加わると、あとで同じ焼きを再現しやすくなります。`,
  },
  {
    q: "同じ配合でも、焼くたびに結果が変わるのはなぜですか。",
    a: "素地の土、原料のロット、窯の癖、酸化・還元の雰囲気、棚の位置、昇温と降温の経過などが結果に影響するためです。配合だけを記録しても再現できないことがあり、焼成の条件を一緒に残す理由はここにあります。",
  },
  {
    q: "窯ログで釉薬の計算（ゼーゲル式など）はできますか。",
    a: "できません。窯ログは記録と見比べに絞っています。配合の計算は、既にある計算ツールをお使いください。計算で決めた配合を、窯ログにテストピースとして記録していく使い方を想定しています。",
  },
  {
    q: "記録はどこに保存されますか。消えることはありますか。",
    a: "記録した内容（配合・所見・写真など）は、お使いのブラウザの中（この端末）にだけ保存され、サーバーには送信されません。ページの閲覧数だけは匿名で集計しています。ブラウザのデータ削除や端末の容量不足で記録が消えることがあるため、大切な記録は「書き出し」からCSVとして別の場所に保管してください。",
  },
  {
    q: "料金はかかりますか。アカウント登録は必要ですか。",
    a: "無料で、アカウント登録は要りません。すべての機能が使えます。",
  },
];

/**
 * 構造化データ（JSON-LD）。Article / BreadcrumbList / FAQPage。
 * @param {(path: string) => string} abs 絶対 URL を作る関数（basePath 込み）
 * @param {string} description ガイドの説明
 */
export function buildGuideJsonLd(abs, description) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: GUIDE_HEADLINE,
      description,
      datePublished: "2026-11-16",
      dateModified: "2026-11-16",
      inLanguage: "ja",
      mainEntityOfPage: abs(GUIDE_PATH),
      author: { "@type": "Organization", name: "窯ログ" },
      publisher: { "@type": "Organization", name: "窯ログ" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "窯ログ", item: abs("/") },
        { "@type": "ListItem", position: 2, name: "記録のつけ方", item: abs(GUIDE_PATH) },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
}

/**
 * JSON-LD を <script> に埋め込む文字列にする。
 * "<" をエスケープして、文字列中の "</script>" で script が閉じるのを防ぐ。
 * @param {unknown} data
 */
export function jsonLdScript(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
