import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCompareColumns,
  buildCompareRows,
  buildCurveCells,
  groupByRecipe,
  formatPercent,
  mixOneLine,
} from "../lib/compare.mjs";
import { mixCell } from "../lib/serialize.mjs";

const MIX_A = [
  { material: "長石", parts: 35, colorant: false },
  { material: "土灰", parts: 40, colorant: false },
  { material: "珪石", parts: 25, colorant: false },
];
const MIX_B = [
  { material: "長石", parts: 60, colorant: false },
  { material: "土灰", parts: 40, colorant: false },
];

function piece(overrides) {
  return {
    id: "p1",
    code: "A-01",
    recipeName: "織部A",
    mix: MIX_A,
    firingId: "f1",
    shelf: 2,
    results: [],
    judgment: null,
    note: "",
    photoId: null,
    colorMemo: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function firing(overrides) {
  return {
    id: "f1",
    code: "#F-01",
    name: "本焼",
    date: "2026-08-01",
    shelfCount: 3,
    points: [
      { minutes: 0, temp: 20, atmosphereFrom: null },
      { minutes: 600, temp: 1230, atmosphereFrom: null },
    ],
    targetTemp: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

test("groupByRecipe は同じ配合を1グループに束ねる", () => {
  const groups = groupByRecipe([
    piece({ id: "p1", code: "A-01" }),
    piece({ id: "p2", code: "A-02" }),
    piece({ id: "p3", code: "B-01", mix: MIX_B, recipeName: "鉄釉" }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].pieces.length, 2);
  assert.equal(groups[1].pieces.length, 1);
});

test("groupByRecipe は配合未記入でも落とさない", () => {
  const groups = groupByRecipe([piece({ id: "p9", mix: [], recipeName: "名前だけ" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].pieces.length, 1);
});

test("buildCompareColumns は焼成日の古い順に並べる", () => {
  const pieces = [
    piece({ id: "p2", code: "A-02", firingId: "f2" }),
    piece({ id: "p1", code: "A-01", firingId: "f1" }),
  ];
  const firings = [firing({ id: "f1", date: "2026-08-01" }), firing({ id: "f2", date: "2026-08-05" })];
  const columns = buildCompareColumns(pieces, firings);
  assert.deepEqual(
    columns.map((c) => c.piece.code),
    ["A-01", "A-02"],
  );
});

test("buildCompareColumns は焼成が紐付いていない列も残す（末尾へ）", () => {
  const pieces = [piece({ id: "p1", code: "A-01", firingId: null }), piece({ id: "p2", code: "A-02" })];
  const columns = buildCompareColumns(pieces, [firing({})]);
  assert.equal(columns.length, 2);
  assert.equal(columns[columns.length - 1].piece.code, "A-01");
  assert.equal(columns[columns.length - 1].maxTemp, null);
});

test("buildCompareColumns は焼成から最高温度と雰囲気を引く", () => {
  const columns = buildCompareColumns([piece({})], [firing({})]);
  assert.equal(columns[0].maxTemp, 1230);
  assert.equal(columns[0].atmosphere, "oxidation");
});

test("buildCompareRows は前の列と値が変わったセルに印を付ける", () => {
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1" }),
    piece({ id: "p2", code: "A-02", firingId: "f2" }),
  ];
  const firings = [
    firing({ id: "f1", date: "2026-08-01", points: [{ minutes: 0, temp: 1230 }] }),
    firing({ id: "f2", date: "2026-08-05", points: [{ minutes: 0, temp: 1250 }] }),
  ];
  const rows = buildCompareRows(buildCompareColumns(pieces, firings));
  const tempRow = rows.find((r) => r.key === "maxTemp");
  // 最初の列は比較対象が無いので常に false
  assert.equal(tempRow.cells[0].changed, false);
  assert.equal(tempRow.cells[0].text, "1230℃");
  assert.equal(tempRow.cells[1].changed, true);
  assert.equal(tempRow.cells[1].text, "1250℃");
});

test("buildCompareRows は雰囲気の切替時刻の違いを差分にする（要約だけで比べない）", () => {
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1" }),
    piece({ id: "p2", code: "A-02", firingId: "f2" }),
  ];
  // どちらも酸化主体。還元に入る時刻だけが違う（＝焼成条件が違う）。
  const firings = [
    firing({
      id: "f1",
      date: "2026-08-01",
      points: [
        { minutes: 0, temp: 20, atmosphereFrom: "oxidation" },
        { minutes: 300, temp: 900, atmosphereFrom: "reduction" },
        { minutes: 600, temp: 1230, atmosphereFrom: null },
      ],
    }),
    firing({
      id: "f2",
      date: "2026-08-05",
      points: [
        { minutes: 0, temp: 20, atmosphereFrom: "oxidation" },
        { minutes: 120, temp: 400, atmosphereFrom: "reduction" },
        { minutes: 600, temp: 1230, atmosphereFrom: null },
      ],
    }),
  ];
  const rows = buildCompareRows(buildCompareColumns(pieces, firings));
  const atmosphereRow = rows.find((r) => r.key === "atmosphere");
  assert.equal(atmosphereRow.cells[1].changed, true);
  // 印が付く以上、何が変わったのかが読めなければならない。
  assert.notEqual(atmosphereRow.cells[0].text, atmosphereRow.cells[1].text);
  assert.match(atmosphereRow.cells[0].text, /5:00 還元/);
  assert.match(atmosphereRow.cells[1].text, /2:00 還元/);
});

test("buildCompareRows は最後の点で切り替えた焼成も切替として扱う", () => {
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1" }),
    piece({ id: "p2", code: "A-02", firingId: "f2" }),
  ];
  // f2 は最後の点で還元に入れている（区間の長さは 0）。CSV と数値の表には残るので、
  // 比較でも「切替の無い焼成」と同じ顔にしてはいけない。
  const firings = [
    firing({
      id: "f1",
      date: "2026-08-01",
      points: [
        { minutes: 0, temp: 20, atmosphereFrom: null },
        { minutes: 600, temp: 1230, atmosphereFrom: null },
      ],
    }),
    firing({
      id: "f2",
      date: "2026-08-05",
      points: [
        { minutes: 0, temp: 20, atmosphereFrom: null },
        { minutes: 600, temp: 1230, atmosphereFrom: "reduction" },
      ],
    }),
  ];
  const rows = buildCompareRows(buildCompareColumns(pieces, firings));
  const atmosphereRow = rows.find((r) => r.key === "atmosphere");
  assert.equal(atmosphereRow.cells[0].text, "酸化");
  assert.match(atmosphereRow.cells[1].text, /10:00 還元/);
  assert.equal(atmosphereRow.cells[1].changed, true);
});

test("buildCompareRows は切替の無い焼成どうしを差分にしない", () => {
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1" }),
    piece({ id: "p2", code: "A-02", firingId: "f2" }),
  ];
  const firings = [
    firing({ id: "f1", date: "2026-08-01" }),
    firing({ id: "f2", date: "2026-08-05" }),
  ];
  const rows = buildCompareRows(buildCompareColumns(pieces, firings));
  const atmosphereRow = rows.find((r) => r.key === "atmosphere");
  assert.equal(atmosphereRow.cells[0].text, "酸化");
  assert.equal(atmosphereRow.cells[1].changed, false);
});

test("buildCompareRows は表示名が同じでも別の焼成なら差分にする", () => {
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1" }),
    piece({ id: "p2", code: "A-02", firingId: "f2" }),
  ];
  // 番号を付けていない同日同名の焼成は表示名が一致する。別の焼成であることは id にしかない。
  const firings = [
    firing({ id: "f1", code: "", date: "2026-08-01" }),
    firing({ id: "f2", code: "", date: "2026-08-01" }),
  ];
  const rows = buildCompareRows(buildCompareColumns(pieces, firings));
  const firingRow = rows.find((r) => r.key === "firing");
  assert.equal(firingRow.cells[0].text, firingRow.cells[1].text);
  assert.equal(firingRow.cells[1].changed, true);
});

test("buildCompareRows は値が同じなら印を付けない", () => {
  const pieces = [piece({ id: "p1", shelf: 2 }), piece({ id: "p2", shelf: 2 })];
  const rows = buildCompareRows(buildCompareColumns(pieces, [firing({})]));
  const shelfRow = rows.find((r) => r.key === "shelf");
  assert.equal(shelfRow.cells[1].changed, false);
});

test("buildCompareRows は値が無いセルを — にし、空どうしを差分にしない", () => {
  const pieces = [piece({ id: "p1", judgment: null }), piece({ id: "p2", judgment: null })];
  const rows = buildCompareRows(buildCompareColumns(pieces, [firing({})]));
  const judgeRow = rows.find((r) => r.key === "judgment");
  assert.equal(judgeRow.cells[0].text, "—");
  assert.equal(judgeRow.cells[1].changed, false);
});

test("mixOneLine は着色材の印を落とさない（印刷もバックアップ）", () => {
  const line = mixOneLine(
    piece({
      mix: [
        { material: "長石", parts: 97, colorant: false },
        { material: "酸化銅", parts: 3, colorant: true },
      ],
    }),
  );
  assert.match(line, /酸化銅 3（着色材）/);
  // 印を付けていない行には出さない（付いている行と見分けが付かなくなる）。
  assert.ok(!/長石 97（着色材）/.test(line));
});

test("mixOneLine は保存されている部数をそのまま出す（正規化した % を単位無しで出さない）", () => {
  const line = mixOneLine(
    piece({
      mix: [
        { material: "材料A", parts: 1, colorant: false },
        { material: "材料B", parts: 3, colorant: false },
      ],
    }),
  );
  // 1:3 を 25/75 に直して出すと、印刷を頼りに書き戻したとき元の数字が戻らない。
  assert.equal(line, "材料A 1 / 材料B 3");
  // CSV（唯一のもう一方のバックアップ）と同じ表記であること。
  assert.equal(
    line,
    mixCell([
      { material: "材料A", parts: 1, colorant: false },
      { material: "材料B", parts: 3, colorant: false },
    ]),
  );
});

test("formatPercent は整数のとき小数を出さない", () => {
  assert.equal(formatPercent(35), "35");
  assert.equal(formatPercent(33.333), "33.3");
});

test("buildCompareRows は結果タグの選択順の違いを差分にしない", () => {
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1", results: ["貫入", "良好"] }),
    piece({ id: "p2", code: "A-02", firingId: "f2", results: ["良好", "貫入"] }),
  ];
  const firings = [firing({ id: "f1", date: "2026-08-01" }), firing({ id: "f2", date: "2026-08-05" })];
  const rows = buildCompareRows(buildCompareColumns(pieces, firings));
  const resultRow = rows.find((r) => r.key === "results");
  assert.equal(resultRow.cells[1].changed, false);
  // 内容が本当に変わったときは印が付く。
  const changedRows = buildCompareRows(
    buildCompareColumns(
      [pieces[0], piece({ id: "p3", code: "A-03", firingId: "f2", results: ["良好"] })],
      firings,
    ),
  );
  assert.equal(changedRows.find((r) => r.key === "results").cells[1].changed, true);
});

test("buildCompareColumns は同じ焼成日でも並びが一意に決まる", () => {
  const firings = [
    firing({ id: "f1", date: "2026-08-01", createdAt: "2026-08-01T09:00:00.000Z" }),
    firing({ id: "f2", date: "2026-08-01", createdAt: "2026-08-01T18:00:00.000Z" }),
  ];
  const pieces = [
    piece({ id: "p2", code: "A-02", firingId: "f2" }),
    piece({ id: "p1", code: "A-01", firingId: "f1" }),
  ];
  const order = buildCompareColumns(pieces, firings).map((c) => c.piece.code);
  assert.deepEqual(order, ["A-01", "A-02"]);
  // 入力順が変わっても同じ並び（IndexedDB の主キー順に左右されない）。
  assert.deepEqual(
    buildCompareColumns([...pieces].reverse(), firings).map((c) => c.piece.code),
    order,
  );
});

test("groupByRecipe は件数が同じグループの並びを入力順に左右されない", () => {
  const a = piece({ id: "p1", code: "A-01", recipeName: "織部A" });
  const b = piece({ id: "p2", code: "B-01", mix: MIX_B, recipeName: "鉄釉" });
  assert.deepEqual(
    groupByRecipe([a, b]).map((g) => g.recipeName),
    groupByRecipe([b, a]).map((g) => g.recipeName),
  );
});

test("buildCompareRows は目標温度を独立した比較軸として出す", () => {
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1" }),
    piece({ id: "p2", code: "A-02", firingId: "f2" }),
  ];
  // 日付・名前・番号・実測カーブまで同じで、狙った温度だけが違う2回の焼成。
  // 焼成の表示名には目標温度が入らないので、独立した行が無いと差が消える。
  const firings = [
    firing({ id: "f1", targetTemp: 1230 }),
    firing({ id: "f2", targetTemp: 1250, createdAt: "2026-08-01T18:00:00.000Z" }),
  ];
  const rows = buildCompareRows(buildCompareColumns(pieces, firings));
  const targetRow = rows.find((r) => r.key === "targetTemp");
  assert.equal(targetRow.cells[0].text, "1230℃");
  assert.equal(targetRow.cells[1].text, "1250℃");
  assert.equal(targetRow.cells[1].changed, true);
});

