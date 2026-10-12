// curve.mjs — 温度カーブの要約と描画座標。
//
// 可視化ライブラリは入れない。点の列から polyline の座標を作るだけの純関数に留める。
// 「カーブを描く」以上のこと（回帰・平滑化・予測）はしない。記録した点がそのまま真実。

/** @typedef {import("./model.mjs").CurvePoint} CurvePoint */
/** @typedef {import("./model.mjs").Atmosphere} Atmosphere */

/**
 * 経過分を `H:MM` に整形する。11:30 のような焼成時間表記。
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * `11:30` / `690` / `11:5` を分に直す。読めなければ null。
 * @param {string | number} value
 * @returns {number | null}
 */
export function parseDuration(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const s = String(value ?? "").trim();
  if (!s) return null;
  const colon = /^(\d{1,3}):([0-5]?\d)$/.exec(s);
  if (colon && colon[1] !== undefined && colon[2] !== undefined) {
    return Number(colon[1]) * 60 + Number(colon[2]);
  }
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

/**
 * 点を経過分の昇順に整える。同じ時刻が2つあっても落とさない（記録は消さない）。
 * @param {CurvePoint[]} points
 * @returns {CurvePoint[]}
 */
export function sortPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p) => p && Number.isFinite(Number(p.minutes)) && Number.isFinite(Number(p.temp)))
    .map((p) => ({
      minutes: Number(p.minutes),
      temp: Number(p.temp),
      atmosphereFrom: p.atmosphereFrom ?? null,
    }))
    .sort((a, b) => a.minutes - b.minutes);
}

/**
 * 焼成の要約。点が無ければ全て null（0 と混同させない）。
 * @param {CurvePoint[]} points
 * @returns {{ maxTemp: number | null, maxAt: number | null, totalMinutes: number | null, pointCount: number }}
 */
export function curveSummary(points) {
  const ps = sortPoints(points);
  if (ps.length === 0) {
    return { maxTemp: null, maxAt: null, totalMinutes: null, pointCount: 0 };
  }
  let maxTemp = -Infinity;
  let maxAt = null;
  for (const p of ps) {
    if (p.temp > maxTemp) {
      maxTemp = p.temp;
      maxAt = p.minutes;
    }
  }
  const last = ps[ps.length - 1];
  return {
    maxTemp,
    maxAt,
    totalMinutes: last ? last.minutes : null,
    pointCount: ps.length,
  };
}

/**
 * polyline 用の座標文字列を作る。
 * 温度域は「点の最小〜最大」ではなく 0℃ 起点にすると平坦になりすぎるため、
 * 下限は最低温度の少し下、上限は最高温度の少し上に取って形が読めるようにする。
 *
 * 時間軸は逆に 0:00 起点にする（軸のラベルも「0:00 — 総焼成時間」と読ませている）。
 * 最初の点の経過分を引いて詰めると、点火から最初の記録までの空白が消え、
 * その分だけ後続の間隔と傾きが実際より急に見える。記録していない時間も時間として残す。
 *
 * 座標にはもとの点の雰囲気切替もそのまま持たせる。座標だけを返すと、読み手は
 * 経過分と温度で元の点を引き直すしかなくなり、同じ時刻・同じ温度で雰囲気だけが違う点
 * （sortPoints は同時刻の点を落とさない）が取り違えられる。
 *
 * @param {CurvePoint[]} points
 * @param {{ width: number, height: number, padX?: number, padY?: number }} box
 * @returns {{ points: string, coords: {x: number, y: number, minutes: number, temp: number, atmosphereFrom: Atmosphere | null}[], scale: { minTemp: number, maxTemp: number, maxMinutes: number } } | null}
 */
