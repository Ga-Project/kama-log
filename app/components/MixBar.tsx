"use client";

import { mixPercentages } from "../../lib/model.mjs";
import { formatPercent } from "../../lib/compare.mjs";
import type { MixRow } from "../../lib/model.mjs";

const GREYS = [
  "var(--k-mix-5)",
  "var(--k-mix-4)",
  "var(--k-mix-3)",
  "var(--k-mix-2)",
  "var(--k-mix-1)",
];

type Props = {
  mix: MixRow[];
  slim?: boolean;
  /** 凡例は既定で出す。バーが読めなくても情報が失われないようにするため。 */
  legend?: boolean;
};

/**
 * 配合バー。着色材はベタ塗りにせずハッチで示す（少量でも視認できるように min-width 6px）。
 * 色だけに意味を持たせないよう、凡例テキストを常に併記する。
 */
export default function MixBar({ mix, slim = false, legend = true }: Props) {
  const rows = mixPercentages(mix);
  if (rows.length === 0) return null;

  // 非着色材は割合の大きい順にグレー5段を割り当てる。
  const nonColorantOrder = rows
    .filter((r) => !r.colorant)
    .slice()
    .sort((a, b) => b.percent - a.percent)
    .map((r) => r.material);

  const aria = `配合 ${rows.map((r) => `${r.material}${formatPercent(r.percent)}%`).join(" ")}`;

  return (
    <div>
      <div
        className={`mix-bar${slim ? " mix-bar--slim" : ""}`}
        role="img"
        aria-label={aria}
      >
        {rows.map((row, i) => {
          const greyIndex = nonColorantOrder.indexOf(row.material);
          const background = row.colorant
            ? undefined
            : (GREYS[
                Math.min(greyIndex < 0 ? 0 : greyIndex, GREYS.length - 1)
              ] ?? GREYS[0]);
          return (
            <span
              key={`${row.material}-${i}`}
              className={`mix-bar__seg${row.colorant ? " mix-bar__seg--colorant" : ""}`}
              style={{ width: `${row.percent}%`, background }}
              // バー内の文字は幅が足りるときだけ見える。読めなくても凡例が担保する。
              title={`${row.material} ${formatPercent(row.percent)}%`}
            >
              {/* 単位を落とすと、部数（保存されている数）と読み違える。
                  バー内は正規化した % なので必ず % を付ける。 */}
              {!slim && row.percent >= 12
                ? `${row.material}${formatPercent(row.percent)}%`
                : ""}
            </span>
          );
        })}
      </div>

      {legend ? (
        <div className="mix-legend">
          {rows.map((row, i) => {
            const greyIndex = nonColorantOrder.indexOf(row.material);
            const background = row.colorant
              ? undefined
              : (GREYS[
                  Math.min(greyIndex < 0 ? 0 : greyIndex, GREYS.length - 1)
                ] ?? GREYS[0]);
            return (
              <span
                className="mix-legend__item"
                key={`legend-${row.material}-${i}`}
              >
                <span
                  className={`mix-legend__chip${row.colorant ? " mix-bar__seg--colorant" : ""}`}
                  style={{ background }}
                  aria-hidden="true"
                />
                {row.material} {formatPercent(row.percent)}%
                {row.colorant ? "（着色材）" : ""}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
