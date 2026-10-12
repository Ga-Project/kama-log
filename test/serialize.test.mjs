import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CSV_BOM,
  atmosphereChangeCell,
  curvePointCell,
  FIRING_CSV_HEADER,
  PIECE_CSV_HEADER,
  escapeCsvCell,
  exportFilename,
  firingsToCsv,
  mixCell,
  parseMixCell,
  piecesToCsv,
  toCsv,
} from "../lib/serialize.mjs";
import { mixOneLine } from "../lib/compare.mjs";
import { firingLabel } from "../lib/model.mjs";
import { capacityLevel, fitWithin, formatBytes, willExceedQuota } from "../lib/storage.mjs";

test("escapeCsvCell はカンマ・引用符・改行を含むセルを囲む", () => {
  assert.equal(escapeCsvCell("長石"), "長石");
  assert.equal(escapeCsvCell("長石,土灰"), '"長石,土灰"');
  assert.equal(escapeCsvCell('彼は"良い"と言った'), '"彼は""良い""と言った"');
  assert.equal(escapeCsvCell("1行目\n2行目"), '"1行目\n2行目"');
  assert.equal(escapeCsvCell(null), "");
});

test("toCsv は CRLF で行を区切る", () => {
  assert.equal(toCsv([["a", "b"], ["c", "d"]]), "a,b\r\nc,d");
});

test("piecesToCsv は BOM 付きで見出し行から始まる（Excel で和文が化けない）", () => {
  const csv = piecesToCsv([], []);
  assert.ok(csv.startsWith(CSV_BOM));
  assert.ok(csv.includes(PIECE_CSV_HEADER[0]));
});

test("piecesToCsv は所見の改行やカンマがあっても行が壊れない", () => {
  const csv = piecesToCsv(
    [
      {
        id: "p1",
        code: "A-01",
        recipeName: "織部A",
        mix: [{ material: "長石", parts: 35, colorant: false }],
        firingId: null,
        shelf: 2,
        results: ["貫入", "流れすぎ"],
        judgment: "adjust",
        note: "上段は流れが強い、\n次は1230まで下げる",
        photoId: null,
        colorMemo: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "",
      },
    ],
    [],
  );
  // 引用符で囲まれていること（囲まれていなければ列がずれる）
  assert.ok(csv.includes('"上段は流れが強い、\n次は1230まで下げる"'));
  assert.ok(csv.includes("貫入・流れすぎ"));
  assert.ok(csv.includes("要調整"));
});

test("piecesToCsv は写真の有無を落とさずに書く", () => {
  const base = {
    id: "p1",
    code: "A-01",
    recipeName: "",
    mix: [],
    firingId: null,
    shelf: null,
    results: [],
    judgment: null,
    note: "",
    createdAt: "",
    updatedAt: "",
  };
  assert.ok(piecesToCsv([{ ...base, photoId: "ph1", colorMemo: null }], []).includes("あり"));
  assert.ok(piecesToCsv([{ ...base, photoId: null, colorMemo: "#aabbcc" }], []).includes("色メモ #aabbcc"));
  assert.ok(piecesToCsv([{ ...base, photoId: null, colorMemo: null }], []).includes("なし"));
});

test("firingsToCsv は温度カーブを1セルに畳む", () => {
  const csv = firingsToCsv([
    {
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
    },
  ]);
  assert.ok(csv.includes("0:00:20 10:00:1230"));
});

test("firingsToCsv は目標温度を独立した列で持ち出す（カーブから導けない入力）", () => {
  const firing = {
    id: "f1",
    code: "#F-01",
    name: "本焼",
    date: "2026-08-01",
    shelfCount: 3,
    points: [{ minutes: 0, temp: 20, atmosphereFrom: null }],
    targetTemp: 1250,
    createdAt: "",
    updatedAt: "",
  };
  const csv = firingsToCsv([firing]);
  assert.ok(csv.includes("目標温度(℃)"));
  assert.ok(csv.includes(",1250,"));
  // 点が1つも無くても目標だけは残る（狙いの記録が消えない）
  const noPoints = firingsToCsv([{ ...firing, points: [] }]);
  assert.ok(noPoints.includes(",1250,"));
  // 目標なしは空欄（0 と混同しない）
  assert.ok(!firingsToCsv([{ ...firing, targetTemp: null }]).includes("1250"));
});