export function curvePolyline(points, box) {
  const ps = sortPoints(points);
  if (ps.length === 0) return null;

  const width = Number(box?.width) || 0;
  const height = Number(box?.height) || 0;
  const padX = Number(box?.padX ?? 2);
  const padY = Number(box?.padY ?? 4);
  if (width <= padX * 2 || height <= padY * 2) return null;

  const temps = ps.map((p) => p.temp);
  const rawMin = Math.min(...temps);
  const rawMax = Math.max(...temps);
  // 全点が同じ温度でも直線が描けるように、幅ゼロを避ける。
  const span = rawMax - rawMin;
  const margin = span > 0 ? span * 0.08 : Math.max(10, Math.abs(rawMax) * 0.05 || 10);
  const minTemp = rawMin - margin;
  const maxTemp = rawMax + margin;

  const maxMinutes = ps[ps.length - 1]?.minutes ?? 0;
  // 0:00 から最後の点までを幅いっぱいに取る。
  // 全点が同じ経過分（1点だけ・0:00 だけ）のときは割れないので中央に置く。
  const timeSpan = maxMinutes > 0 ? maxMinutes : 0;

  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const coords = ps.map((p) => {
    // 壊れた記録（負の経過分）でも枠の外に描かない。
    const tRatio = timeSpan > 0 ? clamp01(p.minutes / timeSpan) : 0.5;
    const vRatio = (p.temp - minTemp) / (maxTemp - minTemp);
    return {
      x: round2(padX + tRatio * innerW),
      // SVG は上が 0 なので温度が高いほど y を小さくする。
      y: round2(padY + (1 - vRatio) * innerH),
      minutes: p.minutes,
      temp: p.temp,
      atmosphereFrom: p.atmosphereFrom ?? null,
    };
  });

  return {
    points: coords.map((c) => `${c.x},${c.y}`).join(" "),
    coords,
    scale: { minTemp, maxTemp, maxMinutes },
  };
}

/**
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {number} n
 * @returns {number}
 */
function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * 雰囲気の区間を作る。`atmosphereFrom` が付いた点でそこから切り替わる。
 * 最初の点に指定が無ければ酸化として始める（電気窯の既定）。
 *
 * 最後の点で切り替えた記録（`atmosphereFrom` が最終点に付いている・点が1つしかない）は
 * 区間の長さが 0 になる。長さで捨てると、CSV と数値の表には残っている切替が
 * 要約・比較・図の凡例からだけ消え、「切替の無い焼成」と同じ顔になる。
 * 記録された切替は長さ 0 の区間としてでも必ず返す。
 *
 * 逆に、切替が一度も記録されていない焼成では長さ 0 の区間を作らない。
 * そこでの「酸化」は既定値の推測でしかなく、返してしまうと
 * 「不明を勝手に酸化と言わない」（dominantAtmosphere）が崩れる。
 * @param {CurvePoint[]} points
 * @returns {{ from: number, to: number, atmosphere: Atmosphere }[]}
 */
export function atmosphereSegments(points) {
  const ps = sortPoints(points);
  const first = ps[0];
  const last = ps[ps.length - 1];
  if (!first || !last) return [];
  /** @type {{ from: number, to: number, atmosphere: Atmosphere }[]} */
  const segments = [];
  /** @type {Atmosphere} */
  let current = first.atmosphereFrom ?? "oxidation";
  let start = first.minutes;
  // 記録された切替を1つでも見たか（＝いまの雰囲気が推測ではないか）。
  let recorded = Boolean(first.atmosphereFrom);

  for (let i = 1; i < ps.length; i++) {
    const p = ps[i];
    if (!p) continue;
    if (p.atmosphereFrom && p.atmosphereFrom !== current) {
      segments.push({ from: start, to: p.minutes, atmosphere: current });
      current = p.atmosphereFrom;
      start = p.minutes;
      recorded = true;
    }
  }
  if (last.minutes > start || recorded) {
    segments.push({ from: start, to: Math.max(last.minutes, start), atmosphere: current });
  }
  return segments;
}

/**
 * 焼成全体を一言で表す雰囲気。もっとも長く占めた区間を採る。
 * 区間が無ければ null（「不明」を勝手に酸化と言わない）。
 *
 * 最後の点で切り替えた記録は長さ 0 の区間になるので、全体の要約は塗り替えない
 * （切替そのものは atmosphereSignature と比較・書き出しが持つ）。
 * @param {CurvePoint[]} points
 * @returns {Atmosphere | null}
 */
export function dominantAtmosphere(points) {
  const segs = atmosphereSegments(points);
  if (segs.length === 0) return null;
  /** @type {Record<string, number>} */
  const totals = {};
  for (const s of segs) {
    totals[s.atmosphere] = (totals[s.atmosphere] ?? 0) + (s.to - s.from);
  }
  let best = null;
  let bestLen = -1;
  for (const [atmosphere, len] of Object.entries(totals)) {
    if (len > bestLen) {
      bestLen = len;
      best = atmosphere;
    }
  }
  return /** @type {Atmosphere | null} */ (best);
}

/**
 * 雰囲気の切替スケジュールの比較キー。
 *
 * 「もっとも長く占めた雰囲気」（dominantAtmosphere）は焼成条件の要約でしかなく、
 * 同じ酸化主体でも還元に入る時刻が 2:00 と 5:00 の焼成を同じ値にしてしまう。
 * 切替の時刻は焼成条件そのもの（結果を左右する）なので、切替の並びで見る。
 *
 * 最初の区間は雰囲気だけを見る（開始時刻は「いつから記録を取り始めたか」であって
 * 切替ではない。ここを鍵に入れると、記録の開始時刻が違うだけの焼成が
 * 「雰囲気が違う」と読まれる）。区間の終わりも見ない（総焼成時間は別の軸）。
 * @param {CurvePoint[]} points
 * @returns {string}
 */
