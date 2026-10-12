// compare.mjs — 同一調合の横断比較。
//
// この製品の中核。「同じ配合を、違う条件で焼いたらどうなったか」を横一列に並べる。
// 比較の読み取りを一瞬にするのは差分（前の列と値が変わったセル）なので、
// 行の組み立てと同時に差分フラグを付ける。

import {
  mixSignature,
  firingLabel,
  isShelfInRange,
  normalizeShelfCount,
  resultsSignature,
  shelfSubLabel,
} from "./model.mjs";
import { mixCell } from "./serialize.mjs";
import {
  atmosphereSegments,
  atmosphereSignature,
  curveAriaLabel,
  curveSignature,
  curveSummary,
  dominantAtmosphere,
  formatDuration,
} from "./curve.mjs";

/** @typedef {import("./model.mjs").Piece} Piece */
/** @typedef {import("./model.mjs").Firing} Firing */

const ATMOS_LABEL = { oxidation: "酸化", neutral: "中性", reduction: "還元" };
const JUDGMENT_LABEL = { again: "また焼く", adjust: "要調整", drop: "使わない" };

/**
 * 調合ごとにテストピースを束ねる。
 * 配合が空のピースは束ねようがないので「配合未記入」の1グループにまとめる。
 * @param {Piece[]} pieces
 * @returns {{ signature: string, recipeName: string, pieces: Piece[] }[]}
 */
export function groupByRecipe(pieces) {
  /** @type {Map<string, { signature: string, recipeName: string, pieces: Piece[] }>} */
  const groups = new Map();
  for (const piece of pieces ?? []) {
    if (!piece) continue;
    const signature = mixSignature(piece.mix ?? []);
    const key = signature || `__name__:${String(piece.recipeName ?? "").trim()}`;
    const existing = groups.get(key);
    if (existing) {
      existing.pieces.push(piece);
      // 調合名は最初に見つかった非空のものを採る。
      if (!existing.recipeName && piece.recipeName) existing.recipeName = piece.recipeName;
    } else {
      groups.set(key, {
        signature: key,
        recipeName: String(piece.recipeName ?? "").trim(),
        pieces: [piece],
      });
    }
  }
  // 件数が同じグループの並びが実行ごとに変わらないよう、調合名・キーで決着させる。
  return [...groups.values()].sort(
    (a, b) =>
      b.pieces.length - a.pieces.length ||
      String(a.recipeName).localeCompare(String(b.recipeName)) ||
      String(a.signature).localeCompare(String(b.signature)),
  );
}

/**
 * 比較レールの列（＝テストピース1件）を、焼成情報とともに組み立てる。
 * 既定は焼成日の古い→新しい（左→右が時間軸＝窯の履歴）。
 *
 * @param {Piece[]} pieces
 * @param {Firing[]} firings
 * @param {{ sort?: "date" | "maxTemp" | "atmosphere" }} [options]
 * @returns {CompareColumn[]}
 */
export function buildCompareColumns(pieces, firings, options = {}) {
  const byId = new Map((firings ?? []).map((f) => [f.id, f]));
  const columns = (pieces ?? []).filter(Boolean).map((piece) => {
    const firing = piece.firingId ? (byId.get(piece.firingId) ?? null) : null;
    const summary = firing ? curveSummary(firing.points ?? []) : null;
    const atmosphere = firing ? dominantAtmosphere(firing.points ?? []) : null;
    return {
      piece,
      firing,
      // 目標温度は「何℃を狙って焼いたか」という入力で、実測カーブからは導けない。
      // 焼成の表示名にも入らないので、ここで持たないと比較のどこにも出ない
      // （日付・名前・番号・実測が同じで狙いだけが違う焼成が、同じ条件に見える）。
      targetTemp: firing?.targetTemp ?? null,
      maxTemp: summary?.maxTemp ?? null,
      totalMinutes: summary?.totalMinutes ?? null,
      atmosphere,
      shelf: piece.shelf ?? null,
      // 棚位置は「その窯の何段目か」でしかない。段数が違えば同じ数字でも物理的な位置が
      // 変わる（3段窯の棚3は最上段、5段窯の棚3は中段）ので、段数も一緒に持つ。
      // 持たないと、棚位置の軸が違う位置を同じ値として並べ、差分の印も付かない。
      shelfCount: firing ? (normalizeShelfCount(firing.shelfCount) ?? null) : null,
      date: firing?.date ?? null,
    };
  });

  const sort = options.sort ?? "date";
  const sorted = [...columns].sort((a, b) => {
    if (sort === "maxTemp") {
      return nullsLast(a.maxTemp, b.maxTemp, (x, y) => x - y) || tieBreak(a, b);
    }
    if (sort === "atmosphere") {
      return (
        nullsLast(a.atmosphere, b.atmosphere, (x, y) => String(x).localeCompare(String(y))) ||
        tieBreak(a, b)
      );
    }
    return nullsLast(a.date, b.date, (x, y) => String(x).localeCompare(String(y))) || tieBreak(a, b);
  });
  return sorted;
}