test("piecesToCsv は着色材の印と紐付いた焼成の目標温度を落とさない", () => {
  const csv = piecesToCsv(
    [
      {
        id: "p1",
        code: "A-01",
        recipeName: "織部A",
        mix: [
          { material: "長石", parts: 35, colorant: false },
          { material: "酸化銅", parts: 3, colorant: true },
        ],
        firingId: "f1",
        shelf: null,
        results: [],
        judgment: null,
        note: "",
        photoId: null,
        colorMemo: null,
        createdAt: "",
        updatedAt: "",
      },
    ],
    [
      {
        id: "f1",
        code: "#F-01",
        name: "本焼",
        date: "2026-08-01",
        shelfCount: 3,
        points: [{ minutes: 0, temp: 20, atmosphereFrom: null }],
        targetTemp: 1230,
        createdAt: "",
        updatedAt: "",
      },
    ],
  );
  assert.ok(csv.includes("長石 35 / 酸化銅 3（着色材）"));
  assert.ok(csv.includes("1230"));
});

test("mixCell は材料名の中の区切り文字を退避する（行の数が変わらない）", () => {
  const cell = mixCell([{ material: "長石 / 珪石", parts: 50, colorant: false }]);
  // 退避しないと「長石」と「珪石 50」の2行に見え、書き出しから元の配合が戻らない。
  assert.equal(cell, "長石 \\/ 珪石 50");
  assert.notEqual(
    cell,
    mixCell([
      { material: "長石", parts: 1, colorant: false },
      { material: "珪石", parts: 50, colorant: false },
    ]),
  );
});

test("mixCell と parseMixCell は往復する（書き出しから配合が戻る）", () => {
  const mix = [
    { material: "長石 / 珪石", parts: 50, colorant: false },
    { material: "土灰", parts: 12.5, colorant: false },
    { material: "呉須 / 弁柄", parts: 0.5, colorant: true },
    // 退避記号そのものを含む名前・空白を含む名前も戻ること。
    { material: "自家調合\\A 2種", parts: 3, colorant: false },
  ];
  assert.deepEqual(parseMixCell(mixCell(mix)), mix);
});

test("parseMixCell は行の数と着色材の印を取り違えない", () => {
  assert.deepEqual(parseMixCell(mixCell([{ material: "長石", parts: 35, colorant: false }])), [
    { material: "長石", parts: 35, colorant: false },
  ]);
  // 材料名の末尾が着色材の印でも、印が付いているかどうかは行の末尾で決まる。
  assert.deepEqual(
    parseMixCell(mixCell([{ material: "呉須（着色材）", parts: 5, colorant: false }])),
    [{ material: "呉須（着色材）", parts: 5, colorant: false }],
  );
  assert.deepEqual(parseMixCell(""), []);
});

test("印刷（PDF）の配合も CSV と同じ退避を通る", () => {
  const mix = [{ material: "長石 / 珪石", parts: 50, colorant: false }];
  // 印刷は CSV と並ぶバックアップ。片方だけが戻せない表記になっていないこと。
  assert.equal(mixOneLine({ mix }), mixCell(mix));
  assert.deepEqual(parseMixCell(mixOneLine({ mix })), mix);
});