test("buildCompareRows は目標温度が未記入なら — にし、空どうしを差分にしない", () => {
  const pieces = [piece({ id: "p1", firingId: "f1" }), piece({ id: "p2", firingId: "f1" })];
  const rows = buildCompareRows(buildCompareColumns(pieces, [firing({ targetTemp: null })]));
  const targetRow = rows.find((r) => r.key === "targetTemp");
  assert.equal(targetRow.cells[0].text, "—");
  assert.equal(targetRow.cells[1].changed, false);
});

test("buildCompareRows は段数の違う窯の同じ棚番号を差分にする", () => {
  // 棚位置は焼成の中の相対位置。3段窯の棚3は最上段、5段窯の棚3は中段で、
  // 置いた場所そのものが違う。同じ「棚3」として並べると条件が同じに見えてしまう。
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1", shelf: 3 }),
    piece({ id: "p2", code: "A-02", firingId: "f2", shelf: 3 }),
  ];
  const firings = [
    firing({ id: "f1", code: "#F-01", shelfCount: 3 }),
    firing({ id: "f2", code: "#F-02", shelfCount: 5 }),
  ];
  const rows = buildCompareRows(buildCompareColumns(pieces, firings));
  const shelfRow = rows.find((r) => r.key === "shelf");
  assert.equal(shelfRow.cells[1].changed, true);
  assert.ok(shelfRow.cells[0].text.includes("全3段"));
  assert.ok(shelfRow.cells[1].text.includes("全5段"));
  assert.notEqual(shelfRow.cells[0].text, shelfRow.cells[1].text);
});