/**
 * 並び順の決着。同日・同温度の列が実行ごとに入れ替わると、差分の印まで変わってしまう。
 * 焼成の記録時刻 → テストピースの記録時刻 → id の順に見て、必ず一意に決める。
 * @param {CompareColumn} a
 * @param {CompareColumn} b
 * @returns {number}
 */
function tieBreak(a, b) {
  return (
    String(a.firing?.createdAt ?? "").localeCompare(String(b.firing?.createdAt ?? "")) ||
    String(a.piece?.createdAt ?? "").localeCompare(String(b.piece?.createdAt ?? "")) ||
    String(a.piece?.id ?? "").localeCompare(String(b.piece?.id ?? ""))
  );
}

/**
 * @template T
 * @param {T | null} a
 * @param {T | null} b
 * @param {(x: T, y: T) => number} cmp
 * @returns {number}
 */
function nullsLast(a, b, cmp) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  return cmp(a, b);
}

/**
 * @typedef {object} CompareColumn
 * @property {Piece} piece
 * @property {Firing | null} firing
 * @property {number | null} targetTemp
 * @property {number | null} maxTemp
 * @property {number | null} totalMinutes
 * @property {import("./model.mjs").Atmosphere | null} atmosphere
 * @property {number | null} shelf
 * @property {number | null} shelfCount
 * @property {string | null} date
 *
 * @typedef {object} CompareCell
 * @property {string} text     表示文字列（値が無ければ "—"）
 * @property {boolean} changed 直前の列と値が違うか
 *
 * @typedef {object} CompareRow
 * @property {string} key
 * @property {string} label
 * @property {CompareCell[]} cells
 */

/**
 * 雰囲気の列の表示。切替が無ければ要約（もっとも長く占めた雰囲気）だけ、
 * 切替があれば `酸化 → 5:00 還元` のように切替の時刻まで出す。
 *
 * 要約だけを出すと、還元に入る時刻だけが違う焼成が同じ表示になり、
 * 「条件が同じ」と読めてしまう（この製品は条件の違いを見るためにある）。
 * @param {CompareColumn} column
 * @returns {string}
 */
function atmosphereCell(column) {
  const segments = atmosphereSegments(column?.firing?.points ?? []);
  if (segments.length <= 1) {
    return column?.atmosphere ? ATMOS_LABEL[column.atmosphere] : "";
  }
  return segments
    .map((seg, i) =>
      i === 0
        ? ATMOS_LABEL[seg.atmosphere]
        : `${formatDuration(seg.from)} ${ATMOS_LABEL[seg.atmosphere]}`,
    )
    .join(" → ");
}

/**
 * 棚位置の列の表示。段数の分かる焼成では、全体の段数と上下の呼び名まで出す。
 *
 * 「棚3」だけを出すと、3段窯の最上段と5段窯の中段が同じ表示になり、
 * 「同じ位置に置いた」と読めてしまう（棚位置は焼成の中の相対位置でしかない）。
 * @param {CompareColumn} column
 * @returns {string}
 */
function shelfCell(column) {
  const shelf = column?.shelf ?? null;
  if (shelf === null) return "";
  const count = column?.shelfCount ?? null;
  if (!count) return `棚${shelf}`;
  const sub = isShelfInRange(shelf, count) ? shelfSubLabel(shelf, count) : "この焼成には無い段";
  return sub ? `棚${shelf}（全${count}段・${sub}）` : `棚${shelf}（全${count}段）`;
}

/**
 * 比較レールの行（＝比較軸）を作る。
 * 差分は「直前の列と値が違うか」。最初の列は常に changed=false（比較対象が無いため）。
 *
 * @param {CompareColumn[]} columns
 * @returns {CompareRow[]}
 */
