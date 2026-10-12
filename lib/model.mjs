// model.mjs — 記録のデータ定義・採番・配合の正規化。
//
// この製品は「記録」に特化する。ゼーゲル式などの釉薬計算は持たない。
// ここに計算式を足したくなったら、それは製品の境界を越えるサインなので足さない。
//
// 配合は parts（部数）で持つ。実務では合計が 100 にならない表記が普通なので、
// 合計 100 を強制せず、表示用の % だけを別に算出する。

/**
 * @typedef {object} MixRow
 * @property {string} material  材料名
 * @property {number} parts     部数
 * @property {boolean} colorant 着色材か（銅・鉄など少量で効くもの）
 *
 * @typedef {object} Piece
 * @property {string} id
 * @property {string} code        識別番号（ユーザーがタイルに書いた番号）
 * @property {string} recipeName  調合名
 * @property {MixRow[]} mix
 * @property {string | null} firingId
 * @property {number | null} shelf   棚位置（1 が最下段）
 * @property {string[]} results      結果タグ
 * @property {Judgment | null} judgment
 * @property {string} note           所見
 * @property {string | null} photoId 写真 Blob のキー
 * @property {string | null} [supersededPhotoId]
 *   差し替え中の前の写真のキー。写真を差し替えるときだけ、新しい Blob が確定するまでの間だけ持つ。
 *   この間の前の写真はどのレコードの photoId にも現れないので、これが無いと孤児の掃除に消され、
 *   新しい写真の保存が失敗したときに戻す先が無くなる。差し替えが確定した時点で外す。
 * @property {string | null} [pendingPhotoId]
 *   まだ Blob を書けていない写真のキー。記録を先に書く以上、記録が実在しない写真を指す
 *   時間が必ずできる。これが無いと「保存が進行中」と「中断してもう書かれない」を区別できず、
 *   写真を初めて付ける保存が中断した記録は、存在しない写真を指したまま残る（編集画面は
 *   写真ありとして色メモを隠し、書き出しは「あり」と報告し続ける）。Blob が確定した時点で外す。
 * @property {string | null} colorMemo 写真が無いときの色メモ（#rrggbb）
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {"again" | "adjust" | "drop"} Judgment
 *
 * @typedef {object} CurvePoint
 * @property {number} minutes  経過分
 * @property {number} temp     ℃
 * @property {Atmosphere | null} atmosphereFrom この点から雰囲気が変わる
 *
 * @typedef {"oxidation" | "neutral" | "reduction"} Atmosphere
 *
 * @typedef {object} Firing
 * @property {string} id
 * @property {string} code      #F-014 など
 * @property {string} name      「本焼」など
 * @property {string} date      YYYY-MM-DD
 * @property {number} shelfCount 棚段数（1..8）
 * @property {CurvePoint[]} points
 * @property {number | null} targetTemp
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** 結果タグの既定候補。吉凶で並べず、観察された現象として並べる。 */
export const RESULT_TAGS = [
  "貫入",
  "ピンホール",
  "流れすぎ",
  "縮れ",
  "剥離",
  "発泡",
  "色ムラ",
  "焼け不足",
  "過焼成",
  "良好",
];

/** 自由入力の結果タグを1つの入力欄で扱うときの区切り。 */
export const CUSTOM_RESULT_SEPARATOR = "・";

/**
 * 保存済みの結果タグを「既定候補」と「自由入力」に分ける。
 * 編集画面はチェックボックスを既定候補にしか出さないので、この分離をしないと
 * 自由入力の値が画面から消え、直すことも消すこともできなくなる。
 * @param {string[] | null | undefined} results
 * @returns {{ tags: string[], customText: string }}
 */
export function partitionResults(results) {
  /** @type {string[]} */
  const tags = [];
  /** @type {string[]} */
  const customs = [];
  for (const raw of results ?? []) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    if (RESULT_TAGS.includes(value)) {
      if (!tags.includes(value)) tags.push(value);
    } else if (!customs.includes(value)) {
      customs.push(value);
    }
  }
  return { tags, customText: customs.join(CUSTOM_RESULT_SEPARATOR) };
}

