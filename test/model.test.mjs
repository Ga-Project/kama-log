import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_RESULT_SEPARATOR,
  composeResults,
  isShelfInRange,
  looksLikeColorant,
  mixPercentages,
  mixSignature,
  mixTotal,
  nextPieceCode,
  normalizeShelfCount,
  partitionResults,
  piecesOffShelf,
  resultsSignature,
  shelfSubLabel,
  shelvesTopDown,
  sortFiringsNewestFirst,
  uniqueOptionLabels,
  validatePiece,
  firingLabel,
} from "../lib/model.mjs";

test("mixTotal は材料名が空の行を無視する", () => {
  const mix = [
    { material: "長石", parts: 35, colorant: false },
    { material: "", parts: 999, colorant: false },
    { material: "土灰", parts: 40, colorant: false },
  ];
  assert.equal(mixTotal(mix), 75);
});

test("mixPercentages は合計を100として正規化する（parts 表記のまま扱える）", () => {
  const mix = [
    { material: "長石", parts: 35, colorant: false },
    { material: "土灰", parts: 40, colorant: false },
    { material: "珪石", parts: 25, colorant: false },
  ];
  const rows = mixPercentages(mix);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].percent, 35);
  assert.equal(rows[1].percent, 40);
  assert.equal(rows[2].percent, 25);
});

test("mixPercentages は合計0でも0除算を出さない", () => {
  const rows = mixPercentages([{ material: "長石", parts: 0, colorant: false }]);
  assert.equal(rows[0].percent, 0);
  assert.ok(Number.isFinite(rows[0].percent));
});

test("mixSignature は比率が同じなら同一調合とみなす", () => {
  const a = [
    { material: "長石", parts: 35, colorant: false },
    { material: "土灰", parts: 40, colorant: false },
    { material: "珪石", parts: 25, colorant: false },
  ];
  // 全て2倍。実務では同じ調合を倍量で仕込むことがある。
  const b = [
    { material: "長石", parts: 70, colorant: false },
    { material: "土灰", parts: 80, colorant: false },
    { material: "珪石", parts: 50, colorant: false },
  ];
  assert.equal(mixSignature(a), mixSignature(b));
});

test("mixSignature は材料の並び順と表記ゆれに依存しない", () => {
  const a = [
    { material: "長石", parts: 50, colorant: false },
    { material: " 土灰 ", parts: 50, colorant: false },
  ];
  const b = [
    { material: "土灰", parts: 50, colorant: false },
    { material: "長石", parts: 50, colorant: false },
  ];
  assert.equal(mixSignature(a), mixSignature(b));
});

test("mixSignature は同じ材料が複数行に分かれていても合算する", () => {
  // 入力の行の切り方は人それぞれ（あとから追記すると同じ材料が2行になる）。
  // 行の切り方で比較のグループが割れると「同じ配合を並べる」が成立しない。
  const split = [
    { material: "長石", parts: 20, colorant: false },
    { material: "長石", parts: 30, colorant: false },
    { material: "珪石", parts: 50, colorant: false },
  ];
  const merged = [
    { material: "長石", parts: 50, colorant: false },
    { material: "珪石", parts: 50, colorant: false },
  ];
  assert.equal(mixSignature(split), mixSignature(merged));
});

test("mixSignature は合算しても材料ごとに1項目だけを持つ", () => {
  const signature = mixSignature([
    { material: "長石", parts: 20, colorant: false },
    { material: " 長石 ", parts: 30, colorant: false },
    { material: "珪石", parts: 50, colorant: false },
  ]);
  assert.equal(signature.split("|").length, 2);
});

test("mixSignature は負の部数を 0 として扱う（編集画面の表示と一致させる）", () => {
  const a = [
    { material: "長石", parts: 50, colorant: false },
    { material: "珪石", parts: -10, colorant: false },
  ];
  const b = [
    { material: "長石", parts: 50, colorant: false },
    { material: "珪石", parts: 0, colorant: false },
  ];
  assert.equal(mixSignature(a), mixSignature(b));
});

test("mixSignature は少量の着色材の違いを潰さない", () => {
  // この画面は 0.1 部の入力を認めている（step 0.1）。比率を小数第1位で丸めると
  // 呉須 0.10 と 0.14 が同じ鍵になり、比較は1グループに束ねて先頭の配合バーしか描かない。
  // ＝調合を変えて焼き比べたという記録そのものが画面から消える。
  const a = [
    { material: "長石", parts: 100, colorant: false },
    { material: "呉須", parts: 0.1, colorant: true },
  ];
  const b = [
    { material: "長石", parts: 100, colorant: false },
    { material: "呉須", parts: 0.14, colorant: true },
  ];
  assert.notEqual(mixSignature(a), mixSignature(b));
  // 倍量で仕込んだだけなら、少量の側も同じ調合のまま。
  const doubled = [
    { material: "長石", parts: 200, colorant: false },
    { material: "呉須", parts: 0.2, colorant: true },
  ];
  assert.equal(mixSignature(a), mixSignature(doubled));
});