test("2つの CSV は焼成IDで突き合わせられる（表示名が同じ焼成でも取り違えない）", () => {
  // 日付・名前・番号まで同じ2回の焼成。表示名だけでは区別が付かない。
  const base = {
    code: "#F-01",
    name: "本焼",
    date: "2026-08-01",
    shelfCount: 3,
    targetTemp: null,
    createdAt: "",
    updatedAt: "",
  };
  const firings = [
    { ...base, id: "firing_aaa", points: [{ minutes: 0, temp: 20, atmosphereFrom: null }] },
    { ...base, id: "firing_bbb", points: [{ minutes: 0, temp: 30, atmosphereFrom: null }] },
  ];
  const pieceBase = {
    recipeName: "",
    mix: [],
    shelf: null,
    results: [],
    judgment: null,
    note: "",
    photoId: null,
    colorMemo: null,
    createdAt: "",
    updatedAt: "",
  };
  const pieceCsv = piecesToCsv(
    [
      { ...pieceBase, id: "p1", code: "A-01", firingId: "firing_aaa" },
      { ...pieceBase, id: "p2", code: "A-02", firingId: "firing_bbb" },
    ],
    firings,
  );
  const firingCsv = firingsToCsv(firings);

  // 見出しは両方に「焼成ID」を持つ。
  assert.ok(pieceCsv.includes("焼成ID"));
  assert.ok(firingCsv.includes("焼成ID"));
  assert.equal(PIECE_CSV_HEADER.indexOf("焼成ID"), PIECE_CSV_HEADER.indexOf("焼成") + 1);
  assert.equal(FIRING_CSV_HEADER[0], "焼成ID");

  const [, pieceRow1, pieceRow2] = pieceCsv.split("\r\n");
  assert.equal(pieceRow1.split(",")[PIECE_CSV_HEADER.indexOf("焼成ID")], "firing_aaa");
  assert.equal(pieceRow2.split(",")[PIECE_CSV_HEADER.indexOf("焼成ID")], "firing_bbb");
  const [, firingRow1, firingRow2] = firingCsv.split("\r\n");
  assert.equal(firingRow1.split(",")[0].replace(CSV_BOM, ""), "firing_aaa");
  assert.equal(firingRow2.split(",")[0], "firing_bbb");
});

test("2つの CSV は見出しと中身が一致する（焼成の「番号」列に表示名を名乗らせない）", () => {
  // 書き出しは唯一のバックアップ。列名だけを頼りに読み戻すので、見出しと中身が
  // ずれていると、番号を「日付 名前 番号」の表示名として読み戻すことになる。
  const firing = {
    id: "firing_aaa",
    code: "#F-01",
    name: "本焼",
    date: "2026-08-01",
    shelfCount: 3,
    targetTemp: null,
    points: [],
    createdAt: "",
    updatedAt: "",
  };
  const firingCells = firingsToCsv([firing]).split("\r\n")[1].split(",");
  const firingCell = (label) => firingCells[FIRING_CSV_HEADER.indexOf(label)];
  assert.equal(firingCell("番号"), "#F-01");
  assert.equal(firingCell("名前"), "本焼");
  assert.equal(firingCell("日付"), "'2026-08-01");
  // 表示名（日付 名前 番号）が入るのはテストピース CSV の「焼成」列だけ。
  // 焼成 CSV は日付・名前・番号を別々の列に持つので、同じ列名を名乗らせない。
  assert.ok(!FIRING_CSV_HEADER.includes("焼成"));

  const pieceCells = piecesToCsv(
    [
      {
        id: "p1",
        code: "A-01",
        recipeName: "",
        mix: [],
        firingId: "firing_aaa",
        shelf: null,
        results: [],
        judgment: null,
        note: "",
        photoId: null,
        colorMemo: null,
        createdAt: "",
        updatedAt: "",
      },
    ],
    [firing],
  )
    .split("\r\n")[1]
    .split(",");
  assert.equal(pieceCells[PIECE_CSV_HEADER.indexOf("焼成")], firingLabel(firing));
});

