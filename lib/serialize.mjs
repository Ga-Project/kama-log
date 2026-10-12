// serialize.mjs — 書き出し（CSV）。
//
// 自分の記録を自分で持ち出せることは無料機能。ここをロックしない。
// Excel / Numbers で開かれる前提なので BOM を付ける（付けないと和文が化ける）。

import { mixPercentages, firingLabel, normalizeShelfCount } from "./model.mjs";
import { curveSummary, dominantAtmosphere, formatDuration } from "./curve.mjs";

/** @typedef {import("./model.mjs").Piece} Piece */
/** @typedef {import("./model.mjs").Firing} Firing */

const ATMOS_LABEL = { oxidation: "酸化", neutral: "中性", reduction: "還元" };
const JUDGMENT_LABEL = { again: "また焼く", adjust: "要調整", drop: "使わない" };

export const CSV_BOM = "﻿";

/**
 * 表計算ソフトが数式として解釈しはじめる先頭文字。
 * タブ・復帰も先頭にあると Excel が続く文字を数式の一部として読むため含める。
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * 表計算ソフトが「数値」として読み直してしまう文字列。
 * `001` は 1 に、`1.50` は 1.5 に、`1e3` は 1000 に化ける（＝打った文字が戻らない）。
 * 桁区切り・指数表記も Excel / Numbers は数値として取り込むので含める。
 */
const NUMBER_LIKE =
  /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+|\d*\.\d+|\d+\.\d*)(?:[eE][+-]?\d+)?$/;

/**
 * 表計算ソフトが「日付」として読み直してしまう文字列。
 * `1-2` や `1/2` は識別番号としてありふれた書き方だが、Excel / Numbers は 1月2日 に
 * 変換する（打った文字が戻らない）。区切りは `-`・`/`・`.` のいずれも日付として読まれる。
 */
const DATE_LIKE = /^\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,4})?$/;

/**
 * 表計算ソフトが「時刻」として読み直してしまう文字列。
 * 総焼成時間の `9:00` は9時間の経過であって午前9時ではない。温度カーブの1点だけを
 * 持つセル（`0:00:20`）も時刻として取り込まれ、経過と温度の組が消える。
 */
const TIME_LIKE = /^\d{1,3}:\d{1,2}(?::\d{1,2})?(?:\.\d+)?$/;

/**
 * 記録日時（ISO 8601）。日付と時刻を1つの値として持つので上の2つに当たらない。
 */
const DATETIME_LIKE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * 和文の日付表記。`8月1日` のような入力も表計算ソフトは日付に変換する。
 */
const JP_DATE_LIKE = /^(?:\d{1,4}年)?\d{1,2}月(?:\d{1,2}日)?$|^\d{1,4}年$/;

/**
 * 表計算ソフトが値そのものを別の型に読み替える表記かどうか。
 * @param {string} s trim 済みの文字列
 * @returns {boolean}
 */
function looksCoercible(s) {
  return (
    NUMBER_LIKE.test(s) ||
    DATE_LIKE.test(s) ||
    TIME_LIKE.test(s) ||
    DATETIME_LIKE.test(s) ||
    JP_DATE_LIKE.test(s)
  );
}

/**
 * 書き出しの文字列が Excel / Numbers で数式・数値・日付として読み替えられないようにする。
 *
 * 所見や識別番号は自由入力なので `=`・`+`・`-`・`@` で始まりうる。CSV の引用符は
 * 「区切りとして読ませない」ための記法であって、数式の解釈は止められない。
 * 同じ理由で、`001` のような識別番号は引用符で囲んでも数値として取り込まれて先頭の 0 が
 * 落ち、`1-2` や `1/2` は 1月2日 に化ける。どれも「書いた文字が戻らない」＝記録の毀損
 * なので、値そのものは残したまま先頭に `'`（表計算ソフトの文字列指定）を足して、
 * 文字として開かせる。戻すときは先頭の `'` を1つ外す。
 *
 * 読み替えの範囲は数値だけではない。日付・時刻・和文の日付も同じく値が別の型に
 * 置き換わるので、文字列として渡された値はまとめて文字のまま出す。書き出しは
 * この製品で唯一のバックアップなので、並べ替えの都合より原文が戻ることを優先する
 * （ISO の日付は文字のままでも日付順に並ぶ）。
 *
 * ここに来るのは文字列として入力された値だけ。温度や部数のような算出済みの数値は
 * 呼び出し側で数値のまま通す（文字列にすると数値列が並べ替え・グラフに使えなくなる）。
 * @param {string} s
 * @returns {string}
 */