test("buildCompareRows は同じ段数の同じ棚を差分にしない", () => {
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1", shelf: 3 }),
    piece({ id: "p2", code: "A-02", firingId: "f2", shelf: 3 }),
  ];
  const firings = [
    firing({ id: "f1", code: "#F-01", shelfCount: 3 }),
    firing({ id: "f2", code: "#F-02", shelfCount: 3 }),
  ];
  const rows = buildCompareRows(buildCompareColumns(pieces, firings));
  const shelfRow = rows.find((r) => r.key === "shelf");
  assert.equal(shelfRow.cells[1].changed, false);
});

test("buildCurveCells は最高温度と総焼成時間が同じでも途中の形が違えば印を付ける", () => {
  // 比較の図は列ごとに独立して伸縮するので、形の違いは目では拾いにくい。
  // 印が付かないと、途中の昇温だけが違う焼成が「条件が同じ」に見える
  // （焼成の行の印は「別の焼成である」ことしか言わない）。
  const pieces = [
    piece({ id: "p1", code: "A-01", firingId: "f1" }),
    piece({ id: "p2", code: "A-02", firingId: "f2" }),
  ];
  const firings = [
    firing({
      id: "f1",
      code: "#F-01",
      date: "2026-08-01",
      points: [
        { minutes: 0, temp: 20, atmosphereFrom: null },
        { minutes: 300, temp: 900, atmosphereFrom: null },
        { minutes: 600, temp: 1230, atmosphereFrom: null },
      ],
    }),
    firing({
      id: "f2",
      code: "#F-02",
      date: "2026-08-02",
      // 最高温度も総焼成時間も同じ。違うのは途中の昇温だけ。
      points: [
        { minutes: 0, temp: 20, atmosphereFrom: null },
        { minutes: 300, temp: 400, atmosphereFrom: null },
        { minutes: 600, temp: 1230, atmosphereFrom: null },
      ],
    }),
  ];
  const columns = buildCompareColumns(pieces, firings);
  const rows = buildCompareRows(columns);
  // 数値の軸では違いが出ない＝この行が付けなければ、どこにも印が付かない。
  assert.equal(rows.find((r) => r.key === "maxTemp").cells[1].changed, false);
  assert.equal(rows.find((r) => r.key === "totalMinutes").cells[1].changed, false);
  const cells = buildCurveCells(columns);
  assert.equal(cells[0].changed, false);
  assert.equal(cells[1].changed, true);
});

