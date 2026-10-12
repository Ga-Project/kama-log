"use client";

import PieceTile from "./PieceTile";
import { piecesOffShelf } from "../../lib/model.mjs";
import type { Piece } from "../../lib/model.mjs";

/**
 * 窯の断面の外に置かれる記録の帯。
 * 窯の構造材（支柱・炉床）の外にある帯として描く。棚板の見た目は使わない。
 */
function PieceStrip({
  headingId,
  heading,
  note,
  groupLabel,
  pieces,
}: {
  headingId: string;
  heading: string;
  note: string;
  groupLabel: string;
  pieces: Piece[];
}) {
  return (
    <section className="baseline" aria-labelledby={headingId}>
      <div className="baseline__head">
        <span className="t-label" id={headingId}>
          {heading}
        </span>
        <span className="t-num-m">{pieces.length} 件</span>
        <span className="list__spacer" />
        <span className="t-small muted">{note}</span>
      </div>
      <div
        className="shelf__body"
        style={{ paddingTop: 16 }}
        tabIndex={0}
        role="group"
        aria-label={`${groupLabel} ${pieces.length} 件`}
      >
        {pieces.map((piece) => (
          <PieceTile piece={piece} key={piece.id} />
        ))}
      </div>
    </section>
  );
}

/**
 * 窯の断面に描かれないテストピース。
 *
 * 断面は 1..段数 の棚しか描かないので、「棚を指定しない」で保存したものと、
 * 焼成の段数が後から減って範囲外になったものは、どの棚にも出ない。
 * 記録が画面から消えたように見えるのを避けるため、炉床の下に必ず並べる。
 */
export default function OffShelfPieces({
  pieces,
  shelfCount,
}: {
  pieces: Piece[];
  shelfCount: number;
}) {
  const offShelf = piecesOffShelf(pieces, shelfCount);
  if (offShelf.length === 0) return null;

  return (
    <PieceStrip
      headingId="off-shelf-heading"
      heading="棚の外 — 断面に置かれていない記録"
      note="棚位置なし・この窯に無い段"
      groupLabel="棚に置かれていないテストピース"
      pieces={offShelf}
    />
  );
}

/**
 * どの焼成にも紐付いていないテストピース。
 *
 * 焼成の選択は任意なので「焼成を選ばずに保存する」は正当な使い方だが、炉前の断面は
 * 直近の焼成に紐付いた記録しか描かない。ここで受けないと、焼成が1件も無いうちは
 * 保存したすべての記録が炉前から消え、保存直後の「窯を見る」が記録を失ったように見える。
 */
export function UnlinkedPieces({ pieces }: { pieces: Piece[] }) {
  if (pieces.length === 0) return null;

  return (
    <PieceStrip
      headingId="unlinked-heading"
      heading="窯の外 — どの焼成にも紐付いていない記録"
      note="焼成を選ばずに保存したもの"
      groupLabel="焼成に紐付いていないテストピース"
      pieces={pieces}
    />
  );
}
