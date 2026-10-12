"use client";

import { sortFiringsNewestFirst } from "./useRecords";
import { firingLabel, normalizeShelfCount } from "../../lib/model.mjs";
import { mixOneLine } from "../../lib/compare.mjs";
import { firingKey } from "../../lib/serialize.mjs";
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

const JUDGMENT_LABEL: Record<string, string> = {
  again: "また焼く",
  adjust: "要調整",
  drop: "使わない",
};

/**
 * 印刷 / PDF 用の記録一覧。画面には出さず、印刷のときだけ現れる。
 *
 * 書き出し画面から印刷すると、画面にあるのは操作ボタンと容量の説明だけなので、
 * そのまま印刷すると「設定画面の PDF」が出てしまう。PDF は CSV と並ぶバックアップ手段
 * なので、記録そのものをここで組み立てて印刷対象にする。
 */
export default function PrintableRecords({
  pieces,
  firings,
  ready,
}: {
  pieces: Piece[];
  firings: Firing[];
  ready: boolean;
}) {
  if (!ready) return null;

  const sortedFirings = sortFiringsNewestFirst(firings);
  const byFiring = new Map(sortedFirings.map((f) => [f.id, f]));
  // 焼成に紐付かない記録も落とさない（紐付けは任意なので、落とすとバックアップにならない）。
  const orderedPieces = [...pieces].sort(
    (a, b) =>
      String(byFiring.get(String(b.firingId))?.date ?? "").localeCompare(
        String(byFiring.get(String(a.firingId))?.date ?? ""),
      ) ||
      String(a.code ?? "").localeCompare(String(b.code ?? "")) ||
      String(a.id ?? "").localeCompare(String(b.id ?? "")),
  );

  return (
    <section className="print-only print-sheet" aria-label="印刷用の記録一覧">
      <h2 className="t-h2">記録一覧</h2>
      <p className="t-small">
        テストピース {pieces.length} 件・焼成 {firings.length} 件（
        {new Date().toLocaleDateString("ja-JP")} 時点）。
        写真は含まれません（端末内にのみ保存されています）。
      </p>

      {pieces.length === 0 && firings.length === 0 ? (
        <p className="t-small">まだ記録がありません。</p>
      ) : null}

      {orderedPieces.length > 0 ? (
        <table>
          <caption>テストピース</caption>
          <thead>
            <tr>
              <th scope="col">識別番号</th>
              <th scope="col">調合名</th>
              {/* 数は保存されている部数そのもの。単位をここで示す（% と読み違えると
                  印刷から書き戻したときに元の数字が戻らない）。 */}
              <th scope="col">配合(部)</th>
              <th scope="col">焼成</th>
              {/* 表示名は同日同名の焼成で一致する。下の焼成表と突き合わせる鍵はこの列。 */}
              <th scope="col">焼成ID</th>
              <th scope="col">棚</th>
              <th scope="col">結果</th>
              <th scope="col">判断</th>
              <th scope="col">所見</th>
              <th scope="col">写真</th>
              {/* 記録時刻は並び順を決める値（同じ条件の記録は記録日時で決着する）。
                  印刷も CSV と並ぶバックアップなので、ここでも落とさない。 */}
              <th scope="col">記録日時</th>
              <th scope="col">更新日時</th>
            </tr>
          </thead>
          <tbody>
            {orderedPieces.map((piece) => {
              const firing = piece.firingId
                ? (byFiring.get(piece.firingId) ?? null)
                : null;
              return (
                <tr key={piece.id}>
                  <td>{piece.code || "—"}</td>
                  <td>{piece.recipeName || "—"}</td>
                  <td>{mixOneLine(piece) || "—"}</td>
                  <td>{firing ? firingLabel(firing) : "—"}</td>
                  {/* 焼成の記録が見つからないときも、紐付け先そのものは残す。 */}
                  <td className="id">
                    {firingKey(firing) || piece.firingId || "—"}
                  </td>
                  <td>
                    {piece.shelf === null || piece.shelf === undefined
                      ? "—"
                      : `棚${piece.shelf}`}
                  </td>
                  <td>{(piece.results ?? []).join("・") || "—"}</td>
                  <td>
                    {piece.judgment
                      ? (JUDGMENT_LABEL[piece.judgment] ?? piece.judgment)
                      : "—"}
                  </td>
                  <td>{piece.note || "—"}</td>
                  <td>
                    {piece.photoId
                      ? "あり"
                      : piece.colorMemo
                        ? `色メモ ${piece.colorMemo}`
                        : "なし"}
                  </td>
                  <td className="stamp">{piece.createdAt || "—"}</td>
                  <td className="stamp">{piece.updatedAt || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}

      {sortedFirings.length > 0 ? (
        <table>
          <caption>焼成</caption>
          <thead>
            <tr>
              <th scope="col">焼成</th>
              {/* 上のテストピース表の「焼成ID」と突き合わせる鍵。日付・名前・番号が
                  同じ焼成が2回あっても、どちらに紐付いていたかが分かる。 */}
              <th scope="col">焼成ID</th>
              {/* 目標温度は実測カーブから導けないユーザーの入力。
                  印刷も CSV と並ぶバックアップなので、ここでも落とさない。 */}
              <th scope="col">目標温度</th>
              <th scope="col">最高温度</th>
              <th scope="col">総焼成時間</th>
              <th scope="col">雰囲気</th>
              <th scope="col">棚段数</th>
              <th scope="col">温度カーブ（経過:温度）</th>
              {/* 同じ日付の焼成は記録日時 → 更新日時 で新しい順が決まる。落とすと、
                  印刷から戻したときに「直近の焼成」も比較の並びも入れ替わりうる
                  （残るのは id の並びだけで、id は UUID＝意味を持たない）。 */}
              <th scope="col">記録日時</th>
              <th scope="col">更新日時</th>
            </tr>
          </thead>
          <tbody>
            {sortedFirings.map((firing) => {
              const summary = curveSummary(firing.points ?? []);
              const atmosphere = dominantAtmosphere(firing.points ?? []);
              return (
                <tr key={firing.id}>
                  <td>{firingLabel(firing)}</td>
                  <td className="id">{firingKey(firing) || "—"}</td>
                  <td>
                    {firing.targetTemp === null ||
                    firing.targetTemp === undefined
                      ? "—"
                      : `${firing.targetTemp}℃`}
                  </td>
                  <td>
                    {summary.maxTemp === null ? "—" : `${summary.maxTemp}℃`}
                  </td>
                  <td>
                    {summary.totalMinutes === null
                      ? "—"
                      : formatDuration(summary.totalMinutes)}
                  </td>
                  <td>{atmosphere ? ATMOS_LABEL[atmosphere] : "—"}</td>
                  {/* 断面や棚位置の判定と同じ整数を出す（印刷だけ違う段数を名乗らせない）。 */}
                  <td>{normalizeShelfCount(firing.shelfCount) ?? 3}</td>
                  <td>
                    {(firing.points ?? [])
                      .map(
                        (p) =>
                          `${formatDuration(p.minutes)}:${p.temp}${
                            p.atmosphereFrom
                              ? `>${ATMOS_LABEL[p.atmosphereFrom]}`
                              : ""
                          }`,
                      )
                      .join(" ") || "—"}
                  </td>
                  <td className="stamp">{firing.createdAt || "—"}</td>
                  <td className="stamp">{firing.updatedAt || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