function markAsText(s) {
  const trimmed = s.trim();
  if (!FORMULA_LEAD.test(s) && !looksCoercible(trimmed)) return s;
  return `'${s}`;
}

/**
 * 1セルを CSV としてエスケープする。
 * 引用符・カンマ・改行のいずれかを含むなら全体を引用符で囲み、内側の引用符は二重にする。
 *
 * 数値として渡された値（温度・段数・記録点数）は数値のまま出し、文字列として渡された値
 * （識別番号・調合名・所見）は文字として出す。`String()` に通してから見分けようとすると
 * 両者の区別が消え、ユーザーが打った `001` が数値の 1 として書き出される。
 *
 * CSV を書き出す経路（テストピース・焼成）は必ずここを通す。読み替えの防止を
 * 呼び出し側に持たせると、列を1つ足したときに素通りする経路ができる。
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvCell(value) {
  if (value === null || value === undefined) return "";
  // 数値・真偽値は入力そのものではなく算出値なので、読み替えられて困る文字を持たない。
  const s =
    typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : markAsText(String(value));
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 行配列を CSV 文字列にする（改行は CRLF＝表計算ソフトの既定）。
 * @param {unknown[][]} rows
 * @returns {string}
 */
export function toCsv(rows) {
  return (rows ?? []).map((row) => (row ?? []).map(escapeCsvCell).join(",")).join("\r\n");
}

export const PIECE_CSV_HEADER = [
  "識別番号",
  "調合名",
  "配合(部)",
  "焼成",
  "焼成ID",
  "焼成日",
  "目標温度(℃)",
  "最高温度(℃)",
  "総焼成時間",
  "雰囲気",
  "雰囲気の切替(経過:雰囲気)",
  "棚位置",
  "結果",
  "判断",
  "所見",
  "写真",
  "記録日時",
  "更新日時",
];

/** 配合の行と行を分ける区切り。読み戻し（splitMixCell）はこの中の `/` を目印にする。 */
const MIX_ROW_SEPARATOR = " / ";

/** 着色材の印。行の末尾に付ける。 */
const COLORANT_MARK = "（着色材）";

/**
 * 材料名の中に現れた区切り文字を退避する。
 *
 * 材料名は自由入力なので `/` を含みうる。退避せずに並べると `長石 / 珪石 50` の1行が
 * 「長石」と「珪石 50」の2行と見分けが付かなくなり、書き出しからも印刷からも
 * 打った配合が戻らない（書き出しはこの製品で唯一のバックアップなので、戻らない＝記録の毀損）。
 *
 * 退避記号そのもの（`\`）も一緒に退避する。しないと `\/` が「退避された区切り」なのか
 * 「材料名の `\` に続く区切り」なのか決まらない。
 * @param {string} material
 * @returns {string}
 */
export function escapeMixMaterial(material) {
  return String(material ?? "").replace(/[\\/]/g, "\\$&");
}

/**
 * escapeMixMaterial の逆。退避記号を1つ外す。
 * @param {string} text
 * @returns {string}
 */
export function unescapeMixMaterial(text) {
  return String(text ?? "").replace(/\\([\s\S])/g, "$1");
}

/**
 * 配合の1行を CSV セル内の表記にする。
 * 着色材の印はユーザーが行ごとに付け外しできる入力なので（材料名からの推定は初期値にすぎない）、
 * 落とすと書き出しから元の配合を復元できなくなる。
 *
 * 数は保存されている部数をそのまま出す（% に直すと 1:3 が 25/75 になり、
 * 書き戻したときに元の数字が戻らない）。単位は列見出しの「配合(部)」で示す。
 * @param {{ material: string, parts: number, colorant: boolean }} row
 * @returns {string}
 */
export function mixRowCell(row) {
  const base = `${escapeMixMaterial(row?.material ?? "")} ${row?.parts ?? 0}`;
  return row?.colorant ? `${base}${COLORANT_MARK}` : base;
}

/**
 * 配合を1セル分の表記にまとめる。CSV と印刷（PDF）で同じ表記にするため、
 * 書き出す側はここを通す（別々に組み立てると、片方だけが単位や着色材の印を落とす）。
 * @param {import("./model.mjs").MixRow[]} mix
 * @returns {string}
 */
export function mixCell(mix) {
  return mixPercentages(mix ?? []).map(mixRowCell).join(MIX_ROW_SEPARATOR);
}