test("mixSignature は合算で出る浮動小数の誤差で調合を割らない", () => {
  // 0.1 + 0.2 は 0.30000000000000004 になる。行の切り方が違うだけで別の調合にしない。
  const split = [
    { material: "長石", parts: 100, colorant: false },
    { material: "呉須", parts: 0.1, colorant: true },
    { material: "呉須", parts: 0.2, colorant: true },
  ];
  const merged = [
    { material: "長石", parts: 100, colorant: false },
    { material: "呉須", parts: 0.3, colorant: true },
  ];
  assert.equal(mixSignature(split), mixSignature(merged));
});

test("mixSignature は配合が違えば別の調合になる", () => {
  const a = [{ material: "長石", parts: 50, colorant: false }, { material: "土灰", parts: 50, colorant: false }];
  const b = [{ material: "長石", parts: 60, colorant: false }, { material: "土灰", parts: 40, colorant: false }];
  assert.notEqual(mixSignature(a), mixSignature(b));
});

test("nextPieceCode は既存の最大値+1を既存の桁数で返す", () => {
  assert.equal(nextPieceCode(["A-01", "A-07", "A-03"]), "A-08");
  assert.equal(nextPieceCode(["A-1", "A-9"]), "A-10");
  assert.equal(nextPieceCode([]), "A-01");
});

test("nextPieceCode は別接頭辞の番号に引きずられない", () => {
  assert.equal(nextPieceCode(["B-40", "A-02"], "A"), "A-03");
  assert.equal(nextPieceCode(["B-40", "A-02"], "B"), "B-41");
});

