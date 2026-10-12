"use client";

import { useId, useState } from "react";
import {
  atmosphereSegments,
  curveAriaLabel,
  curvePolyline,
  curveSummary,
  formatDuration,
} from "../../lib/curve.mjs";
import type { CurvePoint } from "../../lib/model.mjs";

const ATMOS_LABEL: Record<string, string> = {
  oxidation: "酸化",
  neutral: "中性",
  reduction: "還元",
};

type Props = {
  points: CurvePoint[];
  width: number;
  height: number;
  /** 基線サイズでは最高温ラベルと目盛りを出す。 */
  detailed?: boolean;
  targetTemp?: number | null;
};

/**
 * 温度カーブ。ライブラリを使わず polyline を1本引くだけ。
 * 描画アニメーションは持たない（reduced-motion と $0/perf の両立）。
 */
export default function Spark({
  points,
  width,
  height,
  detailed = false,
  targetTemp = null,
}: Props) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const poly = curvePolyline(points, {
    width,
    height,
    padX: 4,
    padY: detailed ? 20 : 4,
  });
  const summary = curveSummary(points);
  const segments = atmosphereSegments(points);

  // 目標温度は実測カーブから導けないユーザーの入力なので、線が引けるかどうかとは
  // 別に、値そのものを必ず持ち回る（描けないときに黙って消さないため）。
  const target =
    targetTemp !== null &&
    targetTemp !== undefined &&
    Number.isFinite(Number(targetTemp))
      ? Number(targetTemp)
      : null;

  if (!poly) {
    return (
      <p className="muted t-small">
        温度の点がまだありません。{target !== null ? `目標 ${target}℃。` : ""}
      </p>
    );
  }

  const maxCoord = poly.coords.reduce(
    (best, c) => (best === null || c.temp > best.temp ? c : best),
    null as (typeof poly.coords)[number] | null,
  );

  // 目標温度線の y 座標。スケール外なら引かない（枠外に線が出るのを避ける）。
  // 引けなかったことは下の凡例で言葉にする（線が消えるだけだと、記録が無いのと区別が付かない）。
  const targetInScale =
    target !== null &&
    target >= poly.scale.minTemp &&
    target <= poly.scale.maxTemp;
  const targetY =
    target !== null && targetInScale
      ? (() => {
          const padY = detailed ? 20 : 4;
          const innerH = height - padY * 2;
          const ratio =
            (target - poly.scale.minTemp) /
            (poly.scale.maxTemp - poly.scale.minTemp);
          return padY + (1 - ratio) * innerH;
        })()
      : null;

  // 雰囲気帯はカーブの真下に敷くので、時間軸をカーブと同じ 0:00 起点で取る。
  // 最初の点までの空白を詰めると、帯と上のカーブで同じ時刻が別の位置に来る。
  const totalSpan =
    segments.length > 0 ? (segments[segments.length - 1]?.to ?? 0) : 0;
  const leadSpan = segments.length > 0 ? (segments[0]?.from ?? 0) : 0;
  const leadRatio = totalSpan > 0 ? Math.max(0, leadSpan) / totalSpan : 0;

  return (
    <div>
      <svg
        className="spark"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={curveAriaLabel(points, target)}
      >
        {targetY !== null ? (
          <line
            className="spark__target"
            x1={0}
            y1={targetY}
            x2={width}
            y2={targetY}
          />
        ) : null}
        <line
          className="spark__axis"
          x1={0}
          y1={height - 0.5}
          x2={width}
          y2={height - 0.5}
        />
        <polyline className="spark__line" points={poly.points} />
        {poly.coords.map((c, i) => {
          const isMax =
            maxCoord !== null &&
            c.minutes === maxCoord.minutes &&
            c.temp === maxCoord.temp;
          const size = isMax ? 4 : 3;
          return (
            <rect
              key={`${c.minutes}-${c.temp}-${i}`}
              className={
                isMax ? "spark__point spark__point--max" : "spark__point"
              }
              x={c.x - size / 2}
              y={c.y - size / 2}
              width={size}
              height={size}
            />
          );
        })}
        {detailed && maxCoord ? (
          // 端に寄った点では middle 揃えだとラベルが枠外に切れるので、寄せ方を切り替える。
          <text
            x={maxCoord.x}
            y={Math.max(12, maxCoord.y - 8)}
            textAnchor={
              maxCoord.x > width - 48
                ? "end"
                : maxCoord.x < 48
                  ? "start"
                  : "middle"
            }
            fontSize="12"
            fontWeight="700"
            fill="currentColor"
          >
            {maxCoord.temp}℃
          </text>
        ) : null}
      </svg>

      {/* 雰囲気帯。色相差ではなく点/線/ハッチで区別する。
          全ての点が同じ時刻なら帯は長さを表せないので敷かない（切替は下の凡例と
          数値の表に残る）。 */}
      {segments.length > 0 && totalSpan > 0 ? (
        <div
          className="atmos-band"
          style={{ width }}
          role="img"
          aria-label={atmosAria(segments)}
        >
          {/* 最初の記録までの、雰囲気が分からない時間。塗らずに空けておく。 */}
          {leadRatio > 0 ? (
            <span
              className="atmos-band__seg"
              style={{ width: `${leadRatio * 100}%` }}
            />
          ) : null}
          {segments.map((seg, i) => (
            <span
              key={`${seg.from}-${i}`}
              className={`atmos-band__seg atmos-band__seg--${seg.atmosphere}`}
              style={{ width: `${((seg.to - seg.from) / totalSpan) * 100}%` }}
            />
          ))}
        </div>
      ) : null}

      {detailed ? (
        <>
          <div className="row-gap" style={{ marginTop: 12 }}>
            <span className="t-small muted">
              0:00 —{" "}
              {summary.totalMinutes === null
                ? "—"
                : formatDuration(summary.totalMinutes)}
            </span>
            {/* 目標温度は図から読み取れない（範囲外だと線すら引けない）ので、必ず数字で出す。 */}
            {target !== null ? (
              <span className="t-small muted">
                目標 {target}℃{targetInScale ? "" : "（カーブの範囲の外）"}
              </span>
            ) : null}
            {segments.map((seg, i) => (
              <span key={`legend-${i}`} className="t-small muted">
                {formatDuration(seg.from)} から {ATMOS_LABEL[seg.atmosphere]}
              </span>
            ))}
            <span className="list__spacer" />
            <button
              type="button"
              className="btn btn--quiet btn--small no-print"
              aria-expanded={showTable}
              aria-controls={tableId}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? "数値を閉じる" : "数値で見る"}
            </button>
          </div>

          {/* 図が読めなくても情報が失われないよう、実テーブルで同じ内容を出す。 */}
          <div id={tableId} hidden={!showTable}>
            <table
              className="list"
              style={{
                marginTop: 12,
                width: "100%",
                borderCollapse: "collapse",
              }}
            >
              <caption className="visually-hidden">温度カーブの記録点</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="t-label"
                    style={{ textAlign: "left", padding: "8px 16px" }}
                  >
                    経過
                  </th>
                  <th
                    scope="col"
                    className="t-label"
                    style={{ textAlign: "left", padding: "8px 16px" }}
                  >
                    温度
                  </th>
                  <th
                    scope="col"
                    className="t-label"
                    style={{ textAlign: "left", padding: "8px 16px" }}
                  >
                    雰囲気
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* 雰囲気は座標が持っている元の点のものを使う。経過分と温度で引き直すと、
                    同じ時刻・同じ温度で雰囲気だけが違う点が取り違えられる。 */}
                {poly.coords.map((c, i) => (
                  <tr key={`row-${c.minutes}-${i}`}>
                    <td className="num" style={{ padding: "8px 16px" }}>
                      {formatDuration(c.minutes)}
                    </td>
                    <td className="num" style={{ padding: "8px 16px" }}>
                      {c.temp}℃
                    </td>
                    <td style={{ padding: "8px 16px" }}>
                      {c.atmosphereFrom
                        ? `${ATMOS_LABEL[c.atmosphereFrom]} に切替`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function atmosAria(
  segments: { from: number; to: number; atmosphere: string }[],
): string {
  return `雰囲気の区間。${segments
    .map((s) =>
      // 最後の点で切り替えた記録は長さが 0 になる。「8:00から8:00は還元」とは読ませない。
      s.to > s.from
        ? `${formatDuration(s.from)}から${formatDuration(s.to)}は${ATMOS_LABEL[s.atmosphere]}`
        : `${formatDuration(s.from)}から${ATMOS_LABEL[s.atmosphere]}に切替（この先の記録はまだありません）`,
    )
    .join("、")}。`;
}