/**
 * 1セルにまとめた配合を行に戻す（mixCell の逆）。
 *
 * 書き出しが唯一のバックアップである以上、「戻せる」は仕様であって努力目標ではない。
 * 逆変換をここに置いて往復をテストで固定しないと、表記だけを足したときに
 * 静かに戻せなくなる（誰も戻す処理を持っていないと、壊れたことにも気付けない）。
 *
 * 材料名の中の `/` は退避済みなので、退避されていない `/` は必ず行の区切り。
 * 部数は行の末尾（着色材の印があればその手前）の数として読む。材料名に空白があっても、
 * 末尾から数を1つ取れば残りが材料名になる。
 * @param {string} cell
 * @returns {{ material: string, parts: number, colorant: boolean }[]}
 */
export function parseMixCell(cell) {
  /** @type {{ material: string, parts: number, colorant: boolean }[]} */
  const rows = [];
  for (const chunk of splitMixCell(cell)) {
    const text = chunk.trim();
    if (!text) continue;
    const colorant = text.endsWith(COLORANT_MARK);
    const body = colorant ? text.slice(0, -COLORANT_MARK.length).trim() : text;
    const at = body.lastIndexOf(" ");
    const partsText = at === -1 ? "" : body.slice(at + 1);
    const parts = partsText === "" ? Number.NaN : Number(partsText);
    const hasParts = Number.isFinite(parts);
    rows.push({
      material: unescapeMixMaterial(hasParts ? body.slice(0, at) : body),
      parts: hasParts ? parts : 0,
      colorant,
    });
  }
  return rows;
}

/**
 * 退避されていない `/` だけで区切る。
 * @param {string} cell
 * @returns {string[]}
 */
function splitMixCell(cell) {
  const s = String(cell ?? "");
  /** @type {string[]} */
  const out = [];
  let buffer = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      buffer += ch + s[i + 1];
      i += 1;
      continue;
    }
    if (ch === "/") {
      out.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  out.push(buffer);
  return out;
}

/**
 * 書き出しの中で焼成を一意に指す鍵。
 *
 * 表示名（日付・名前・番号）は同じ日に同じ名前で焼けば一致するので、テストピース側の
 * 「焼成」列だけでは、どちらの焼成に紐付いていたのかが復元できない。テストピースと焼成は
 * 別々のファイルに書き出されるため、両方が同じ鍵を持っていないと紐付けが失われる。
 * @param {{ id?: string } | null | undefined} firing
 * @returns {string}
 */
export function firingKey(firing) {
  return String(firing?.id ?? "");
}

/**
 * テストピース一覧を CSV 行に変換する。
 * 写真そのものは CSV に入らないので「あり/なし」だけを残す（黙って落とさない）。
 *
 * @param {Piece[]} pieces
 * @param {Firing[]} firings
 * @returns {string}
 */
export function piecesToCsv(pieces, firings) {
  const byId = new Map((firings ?? []).map((f) => [f.id, f]));
  const rows = [PIECE_CSV_HEADER];

  for (const piece of pieces ?? []) {
    if (!piece) continue;
    const firing = piece.firingId ? (byId.get(piece.firingId) ?? null) : null;
    const summary = firing ? curveSummary(firing.points ?? []) : null;
    const atmosphere = firing ? dominantAtmosphere(firing.points ?? []) : null;

    rows.push([
      piece.code ?? "",
      piece.recipeName ?? "",
      mixCell(piece.mix ?? []),
      firing ? firingLabel(firing) : "",
      // 表示名は同日同名の焼成で一致する。焼成 CSV と突き合わせる鍵はこの列だけ。
      // 焼成の記録が見つからないときも、テストピースが持っている紐付け先は残す
      // （消すと、焼成だけを先に書き出してあった場合にも二度と繋がらなくなる）。
      firingKey(firing) || String(piece.firingId ?? ""),
      firing?.date ?? "",
      firing?.targetTemp === null || firing?.targetTemp === undefined ? "" : firing.targetTemp,
      summary?.maxTemp ?? "",
      summary?.totalMinutes === null || summary?.totalMinutes === undefined
        ? ""
        : formatDuration(summary.totalMinutes),
      atmosphere ? ATMOS_LABEL[atmosphere] : "",
      firing ? atmosphereChangeCell(firing.points ?? []) : "",
      piece.shelf === null || piece.shelf === undefined ? "" : `棚${piece.shelf}`,
      (piece.results ?? []).join("・"),
      piece.judgment ? JUDGMENT_LABEL[piece.judgment] : "",
      piece.note ?? "",
      piece.photoId ? "あり" : piece.colorMemo ? `色メモ ${piece.colorMemo}` : "なし",
      piece.createdAt ?? "",
      piece.updatedAt ?? "",
    ]);
  }
  return CSV_BOM + toCsv(rows);
}

