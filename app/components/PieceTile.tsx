"use client";

import Link from "next/link";
import PhotoImage from "./PhotoImage";
import type { Piece } from "../../lib/model.mjs";

type Props = { piece: Piece };

/**
 * 棚に載ったテストピース。
 * 写真なしは欠落物ではなく正規の記録として扱うので、枠線・寸法は写真ありと完全に同一。
 */
export default function PieceTile({ piece }: Props) {
  const hasPhoto = Boolean(piece.photoId);
  const hasMemo = !hasPhoto && Boolean(piece.colorMemo);

  const faceClass = hasPhoto
    ? "tile__face"
    : hasMemo
      ? "tile__face tile__face--memo"
      : "tile__face tile__face--none";

  return (
    <Link
      className="tile"
      href={`/pieces/new/?id=${encodeURIComponent(piece.id)}`}
    >
      <span
        className={faceClass}
        style={
          hasMemo && piece.colorMemo
            ? { background: piece.colorMemo }
            : undefined
        }
      >
        {hasPhoto ? (
          <PhotoImage
            photoId={piece.photoId}
            alt={`テストピース ${piece.code} の発色`}
          />
        ) : hasMemo ? (
          <span className="tile__memo-mark">色メモ</span>
        ) : (
          <>
            <span className="tile__face-code">{piece.code}</span>
            <span className="tile__face-note">写真なし</span>
          </>
        )}
      </span>

      <span className="tile__info">
        <span className="tile__code">{piece.code}</span>
        <span className="tile__recipe">{piece.recipeName || "調合名なし"}</span>
        {piece.results && piece.results.length > 0 ? (
          <span className="tile__marks" aria-hidden="true">
            {piece.results.slice(0, 3).map((r) => (
              <span className="tile__mark" key={r} />
            ))}
          </span>
        ) : null}
        {piece.results && piece.results.length > 0 ? (
          <span className="visually-hidden">
            結果 {piece.results.join("、")}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