export function atmosphereSignature(points) {
  return atmosphereSegments(points)
    .map((seg, i) => (i === 0 ? String(seg.atmosphere) : `${seg.from}:${seg.atmosphere}`))
    .join("|");
}

/**
 * 温度カーブそのものの比較キー。
 *
 * 最高温度と総焼成時間は要約でしかない。同じ 1250℃・同じ 10:00 でも、途中の昇温の
 * 傾きや保持の取り方が違えば別の焼成条件で、それがこの製品で見たい違いそのもの
 * （比較の図は列ごとに独立して縦横に伸縮するので、形の違いは目でも拾いにくい）。
 * 記録された点を並びごと鍵にして、要約が一致する焼成を「同じ条件」と読ませない。
 *
 * 点の並びは経過分で正規化する（打った順ではなく、記録された形で比べる）。
 * @param {CurvePoint[]} points
 * @returns {string}
 */
export function curveSignature(points) {
  return sortPoints(points)
    .map((p) => `${p.minutes}:${p.temp}:${p.atmosphereFrom ?? ""}`)
    .join("|");
}

/** 雰囲気の短い表示。図の凡例と同じ語を使う。 */
const ATMOS_LABEL = { oxidation: "酸化", neutral: "中性", reduction: "還元" };

/**
 * 焼成の条件を一行に畳んだ要約。
 *
 * 表示名（日付・名前・番号）が重なった焼成を選択肢で見分けるために使う。
 * 見分けの材料になるのは「何を狙って、どう焼いたか」なので、狙い（目標温度）と
 * 実測（最高温度・総焼成時間）と雰囲気の切替を、この順で並べる。
 * 記録されていない項目は書かない（空欄を `—` で埋めると、どれも同じ顔になる）。
 * @param {{ targetTemp?: number | null, points?: CurvePoint[] }} firing
 * @returns {string}
 */
export function firingConditionSummary(firing) {
  const points = firing?.points ?? [];
  const summary = curveSummary(points);
  const rawTarget = firing?.targetTemp;
  const target =
    rawTarget === null || rawTarget === undefined || !Number.isFinite(Number(rawTarget))
      ? null
      : Number(rawTarget);
  const segments = atmosphereSegments(points);
  const atmosphere = segments
    .map((seg, i) =>
      i === 0
        ? ATMOS_LABEL[seg.atmosphere]
        : `${formatDuration(seg.from)}${ATMOS_LABEL[seg.atmosphere]}`,
    )
    .join("→");
  return [
    target !== null ? `目標${target}℃` : "",
    summary.maxTemp !== null ? `最高${summary.maxTemp}℃` : "",
    summary.totalMinutes !== null ? formatDuration(summary.totalMinutes) : "",
    atmosphere,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * スクリーンリーダー向けの説明文。図を見なくても内容が分かる粒度で書く。
 *
 * 目標温度はユーザーが入力した「狙い」で、実測カーブからは導けない。
 * 目標線が引けるかどうかに関わらず言葉では必ず伝える。
 * @param {CurvePoint[]} points
 * @param {number | null} [targetTemp]
 * @returns {string}
 */
export function curveAriaLabel(points, targetTemp = null) {
  const s = curveSummary(points);
  const target = Number.isFinite(Number(targetTemp)) && targetTemp !== null ? Number(targetTemp) : null;
  if (s.pointCount === 0) {
    return target === null
      ? "温度カーブ。記録された点はありません。"
      : `温度カーブ。記録された点はありません。目標 ${target}℃。`;
  }
  const parts = [
    `温度カーブ。記録点 ${s.pointCount} 点`,
    s.maxTemp !== null ? `最高 ${s.maxTemp}℃` : null,
    s.maxAt !== null ? `（${formatDuration(s.maxAt)} 時点）` : null,
    s.totalMinutes !== null ? `総焼成時間 ${formatDuration(s.totalMinutes)}` : null,
    target !== null ? `目標 ${target}℃` : null,
  ].filter(Boolean);
  const segs = atmosphereSegments(points);
  if (segs.length > 0) {
    const desc = segs
      .map((seg) => `${formatDuration(seg.from)}から${ATMOS_LABEL[seg.atmosphere]}`)
      .join("、");
    parts.push(`雰囲気は ${desc}`);
  }
  return `${parts.join("、")}。`;
}