export function buildCompareRows(columns) {
  const cols = columns ?? [];
  /**
   * value は表示、signature は差分判定に使う値（省略時は value と同じ）。
   * 表示順に意味がある一方で、差分は順序に左右されてはいけない軸があるため分けている。
   * @type {{ key: string, label: string, value: (c: CompareColumn) => string, signature?: (c: CompareColumn) => string }[]}
   */
  const axes = [
    // 狙い（目標温度）→ 結果（最高温度）の順。書き出し（CSV）の列順とも揃える。
    {
      key: "targetTemp",
      label: "目標温度",
      value: (c) => (c.targetTemp === null || c.targetTemp === undefined ? "" : `${c.targetTemp}℃`),
    },
    { key: "maxTemp", label: "最高温度", value: (c) => (c.maxTemp === null ? "" : `${c.maxTemp}℃`) },
    {
      key: "totalMinutes",
      label: "総焼成時間",
      value: (c) => (c.totalMinutes === null ? "" : formatDuration(c.totalMinutes)),
    },
    {
      key: "atmosphere",
      label: "雰囲気",
      // 切替が1回でもあれば、いつ切り替えたかまで見せる（下の signature で差分が付くのに
      // 表示が「酸化」のままだと、何が変わったのか読み手に分からない）。
      value: (c) => atmosphereCell(c),
      // 切替の時刻は焼成条件そのもの。同じ酸化主体でも還元に入る時刻が違えば別の条件なので、
      // 「もっとも長く占めた雰囲気」ではなく切替の並びで比べる。
      signature: (c) => atmosphereSignature(c.firing?.points ?? []),
    },
    {
      key: "shelf",
      label: "棚位置",
      value: (c) => shelfCell(c),
      // 段数の違う窯の同じ数字を「同じ位置」と読ませない。棚3は3段窯なら最上段、
      // 5段窯なら中段で、置いた場所そのものが違う（この製品は条件の違いを見るためにある）。
      signature: (c) => (c.shelf === null ? "" : `shelf:${c.shelf}|of:${c.shelfCount ?? ""}`),
    },
    {
      key: "firing",
      label: "焼成",
      value: (c) => (c.firing ? firingLabel(c.firing) : ""),
      // 表示名は日付・名前・番号の連結なので、番号を付けていない同日同名の焼成では一致する。
      // 別々の焼成を「同じ焼成」と読ませないため、差分は焼成そのもの（id）で見る。
      signature: (c) => (c.firing ? `id:${c.firing.id}` : ""),
    },
    {
      key: "results",
      label: "結果",
      value: (c) => (c.piece.results ?? []).join("・"),
      // 結果タグはチェックした順に入るので、同じ内容でも並びが違う。
      // 並び順の違いを「条件が変わった」と読ませないため、集合として比べる。
      signature: (c) => resultsSignature(c.piece.results),
    },
    {
      key: "judgment",
      label: "判断",
      value: (c) => (c.piece.judgment ? JUDGMENT_LABEL[c.piece.judgment] : ""),
    },
    { key: "note", label: "所見", value: (c) => String(c.piece.note ?? "").trim() },
  ];

  return axes.map((axis) => ({
    key: axis.key,
    label: axis.label,
    cells: markChangedCells(cols, axis.value, axis.signature),
  }));
}

/**
 * 直前の列と違うセルに印を付ける（差分判定の実装はここ1か所）。
 *
 * 比較軸が増えるたびに同じループを書き写すと、写し忘れた軸だけが
 * 「値は違うのに印が付かない」列になる（読み手には条件が同じに見える）。
 * @param {CompareColumn[]} columns
 * @param {(c: CompareColumn) => string} value 表示文字列
 * @param {(c: CompareColumn) => string} [signature] 差分判定に使う値（省略時は表示と同じ）
 * @returns {CompareCell[]}
 */
function markChangedCells(columns, value, signature) {
  /** @type {CompareCell[]} */
  const cells = [];
  /** @type {string | null} */
  let previous = null;
  for (const col of columns ?? []) {
    const raw = value(col);
    const key = signature ? signature(col) : raw;
    const text = raw === "" ? "—" : raw;
    // 直前と比較する。両方が空（"—"）なら「変わっていない」とみなす。
    const changed = previous !== null && key !== previous;
    cells.push({ text, changed });
    previous = key;
  }
  return cells;
}

/**
 * 温度カーブの行のセル。図を描くのは画面側なので、ここでは差分の印と読み上げ文だけを作る。
 *
 * 温度カーブも焼成条件の1つなので、他の条件行と同じ印を付ける。付けないと、
 * 最高温度と総焼成時間が同じで途中の昇温だけが違う焼成が「条件が同じ」に見える
 * （焼成の行の印は「別の焼成である」ことしか言わない）。
 * @param {CompareColumn[]} columns
 * @returns {CompareCell[]}
 */
export function buildCurveCells(columns) {
  return markChangedCells(
    columns ?? [],
    (c) => {
      const points = c?.firing?.points ?? [];
      // 図と同じ説明文を使う（図が読めない読み手にも、印の対象が何かが分かる）。
      return points.length > 0 ? curveAriaLabel(points) : "";
    },
    (c) => curveSignature(c?.firing?.points ?? []),
  );
}

/**
 * 配合の1行表記。印刷（PDF）のバックアップで使う。
 *
 * 印刷は CSV と並ぶバックアップなので、CSV と同じ組み立て（mixCell）をそのまま使う。
 * 別々に組み立てると、片方だけが着色材の印や単位を落としても気付けない。
 *
 * 数は保存されている部数をそのまま出す。正規化した % を単位無しで出していたため、
 * 1:3 の配合が `材料A25 材料B75` と印刷され、部数として読み直すと元の数字に戻らなかった。
 * 単位は表の見出し（配合(部)）で示す。
 * @param {Piece | undefined} piece
 * @returns {string}
 */
export function mixOneLine(piece) {
  if (!piece) return "";
  return mixCell(piece.mix ?? []);
}

/**
 * 小数第1位まで。ただし整数なら小数を出さない（35.0% より 35% の方が読みやすい）。
 * @param {number} percent
 * @returns {string}
 */
export function formatPercent(percent) {
  const n = Number(percent) || 0;
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