export const FIRING_CSV_HEADER = [
  "焼成ID",
  // 入るのは焼成の番号（code）だけ。日付・名前は次の列に別々に入るので、ここを
  // テストピース CSV と同じ「焼成」と名乗らせない（あちらは日付・名前・番号を
  // 連結した表示名が入る列。列名だけを見て突き合わせると別物を同じ列と読む）。
  // 画面の入力欄の見出し（番号）とも同じ言葉にする。
  "番号",
  "日付",
  "名前",
  "棚段数",
  "目標温度(℃)",
  "最高温度(℃)",
  "総焼成時間",
  "雰囲気",
  "記録点数",
  "温度カーブ(経過:温度[>雰囲気])",
  "雰囲気の切替(経過:雰囲気)",
  // 記録時刻は「どちらが新しい焼成か」を決める値。日付が同じ焼成の順序は
  // sortFiringsNewestFirst が記録日時 → 更新日時 で決着させるので、これを落とすと
  // 書き出しから戻したときに炉前が指す「直近の焼成」も比較の並びも入れ替わりうる
  // （残るのは id の並びだけで、id は UUID＝意味を持たない）。
  "記録日時",
  "更新日時",
];

/**
 * 温度カーブの1点を CSV セル内の表記にする。
 * 雰囲気の切替点は焼成条件そのものなので、経過・温度と一緒に必ず持ち出す
 * （書き出しが唯一のバックアップである以上、ここで落とすと復元できない）。
 * @param {import("./model.mjs").CurvePoint} point
 * @returns {string}
 */
export function curvePointCell(point) {
  const base = `${formatDuration(point?.minutes)}:${point?.temp ?? ""}`;
  const atmosphere = point?.atmosphereFrom;
  const label = atmosphere ? ATMOS_LABEL[atmosphere] : null;
  return label ? `${base}>${label}` : base;
}

/**
 * 雰囲気が切り替わった点だけを並べる。カーブのセルを読まなくても切替が追える。
 * @param {import("./model.mjs").CurvePoint[]} points
 * @returns {string}
 */
export function atmosphereChangeCell(points) {
  return (points ?? [])
    .filter((p) => p && p.atmosphereFrom)
    .map((p) => `${formatDuration(p.minutes)}:${ATMOS_LABEL[p.atmosphereFrom] ?? p.atmosphereFrom}`)
    .join(" ");
}

/**
 * 焼成一覧を CSV 行に変換する。温度カーブは 1 セルに畳んで持たせる。
 *
 * 目標温度は「何℃を狙って焼いたか」というユーザーの入力で、実測カーブからは導けない
 * （狙いと結果が違うことこそ記録の意味）。書き出しが唯一のバックアップである以上、
 * 独立した列として必ず持ち出す。
 * @param {Firing[]} firings
 * @returns {string}
 */
export function firingsToCsv(firings) {
  const rows = [FIRING_CSV_HEADER];
  for (const firing of firings ?? []) {
    if (!firing) continue;
    const summary = curveSummary(firing.points ?? []);
    const atmosphere = dominantAtmosphere(firing.points ?? []);
    rows.push([
      // テストピース CSV の「焼成ID」と突き合わせるための鍵。番号（code）は未記入でも
      // 重複していても構わない入力なので、鍵には使えない。
      firingKey(firing),
      firing.code ?? "",
      firing.date ?? "",
      firing.name ?? "",
      // 画面が使う段数（整数）と同じ値を書き出す。生の値を出すと、書き出しだけが
      // 断面や棚位置の判定と違う段数を名乗る。
      normalizeShelfCount(firing.shelfCount) ?? "",
      firing.targetTemp === null || firing.targetTemp === undefined ? "" : firing.targetTemp,
      summary.maxTemp ?? "",
      summary.totalMinutes === null ? "" : formatDuration(summary.totalMinutes),
      atmosphere ? ATMOS_LABEL[atmosphere] : "",
      summary.pointCount,
      (firing.points ?? []).map(curvePointCell).join(" "),
      atmosphereChangeCell(firing.points ?? []),
      firing.createdAt ?? "",
      firing.updatedAt ?? "",
    ]);
  }
  return CSV_BOM + toCsv(rows);
}

/**
 * 書き出しファイル名。日付を入れて上書き事故を避ける。
 * @param {string} kind
 * @param {string} isoDate YYYY-MM-DD
 * @returns {string}
 */
export function exportFilename(kind, isoDate) {
  const safeKind = String(kind ?? "record").replace(/[^a-z0-9-]/gi, "") || "record";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate)) ? isoDate : "export";
  return `kama-log_${safeKind}_${safeDate}.csv`;
}