test("buildCurveCells は同じカーブを差分にしない（記録の順が違っても）", () => {
  const shared = [
    { minutes: 600, temp: 1230, atmosphereFrom: null },
    { minutes: 0, temp: 20, atmosphereFrom: null },
  ];
  const columns = buildCompareColumns(
    [
      piece({ id: "p1", code: "A-01", firingId: "f1" }),
      piece({ id: "p2", code: "A-02", firingId: "f2" }),
    ],
    [
      firing({ id: "f1", code: "#F-01", date: "2026-08-01", points: shared }),
      firing({
        id: "f2",
        code: "#F-02",
        date: "2026-08-02",
        points: [...shared].reverse(),
      }),
    ],
  );
  const cells = buildCurveCells(columns);
  assert.equal(cells[1].changed, false);
});

test("buildCurveCells は記録の無い焼成を「—」として扱う", () => {
  const columns = buildCompareColumns(
    [
      piece({ id: "p1", code: "A-01", firingId: "f1" }),
      piece({ id: "p2", code: "A-02", firingId: null }),
    ],
    [firing({ id: "f1", code: "#F-01", date: "2026-08-01" })],
  );
  const cells = buildCurveCells(columns);
  assert.equal(cells[1].text, "—");
  // カーブがあった列の次で消えているのも条件の違い。
  assert.equal(cells[1].changed, true);
});
