"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import PieceTile from "./PieceTile";
import Spark from "./Spark";
import BaselineSpark from "./BaselineSpark";
import OffShelfPieces from "./OffShelfPieces";
import { sortFiringsNewestFirst, useRecords } from "./useRecords";
import {
  ATMOSPHERES,
  MAX_SHELF_COUNT,
  MIN_SHELF_COUNT,
  firingLabel,
  normalizeShelfCount,
  shelfSubLabel,
  shelvesTopDown,
} from "../../lib/model.mjs";
import {
  curveSummary,
  dominantAtmosphere,
  formatDuration,
  parseDuration,
  sortPoints,
} from "../../lib/curve.mjs";
import {
  CONFLICT_MISSING,
  STORE_FIRINGS,
  commitRecord,
  conflictOf,
  deleteFiringWithUnlink,
  newId,
} from "../../lib/storage.mjs";
import type { Atmosphere, CurvePoint, Firing } from "../../lib/model.mjs";

const ATMOS_LABEL: Record<string, string> = {
  oxidation: "酸化",
  neutral: "中性",
  reduction: "還元",
};

export default function FiringsView() {
  const params = useSearchParams();
  const id = params.get("id");
  const { pieces, firings, state, reload } = useRecords();

  const sorted = useMemo(() => sortFiringsNewestFirst(firings), [firings]);
  const selected = useMemo(
    () => firings.find((f) => f.id === id) ?? null,
    [firings, id],
  );

  if (state === "loading") {
    return (
      <main id="main" tabIndex={-1} className="section" aria-busy="true">
        <h1 className="t-h1">焼成</h1>
        <p className="muted t-small" style={{ marginTop: 16 }}>
          読み込んでいます…
        </p>
      </main>
    );
  }

  if (state === "unavailable") {
    return (
      <main id="main" tabIndex={-1} className="section">
        <div className="notice notice--alert" role="alert">
          <div className="notice__body">
            この端末のブラウザでは記録を保存できません。プライベートウィンドウでは保存が制限されることがあります。通常のウィンドウで開き直してください。
          </div>
        </div>
      </main>
    );
  }

  // 読み込みに失敗した状態で一覧を描くと「まだ焼成の記録がありません」＝記録が消えた、と読める。
  if (state === "error") {
    return (
      <main id="main" tabIndex={-1} className="section">
        <div className="notice notice--alert" role="alert">
          <div className="notice__body">
            <strong>記録を読み込めませんでした。</strong>
            <p className="t-small" style={{ marginTop: 4 }}>
              保存済みの記録が消えたとは限りません。ページを再読み込みしてもこの表示が続く場合、ブラウザのデータが壊れている可能性があります。
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (selected) {
    return (
      <FiringDetail
        firing={selected}
        pieces={pieces.filter((p) => p.firingId === selected.id)}
        onChanged={reload}
      />
    );
  }

  // 読み込めているのに指定の焼成が無い＝消された記録か、古いブックマーク。
  // 黙って一覧に落とすと「開いたつもりの焼成の中身」として一覧を読むことになるので、
  // 見つからなかったことをそのまま出す。
  return (
    <FiringList
      firings={sorted}
      missingId={id && !selected ? id : null}
      onChanged={reload}
    />
  );
}

function FiringList({
  firings,
  missingId,
  onChanged,
}: {
  firings: Firing[];
  missingId: string | null;
  onChanged: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="lintel">
        <p className="lintel__inner">
          <Link href="/">炉前</Link> / 焼成
        </p>
      </div>

      <main id="main" tabIndex={-1} className="section">
        <div className="section__head">
          <h1 className="t-h1">焼成</h1>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setCreating(true)}
          >
            ＋ 焼成を記録
          </button>
        </div>

        {missingId ? (
          <div
            className="notice notice--alert"
            role="alert"
            style={{ marginTop: 16 }}
          >
            <div className="notice__body">
              指定された焼成が見つかりません（削除された可能性があります）。ほかの焼成の記録は下に出ています。
            </div>
          </div>
        ) : null}

        {creating ? (
          <FiringEditor
            onCancel={() => setCreating(false)}
            onSaved={async () => {
              setCreating(false);
              await onChanged();
            }}
          />
        ) : null}

        {firings.length === 0 && !creating ? (
          <div className="baseline">
            <p className="baseline__empty">
              まだ焼成の記録がありません。焼成を1件つくると、温度カーブと棚位置が記録できるようになります。
            </p>
          </div>
        ) : (
          <div className="list" style={{ marginTop: 24 }}>
            {firings.map((f) => {
              const summary = curveSummary(f.points ?? []);
              const atmosphere = dominantAtmosphere(f.points ?? []);
              return (
                <Link
                  className="list__row"
                  href={`/firings/?id=${encodeURIComponent(f.id)}`}
                  key={f.id}
                >
                  <span className="t-h3">{firingLabel(f)}</span>
                  <span className="list__spacer" />
                  {summary.maxTemp !== null ? (
                    <span className="t-num-m">{summary.maxTemp}℃</span>
                  ) : (
                    <span className="t-small muted">温度未記録</span>
                  )}
                  {summary.totalMinutes !== null ? (
                    <span className="t-num-m">
                      {formatDuration(summary.totalMinutes)}
                    </span>
                  ) : null}
                  {atmosphere ? (
                    <span className="t-small muted">
                      {ATMOS_LABEL[atmosphere]}
                    </span>
                  ) : null}
                  {(f.points ?? []).length > 0 ? (
                    <Spark points={f.points} width={220} height={56} />
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}

function FiringDetail({
  firing,
  pieces,
  onChanged,
}: {
  firing: Firing;
  pieces: import("../../lib/model.mjs").Piece[];
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const summary = curveSummary(firing.points ?? []);
  const atmosphere = dominantAtmosphere(firing.points ?? []);
  const shelves = shelvesTopDown(firing.shelfCount ?? 3);

  async function handleDelete() {
    setDeleteError(null);
    try {
      // 紐付けの解除と焼成の削除は1トランザクションで行う。
      // 1件ずつ書くと、途中で失敗したときに前半のテストピースだけ紐付けが外れて確定し、
      // 画面には「そのまま残っています」と出る（＝嘘の報告になる）。
      // 棚位置は焼成の中の位置なので、焼成が消えた時点で意味を持たない。一緒に外す。
      //
      // 外す対象はこの画面が持っている一覧ではなく、削除と同じトランザクションの中で
      // 引き直す（storage 側）。この一覧は開いた時点の写しで、別のタブでこの焼成に
      // 追加・付け替えされたテストピースは入っていない。写しを元に外すと、後から
      // 紐付いた記録だけが消えた焼成を指したまま残る。
      await deleteFiringWithUnlink(firing.id);
    } catch {
      // 途中で失敗しても焼成は消えていない（＝宙に浮いた紐付けは生まれない）。
      setDeleteError(
        "削除できませんでした。この焼成も、テストピースもそのまま残っています。もう一度お試しください。",
      );
      await onChanged();
      return;
    }
    dialogRef.current?.close();
    // 先に一覧へ戻してから読み直す。順を逆にすると、読み直しが終わった一瞬だけ
    // 「指定された焼成が見つかりません」が出る（消したのは自分なのに事故に見える）。
    router.push("/firings/");
    await onChanged();
  }

  return (
    <>
      <div className="lintel">
        <p className="lintel__inner">
          <Link href="/">炉前</Link> / <Link href="/firings/">焼成</Link> /{" "}
          {firing.code || firing.date}
        </p>
      </div>

      <main id="main" tabIndex={-1} className="section">
        <div className="section__head">
          <h1 className="t-h1">{firingLabel(firing)}</h1>
          <div className="row-gap">
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
            >
              {editing ? "編集を閉じる" : "編集"}
            </button>
            <button
              type="button"
              className="btn btn--danger btn--small"
              onClick={() => dialogRef.current?.showModal()}
            >
              削除
            </button>
          </div>
        </div>

        {/* 数値サマリはカードではなく罫線で4分割した帯 */}
        <div className="readout">
          <div className="readout__cell">
            <span className="t-label">最高温度</span>
            <p className="readout__value">
              {summary.maxTemp === null ? "—" : `${summary.maxTemp} ℃`}
            </p>
          </div>
          <div className="readout__cell">
            <span className="t-label">総焼成時間</span>
            <p className="readout__value">
              {summary.totalMinutes === null
                ? "—"
                : formatDuration(summary.totalMinutes)}
            </p>
          </div>
          <div className="readout__cell">
            <span className="t-label">雰囲気</span>
            <p className="readout__value" style={{ fontSize: "1.375rem" }}>
              {atmosphere ? ATMOS_LABEL[atmosphere] : "—"}
            </p>
          </div>
          <div className="readout__cell">
            <span className="t-label">テストピース</span>
            <p className="readout__value">{pieces.length} 件</p>
          </div>
        </div>

        {editing ? (
          <FiringEditor
            firing={firing}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              setEditing(false);
              await onChanged();
            }}
          />
        ) : null}

        {/* 上に窯（棚）、下に熱（温度カーブ）。画面の物理配置が窯の物理配置と一致する。 */}
        <div className="kiln" style={{ marginTop: 32 }}>
          {shelves.map((shelf) => {
            const onShelf = pieces.filter((p) => p.shelf === shelf);
            const headingId = `detail-shelf-${shelf}`;
            return (
              <section
                className="shelf"
                key={shelf}
                aria-labelledby={headingId}
              >
                <div className="shelf__head">
                  <h2 className="shelf__no" id={headingId}>
                    棚 {shelf}
                  </h2>
                  <span className="shelf__sub">
                    {shelfSubLabel(shelf, firing.shelfCount ?? 3)}
                  </span>
                  <span className="shelf__count">
                    {onShelf.length > 0 ? `${onShelf.length} 件` : "まだ空です"}
                  </span>
                  <span className="shelf__spacer" />
                  <Link
                    className="btn btn--secondary btn--small"
                    href={`/pieces/new/?firingId=${encodeURIComponent(firing.id)}&shelf=${shelf}`}
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
                    <span className="tile--ghost" />
                    <span className="tile--ghost" />
                    <span className="tile--ghost" />
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="hearth" />
        {/* 断面（1..段数）に描けない記録の受け皿。段数を減らした焼成でも記録が消えないようにする。 */}
        <OffShelfPieces pieces={pieces} shelfCount={firing.shelfCount ?? 3} />

        <div className="baseline">
          <div className="baseline__head">
            <span className="t-label">基線 — 温度カーブ</span>
          </div>
          {(firing.points ?? []).length > 0 ? (
            <div className="baseline__body">
              <BaselineSpark
                points={firing.points}
                targetTemp={firing.targetTemp ?? null}
              />
            </div>
          ) : (
            <p className="baseline__empty">
              温度の点がまだありません。「編集」から経過時間と温度を打つと、ここにカーブが出ます。
              {/* 目標温度はカーブが無くても保存されている入力。画面から消さない。 */}
              {firing.targetTemp === null || firing.targetTemp === undefined
                ? ""
                : ` 目標 ${firing.targetTemp}℃ を記録しています。`}
            </p>
          )}
        </div>
      </main>

      <dialog ref={dialogRef}>
        <h2 className="t-h2">{firingLabel(firing)} を削除します</h2>
        <p style={{ marginTop: 12 }}>
          この焼成の温度カーブが消え、元に戻せません。
          {pieces.length > 0
            ? `この焼成に置かれた ${pieces.length} 件のテストピースは残りますが、焼成と棚位置の紐付けが外れます。`
            : ""}
        </p>
        {deleteError ? (
          <div
            className="notice notice--alert"
            role="alert"
            style={{ marginTop: 12 }}
          >
            <div className="notice__body">{deleteError}</div>
          </div>
        ) : null}
        <div className="row-gap" style={{ marginTop: 24 }}>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void handleDelete()}
          >
            削除する
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => dialogRef.current?.close()}
          >
            やめる
          </button>
        </div>
      </dialog>
    </>
  );
}

type PointDraft = {
  minutes: string;
  temp: string;
  atmosphereFrom: Atmosphere | null;
};

function FiringEditor({
  firing,
  onCancel,
  onSaved,
}: {
  firing?: Firing;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [date, setDate] = useState(firing?.date ?? todayIso());
  const [name, setName] = useState(firing?.name ?? "本焼");
  const [code, setCode] = useState(firing?.code ?? "");
  // 段数も打っている途中は文字のまま持つ（打鍵のたびに丸めると打ち直せない）。
  // 保存する値は必ず normalizeShelfCount を通した整数にする。
  const [shelfCount, setShelfCount] = useState(
    String(normalizeShelfCount(firing?.shelfCount) ?? 3),
  );
  const [targetTemp, setTargetTemp] = useState(
    firing?.targetTemp === null || firing?.targetTemp === undefined
      ? ""
      : String(firing.targetTemp),
  );
  // 記録が無い焼成は空の行から始める。`0:00 / 20℃` を最初から入れておくと、
  // 名前や段数だけを直して保存したときに、観測していない点が記録として残ってしまう
  // （最高温度・総焼成時間・書き出しまで、その捏造された点で埋まる）。
  // 入力の形は各欄の placeholder（0:00 / 1250）が示す。空行は保存時に静かに捨てられる。
  const [points, setPoints] = useState<PointDraft[]>(
    firing && firing.points.length > 0
      ? sortPoints(firing.points).map((p) => ({
          minutes: formatDuration(p.minutes),
          temp: String(p.temp),
          atmosphereFrom: p.atmosphereFrom,
        }))
      : [{ minutes: "", temp: "", atmosphereFrom: null }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function updatePoint(index: number, patch: Partial<PointDraft>) {
    setPoints((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  async function handleSave() {
    setError(null);
    const parsed: CurvePoint[] = [];
    for (const row of points) {
      const minutes = parseDuration(row.minutes);
      // 空欄を Number() に通すと 0 になり、打ち忘れが「0℃の点」として保存される。
      // 数値へ変換する前に、文字列として空かどうかを見る。
      const tempText = row.temp.trim();
      // 何も入っていない行だけを静かに捨てる。雰囲気の切替だけが選ばれている行は
      // 「打ちかけ」ではなく焼成条件そのものなので、黙って捨てず打ち直しを促す
      // （捨てると保存は成功したように見えて、切替の記録だけが消える）。
      if (minutes === null && tempText === "" && !row.atmosphereFrom) continue;
      const temp = Number(tempText);
      if (minutes === null || tempText === "" || !Number.isFinite(temp)) {
        setError(
          "温度の点は「経過（0:00 か 分）」と「温度（数値）」の両方が要ります。雰囲気の切替だけの行は保存できないので、経過と温度も入れるか、その行を × で消してください。",
        );
        return;
      }
      parsed.push({ minutes, temp, atmosphereFrom: row.atmosphereFrom });
    }

    // 目標温度も同じ扱い。空欄は「目標なし」、数値にならない入力は保存しない
    // （NaN のまま保存するとカーブの目標線が描けなくなる）。
    const targetTempText = targetTemp.trim();
    const targetTempValue =
      targetTempText === "" ? null : Number(targetTempText);
    if (targetTempValue !== null && !Number.isFinite(targetTempValue)) {
      setError(
        "目標温度は数値で入力してください（空欄なら目標なしとして保存します）。",
      );
      return;
    }

    // 段数は数えるものなので整数だけ。3.5 のような値を保存すると、断面は 4 段を描くのに
    // 編集画面と書き出しには 3.5 が残り、同じ焼成が場所によって違う段数を名乗る。
    const shelfCountValue = normalizeShelfCount(shelfCount);
    if (shelfCountValue === null) {
      setError(
        `棚の段数は ${MIN_SHELF_COUNT}〜${MAX_SHELF_COUNT} の数で入力してください。`,
      );
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    const record: Firing = {
      id: firing?.id ?? newId("firing"),
      code: code.trim(),
      name: name.trim(),
      date,
      shelfCount: shelfCountValue,
      points: sortPoints(parsed),
      targetTemp: targetTempValue,
      createdAt: firing?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      // この画面が持っている焼成は開いた時点の写しで、別のタブの削除も変更も届かない。
      // 確かめずに書くと、消された焼成がこの保存で復活する（削除で外れたテストピースの
      // 紐付けは戻らないので、復活するのは中身の無い焼成だけ）。書き込みと同じ
      // トランザクションの中で版を確かめる（storage の約束 10）。
      await commitRecord(
        STORE_FIRINGS,
        record,
        firing
          ? { mode: "update", updatedAt: firing.updatedAt ?? null }
          : { mode: "create" },
      );
      setSaving(false);
      await onSaved();
    } catch (err) {
      setSaving(false);
      const conflict = conflictOf(err);
      setError(
        conflict === null
          ? "保存できませんでした。入力内容はこの画面に残っています。"
          : conflict === CONFLICT_MISSING
            ? "この焼成は、ほかのタブ（またはウィンドウ）で削除されています。このまま保存すると、置かれていたテストピースの紐付けが外れたままの焼成だけが戻ってしまうため、保存を中止しました。入力内容はこの画面に残っています。新しい焼成として残すなら、一覧から「＋ 焼成を記録」で入れ直してください。"
            : "この焼成は、ほかのタブ（またはウィンドウ）で変更されています。このまま保存するとその変更が消えるため、保存を中止しました。入力内容はこの画面に残っています。ページを再読み込みして、最新の内容を確かめてから入れ直してください。",
      );
    }
  }

  return (
    <section
      className="mix-rail"
      style={{ marginTop: 24, padding: 16 }}
      aria-labelledby="firing-editor-heading"
    >
      <h2
        className="t-h2"
        id="firing-editor-heading"
        tabIndex={-1}
        ref={headingRef}
      >
        {firing ? "焼成を編集" : "焼成を記録"}
      </h2>

      {error ? (
        <div
          className="notice notice--alert"
          role="alert"
          style={{ marginTop: 12 }}
        >
          <div className="notice__body">{error}</div>
        </div>
      ) : null}

      <div
        className="row-gap"
        style={{ marginTop: 16, alignItems: "flex-end" }}
      >
        <div style={{ flex: "1 1 160px" }}>
          <label className="field__label" htmlFor="firing-date">
            日付
          </label>
          <input
            id="firing-date"
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label className="field__label" htmlFor="firing-name">
            名前
          </label>
          <input
            id="firing-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="本焼"
            autoComplete="off"
          />
        </div>
        <div style={{ flex: "1 1 120px" }}>
          <label className="field__label" htmlFor="firing-code">
            番号
          </label>
          <input
            id="firing-code"
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="#F-014"
            autoComplete="off"
          />
        </div>
      </div>

      <div
        className="row-gap"
        style={{ marginTop: 16, alignItems: "flex-end" }}
      >
        <div style={{ flex: "1 1 140px" }}>
          <label className="field__label" htmlFor="shelf-count">
            棚の段数
          </label>
          <input
            id="shelf-count"
            className="input input--num"
            type="number"
            min={MIN_SHELF_COUNT}
            max={MAX_SHELF_COUNT}
            step="1"
            value={shelfCount}
            onChange={(e) => setShelfCount(e.target.value)}
            // 打ち終わったら、保存される値そのものに揃える（欄の値と保存値を食い違わせない）。
            onBlur={() =>
              setShelfCount((v) => {
                const n = normalizeShelfCount(v);
                return n === null ? v : String(n);
              })
            }
          />
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label className="field__label" htmlFor="target-temp">
            目標温度（任意）
          </label>
          <input
            id="target-temp"
            className="input input--num"
            type="number"
            inputMode="decimal"
            value={targetTemp}
            onChange={(e) => setTargetTemp(e.target.value)}
            placeholder="1250"
          />
        </div>
      </div>

      <h3 className="t-h3" style={{ marginTop: 24 }}>
        温度の点
      </h3>
      <p className="field__hint" style={{ marginTop: 4 }}>
        経過は <span className="num">0:00</span>{" "}
        の形か、分の数値で入力できます。3〜30 点くらいが目安です。
      </p>

      <div
        className="mix-rail"
        style={{ marginTop: 12, background: "var(--k-void)" }}
      >
        {points.map((row, i) => (
          <div
            className="mix-row"
            style={{ gridTemplateColumns: "120px 120px 1fr 44px" }}
            key={i}
          >
            <div>
              <label className="visually-hidden" htmlFor={`pt-min-${i}`}>
                {i + 1} 点目の経過
              </label>
              <input
                id={`pt-min-${i}`}
                className="input input--num"
                value={row.minutes}
                onChange={(e) => updatePoint(i, { minutes: e.target.value })}
                placeholder="0:00"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="visually-hidden" htmlFor={`pt-temp-${i}`}>
                {i + 1} 点目の温度（℃）
              </label>
              <input
                id={`pt-temp-${i}`}
                className="input input--num"
                type="number"
                inputMode="decimal"
                value={row.temp}
                onChange={(e) => updatePoint(i, { temp: e.target.value })}
                placeholder="1250"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="visually-hidden" htmlFor={`pt-atm-${i}`}>
                {i + 1} 点目からの雰囲気
              </label>
              <select
                id={`pt-atm-${i}`}
                className="select"
                value={row.atmosphereFrom ?? ""}
                onChange={(e) =>
                  updatePoint(i, {
                    atmosphereFrom:
                      e.target.value === ""
                        ? null
                        : (e.target.value as Atmosphere),
                  })
                }
              >
                <option value="">雰囲気の切替なし</option>
                {ATMOSPHERES.map((a) => (
                  <option value={a.value} key={a.value}>
                    ここから {a.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="mix-row__remove"
              onClick={() =>
                setPoints((rows) =>
                  rows.length > 1 ? rows.filter((_, j) => j !== i) : rows,
                )
              }
              aria-label={`${i + 1} 点目を削除`}
            >
              ×
            </button>
          </div>
        ))}
        <div className="mix-foot">
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() =>
              setPoints((rows) => [
                ...rows,
                { minutes: "", temp: "", atmosphereFrom: null },
              ])
            }
          >
            ＋ 点を追加
          </button>
        </div>
      </div>

      <div className="row-gap" style={{ marginTop: 24 }}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void handleSave()}
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? "保存しています…" : "保存する"}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </section>
  );
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