/**
 * チェックした既定候補と自由入力欄から、保存する結果タグの配列を作る。
 * 自由入力は区切りで分割して1件ずつ持たせる（partitionResults と往復できる形）。
 * 既定候補と同じ語を打たれても重複させない。
 * @param {string[] | null | undefined} tags
 * @param {string} customText
 * @returns {string[]}
 */
export function composeResults(tags, customText) {
  /** @type {string[]} */
  const out = [];
  const push = (/** @type {unknown} */ value) => {
    const v = String(value ?? "").trim();
    if (v && !out.includes(v)) out.push(v);
  };
  for (const tag of tags ?? []) push(tag);
  for (const part of String(customText ?? "").split(CUSTOM_RESULT_SEPARATOR)) push(part);
  return out;
}

/**
 * 鍵の中で項目を区切る文字を、値そのものの中から退避する。
 *
 * 鍵に入るのは材料名・結果タグ、つまり自由入力。区切り文字を退避せずに繋ぐと
 * `["a", "b"]` と `["a|b"]` が同じ鍵になり、別々の記録が「同じ」と判定される
 * （調合の鍵なら別の調合が1グループに束ねられ、結果の鍵なら変わった値に差分の印が付かない）。
 * @param {string} value
 * @returns {string}
 */
function escapeKeyPart(value) {
  return String(value ?? "").replace(/[\\|:]/g, "\\$&");
}

/**
 * 結果タグの順序に依存しない比較キー。
 * チェックした順にそのまま入るため、同じ内容でも配列の並びは一致しない。
 * @param {string[] | null | undefined} results
 * @returns {string}
 */
export function resultsSignature(results) {
  return [...new Set((results ?? []).map((r) => String(r ?? "").trim()).filter(Boolean))]
    .sort()
    .map(escapeKeyPart)
    .join("|");
}

/** 「判断」は3択。★評価は持たない（他人と比べる指標ではないため）。 */
export const JUDGMENTS = /** @type {const} */ ([
  { value: "again", label: "また焼く" },
  { value: "adjust", label: "要調整" },
  { value: "drop", label: "使わない" },
]);

/** 雰囲気。色ではなくパターンで区別するため、パターン種別も持たせる。 */
export const ATMOSPHERES = /** @type {const} */ ([
  { value: "oxidation", label: "酸化", pattern: "dots" },
  { value: "neutral", label: "中性", pattern: "line" },
  { value: "reduction", label: "還元", pattern: "hatch" },
]);

/** 少量でも効くため、既定で着色材として扱う材料。 */
const KNOWN_COLORANTS = [
  "銅",
  "酸化銅",
  "炭酸銅",
  "鉄",
  "弁柄",
  "酸化鉄",
  "コバルト",
  "酸化コバルト",
  "マンガン",
  "二酸化マンガン",
  "クロム",
  "ニッケル",
  "金紅石",
  "ルチル",
];

/**
 * 材料名から着色材かどうかを推定する（ユーザーは後から変更できる）。
 * @param {string} material
 * @returns {boolean}
 */
export function looksLikeColorant(material) {
  const m = String(material ?? "").trim();
  if (!m) return false;
  return KNOWN_COLORANTS.some((c) => m.includes(c));
}

/**
 * 配合の部数合計。空行（材料名なし）は無視する。
 * @param {MixRow[]} mix
 * @returns {number}
 */
export function mixTotal(mix) {
  return usableRows(mix).reduce((sum, r) => sum + toParts(r.parts), 0);
}

/**
 * 表示用の % を算出する。合計 0 のときは全て 0%（0除算を出さない）。
 * @param {MixRow[]} mix
 * @returns {{ material: string, parts: number, colorant: boolean, percent: number }[]}
 */
export function mixPercentages(mix) {
  const rows = usableRows(mix);
  const total = mixTotal(rows);
  return rows.map((r) => ({
    material: r.material.trim(),
    parts: toParts(r.parts),
    colorant: Boolean(r.colorant),
    percent: total > 0 ? (toParts(r.parts) / total) * 100 : 0,
  }));
}

