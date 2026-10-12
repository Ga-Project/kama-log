"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PrintableRecords from "./PrintableRecords";
import { useRecords } from "./useRecords";
import {
  exportFilename,
  firingsToCsv,
  piecesToCsv,
} from "../../lib/serialize.mjs";
import {
  capacityLevel,
  estimateStorage,
  formatBytes,
  requestPersistence,
  subscribeStorageChanged,
  sweepOrphanPhotos,
} from "../../lib/storage.mjs";

export default function ExportView() {
  const { pieces, firings, state } = useRecords();
  const [capacity, setCapacity] = useState<{
    usage: number;
    quota: number;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  // 写真の後始末が失敗していると、どの記録からも辿れない Blob が容量だけを占め続ける。
  // 容量を見に来た画面で必ず引き直して掃除する（消えるのは記録が指していない写真だけ）。
  // 掃除が済むと保存領域の変化として通知され、下の実測が測り直される。
  useEffect(() => {
    void sweepOrphanPhotos().catch(() => {
      // 掃除できなくても記録は正しい。容量の表示だけが実態より多いまま残る。
    });
  }, []);

  // ここは容量を見に来る画面なので、書き込みのたびに測り直す（古い値を見せない）。
  useEffect(() => {
    let alive = true;
    const measure = () => {
      void estimateStorage().then((next) => {
        if (alive) setCapacity(next);
      });
    };
    measure();
    const unsubscribe = subscribeStorageChanged(measure);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  function download(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function today(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function exportPieces() {
    download(exportFilename("pieces", today()), piecesToCsv(pieces, firings));
    setStatus(`テストピース ${pieces.length} 件を CSV に書き出しました。`);
  }

  function exportFirings() {
    download(exportFilename("firings", today()), firingsToCsv(firings));
    setStatus(`焼成 ${firings.length} 件を CSV に書き出しました。`);
  }

  const level = capacity
    ? capacityLevel(capacity.usage, capacity.quota)
    : "hidden";
  const withPhoto = pieces.filter((p) => p.photoId).length;
  const hasRecords = pieces.length > 0 || firings.length > 0;

  return (
    <>
      <div className="lintel no-print">
        <p className="lintel__inner">
          <Link href="/">炉前</Link> / 書き出し
        </p>
      </div>

      <main
        id="main"
        tabIndex={-1}
        className="section"
        style={{ maxWidth: 860 }}
      >
        <h1 className="t-h1 no-print">書き出しと保存領域</h1>
        <p className="no-print" style={{ marginTop: 12 }}>
          記録はこの端末の中にしかありません。端末を変えると移らないので、ときどき書き出して別の場所に保管してください。
        </p>

        {status ? (
          <div
            className="notice no-print"
            role="status"
            style={{ marginTop: 16 }}
          >
            <div className="notice__body">{status}</div>
          </div>
        ) : null}

        <section className="form-block no-print">
          <h2 className="t-h2">CSV に書き出す</h2>
          <div className="row-gap" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={exportPieces}
              disabled={state !== "ready" || pieces.length === 0}
            >
              テストピース{state === "ready" ? `（${pieces.length} 件）` : ""}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={exportFirings}
              disabled={state !== "ready" || firings.length === 0}
            >
              焼成{state === "ready" ? `（${firings.length} 件）` : ""}
            </button>
            {/* 印刷は記録一覧（下の印刷専用ブロック）を出す。
                画面の操作パネルだけを印刷しても、バックアップにならない。 */}
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => window.print()}
              disabled={state !== "ready" || !hasRecords}
            >
              印刷 / PDF（印刷ダイアログが開きます）
            </button>
          </div>
          {state === "ready" && hasRecords ? (
            <p className="field__hint">
              印刷 / PDF には、テストピース {pieces.length} 件と焼成{" "}
              {firings.length} 件の一覧が出ます（写真は入りません）。
            </p>
          ) : null}
          {/* 「読めていない」を「無い」と言わない。
              この画面は記録を救い出しに来る場所なので、読み込みの失敗を件数ゼロと同じ顔で出すと
              「記録が消えた」と誤解させる。状態の判定は 読み込み中 → 失敗 → 件数ゼロ の順。 */}
          {state === "loading" ? (
            <p className="field__hint" role="status">
              記録を読み込んでいます…
            </p>
          ) : state === "unavailable" ? (
            <p className="field__hint" role="alert">
              この端末のブラウザでは記録を読み書きできません。プライベートウィンドウでは制限されることがあります。通常のウィンドウで開き直してください。
            </p>
          ) : state === "error" ? (
            <p className="field__hint" role="alert">
              記録を読み込めませんでした。保存済みの記録が消えたとは限りません。ページを再読み込みしてもこの表示が続く場合、ブラウザのデータが壊れている可能性があります。
            </p>
          ) : pieces.length === 0 && firings.length === 0 ? (
            <p className="field__hint">
              まだ書き出せる記録がありません。
              <Link href="/pieces/new/">記録をはじめる</Link>
            </p>
          ) : (
            <p className="field__hint">
              写真そのものは CSV
              に入りません（「あり／なし」だけが残ります）。写真は端末内にのみ保存されています。
            </p>
          )}
        </section>

        <section className="form-block no-print">
          <h2 className="t-h2">保存領域</h2>

          {capacity ? (
            <>
              <div
                className="capacity"
                style={{ display: "flex", marginTop: 16, width: "100%" }}
              >
                <span
                  className="capacity__bar capacity__bar--full"
                  aria-hidden="true"
                >
                  <span
                    className={`capacity__fill${level === "critical" ? " capacity__fill--critical" : ""}`}
                    style={{
                      width: `${Math.min(100, (capacity.usage / capacity.quota) * 100)}%`,
                    }}
                  />
                </span>
              </div>
              <p className="t-small num" style={{ marginTop: 8 }}>
                使用中 {formatBytes(capacity.usage)} /{" "}
                {formatBytes(capacity.quota)}
              </p>
            </>
          ) : (
            <p className="field__hint">
              この端末では空き容量を取得できません。
            </p>
          )}

          <p className="t-small muted" style={{ marginTop: 8 }}>
            {state === "ready"
              ? `記録 ${pieces.length} 件（うち写真あり ${withPhoto} 件）・焼成 ${firings.length} 件`
              : "件数は記録を読み込めたときに出ます。"}
          </p>

          <div className="row-gap" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() =>
                void requestPersistence().then((ok) => {
                  setPersisted(ok);
                  // 許可されると割当そのものが変わることがあるので、測り直す。
                  void estimateStorage().then(setCapacity);
                })
              }
            >
              保存領域を確保する
            </button>
            {persisted !== null ? (
              <span className="t-small muted" role="status">
                {persisted
                  ? "確保できました。この端末の記録は自動削除されにくくなります。"
                  : "確保できませんでした。ブラウザの設定によっては許可されないことがあります。"}
              </span>
            ) : null}
          </div>
          <p className="field__hint">
            押すとブラウザに保存の許可を求めます。許可すると、空き容量が減ったときにこのアプリの記録が自動で消されにくくなります。
          </p>
        </section>

        <PrintableRecords
          pieces={pieces}
          firings={firings}
          ready={state === "ready"}
        />
      </main>
    </>
  );
}