test("piecesToCsv は焼成の記録が見つからなくても紐付け先を残す", () => {
  const csv = piecesToCsv(
    [
      {
        id: "p1",
        code: "A-01",
        recipeName: "",
        mix: [],
        firingId: "firing_missing",
        shelf: null,
        results: [],
        judgment: null,
        note: "",
        photoId: null,
        colorMemo: null,
        createdAt: "",
        updatedAt: "",
      },
    ],
    [],
  );
  assert.ok(csv.includes("firing_missing"));
});

test("exportFilename は日付を含み、危険な文字を落とす", () => {
  assert.equal(exportFilename("pieces", "2026-08-10"), "kama-log_pieces_2026-08-10.csv");
  assert.equal(exportFilename("../etc", "x"), "kama-log_etc_export.csv");
});

test("formatBytes は単位を切り替える", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(-1), "—");
});

test("capacityLevel は70%未満で何も出さない", () => {
  assert.equal(capacityLevel(10, 100), "hidden");
  assert.equal(capacityLevel(70, 100), "low");
  assert.equal(capacityLevel(95, 100), "critical");
  // 取得できない環境では出さない（推定値を作らない）
  assert.equal(capacityLevel(NaN, 100), "hidden");
  assert.equal(capacityLevel(10, 0), "hidden");
});

test("willExceedQuota は95%を超える見込みを事前に知らせる", () => {
  assert.equal(willExceedQuota(900, 1000, 10), false);
  assert.equal(willExceedQuota(900, 1000, 100), true);
  // 容量が取れない環境では警告しない
  assert.equal(willExceedQuota(NaN, 1000, 100), false);
});

test("fitWithin は長辺を収め、元より大きくしない", () => {
  assert.deepEqual(fitWithin(4000, 3000, 1024), { width: 1024, height: 768 });
  assert.deepEqual(fitWithin(800, 600, 1024), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(3000, 4000, 1024), { width: 768, height: 1024 });
});