/**
 * 同一調合を束ねるための安定キー。
 * 材料名の表記ゆれ（前後空白・全角空白）を吸収し、順序に依存しないようにする。
 * 部数は約分した整数比にするので、35/40/15 と 70/80/30 は同じ調合とみなす。
 *
 * 比率は丸めない。% に直して小数第1位で丸めると、この画面が入力できる少量の着色材
 * （step 0.1）が潰れて `base100 + 呉須0.10` と `base100 + 呉須0.14` が同じ鍵になる。
 * 同じ鍵になった調合は比較で1グループに束ねられ、配合バーは先頭の1件しか描かないので、
 * 調合を変えて焼き比べたという記録そのものが画面から消える。約分した整数比なら
 * 「倍量で仕込んだだけ」は束ね、打った数字の違いは残る。
 *
 * 同じ材料が複数行に分かれて入力されることがある（追記していくと普通に起きる）。
 * 行ごとに鍵を作ると `長石20 + 長石30 + 珪石50` と `長石50 + 珪石50` が別の調合になり、
 * 「同じ配合を違う条件で焼いた結果を並べる」というこの製品の目的が壊れるので、
 * 正規化した材料名で合算してから比率にする。
 *
 * 部数が 0 の材料（部数欄が空のまま残った行・0 と打たれた行・負数）は調合に何も入って
 * いないので、鍵にも入れない。入れると `長石50 + 珪石50` と `長石50 + 珪石50 + 呉須0` が
 * 別グループになり、比率で束ねるという約束が入っていない材料のせいで破れる。
 * ただし全ての行が 0 のときは比率そのものが無いので、材料名だけで束ねる
 * （空にすると「配合未記入」のピースと混ざり、書いたはずの材料名が消える）。
 * @param {MixRow[]} mix
 * @returns {string}
 */
export function mixSignature(mix) {
  const rows = usableRows(mix);
  if (rows.length === 0) return "";
  /** @type {Map<string, number>} */
  const byMaterial = new Map();
  for (const row of rows) {
    const key = normalizeMaterial(row.material);
    byMaterial.set(key, (byMaterial.get(key) ?? 0) + toParts(row.parts));
  }
  const contributing = [...byMaterial.entries()].filter(([, parts]) => parts > 0);
  if (contributing.length === 0) {
    return [...byMaterial.keys()].map((material) => `${escapeKeyPart(material)}:0`).sort().join("|");
  }
  const ratio = canonicalRatio(contributing.map(([, parts]) => parts));
  return contributing
    .map(([material], i) => `${escapeKeyPart(material)}:${ratio[i]}`)
    .sort()
    .join("|");
}

/**
 * 部数を約分した整数比に直す桁合わせ。部数の入力は step 0.1 なので、
 * 6桁あれば打てる値は全て整数に載る（残りは浮動小数の誤差だけ）。
 * 0.1 + 0.2 が 0.30000000000000004 になる類の誤差はここで吸収する。
 */
const RATIO_SCALE = 1e6;

/**
 * 正の部数の列を、約分した整数比の文字列にする。
 * 桁が大きすぎて整数に載らない場合だけ、比率の高精度表記に落とす
 * （落としても、この画面で打てる少量（0.1 部）を潰さない桁を残す）。
 * @param {number[]} parts
 * @returns {string[]}
 */
