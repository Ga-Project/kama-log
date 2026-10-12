/**
 * 窯ログ 受入E2E — コンソール check_items の機械実行版。
 * キーは check_items.key と一致させること（ずれるとランナーが警告を出す）。
 *
 * 方針: 実装内部を覗かず、人間の受入手順と同じ操作だけで判定する
 *       （実装から作ると誤った前提が製品とテストの両方に焼き付くため）。
 */

/** 焼成のセレクトは id が動的なので、画面から実際の option 値を読む。 */
async function firstFiringOptionValue(h) {
  return h.page.$eval("#firing", (el) => {
    const opt = Array.from(el.options).find((o) => o.value !== "");
    return opt ? opt.value : "";
  });
}

/** 焼成を1件つくる。既にあれば何もしない。 */
async function ensureFiring(h, { date, name, code, maxTemp }) {
  await h.goto("/firings/");
  const text = await h.text();
  if (text.includes(code)) return;

  await h.clickText("＋ 焼成を記録");
  await h.fillDate("#firing-date", date);
  await h.fill("#firing-name", name);
  await h.fill("#firing-code", code);
  await h.fill("#shelf-count", 3);
  // 室温から最高温度までの2点。カーブとして成立する最小限。
  await h.fill("#pt-min-0", "0:00");
  await h.fill("#pt-temp-0", 20);
  await h.clickText("＋ 点を追加");
  await h.fill("#pt-min-1", "10:00");
  await h.fill("#pt-temp-1", maxTemp);
  await h.clickText("保存する");
  await h.wait(500);
}

/** テストピースを1件つくる。 */
async function createPiece(h, { code, recipe, mix, note, firingIndex = 0, shelf = 2, results = [] }) {
  await h.goto("/pieces/new/");
  await h.fill("#code", code);
  await h.fill("#recipe", recipe);

  for (let i = 0; i < mix.length; i++) {
    if (i > 0) await h.clickText("＋ 材料を追加");
    await h.fill(`#material-${i}`, mix[i].material);
    await h.fill(`#parts-${i}`, mix[i].parts);
  }

  // 焼成を選ぶ（新しい順に並ぶので index で指す）。
  const values = await h.page.$eval("#firing", (el) =>
    Array.from(el.options)
      .map((o) => o.value)
      .filter((v) => v !== ""),
  );
  if (values[firingIndex]) await h.select("#firing", values[firingIndex]);

  await h.click(`input[name="shelf"][value="${shelf}"]`);
  for (const r of results) await h.clickText(r);
  await h.fill("#note", note);
  await h.clickText("保存する");
  await h.wait(500);
}

const MIX_ORIBE = [
  { material: "長石", parts: 35 },
  { material: "土灰", parts: 40 },
  { material: "珪石", parts: 25 },
];

/** 同じ調合を2件、違う焼成で作る（比較が成立する最小の状態）。 */
async function seedComparable(h) {
  await ensureFiring(h, { date: "2026-08-01", name: "本焼", code: "#F-01", maxTemp: 1230 });
  await ensureFiring(h, { date: "2026-08-05", name: "本焼", code: "#F-02", maxTemp: 1250 });

  await h.goto("/compare/");
  const already = await h.text();
  if (already.includes("A-01") && already.includes("A-02")) return;

  await createPiece(h, {
    code: "A-01",
    recipe: "織部A",
    mix: MIX_ORIBE,
    note: "上段は流れが強い。次は温度を下げる。",
    firingIndex: 1, // 古い方（#F-01）
    shelf: 2,
    results: ["貫入"],
  });
  await createPiece(h, {
    code: "A-02",
    recipe: "織部A",
    mix: MIX_ORIBE,
    note: "発色が深くなった。この条件で確定でよさそう。",
    firingIndex: 0, // 新しい方（#F-02）
    shelf: 3,
    results: ["良好"],
  });
}

