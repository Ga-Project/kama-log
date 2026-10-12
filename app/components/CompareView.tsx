"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import MixBar from "./MixBar";
import PhotoImage from "./PhotoImage";
import Spark from "./Spark";
import { useRecords } from "./useRecords";
import {
  buildCompareColumns,
  buildCompareRows,
  buildCurveCells,
  groupByRecipe,
  mixOneLine,
} from "../../lib/compare.mjs";
import { firingLabel, uniqueOptionLabels } from "../../lib/model.mjs";
import type { CompareColumn } from "../../lib/compare.mjs";

type Sort = "date" | "maxTemp" | "atmosphere";

export default function CompareView() {
  const { pieces, firings, state } = useRecords();
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("date");
  const [swatchOnly, setSwatchOnly] = useState(false);

  const groups = useMemo(() => groupByRecipe(pieces), [pieces]);
  // 調合名は入力であって鍵ではない（空でも、同じ名前で中身が違っても構わない）。
  // 選択欄が調合名しか出さないと、配合の違うグループが同じ1行に見え、どちらを見ているのか
  // 分からないまま比較の中身が入れ替わる。重なった名前にだけ配合そのものを添える。
  const groupOptions = useMemo(
    () =>
      uniqueOptionLabels(
        groups,
        (g) => `${g.recipeName || "調合名なし"}（${g.pieces.length} 件）`,
        (g) => mixOneLine(g.pieces[0]),
      ),
    [groups],
  );
  const active = useMemo(
    () => groups.find((g) => g.signature === selected) ?? groups[0] ?? null,
    [groups, selected],
  );

  const columns = useMemo(
    () => (active ? buildCompareColumns(active.pieces, firings, { sort }) : []),
    [active, firings, sort],
  );
  const rows = useMemo(() => buildCompareRows(columns), [columns]);
  // 温度カーブの行は図を描くので rows とは別に組み立てるが、差分の印の付け方は同じ。
  const curveCells = useMemo(() => buildCurveCells(columns), [columns]);

  if (state === "loading") {
    return (
      <main id="main" tabIndex={-1} className="section" aria-busy="true">
        <h1 className="t-h1">同じ調合を並べて比べる</h1>
        <p className="muted t-small" style={{ marginTop: 16 }}>
          読み込んでいます…
        </p>
      </main>
    );
  }

  if (state === "unavailable" || state === "error") {
    return (
      <main id="main" tabIndex={-1} className="section">
        <div className="notice notice--alert" role="alert">
          <div className="notice__body">
            {state === "unavailable"
              ? "この端末のブラウザでは記録を保存できません。通常のウィンドウで開き直してください。"
              : "記録を読み込めませんでした。"}
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="lintel">
        <p className="lintel__inner">
          <Link href="/">炉前</Link> / 比較
        </p>
      </div>

      <main id="main" tabIndex={-1} className="section">
        <h1 className="t-h1">同じ調合を並べて比べる</h1>

        {groups.length === 0 ? (
          <div className="baseline" style={{ marginTop: 24 }}>
            <p className="baseline__empty">
              まだテストピースの記録がありません。{" "}
              <Link href="/pieces/new/">最初のテストピースを記録する</Link>
            </p>
          </div>
        ) : (
          <>
            <div className="row-gap" style={{ marginTop: 24 }}>
              <div style={{ flex: "1 1 320px" }}>
                <label className="field__label" htmlFor="recipe-select">
                  調合を選ぶ
                </label>
                <select
                  id="recipe-select"
                  className="select"
                  value={active?.signature ?? ""}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {groups.map((g, i) => (
                    <option value={g.signature} key={g.signature}>
                      {groupOptions[i] ??
                        `${g.recipeName || "調合名なし"}（${g.pieces.length} 件）`}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ flex: "0 1 200px" }}>
                <label className="field__label" htmlFor="sort-select">
                  並び
                </label>
                <select
                  id="sort-select"
                  className="select"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                >
                  <option value="date">焼成日 古い→新しい</option>
                  <option value="maxTemp">最高温度 低い→高い</option>
                  <option value="atmosphere">雰囲気</option>
                </select>
              </div>

              <button
                type="button"
                className="btn btn--secondary btn--small no-print"
                aria-pressed={swatchOnly}
                onClick={() => setSwatchOnly((v) => !v)}
                style={{ marginTop: 20 }}
              >
                {swatchOnly ? "表に戻す" : "色片だけを並べる"}
              </button>
            </div>

            {/* 配合を比較の真上に固定表示 → 「この配合を、この条件で焼いたらこうなった」の主語が常に見える */}
            {active && active.pieces[0] ? (
              <div style={{ marginTop: 20 }}>
                <MixBar mix={active.pieces[0].mix ?? []} />
              </div>
            ) : null}

            {swatchOnly ? (
              <SwatchStrip columns={columns} />
            ) : (
              <>
                <div
                  className="compare"
                  style={{ marginTop: 20 }}
                  tabIndex={0}
                  role="group"
                  aria-label="比較レール（横スクロール）"
                >
                  <table>
                    <caption className="visually-hidden">
                      {active?.recipeName || "調合名なし"} の焼成別の比較。
                      前の列と値が変わったセルには「前回と異なる」印が付きます。
                    </caption>
                    <thead>
                      <tr>
                        <th scope="row" className="compare__axis">
                          識別番号
                        </th>
                        {columns.map((c) => (
                          <th
                            scope="col"
                            className="compare__col"
                            key={c.piece.id}
                          >
                            <Link
                              href={`/pieces/new/?id=${encodeURIComponent(c.piece.id)}`}
                            >
                              {c.piece.code}
                            </Link>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* 発色は「条件を変えた結果」であって条件ではないので、差分の印は
                          付けない（写真は撮るたびに違う＝全ての列に印が付いてしまい、
                          条件の行に付いた印が埋もれる）。 */}
                      <tr>
                        <th scope="row" className="compare__axis">
                          発色
                        </th>
                        {columns.map((c) => (
                          <td className="compare__swatch-cell" key={c.piece.id}>
                            <SwatchCell column={c} size="md" />
                          </td>
                        ))}
                      </tr>

                      {/* 温度カーブは値ではなく形で比べる行。数値行と並べて置く。
                          図は列ごとに独立して伸縮するので、形の違いは目では拾いにくい。
                          他の条件行と同じ差分の印を付ける（付けないと、最高温度と
                          総焼成時間が同じで途中の昇温だけが違う焼成が同じ条件に見える）。 */}
                      <tr>
                        <th scope="row" className="compare__axis">
                          温度カーブ
                        </th>
                        {columns.map((c, i) => {
                          const cell = curveCells[i];
                          return (
                            <td
                              key={c.piece.id}
                              data-changed={cell?.changed ? "true" : undefined}
                              aria-label={
                                cell?.changed
                                  ? `${cell.text}（前回と異なる）`
                                  : undefined
                              }
                            >
                              {c.firing &&
                              (c.firing.points ?? []).length > 0 ? (
                                <Spark
                                  points={c.firing.points}
                                  width={132}
                                  height={44}
                                />
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        })}
                      </tr>

                      {rows.map((row) => (
                        <tr key={row.key}>
                          <th scope="row" className="compare__axis">
                            {row.label}
                          </th>
                          {row.cells.map((cell, i) => (
                            <td
                              key={`${row.key}-${i}`}
                              data-changed={cell.changed ? "true" : undefined}
                              className={
                                row.key === "note" ? "compare__note" : undefined
                              }
                              aria-label={
                                cell.changed
                                  ? `${cell.text}（前回と異なる）`
                                  : undefined
                              }
                            >
                              {cell.text}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {columns.length === 1 ? (
                  <p className="muted t-small" style={{ marginTop: 12 }}>
                    この調合の記録は1件です。同じ調合をもう一度焼くと、ここに並べて比べられます。
                  </p>
                ) : null}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}

function SwatchStrip({ columns }: { columns: CompareColumn[] }) {
  return (
    <div
      className="swatch-strip"
      style={{ marginTop: 20 }}
      tabIndex={0}
      role="group"
      aria-label="色片の一覧（横スクロール）"
    >
      {columns.map((c) => (
        <div className="swatch-strip__item" key={c.piece.id}>
          <SwatchCell column={c} size="lg" />
          <p className="swatch-strip__code">{c.piece.code}</p>
        </div>
      ))}
    </div>
  );
}

function SwatchCell({
  column,
  size,
}: {
  column: CompareColumn;
  size: "md" | "lg";
}) {
  const cls = size === "lg" ? "swatch swatch--lg" : "swatch swatch--md";
  const piece = column.piece;

  if (piece.photoId) {
    return (
      <>
        <PhotoImage
          className={cls}
          photoId={piece.photoId}
          alt={`テストピース ${piece.code} の発色`}
        />
        <span className="visually-hidden">
          {column.firing
            ? `${firingLabel(column.firing)} の焼成`
            : "焼成の紐付けなし"}
        </span>
      </>
    );
  }

  if (piece.colorMemo) {
    return (
      <span
        className={cls}
        style={{ background: piece.colorMemo }}
        role="img"
        aria-label={`テストピース ${piece.code} の色メモ ${piece.colorMemo}`}
      />
    );
  }

  // 写真なしでも列を詰めたり除外したりしない（記録として同格）。
  return (
    <span
      className={`${cls} swatch--none`}
      role="img"
      aria-label={`テストピース ${piece.code} は写真なし`}
    >
      写真なし
    </span>
  );
}