function canonicalRatio(parts) {
  const scaled = parts.map((p) => Math.round(p * RATIO_SCALE));
  if (scaled.some((n) => !Number.isSafeInteger(n))) {
    const total = parts.reduce((sum, p) => sum + p, 0);
    return parts.map((p) => ((p / total) * 100).toFixed(6));
  }
  const divisor = scaled.reduce((a, b) => gcd(a, b), 0);
  if (divisor <= 0) return scaled.map((n) => String(n));
  return scaled.map((n) => String(n / divisor));
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * @param {string} material
 * @returns {string}
 */
function normalizeMaterial(material) {
  return String(material ?? "")
    .replace(/[　\s]+/g, "")
    .toLowerCase();
}

/**
 * @param {MixRow[]} mix
 * @returns {MixRow[]}
 */
function usableRows(mix) {
  if (!Array.isArray(mix)) return [];
  return mix.filter((r) => r && String(r.material ?? "").trim() !== "");
}

/**
 * @param {unknown} parts
 * @returns {number}
 */
function toParts(parts) {
  const n = Number(parts);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 識別番号の自動採番。既存の `A-07` 形式のうち同じ接頭辞の最大値 +1 を返す。
 * 桁数は既存に合わせる（`A-07` があれば `A-08`、`A-7` があれば `A-8`）。
 * @param {string[]} existingCodes
 * @param {string} [prefix]
 * @returns {string}
 */
export function nextPieceCode(existingCodes, prefix = "A") {
  const p = String(prefix ?? "A").trim() || "A";
  const re = new RegExp(`^${escapeRe(p)}-(\\d+)$`, "i");
  let max = 0;
  let width = 2;
  for (const code of existingCodes ?? []) {
    const m = re.exec(String(code ?? "").trim());
    if (!m || m[1] === undefined) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    if (n >= max) {
      max = n;
      width = m[1].length;
    }
  }
  return `${p}-${String(max + 1).padStart(width, "0")}`;
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 保存できるかどうか。必須は識別番号と所見のみ。
 * 写真・配合・焼成・結果タグはすべて任意（欠けていることも正当な記録）。
 * @param {Partial<Piece>} piece
 * @returns {{ ok: boolean, errors: Record<string, string> }}
 */
export function validatePiece(piece) {
  /** @type {Record<string, string>} */
  const errors = {};
  const code = String(piece?.code ?? "").trim();
  const note = String(piece?.note ?? "").trim();
  if (!code) errors.code = "識別番号を入力してください。";
  else if (code.length > 40) errors.code = "識別番号は40文字までです。";
  if (!note) errors.note = "所見を入力してください。写真がなくても所見だけで残せます。";
  else if (note.length > 2000) errors.note = "所見は2000文字までです。";
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * 焼成の表示名。`2026-08-03 本焼 #F-014` の形。
 * @param {Pick<Firing, "date" | "name" | "code">} firing
 * @returns {string}
 */
export function firingLabel(firing) {
  if (!firing) return "";
  return [firing.date, firing.name, firing.code].filter((v) => String(v ?? "").trim() !== "").join(" ");
}

/**
 * 選択肢の表示名を、必ず見分けられる形にそろえる。
 *
 * この製品の表示名（焼成の「日付 名前 番号」、調合の「調合名」）はどれもユーザーの入力で
 * あって鍵ではない。同じ日に同じ名前で2回焼けば一致するし、調合名は空でも構わない。
 * 選択欄がその表示名しか出さないと、条件も中身も違う別々の記録が同じ1行に見え、
 * どちらを選んだのか分からないまま紐付けが決まる（この製品は条件と結果の対応を残すためにある）。
 *
 * 重なった表示名にだけ、中身の要約（describe）を添える。要約まで同じなら並び順の通し番号を
 * 添えて必ず一意にする（見分けは付かなくても、別の記録だと分かる形にする）。
 * 重なっていない表示名には何も足さない（読みにくくするだけなので）。
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} baseLabel 素の表示名
 * @param {(item: T) => string} [describe] 中身の要約。空文字なら添えない
 * @returns {string[]} items と同じ並びの表示名
 */
export function uniqueOptionLabels(items, baseLabel, describe) {
  const list = items ?? [];
  const bases = list.map((item) => String(baseLabel(item) ?? ""));
  /** @type {Map<string, number[]>} 表示名 → その表示名になった要素の位置 */
  const positions = new Map();
  bases.forEach((base, i) => {
    const group = positions.get(base);
    if (group) group.push(i);
    else positions.set(base, [i]);
  });

  const labels = [...bases];
  for (const [base, group] of positions) {
    if (group.length === 1) continue;
    const notes = group.map((i) => describeSafely(describe, list[i]));
    // 要約だけで見分けが付くならそれを添える。付かないものが1つでもあれば、
    // グループ全体に通し番号も添える（一部だけ番号が付くと、番号の意味が読めない）。
    const distinct = notes.every(Boolean) && new Set(notes).size === notes.length;
    group.forEach((position, n) => {
      const suffix = [notes[n], distinct ? "" : `${n + 1}件目`].filter(Boolean).join(" / ");
      labels[position] = suffix ? `${base}（${suffix}）` : base;
    });
  }
  return labels;
}

/**
 * @template T
 * @param {((item: T) => string) | undefined} describe
 * @param {T} item
 * @returns {string}
 */
function describeSafely(describe, item) {
  try {
    return String(describe?.(item) ?? "").trim();
  } catch {
    // 要約が作れない記録があっても選択肢そのものは出す（通し番号で一意になる）。
    return "";
  }
}

export const MIN_SHELF_COUNT = 1;
export const MAX_SHELF_COUNT = 8;

/**
 * 棚段数を「段の数」として成立する値に正す。読めなければ null。
 *
 * 段数は数えるものなので整数しか意味を持たない。3.5 のような値をそのまま持つと、
 * 描画と棚位置の判定では 3 段に丸められる一方で、編集画面と書き出しには 3.5 が残り、
 * 同じ焼成が場所によって違う段数を名乗ることになる。入口と出口の両方でここを通す。
 * @param {unknown} value
 * @returns {number | null}
 */
export function normalizeShelfCount(value) {
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_SHELF_COUNT, Math.min(MAX_SHELF_COUNT, Math.round(n)));
}

/**
 * 棚は上段が上に来るように降順で並べる（窯詰めのメンタルモデルと一致させる）。
 * @param {number} shelfCount
 * @returns {number[]}
 */
export function shelvesTopDown(shelfCount) {
  const n = normalizeShelfCount(shelfCount) ?? MIN_SHELF_COUNT;
  return Array.from({ length: n }, (_, i) => n - i);
}

/**
 * 焼成を新しい順に並べる。日付が無いものは末尾へ。
 *
 * 日付だけでは同日の焼成が決着せず、IndexedDB の主キー順（id は UUID）が
 * そのまま出るため「直近の焼成」が実質ランダムになる。記録時刻で必ず決着させる。
 * @param {Firing[]} firings
 * @returns {Firing[]}
 */
export function sortFiringsNewestFirst(firings) {
  return [...(firings ?? [])].sort(
    (a, b) =>
      String(b?.date ?? "").localeCompare(String(a?.date ?? "")) ||
      String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? "")) ||
      String(b?.updatedAt ?? "").localeCompare(String(a?.updatedAt ?? "")) ||
      String(b?.id ?? "").localeCompare(String(a?.id ?? "")),
  );
}

/**
 * その焼成で成立する棚位置か。
 * 段数の違う焼成に付け替えたり、段数を減らして保存したりすると範囲外になりうる。
 * 範囲外の棚位置は窯の断面（1..shelfCount のみを描く）に出ないので、必ずここで判定する。
 * @param {number | null | undefined} shelf
 * @param {number} shelfCount
 * @returns {boolean}
 */
export function isShelfInRange(shelf, shelfCount) {
  if (shelf === null || shelf === undefined) return false;
  const n = Number(shelf);
  if (!Number.isInteger(n)) return false;
  const count = normalizeShelfCount(shelfCount) ?? MIN_SHELF_COUNT;
  return n >= MIN_SHELF_COUNT && n <= count;
}

/**
 * 窯の断面に描かれないテストピース（棚位置なし・範囲外）。
 * 断面に出ないものを黙って消さず、別枠で必ず見せるために使う。
 * @param {Piece[]} pieces
 * @param {number} shelfCount
 * @returns {Piece[]}
 */
export function piecesOffShelf(pieces, shelfCount) {
  return (pieces ?? []).filter((p) => p && !isShelfInRange(p.shelf, shelfCount));
}

/**
 * 棚の呼び名。最上段/最下段だけ補助ラベルを付ける。
 * @param {number} shelf
 * @param {number} shelfCount
 * @returns {string}
 */
export function shelfSubLabel(shelf, shelfCount) {
  if (shelfCount <= 1) return "";
  if (shelf === shelfCount) return "上段";
  if (shelf === 1) return "下段（炉床直上）";
  return "中段";
}