test("firingsToCsv は雰囲気の切替点を落とさない（書き出しから復元できる）", () => {
  const points = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 540, temp: 1000, atmosphereFrom: "reduction" },
    { minutes: 660, temp: 1230, atmosphereFrom: "oxidation" },
  ];
  const csv = firingsToCsv([
    {
      id: "f1",
      code: "#F-01",
      name: "本焼",
      date: "2026-08-01",
      shelfCount: 3,
      points,
      targetTemp: null,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  // カーブのセルに点ごとの切替が入る
  assert.ok(csv.includes("0:00:20 9:00:1000>還元 11:00:1230>酸化"));
  // 切替だけを追える列も持つ
  assert.ok(csv.includes("9:00:還元 11:00:酸化"));
  // 支配的な雰囲気（要約）だけに潰れていない
  assert.equal(curvePointCell(points[1]), "9:00:1000>還元");
  assert.equal(atmosphereChangeCell(points), "9:00:還元 11:00:酸化");
});

test("firingsToCsv は棚段数を画面と同じ整数で書き出す", () => {
  const csv = firingsToCsv([
    {
      id: "f1",
      code: "#F-01",
      name: "本焼",
      date: "2026-08-01",
      // 整数化する前に保存された記録。断面は 4 段を描くので、書き出しも 4 段と名乗る。
      shelfCount: 3.5,
      points: [],
      targetTemp: null,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  // 日付は文字として書き出す（表計算ソフトが日付型に置き換えると原文が戻らない）。
  assert.ok(csv.includes("#F-01,'2026-08-01,本焼,4,"));
});

test("piecesToCsv も紐付いた焼成の雰囲気の切替を持つ", () => {
  const csv = piecesToCsv(
    [
      {
        id: "p1",
        code: "A-01",
        recipeName: "織部A",
        mix: [],
        firingId: "f1",
        shelf: 1,
        results: [],
        judgment: null,
        note: "",
        photoId: null,
        colorMemo: null,
        createdAt: "",
        updatedAt: "",
      },
    ],
    [
      {
        id: "f1",
        code: "#F-01",
        name: "本焼",
        date: "2026-08-01",
        shelfCount: 3,
        points: [
          { minutes: 0, temp: 20, atmosphereFrom: null },
          { minutes: 540, temp: 1230, atmosphereFrom: "reduction" },
        ],
        targetTemp: null,
        createdAt: "",
        updatedAt: "",
      },
    ],
  );
  assert.ok(csv.includes("9:00:還元"));
});

test("escapeCsvCell は数式として読まれる先頭文字を無害化する（値は残す）", () => {
  // 引用符では数式の解釈は止まらないので、文字列指定の ' を先頭に足す。
  assert.equal(escapeCsvCell("=1+1"), "'=1+1");
  assert.equal(escapeCsvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(escapeCsvCell("+81 90-0000-0000"), "'+81 90-0000-0000");
  assert.equal(escapeCsvCell("- 上段は流れが強い"), "'- 上段は流れが強い");
  assert.equal(escapeCsvCell("\tタブ始まり"), "'\tタブ始まり");
  // 無害化してもカンマ・改行の囲みは効いたまま。
  assert.equal(escapeCsvCell("=1,2"), `"'=1,2"`);
  // 値そのものは消えない（先頭の ' を外せば元に戻る）。
  assert.equal(escapeCsvCell("=1+1").slice(1), "=1+1");
});

test("escapeCsvCell は数値を数値のまま出す（並べ替え・グラフを壊さない）", () => {
  assert.equal(escapeCsvCell(1250), "1250");
  assert.equal(escapeCsvCell(-5), "-5");
  assert.equal(escapeCsvCell(-12.5), "-12.5");
  assert.equal(escapeCsvCell("長石 35"), "長石 35");
  assert.equal(escapeCsvCell("棚2"), "棚2");
  assert.equal(escapeCsvCell("9:00:還元"), "9:00:還元");
});

test("escapeCsvCell は日付・時刻に見える入力を文字のまま出す（1-2 を 1月2日 にしない）", () => {
  // 識別番号は自由入力。`1-2` `1/2` は表計算ソフトが日付に変換するので、
  // 数値と同じく文字列指定の ' を足して原文を守る。
  assert.equal(escapeCsvCell("1/2"), "'1/2");
  assert.equal(escapeCsvCell("1-2"), "'1-2");
  assert.equal(escapeCsvCell("2026/8/1"), "'2026/8/1");
  assert.equal(escapeCsvCell("8月1日"), "'8月1日");
  // 経過時間は「午前9時」ではない。時刻型に置き換えられると意味が変わる。
  assert.equal(escapeCsvCell("10:30"), "'10:30");
  assert.equal(escapeCsvCell("0:00:20"), "'0:00:20");
  // 日付・記録日時も同じ。書き出しは唯一のバックアップなので原文が戻ることを優先する。
  assert.equal(escapeCsvCell("2026-08-01"), "'2026-08-01");
  assert.equal(escapeCsvCell("2026-08-01T09:30:00.000Z"), "'2026-08-01T09:30:00.000Z");
  // 値そのものは消えない（先頭の ' を外せば元に戻る）。
  assert.equal(escapeCsvCell("1-2").slice(1), "1-2");
});

test("escapeCsvCell は数値に見える入力を文字のまま出す（001 を 1 にしない）", () => {
  // 識別番号は自由入力。表計算ソフトは引用符では文字列と見なさないので、
  // 文字列指定の ' を足して先頭の 0 や小数の桁を守る。
  assert.equal(escapeCsvCell("001"), "'001");
  assert.equal(escapeCsvCell("1.50"), "'1.50");
  assert.equal(escapeCsvCell("1e3"), "'1e3");
  assert.equal(escapeCsvCell("1,234"), `"'1,234"`);
  assert.equal(escapeCsvCell("-12.5"), "'-12.5");
  // 値そのものは消えない（先頭の ' を外せば元に戻る）。
  assert.equal(escapeCsvCell("001").slice(1), "001");
});

test("piecesToCsv は数値の列を数値のまま、識別番号を文字のまま出す", () => {
  const csv = piecesToCsv(
    [
      {
        id: "p1",
        code: "001",
        recipeName: "織部A",
        mix: [],
        firingId: "f1",
        shelf: 2,
        results: [],
        judgment: null,
        note: "所見",
        photoId: null,
        colorMemo: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    [
      {
        id: "f1",
        code: "#F-01",
        name: "本焼",
        date: "2026-08-01",
        shelfCount: 3,
        points: [
          { minutes: 0, temp: 20, atmosphereFrom: null },
          { minutes: 600, temp: 1230, atmosphereFrom: null },
        ],
        targetTemp: 1250,
        createdAt: "",
        updatedAt: "",
      },
    ],
  );
  const row = csv.split("\r\n")[1];
  assert.ok(row.includes("'001"), row);
  // 温度は算出された数値なので ' を付けない（付けると並べ替え・グラフが壊れる）。
  assert.ok(row.includes(",1250,"), row);
  assert.ok(row.includes(",1230,"), row);
});

test("piecesToCsv は自由入力の数式を書き出しに素通りさせない", () => {
  const csv = piecesToCsv(
    [
      {
        id: "p1",
        code: "=cmd|'/c calc'!A1",
        recipeName: "",
        mix: [],
        firingId: null,
        shelf: null,
        results: [],
        judgment: null,
        note: "=HYPERLINK(\"http://example.test\")",
        photoId: null,
        colorMemo: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    [],
  );
  assert.ok(!/(^|,)=cmd/.test(csv));
  assert.ok(csv.includes("'=cmd"));
  assert.ok(csv.includes("'=HYPERLINK"));
});

test("firingsToCsv は焼成側の自由入力も同じ扱いにする", () => {
  const csv = firingsToCsv([
    {
      id: "f1",
      code: "=1+1",
      name: "@本焼",
      date: "2026-08-01",
      shelfCount: 3,
      points: [],
      targetTemp: 1250,
      createdAt: "",
      updatedAt: "",
    },
  ]);
  assert.ok(csv.includes("'=1+1"));
  assert.ok(csv.includes("'@本焼"));
  // 数値の列は数値のまま。
  assert.ok(csv.includes(",1250,"));
});

test("firingsToCsv は記録日時・更新日時を落とさない（同日の焼成の順序が戻らなくなる）", () => {
  // 同じ日付の焼成は「記録日時 → 更新日時」で新しい順が決まる（sortFiringsNewestFirst）。
  // 書き出しに残さないと、戻したときに炉前が指す「直近の焼成」も比較の並びも
  // id（UUID＝意味を持たない）の順に落ちて入れ替わる。
  const csv = firingsToCsv([
    {
      id: "f1",
      code: "#F-01",
      name: "本焼",
      date: "2026-08-01",
      shelfCount: 3,
      points: [],
      targetTemp: null,
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-02T10:00:00.000Z",
    },
  ]);
  assert.ok(FIRING_CSV_HEADER.includes("記録日時"));
  assert.ok(FIRING_CSV_HEADER.includes("更新日時"));
  assert.ok(csv.includes("2026-08-01T09:00:00.000Z"));
  assert.ok(csv.includes("2026-08-02T10:00:00.000Z"));
});

test("piecesToCsv は更新日時も持ち出す（書き出しは唯一のバックアップ）", () => {
  const csv = piecesToCsv(
    [
      {
        id: "p1",
        code: "A-01",
        recipeName: "",
        mix: [],
        firingId: null,
        shelf: null,
        results: [],
        judgment: null,
        note: "所見",
        photoId: null,
        colorMemo: null,
        createdAt: "2026-08-01T09:00:00.000Z",
        updatedAt: "2026-08-03T11:00:00.000Z",
      },
    ],
    [],
  );
  assert.ok(PIECE_CSV_HEADER.includes("更新日時"));
  assert.ok(csv.includes("2026-08-03T11:00:00.000Z"));
});