export const items = {
  /** 空の窯（棚と炉床）がトップに表示される */
  "empty-kiln-visible": async (h) => {
    await h.goto("/");
    await h.expectText("冷めた窯を、あとで読み返せるように。");
    await h.expectText("棚 3");
    await h.expectText("棚 1");
    await h.expectText("基線");
  },

  /** 写真がなくても、識別番号と所見だけでテストピースを保存できる */
  "record-without-photo": async (h) => {
    await h.goto("/pieces/new/");
    await h.fill("#code", "Z-99");
    await h.fill("#note", "写真は撮り忘れたが、貫入が細かく入った。");
    await h.clickText("保存する");
    await h.wait(600);
    await h.expectText("Z-99 を保存しました");
  },

  /** 識別番号と所見が空だと保存されず、理由が文章で出る */
  "required-fields-blocked": async (h) => {
    await h.goto("/pieces/new/");
    // 自動採番された識別番号を消して、所見も空のまま保存する。
    await h.fill("#code", "");
    await h.clickText("保存する");
    await h.wait(400);
    await h.expectText("識別番号を入力してください");
    await h.expectText("所見を入力してください");
    await h.expectNoText("を保存しました");
  },

  /** 焼成の温度カーブを記録すると、最高温度と総焼成時間が出る */
  "record-firing-curve": async (h) => {
    await ensureFiring(h, { date: "2026-08-01", name: "本焼", code: "#F-01", maxTemp: 1230 });
    await h.goto("/firings/");
    await h.expectText("#F-01");
    await h.expectMatch(/1230/, "最高温度");
    await h.expectMatch(/10:00/, "総焼成時間");
  },

  /** 同じ調合のテストピースが比較レールに並ぶ */
  "compare-same-recipe": async (h) => {
    await seedComparable(h);
    await h.goto("/compare/");
    await h.expectText("織部A");
    await h.expectText("A-01");
    await h.expectText("A-02");
    await h.expectText("最高温度");
    await h.expectText("棚位置");
  },

  /** 前回と条件が変わったところに印が付く */
  "compare-diff-marked": async (h) => {
    await seedComparable(h);
    await h.goto("/compare/");
    // 最高温度が 1230 → 1250 と変わっているので、差分セルが1つ以上あるはず。
    const changed = await h.page.$$eval('td[data-changed="true"]', (els) => els.length);
    if (changed < 1) {
      throw new Error("条件が変わっているのに差分の印が1つも付いていません");
    }
    h.note(`差分セル ${changed} 個を確認`);
  },

  /** 「色片だけを並べる」で発色だけの一覧になる */
  "swatch-only-mode": async (h) => {
    await seedComparable(h);
    await h.goto("/compare/");
    await h.clickText("色片だけを並べる");
    await h.wait(400);
    await h.expectText("A-01");
    // 表の比較軸（棚位置）は消えて、色片だけが残る。
    await h.expectNoText("棚位置");
  },

  /** 記録が CSV に書き出せる */
  "export-csv": async (h) => {
    await seedComparable(h);
    await h.goto("/export/");
    await h.expectText("CSV に書き出す");
    await h.expectMatch(/テストピース（\d+ 件）/, "書き出せる件数");
  },

  /** 再読み込みしても記録が残っている（端末内保存が効いている） */
  "records-persist": async (h) => {
    await seedComparable(h);
    await h.goto("/");
    await h.goto("/compare/");
    await h.expectText("A-01");
    h.note("再読み込み後も記録が残っている");
  },

  /** スマホ幅でも横に崩れない */
  "mobile-layout": async (h) => {
    await h.viewport(375, 812);
    await h.goto("/");
    await h.expectNoHorizontalOverflow();
    await h.goto("/compare/");
    await h.expectNoHorizontalOverflow();
    await h.viewport(1280, 900);
  },
};

export const designStates = {
  /** 値が入って結果が見えている状態（デザイン判定の主画面）。 */
  "main-populated": async (h) => {
    await seedComparable(h);
    await h.goto("/");
    await h.wait(500);
  },

  /** 焼成詳細（棚＋温度カーブが両方見えている面）。 */
  "firing-detail": async (h) => {
    await seedComparable(h);
    await h.goto("/firings/");
    await h.clickText("#F-02");
    await h.wait(500);
  },

  /** 比較レール（この製品の中核）。 */
  "compare-rail": async (h) => {
    await seedComparable(h);
    await h.goto("/compare/");
    await h.wait(500);
  },

  /** テストピース登録フォーム。 */
  "piece-form": async (h) => {
    await h.goto("/pieces/new/");
    await h.wait(400);
  },

  /** 暗い配色へ切り替える。切替ボタンはアイコンのみなので、文字ではなく要素で押す。 */
  dark: async (h) => {
    await h.goto("/");
    await h.click(".theme-toggle");
    await h.wait(400);
  },
};