test("validatePiece は識別番号と所見だけを必須にする（写真・配合・焼成は任意）", () => {
  const ok = validatePiece({ code: "A-01", note: "上段は流れが強い" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, {});
});

test("validatePiece は識別番号と所見の欠落を個別に知らせる", () => {
  const result = validatePiece({ code: "", note: "" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.code);
  assert.ok(result.errors.note);
});

test("shelvesTopDown は上段が先（窯詰めの見た目と一致する）", () => {
  assert.deepEqual(shelvesTopDown(3), [3, 2, 1]);
  // 段数の指定が壊れていても1段は必ず返す。
  assert.deepEqual(shelvesTopDown(0), [1]);
  assert.equal(shelvesTopDown(99).length, 8);
});

test("normalizeShelfCount は段数を整数に正し、読めない値を null にする", () => {
  assert.equal(normalizeShelfCount(3), 3);
  // 段は数えるもの。小数のまま持つと、描画・書き出し・編集画面で段数が食い違う。
  assert.equal(normalizeShelfCount(3.5), 4);
  assert.equal(normalizeShelfCount("3.2"), 3);
  assert.equal(normalizeShelfCount(0), 1);
  assert.equal(normalizeShelfCount(99), 8);
  assert.equal(normalizeShelfCount(""), null);
  assert.equal(normalizeShelfCount("   "), null);
  assert.equal(normalizeShelfCount("あとで"), null);
  assert.equal(normalizeShelfCount(undefined), null);
});

test("shelvesTopDown と isShelfInRange は同じ段数の解釈を使う", () => {
  // 3.5 段の焼成は 4 段として描かれる。判定だけ 3 段に丸めると棚 4 の記録が画面から消える。
  assert.equal(shelvesTopDown(3.5).length, 4);
  assert.equal(isShelfInRange(4, 3.5), true);
  assert.equal(isShelfInRange(5, 3.5), false);
});

test("shelfSubLabel は最上段と最下段だけ補助ラベルを付ける", () => {
  assert.equal(shelfSubLabel(3, 3), "上段");
  assert.equal(shelfSubLabel(2, 3), "中段");
  assert.equal(shelfSubLabel(1, 3), "下段（炉床直上）");
  assert.equal(shelfSubLabel(1, 1), "");
});

test("looksLikeColorant は少量で効く材料を拾う", () => {
  assert.equal(looksLikeColorant("酸化銅"), true);
  assert.equal(looksLikeColorant("弁柄"), true);
  assert.equal(looksLikeColorant("長石"), false);
  assert.equal(looksLikeColorant(""), false);
});

test("firingLabel は欠けた項目を詰めて組み立てる", () => {
  assert.equal(firingLabel({ date: "2026-08-03", name: "本焼", code: "#F-014" }), "2026-08-03 本焼 #F-014");
  assert.equal(firingLabel({ date: "2026-08-03", name: "", code: "" }), "2026-08-03");
});

test("partitionResults は自由入力を既定候補と分けて編集欄に戻す", () => {
  const { tags, customText } = partitionResults(["貫入", "縁に釉溜まり", "良好"]);
  assert.deepEqual(tags, ["貫入", "良好"]);
  assert.equal(customText, "縁に釉溜まり");
});

test("partitionResults は自由入力が複数あっても落とさない", () => {
  const { tags, customText } = partitionResults(["縁に釉溜まり", "底に貼り付き"]);
  assert.deepEqual(tags, []);
  assert.equal(customText, "縁に釉溜まり・底に貼り付き");
});

test("composeResults と partitionResults は往復する（編集で増えない）", () => {
  const stored = ["貫入", "縁に釉溜まり", "底に貼り付き"];
  const { tags, customText } = partitionResults(stored);
  assert.deepEqual(composeResults(tags, customText), stored);
});

test("composeResults の結果タグは区切り文字を含まない（1セルに畳んでも行が増えない）", () => {
  // 書き出し・印刷・比較は結果タグを `・` で1セルに畳む。タグ自身が `・` を含むと
  // 畳んだセルからタグの数が読めなくなるので、入力の時点で分割しておく約束になっている。
  const composed = composeResults(["貫入"], "縁に釉溜まり・底に貼り付き");
  assert.deepEqual(composed, ["貫入", "縁に釉溜まり", "底に貼り付き"]);
  assert.ok(composed.every((tag) => !tag.includes(CUSTOM_RESULT_SEPARATOR)));
});

test("composeResults は既定候補と同じ語を自由入力に打たれても重複させない", () => {
  assert.deepEqual(composeResults(["貫入"], "貫入・縁に釉溜まり"), ["貫入", "縁に釉溜まり"]);
  assert.deepEqual(composeResults(["貫入"], "  "), ["貫入"]);
});

test("resultsSignature は選んだ順序に依存しない", () => {
  assert.equal(resultsSignature(["貫入", "良好"]), resultsSignature(["良好", "貫入"]));
  assert.notEqual(resultsSignature(["貫入"]), resultsSignature(["貫入", "良好"]));
});

test("resultsSignature は区切り文字を含むタグを別のタグ2つと混同しない", () => {
  // 自由入力の結果タグに `|` を書けるので、退避しないと同じ鍵になり、
  // 比較で「結果が変わっていない」と読める。
  assert.notEqual(resultsSignature(["良好|貫入"]), resultsSignature(["貫入", "良好"]));
});

test("isShelfInRange はその焼成に無い段を弾く", () => {
  assert.equal(isShelfInRange(3, 3), true);
  assert.equal(isShelfInRange(4, 3), false);
  assert.equal(isShelfInRange(0, 3), false);
  assert.equal(isShelfInRange(null, 3), false);
  assert.equal(isShelfInRange(1.5, 3), false);
});

test("piecesOffShelf は断面に描かれない記録を拾う（棚なし・範囲外）", () => {
  const pieces = [
    { id: "p1", shelf: 2 },
    { id: "p2", shelf: null },
    { id: "p3", shelf: 5 },
  ];
  assert.deepEqual(
    piecesOffShelf(pieces, 3).map((p) => p.id),
    ["p2", "p3"],
  );
});

test("sortFiringsNewestFirst は同じ日付を記録時刻で決着させる", () => {
  const firings = [
    { id: "f-zzz", date: "2026-08-01", createdAt: "2026-08-01T09:00:00.000Z", updatedAt: "" },
    { id: "f-aaa", date: "2026-08-01", createdAt: "2026-08-01T18:00:00.000Z", updatedAt: "" },
    { id: "f-mmm", date: "2026-07-20", createdAt: "2026-07-20T10:00:00.000Z", updatedAt: "" },
  ];
  assert.deepEqual(
    sortFiringsNewestFirst(firings).map((f) => f.id),
    ["f-aaa", "f-zzz", "f-mmm"],
  );
  // 入力の並びが変わっても結果は同じ（主キー順の影響を受けない）。
  assert.deepEqual(
    sortFiringsNewestFirst([...firings].reverse()).map((f) => f.id),
    ["f-aaa", "f-zzz", "f-mmm"],
  );
});

test("sortFiringsNewestFirst は日付の無い焼成を末尾に置く", () => {
  const firings = [
    { id: "f1", date: "", createdAt: "", updatedAt: "" },
    { id: "f2", date: "2026-08-01", createdAt: "", updatedAt: "" },
  ];
  assert.deepEqual(
    sortFiringsNewestFirst(firings).map((f) => f.id),
    ["f2", "f1"],
  );
});

test("mixSignature は部数0の材料を鍵に入れない（入っていない材料で調合を割らない）", () => {
  // 材料名だけ打って部数を入れ忘れた行・0 と打たれた行は、調合に何も入っていない。
  const withInert = [
    { material: "長石", parts: 50, colorant: false },
    { material: "珪石", parts: 50, colorant: false },
    { material: "呉須", parts: 0, colorant: true },
  ];
  const without = [
    { material: "長石", parts: 50, colorant: false },
    { material: "珪石", parts: 50, colorant: false },
  ];
  assert.equal(mixSignature(withInert), mixSignature(without));
  // 部数が入れば当然べつの調合になる。
  assert.notEqual(
    mixSignature([...without, { material: "呉須", parts: 2, colorant: true }]),
    mixSignature(without),
  );
});

test("mixSignature は材料名の中の区切り文字で別の調合を同じ鍵にしない", () => {
  // 鍵は `材料名:比率` を `|` で繋ぐ。材料名は自由入力なので両方の文字を書ける。
  // 退避しないと下の2つが同じ鍵になり、別々の調合が比較で1グループに束ねられる。
  const oneMaterial = mixSignature([{ material: "珪石:1|長石", parts: 1, colorant: false }]);
  const twoMaterials = mixSignature([
    { material: "珪石", parts: 1, colorant: false },
    { material: "長石", parts: 1, colorant: false },
  ]);
  assert.notEqual(oneMaterial, twoMaterials);
});

test("mixSignature は全ての部数が0でも材料名を残す（配合未記入と混ぜない）", () => {
  const namesOnly = mixSignature([
    { material: "長石", parts: 0, colorant: false },
    { material: "珪石", parts: 0, colorant: false },
  ]);
  assert.notEqual(namesOnly, "");
  assert.equal(mixSignature([]), "");
  // 材料名が違えば別のグループのまま。
  assert.notEqual(
    namesOnly,
    mixSignature([{ material: "土灰", parts: 0, colorant: false }]),
  );
});

test("uniqueOptionLabels は重なっていない表示名に何も足さない", () => {
  const items = [{ label: "本焼", note: "1230℃" }, { label: "素焼", note: "800℃" }];
  assert.deepEqual(
    uniqueOptionLabels(items, (x) => x.label, (x) => x.note),
    ["本焼", "素焼"],
  );
});

test("uniqueOptionLabels は重なった表示名に中身の要約を添える", () => {
  // 表示名（日付・名前・番号／調合名）はどれもユーザーの入力であって鍵ではない。
  // 同じに見える選択肢をそのまま出すと、条件の違う記録に紐付けても気付けない。
  const items = [
    { label: "2026-08-03 本焼", note: "目標1230℃" },
    { label: "2026-08-03 本焼", note: "目標1250℃" },
  ];
  assert.deepEqual(
    uniqueOptionLabels(items, (x) => x.label, (x) => x.note),
    ["2026-08-03 本焼（目標1230℃）", "2026-08-03 本焼（目標1250℃）"],
  );
});

test("uniqueOptionLabels は要約まで同じなら通し番号で必ず一意にする", () => {
  const items = [
    { label: "2026-08-03 本焼", note: "目標1230℃" },
    { label: "2026-08-03 本焼", note: "目標1230℃" },
    { label: "2026-08-03 本焼", note: "" },
  ];
  const labels = uniqueOptionLabels(items, (x) => x.label, (x) => x.note);
  assert.equal(new Set(labels).size, 3);
  assert.deepEqual(labels, [
    "2026-08-03 本焼（目標1230℃ / 1件目）",
    "2026-08-03 本焼（目標1230℃ / 2件目）",
    "2026-08-03 本焼（3件目）",
  ]);
});

test("uniqueOptionLabels は要約が作れなくても選択肢を落とさない", () => {
  const items = [{ label: "本焼" }, { label: "本焼" }];
  const labels = uniqueOptionLabels(items, (x) => x.label, () => {
    throw new Error("読めない");
  });
  assert.deepEqual(labels, ["本焼（1件目）", "本焼（2件目）"]);
  // 要約を渡さない使い方でも一意になる。
  assert.deepEqual(uniqueOptionLabels(items, (x) => x.label), [
    "本焼（1件目）",
    "本焼（2件目）",
  ]);
});
