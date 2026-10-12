"use client";

import Link from "next/link";
import { useMemo } from "react";
import PieceTile from "./PieceTile";
import Spark from "./Spark";
import BaselineSpark from "./BaselineSpark";
import OffShelfPieces, { UnlinkedPieces } from "./OffShelfPieces";
import { sortFiringsNewestFirst, useRecords } from "./useRecords";
import {
  firingLabel,
  shelfSubLabel,
  shelvesTopDown,
} from "../../lib/model.mjs";
import {
  curveSummary,
  dominantAtmosphere,
  formatDuration,
} from "../../lib/curve.mjs";
import type { Firing, Piece } from "../../lib/model.mjs";

const ATMOS_LABEL: Record<string, string> = {
  oxidation: "酸化",
  neutral: "中性",
  reduction: "還元",
};

/**
 * 炉前（トップ）の断面。直近の焼成を「窯の中」として描く。
 * 棚は上段が上（棚3→棚2→棚1）。DB の昇順でそのまま描くと逆さになるので必ず降順にする。
 */
export default function KilnHome() {
  const { pieces, firings, state } = useRecords();

  const latest = useMemo(() => {
    const sorted = sortFiringsNewestFirst(firings);
    return sorted[0] ?? null;
  }, [firings]);

  const shownPieces = useMemo(
    () => (latest ? pieces.filter((p) => p.firingId === latest.id) : []),
    [pieces, latest],
  );

  // 断面は直近の焼成の記録しか描かない。焼成を選ばずに保存した記録（正当な使い方）と、
  // 紐付け先の焼成が見当たらない記録は、ここで受けないと炉前から消える。
  // 棚位置だけが入っていても、その棚は「別の窯の棚」なので断面には載せない。
  const unlinkedPieces = useMemo(() => {
    const firingIds = new Set(firings.map((f) => f.id));
    return pieces.filter((p) => !p.firingId || !firingIds.has(p.firingId));
  }, [pieces, firings]);

  if (state === "loading") {
    return (
      <section className="section" aria-busy="true">
        {/* 骨格を先に出して、読み込み完了時にレイアウトが跳ねないようにする。 */}
        <div className="section__head">
          <div>
            <p className="t-label">窯の中</p>
            <h2 className="t-h2 muted">記録を読み込んでいます…</h2>
          </div>
        </div>
        <div className="kiln">
          {[3, 2, 1].map((shelf) => (
            <div className="shelf" key={shelf}>
              <div className="shelf__head">
                <span className="shelf__no">棚 {shelf}</span>
                <span className="shelf__sub">{shelfSubLabel(shelf, 3)}</span>
              </div>
              <div className="shelf__body">
                {[0, 1, 2].map((i) => (
                  <span className="tile tile--loading" key={i}>
                    <span className="tile__face" />
                    <span className="tile__info" />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="hearth" />
      </section>
    );
  }

  if (state === "unavailable") {
    return (
      <section className="section">
        <div className="notice notice--alert" role="alert">
          <div className="notice__body">
            <strong>この端末のブラウザでは記録を保存できません。</strong>
            <p className="t-small" style={{ marginTop: 4 }}>
              プライベートウィンドウでは保存が制限されることがあります。通常のウィンドウで開き直してください。
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="section">
        <div className="notice notice--alert" role="alert">
          <div className="notice__body">
            <strong>記録を読み込めませんでした。</strong>
            <p className="t-small" style={{ marginTop: 4 }}>
              ページを再読み込みしてもこの表示が続く場合、ブラウザのデータが壊れている可能性があります。
            </p>
          </div>
        </div>
      </section>
    );
  }

  const isEmpty = pieces.length === 0 && firings.length === 0;

  return (
    <section className="section" aria-label="窯の断面 — 棚ごとのテストピース">
      <div className="section__head">
        <div>
          <p className="t-label">{latest ? "直近の焼成" : "窯の中"}</p>
          <h2 className="t-h2">
            {latest ? firingLabel(latest) : "まだ焼成の記録がありません"}
          </h2>
        </div>
        <div className="row-gap">
          {firings.length > 0 ? (
            <Link className="btn btn--secondary btn--small" href="/firings/">
              すべての焼成
            </Link>
          ) : null}
          <Link className="btn btn--secondary btn--small" href="/pieces/new/">
            ＋ テストピース
          </Link>
        </div>
      </div>

      <KilnStack firing={latest} pieces={shownPieces} />
      <div className="hearth" />
      {/* 断面（1..段数）に描けない記録の受け皿。炉床の下に置く。 */}
      <OffShelfPieces
        pieces={shownPieces}
        shelfCount={latest?.shelfCount ?? 3}
      />
      {/* どの焼成にも紐付いていない記録。焼成が1件も無いときはこれが唯一の受け皿になる。 */}
      <UnlinkedPieces pieces={unlinkedPieces} />

      <Baseline firing={latest} />

      {isEmpty ? <Pillars /> : null}
    </section>
  );
}

function KilnStack({
  firing,
  pieces,
}: {
  firing: Firing | null;
  pieces: Piece[];
}) {
  // 焼成が無いときも空の窯を「実物として」見せる。テキストで済ませない。
  const shelfCount = firing?.shelfCount ?? 3;
  const shelves = shelvesTopDown(shelfCount);

  return (
    <>
      <div className="kiln">
        {shelves.map((shelf) => {
          const onShelf = pieces.filter((p) => p.shelf === shelf);
          const headingId = `shelf-${shelf}-heading`;
          return (
            <section className="shelf" key={shelf} aria-labelledby={headingId}>
              <div className="shelf__head">
                <h3 className="shelf__no" id={headingId}>
                  棚 {shelf}
                </h3>
                <span className="shelf__sub">
                  {shelfSubLabel(shelf, shelfCount)}
                </span>
                <span className="shelf__count">
                  {onShelf.length > 0 ? `${onShelf.length} 件` : "まだ空です"}
                </span>
                <span className="shelf__spacer" />
                <Link
                  className="btn btn--secondary btn--small"
                  // 焼成がまだ1件も無いときは棚位置を渡さない。棚位置は焼成の中の位置
                  // なので、焼成なしで受け取ると、どの窯の断面にも描かれない棚位置が
                  // 記録と書き出しにだけ残る（この断面は「空の窯」の見本にすぎない）。
                  href={
                    firing
                      ? `/pieces/new/?firingId=${encodeURIComponent(firing.id)}&shelf=${shelf}`
                      : "/pieces/new/"
                  }
                >
                  ＋ ここに置く
                </Link>
              </div>

              {onShelf.length > 0 ? (
                <div
                  className="shelf__body"
                  tabIndex={0}
                  role="group"
                  aria-label={`棚 ${shelf} のテストピース ${onShelf.length} 件`}
                >
                  {onShelf.map((piece) => (
                    <PieceTile piece={piece} key={piece.id} />
                  ))}
                </div>
              ) : (
                <div className="shelf__body" aria-hidden="true">
                  {/* 破線のゴーストが「ここに置ける」ことを形で伝える */}
                  <span className="tile--ghost" />
                  <span className="tile--ghost" />
                  <span className="tile--ghost" />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function Baseline({ firing }: { firing: Firing | null }) {
  const points = firing?.points ?? [];
  const summary = curveSummary(points);
  const atmosphere = dominantAtmosphere(points);

  return (
    <div className="baseline">
      <div className="baseline__head">
        <span className="t-label">基線 — 温度カーブ</span>
        {summary.maxTemp !== null ? (
          <>
            <span className="t-num-m">最高 {summary.maxTemp}℃</span>
            <span className="t-num-m">
              総{" "}
              {summary.totalMinutes === null
                ? "—"
                : formatDuration(summary.totalMinutes)}
            </span>
            {atmosphere ? (
              <span className="t-num-m">{ATMOS_LABEL[atmosphere]}</span>
            ) : null}
          </>
        ) : null}
        <span className="list__spacer" />
        {firing ? (
          <Link
            className="btn btn--quiet btn--small"
            href={`/firings/?id=${encodeURIComponent(firing.id)}`}
          >
            この焼成を開く
          </Link>
        ) : null}
      </div>

      {points.length > 0 ? (
        <div className="baseline__body">
          <BaselineSpark
            points={points}
            targetTemp={firing?.targetTemp ?? null}
          />
        </div>
      ) : (
        <p className="baseline__empty">
          焼成を1件記録すると、ここに温度カーブが出ます。
          {/* 目標温度はカーブが無くても保存されている入力。画面から消さない。 */}
          {firing &&
          firing.targetTemp !== null &&
          firing.targetTemp !== undefined
            ? ` 目標 ${firing.targetTemp}℃ を記録しています。`
            : ""}
          {firing ? (
            <>
              {" "}
              <Link href={`/firings/?id=${encodeURIComponent(firing.id)}`}>
                この焼成に温度の点を足す
              </Link>
            </>
          ) : (
            <>
              {" "}
              <Link href="/firings/">焼成を記録する</Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Pillars() {
  return (
    <div className="pillars">
      <div className="pillars__cell">
        <p className="pillars__title">配合と所見</p>
        <p className="pillars__body">
          写真がなくても残せます。必須は識別番号と所見だけ。うまくいかなかった焼きも同じ形で記録します。
        </p>
      </div>
      <div className="pillars__cell">
        <p className="pillars__title">温度と雰囲気</p>
        <p className="pillars__body">
          手で打った点がそのままカーブになります。酸化・還元の切り替わりと棚位置も一緒に残せます。
        </p>
      </div>
      <div className="pillars__cell">
        <p className="pillars__title">並べて比べる</p>
        <p className="pillars__body">
          同じ調合の結果を横一列に並べ、前回と変わった条件に印を付けます。何が効いたのかが見えます。
        </p>
      </div>
    </div>
  );
}
