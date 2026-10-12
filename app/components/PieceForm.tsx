"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MixBar from "./MixBar";
import PhotoImage from "./PhotoImage";
import { compressPhoto } from "./compressPhoto";
import { sortFiringsNewestFirst, useRecords } from "./useRecords";
import { firingConditionSummary } from "../../lib/curve.mjs";
import {
  JUDGMENTS,
  RESULT_TAGS,
  composeResults,
  firingLabel,
  isShelfInRange,
  looksLikeColorant,
  mixTotal,
  nextPieceCode,
  partitionResults,
  shelfSubLabel,
  shelvesTopDown,
  uniqueOptionLabels,
  validatePiece,
} from "../../lib/model.mjs";
import {
  CONFLICT_MISSING,
  DEFAULT_COMPRESSION,
  RETRY_COMPRESSION,
  STORE_PHOTOS,
  commitPiece,
  conflictOf,
  deletePhoto,
  deletePieceWithPhotos,
  estimateStorage,
  firstExistingPhotoId,
  formatBytes,
  newId,
  putPhoto,
  requestPersistence,
  sweepOrphanPhotos,
  willExceedQuota,
} from "../../lib/storage.mjs";
import type { Judgment, MixRow, Piece } from "../../lib/model.mjs";

type PhotoState =
  | { kind: "none" }
  | { kind: "existing"; photoId: string }
  | { kind: "compressing" }
  | { kind: "staged"; blob: Blob; bytes: number; originalBytes: number };

/**
 * 写真の保存に失敗したあと、記録の写真が実際にどうなったか。
 * 画面の文言も、警告を閉じたときに入力へ戻す状態も、すべてこれで決める
 * （「前の写真のまま進める」と書いておきながら未保存の写真を握り続けない）。
 *   kept            前の写真が実在することを確かめ、記録の参照もそこへ戻せた
 *   kept-unverified 実在は確かめられなかったが、記録の参照は前の写真に戻した
 *   none            写真なしの記録になった
 *   unsaved         参照を直せず、記録は保存できなかった写真を指したまま
 *   gone            保存の途中でほかのタブから記録ごと消された（記録も残っていない）
 */
type PhotoOutcome = "kept" | "kept-unverified" | "none" | "unsaved" | "gone";

/**
 * 写真を書く前の空き容量の見立て。
 * 書いてから失敗を知らせると、残りの空きを一度使い切ってからでないと
 * 「もっと小さくして再試行」を選べない（＝選ばせる意味が無くなる）。
 */
type PreflightState = null | { usage: number; quota: number; bytes: number };

type QuotaState = null | {
  usage: number | null;
  quota: number | null;
  /** 容量不足だったか（他の I/O 失敗を容量不足と言い切らないための区別）。 */
  quotaExceeded: boolean;
  outcome: PhotoOutcome;
  /** 記録がいま指している写真（null は写真なし）。outcome が unsaved のときは持たない。 */
  settledPhotoId: string | null;
};

/**
 * 入力中の配合の行。
 *
 * 部数は数値で保存するが、入力中は打たれた文字をそのまま持つ。
 * 打鍵のたびに数値へ丸めて描き戻すと、`0.5` の先頭の `0` が数値の 0 になって
 * 空欄として描き直され、小数が打てなくなる（step="0.1" が成立しない）。
 *
 * 着色材の印は「材料名からの推定」と「ユーザーの選択」を区別して持つ。
 * 区別しないと、印を付け外ししたあとに材料名を直した打鍵で推定が上書きし、
 * 選んだはずの分類が保存・書き出しから消える。
 */
type MixDraft = MixRow & { partsText: string; colorantTouched: boolean };

const EMPTY_ROW: MixDraft = {
  material: "",
  parts: 0,
  colorant: false,
  partsText: "",
  colorantTouched: false,
};

/**
 * 色メモを付けるときの初期色。
 * `<input type="color">` は「未設定」を表せない（必ず何かの色を表示する）ので、
 * 付ける／付けないはチェックボックスで別に持つ。表示だけ色が入っていて保存されない、
 * という食い違いを作らないための分離。
 */
const DEFAULT_COLOR_MEMO = "#8a8f6a";

/**
 * 部数の入力を 0 以上の数だけに丸める。
 * フォームは noValidate なので `min="0"` はブラウザに止めてもらえない。負数のまま持つと、
 * 表示・比較・書き出し（toParts）では 0 になるのに編集画面だけ負数を見せることになる。
 */
function parsePartsInput(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 保存される数値を、そのまま入力欄に戻すときの表記（0 は空欄＝未入力として見せる）。 */
function formatPartsInput(parts: number): string {
  return parts > 0 ? String(parts) : "";
}

/** 保存済みの配合を入力中の行に開く。 */
function toMixDrafts(rows: MixRow[] | undefined | null): MixDraft[] {
  if (!rows || rows.length === 0) return [{ ...EMPTY_ROW }];
  return rows.map((row) => ({
    ...row,
    parts: parsePartsInput(String(row.parts ?? "")),
    partsText: formatPartsInput(parsePartsInput(String(row.parts ?? ""))),
    // 保存されている印は、推定であれ選択であれ「一度確定した値」。
    // 材料名を直しただけで推定に戻すと、保存済みの分類が黙って書き換わる。
    colorantTouched: true,
  }));
}

export default function PieceForm() {
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get("id");
  const { pieces, firings, state, reload } = useRecords();

  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [mix, setMix] = useState<MixDraft[]>([{ ...EMPTY_ROW }]);
  const [firingId, setFiringId] = useState<string>("");
  const [shelf, setShelf] = useState<number | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [customResult, setCustomResult] = useState("");
  const [judgment, setJudgment] = useState<Judgment | null>(null);
  const [note, setNote] = useState("");
  const [colorMemo, setColorMemo] = useState("");
  const [photo, setPhoto] = useState<PhotoState>({ kind: "none" });
  // 容量不足のときに「もっと小さくして再試行」できるよう、選ばれた元ファイルを保持する。
  const [originalFile, setOriginalFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaState>(null);
  const [preflight, setPreflight] = useState<PreflightState>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  // 保存されていた焼成が見つからなかったか（削除済みの焼成を指したままの記録）。
  const [missingFiring, setMissingFiring] = useState(false);
  // 保存の途中で、紐付けていた焼成が既に消えていたか（別のタブで消された等）。
  // 画面が持っている焼成の一覧は開いた時点の写しなので、保存の中でしか分からない。
  const [firingUnlinked, setFiringUnlinked] = useState(false);
  // 新規のとき、写真の書き込みだけが失敗して本体だけが保存された記録。
  // 再試行で新しい ID を振ると写真なしの記録が取り残されて二重になるので、
  // 同じ ID・同じ作成時刻で上書きし続ける。
  const [savedDraft, setSavedDraft] = useState<{
    id: string;
    createdAt: string;
  } | null>(null);

  const quotaRef = useRef<HTMLDivElement | null>(null);
  const preflightRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  // 写真の操作（選ぶ・外す・作り直す）に通し番号を振る。圧縮は非同期なので、
  // 古い圧縮が後から終わって、あとで選ばれた写真を上書きするのを防ぐ。
  const photoOpRef = useRef(0);
  // 初期値として受け取り済みの URL 指定（firingId と shelf の組）。
  // 受け取ったあとの変更を上書きし返さないために持つ。
  const urlDefaultsRef = useRef<string | null>(null);
  /**
   * この画面が読み込んだ記録の版。保存は「この版への上書き」として書く。
   *
   * 別のタブの削除・変更はこの画面に届かない（保存領域の通知はそのタブの中にしか
   * 届かず、記録の読み込みも1回だけ）。版を持たずに書くと、消された記録がこの保存で
   * 復活し、別のタブで差し替えられた写真の参照が古い ID に巻き戻る。
   *
   * 見ているのは「この画面が最後に読んだ／書いた版」であって、そのあとの読み直しで
   * 入ってきた別のタブの版ではない。読み直しに合わせてしまうと、画面の入力は古いまま
   * 版だけが新しくなり、確認をすり抜けて別のタブの変更を上書きする。
   */
  const baseVersionRef = useRef<
    { mode: "create" } | { mode: "update"; updatedAt: string | null }
  >({ mode: "create" });
  // 圧縮に失敗したときに戻す、直前に確定していた写真と、その元ファイル。
  // 差し替えに失敗しただけで「写真を外した」ことにすると、保存時に前の写真の
  // Blob まで消える（読めない画像を選んだだけで、無事な写真が失われる）。
  const photoFallbackRef = useRef<{ photo: PhotoState; file: File | null }>({
    photo: { kind: "none" },
    file: null,
  });

  /**
   * 写真の操作を1つ始める。進行中の圧縮を無効化し、この操作の番号を得る。
   *
   * ファイル入力の選択もここで外す。React 側の写真の状態だけを戻しても、
   * <input type="file"> は前に選んだファイル名を持ったまま表示し続けるため、
   * 保存済みの次の記録に写真が付いているように見える。加えて、同じファイルを
   * もう一度選んでも change が起きず、選び直せなくなる。
   */
  const beginPhotoOp = useCallback(() => {
    photoOpRef.current += 1;
    if (photoInputRef.current) photoInputRef.current.value = "";
    // 事前の見立ては「いま持っている写真を書いたらどうなるか」なので、写真が変われば
    // その場で捨てる（残すと、作り直したあとの画面に前のバイト数が出たままになる）。
    setPreflight(null);
    return photoOpRef.current;
  }, []);

  /** 入力を新規の初期状態に戻す（別の記録の内容を持ち越さない）。 */
  const clearForm = useCallback(() => {
    beginPhotoOp();
    // 上書きする相手がいなくなった＝次の保存は新規作成。
    baseVersionRef.current = { mode: "create" };
    setCode("");
    setCodeTouched(false);
    setRecipeName("");
    setMix([{ ...EMPTY_ROW }]);
    setFiringId("");
    setMissingFiring(false);
    setFiringUnlinked(false);
    setShelf(null);
    setResults([]);
    setCustomResult("");
    setJudgment(null);
    setNote("");
    setColorMemo("");
    setPhoto({ kind: "none" });
    setOriginalFile(null);
    setErrors({});
    setSaved(null);
    setSaveError(null);
    setQuota(null);
    setSavedDraft(null);
  }, [beginPhotoOp]);

  const editing = useMemo(
    () => pieces.find((p) => p.id === editId) ?? null,
    [pieces, editId],
  );
  const sortedFirings = useMemo(
    () => sortFiringsNewestFirst(firings),
    [firings],
  );
  // 表示名（日付・名前・番号）は入力であって鍵ではないので、同じ日に同じ名前で焼けば重なる。
  // 重なった選択肢をそのまま出すと、狙いもカーブも違う別の焼成が同じ1行に見え、
  // テストピースと棚位置が意図しない窯に付く。重なったものにだけ条件の要約を添える。
  const firingOptions = useMemo(
    () =>
      uniqueOptionLabels(sortedFirings, firingLabel, firingConditionSummary),
    [sortedFirings],
  );

  // 既存レコードの読み込み（1回だけ）。ユーザーの編集を後から上書きしない。
  // 逆に、編集していた記録から離れたら（上部の「＋ テストピース」は同じパスの
  // クエリだけを落とすので、この画面は開いたままになる）必ず入力を捨てる。
  // 残したまま「新規」と表示すると、保存でまったく同じ内容がもう1件できる。
  useEffect(() => {
    if (!editing) {
      // 入力を捨ててよいのは「編集していた記録から離れた」ときだけ（id が落ちた）。
      // id はあるのに記録が見つからない場合は捨てない。捨てると画面が新規の入力欄に
      // 化けて、保存が「直したい記録の上書き」ではなく「別の記録の新規作成」になる。
      // 見つからないことは下の editRecordMissing で伝え、保存そのものを止める。
      if (loadedId !== null && !editId) {
        setLoadedId(null);
        clearForm();
      }
      return;
    }
    if (loadedId === editing.id) return;
    beginPhotoOp();
    setLoadedId(editing.id);
    // いま読み込んだ版が、保存のときに確かめる相手になる。
    baseVersionRef.current = {
      mode: "update",
      updatedAt: editing.updatedAt ?? null,
    };
    setCode(editing.code ?? "");
    setRecipeName(editing.recipeName ?? "");
    setMix(toMixDrafts(editing.mix));
    // 保存済みの焼成 ID も、いま存在する焼成でなければそのまま持たない。
    // 選択欄に一致する選択肢が無いまま値だけを握ると、画面は「選ばない」に見えるのに
    // 保存では宙に浮いた紐付けが書き戻される（他の画面では紐付けなしとして扱われる）。
    const linkedFiring = editing.firingId
      ? (firings.find((f) => f.id === editing.firingId) ?? null)
      : null;
    setFiringId(linkedFiring ? linkedFiring.id : "");
    setMissingFiring(Boolean(editing.firingId) && !linkedFiring);
    setShelf(editing.shelf ?? null);
    // 自由入力の結果はチェックボックスに出ないので、既定候補と分けて入力欄に戻す。
    // 分けずに results へ入れると、画面から見えないまま保存時に二重に増える。
    const partitioned = partitionResults(editing.results);
    setResults(partitioned.tags);
    setCustomResult(partitioned.customText);
    setJudgment(editing.judgment ?? null);
    setNote(editing.note ?? "");
    setColorMemo(editing.colorMemo ?? "");
    setPhoto(
      editing.photoId
        ? { kind: "existing", photoId: editing.photoId }
        : { kind: "none" },
    );
    setSavedDraft(null);
  }, [editing, editId, loadedId, firings, beginPhotoOp, clearForm]);

  /** その焼成の棚段数。未選択のときは既定の3段（棚ピッカーの表示と同じ根拠）。 */
  const shelfCountOf = useCallback(
    (id: string) => firings.find((f) => f.id === id)?.shelfCount ?? 3,
    [firings],
  );

  // 新規のときは URL の指定を初期値に使う（棚の「＋ここに置く」から来る導線）。
  // URL は手で書き換えられるし、ブックマークは古くなる。実在する焼成の、
  // その焼成に在る段だけを受け取る（存在しない焼成 ID を持たせると、選択欄には
  // 一致する選択肢が無いのに保存では宙に浮いた紐付けが残り、他の画面では
  // 紐付けなしとして扱われる。範囲外の段も窯の断面に描かれず記録が画面から消える）。
  //
  // 受け取るのは「初期値」なので、同じ URL からは一度だけ。この効果は焼成・棚位置の
  // 変化でも走るため、毎回受け取ると「選ばない」「指定しない」に戻した直後に URL の値が
  // 書き戻され、来た導線の焼成・棚を外せないまま保存することになる。
  // 記録するのは URL の値そのもの。別の棚の「＋ここに置く」から入り直したとき
  // （この画面は開いたままクエリだけが変わる）は、新しい指定として受け取り直す。
  useEffect(() => {
    if (editId || state !== "ready") return;
    const f = params.get("firingId");
    const s = params.get("shelf");
    const consumeKey = `${f ?? ""} ${s ?? ""}`;
    if (urlDefaultsRef.current === consumeKey) return;
    urlDefaultsRef.current = consumeKey;
    const known = f && firings.some((firing) => firing.id === f) ? f : "";
    // 受け取り直すときは、既に選ばれている焼成があっても差し替える。差し替えないと、
    // 新しい URL の棚位置だけが前の焼成に付き、別の窯の段を指したまま保存される
    // （棚位置は焼成の中の位置なので、焼成と段は必ず同じ窯のものにする）。
    if (known && known !== firingId) {
      setFiringId(known);
      setMissingFiring(false);
      // 焼成が変われば段数も変わる。前の窯で選んだ段がこの窯に無ければ外す
      // （残すと、どの棚にも描かれない＝画面から消えた記録になる）。
      setShelf((prev) =>
        isShelfInRange(prev, shelfCountOf(known)) ? prev : null,
      );
    }
    // 棚位置も、紐付け先の焼成が決まっているときだけ受け取る。焼成なしで受け取ると、
    // どの窯の断面にも描かれない棚位置が記録と書き出しにだけ残る。
    // URL が焼成を名指ししているのに実在しないときは、その指定を丸ごと捨てる
    // （いま選ばれている別の焼成に、違う窯のつもりで指定された段を付けない）。
    const linkedId = f ? known : firingId;
    if (s && linkedId) {
      const n = Number(s);
      if (isShelfInRange(n, shelfCountOf(linkedId))) setShelf(n);
    }
  }, [editId, params, state, firings, firingId, shelfCountOf]);

  // 識別番号は自動採番を提案する。ユーザーが触ったら以後は上書きしない。
  useEffect(() => {
    if (editId || codeTouched || code || state !== "ready") return;
    setCode(nextPieceCode(pieces.map((p) => p.code)));
  }, [editId, codeTouched, code, pieces, state]);

  const selectedFiring = sortedFirings.find((f) => f.id === firingId) ?? null;
  const shelfCount = selectedFiring?.shelfCount ?? 3;
  // 直前の保存で自分が書いた記録は、読み直しが終わるまで一覧に出てこない。
  // これを「見つからない」と扱うと、写真だけが失敗したときの再試行が塞がる。
  const editTargetLoaded =
    Boolean(editing) || (savedDraft !== null && savedDraft.id === editId);
  // 編集で開いた記録を、いまこの画面に持てていない。
  //   読み込み失敗・保存できない環境 … まだ「無い」と決まっていない
  //   読み込めているのに見つからない … 消された記録・古いブックマーク
  // どちらの状態で保存しても新しい ID が振られ、直したかった記録は元のまま、
  // 中身だけが同じ2件目ができる（どちらが本物か後から見分けられない）。保存を止める。
  const editLoadBlocked = Boolean(editId) && !editTargetLoaded;
  // 「読めていない」のか「読めたうえで無い」のかで、取れる手が違う（再読み込みか、
  // 新規として作り直すか）。文言を分けるためにここで区別する。
  const editRecordMissing = editLoadBlocked && state === "ready";
  const materialSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const p of pieces)
      for (const r of p.mix ?? []) if (r.material) set.add(r.material);
    return [...set].sort();
  }, [pieces]);
  const recipeSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const p of pieces) if (p.recipeName) set.add(p.recipeName);
    return [...set].sort();
  }, [pieces]);

  function updateMixRow(index: number, patch: Partial<MixDraft>) {
    setMix((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        // 材料名を打った時点で着色材らしさを推定する。ただし推定してよいのは、
        // その行の印がまだ触られていない間だけ。印を付け外ししたあとも推定を続けると、
        // 材料名を直す打鍵のたびにユーザーの選択が上書きされ（外した印が戻る）、
        // 保存・書き出しの分類が画面で選んだものと食い違う。
        if (
          patch.material !== undefined &&
          !("colorant" in patch) &&
          !row.colorantTouched
        ) {
          next.colorant = looksLikeColorant(patch.material);
        }
        return next;
      }),
    );
  }

  /**
   * 圧縮を1つ始める。進行中の圧縮を無効にし、失敗したときに戻る先を控える。
   *
   * 控えるのは、いま画面が確定して持っている写真とその元ファイル。圧縮中にもう一度
   * 選び直されたときは、画面の「圧縮中」ではなく、先に始めた圧縮のときに控えた写真が
   * そのまま戻り先になる（圧縮中は戻り先になり得ない）。
   */
  function beginPhotoCompression() {
    // 圧縮の途中で別の写真を選ばれたら、先に始めた圧縮の結果は捨てる。
    // 捨てないと、あとから終わった古い圧縮が新しい写真を上書きして保存される。
    const op = beginPhotoOp();
    if (photo.kind !== "compressing") {
      photoFallbackRef.current = { photo, file: originalFile };
    }
    setPhoto({ kind: "compressing" });
    return op;
  }

  /**
   * 圧縮に失敗した操作を、始める前の写真へ戻す。
   *
   * 「写真なし」に落とさないのが肝心なところ。読めない画像を選んだだけなのに写真なしに
   * すると、そのあとの保存が取り外しとして扱われ（handleSubmit は写真なしの記録として
   * 書く）、前から付いていた無事な写真の Blob まで消える。
   */
  function revertPhotoToFallback() {
    setPhoto(photoFallbackRef.current.photo);
    setOriginalFile(photoFallbackRef.current.file);
  }

  async function handlePhotoChange(file: File | undefined) {
    if (!file) return;
    const op = beginPhotoCompression();
    setSaveError(null);
    setOriginalFile(file);
    try {
      const result = await compressPhoto(file, DEFAULT_COMPRESSION);
      if (photoOpRef.current !== op) return;
      setPhoto({
        kind: "staged",
        blob: result.blob,
        bytes: result.bytes,
        originalBytes: result.originalBytes,
      });
    } catch {
      if (photoOpRef.current !== op) return;
      revertPhotoToFallback();
      setSaveError(
        photoFallbackRef.current.photo.kind === "none"
          ? "この写真を読み込めませんでした。別の画像でお試しください。"
          : "この写真を読み込めませんでした。前の写真をそのまま残しています。別の画像でお試しください。",
      );
    }
  }

  /** 写真を外す。進行中の圧縮も無効にする（あとから戻ってこないように）。 */
  function removePhoto() {
    beginPhotoOp();
    setPhoto({ kind: "none" });
    setOriginalFile(null);
  }

  /**
   * 画面の写真を、保存が確定した記録の参照に合わせる。
   *
   * 記録の読み込みは1回だけなので（同じ記録を開いたままなら再読み込みは走らない）、
   * 保存の中で記録の写真が変わっても、合わせに行かない限り画面は古い状態を持ち続ける。
   * 持ち続けると、ユーザーが取り下げたはずの写真が画面に出たまま残り、次の普通の保存が
   * その写真の書き込みをもう一度試す（＝取り下げが効かない）。
   */
  const settlePhotoTo = useCallback(
    (photoId: string | null) => {
      // 進行中の圧縮とファイル入力の選択も落とす（あとから戻ってこないように）。
      beginPhotoOp();
      setPhoto(photoId ? { kind: "existing", photoId } : { kind: "none" });
      setOriginalFile(null);
    },
    [beginPhotoOp],
  );

  /** 容量不足のときの再試行。長辺 720px・品質 60% でもう一度作り直す。 */
  async function retrySmaller() {
    if (!originalFile) return;
    const file = originalFile;
    const op = beginPhotoCompression();
    try {
      const result = await compressPhoto(file, RETRY_COMPRESSION);
      if (photoOpRef.current !== op) return;
      setPhoto({
        kind: "staged",
        blob: result.blob,
        bytes: result.bytes,
        originalBytes: result.originalBytes,
      });
      setQuota(null);
    } catch {
      if (photoOpRef.current !== op) return;
      // 作り直せなかっただけ。ここで写真なしにすると、次の保存が取り外しとして
      // 扱われ、前から付いていた写真まで消える。選び直せる状態に戻して知らせる。
      revertPhotoToFallback();
      setSaveError(
        "この写真を小さく作り直せませんでした。別の画像でお試しください。",
      );
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void save(false);
  }

  /**
   * 保存本体。
   *
   * @param skipQuotaPreflight
   *   空き容量の事前チェックを飛ばすか。警告を読んだうえで「このまま保存する」を
   *   選んだときだけ true（見立ては見立てでしかないので、ユーザーの選択を塞がない）。
   */
  async function save(skipQuotaPreflight: boolean) {
    // 編集のつもりで開いた記録をまだ読めていない間は保存しない。
    // 通すと editing が null のまま新しい ID が振られ、直したかった記録は元のまま、
    // 中身だけが同じ2件目ができる（どちらが本物か後から見分けられない）。
    if (editLoadBlocked) {
      setSaveError(
        editRecordMissing
          ? "編集しようとしている記録が見つかりません（削除された可能性があります）。このまま保存すると、直したかった記録とは別の記録が新しくできてしまうため、保存できません。内容を新しい記録として残すなら、コピーしてから「＋ テストピース」で開き直してください。"
          : "編集しようとしている記録を読み込めていないため、上書きできません。このまま保存すると別の記録が新しくできてしまいます。ページを再読み込みしてからお試しください。",
      );
      return;
    }
    const draft = { code, note };
    const check = validatePiece(draft);
    setErrors(check.errors);
    if (!check.ok) return;

    // 圧縮中に保存すると、写真が付かないまま確定してしまう（そのあと圧縮が終わっても
    // 画面には写真が出るのに保存されていない、という食い違いになる）。
    if (photo.kind === "compressing") {
      setSaveError(
        "写真を処理しています。プレビューが出てからもう一度保存してください。",
      );
      return;
    }

    // 材料名の無い行は保存されない（配合の鍵は材料名なので、名前なしでは束ねられない）。
    // 部数だけが打たれている行を黙って捨てると、入力したはずの配合が消えるので、
    // 捨てる前に知らせて選ばせる。
    if (mix.some((r) => r.material.trim() === "" && r.parts > 0)) {
      setSaveError(
        "材料名のない行に部数だけが入っています。材料名を入れるか、その行を × で消してから保存してください。",
      );
      return;
    }

    setSaving(true);
    setSaveError(null);
    setQuota(null);
    setPreflight(null);
    setFiringUnlinked(false);

    // 写真を書く前に空き容量を見る。書いてから失敗を知らせると、残りの空きを一度
    // 使い切ってからでないと「もっと小さくして再試行」を選べない（差し替えなら、
    // その1回で前の写真も危うくなる）。空き容量が取れない環境では見立てを作らない
    // ので（estimateStorage は null を返す）、この関門は素通りする。
    if (photo.kind === "staged" && !skipQuotaPreflight) {
      const est = await estimateStorage();
      if (est && willExceedQuota(est.usage, est.quota, photo.bytes)) {
        setSaving(false);
        setPreflight({
          usage: est.usage,
          quota: est.quota,
          bytes: photo.bytes,
        });
        window.setTimeout(() => preflightRef.current?.focus(), 0);
        return;
      }
    }

    const now = new Date().toISOString();
    const id = editing?.id ?? savedDraft?.id ?? newId("piece");
    const allResults = composeResults(results, customResult);

    // 写真は新しく貼るときだけ ID を作る。既存写真はそのまま引き継ぐ。
    const stagedPhotoId =
      photo.kind === "staged"
        ? newId("photo")
        : photo.kind === "existing"
          ? photo.photoId
          : null;
    // 差し替え・取り外しで参照されなくなる写真。UI からは消せず、件数にも出ないので、
    // 保存が確定してから必ず消す（放置すると編集のたびに端末の容量だけが減る）。
    const supersededPhotoId =
      editing?.photoId && editing.photoId !== stagedPhotoId
        ? editing.photoId
        : null;
    // この記録が既に持っている印。差し替えが中断されたまま復帰できていない
    // （読み込み時の復帰が失敗した端末）と、これが唯一無事な写真の手がかりになる。
    const carriedPhotoMark = editing?.supersededPhotoId ?? null;
    // 実際にいま差し替えているか。印を外して前の Blob を消してよいのはこの場合だけ。
    const replacingPhoto =
      photo.kind === "staged" && Boolean(supersededPhotoId);
    // 記録に持たせる「まだ消してはいけない写真」の印。
    //
    // 差し替え中: 記録を先に新しい写真へ向けるので、この間の前の写真はどの photoId からも
    //   指されない。印が無いと、書き出し画面（別タブでも開ける）の孤児の掃除がこの Blob を
    //   消し、下の失敗時の復帰で「残っています」と言えなくなる。
    // 差し替えでない保存: 記録が既に持っている印をそのまま書き戻す。ここで外すと、中断した
    //   差し替えから戻れていない記録で、無事な前の写真が誰からも参照されなくなって掃除に
    //   消される（記録が指している新しい写真は存在しないので、写真が全部消える）。
    // 写真を外す保存: 印も外す。写真なしの記録に印だけを残すと、読み込み時の復帰がそれを
    //   「差し替えの途中」と読んで、外したはずの写真を指し直してしまう。
    const pendingReplacedPhotoId = replacingPhoto
      ? supersededPhotoId
      : stagedPhotoId
        ? carriedPhotoMark
        : null;

    const record: Piece = {
      id,
      code: code.trim(),
      recipeName: recipeName.trim(),
      // 入力中の表記（partsText）は記録には残さない。保存するのは数値だけ。
      mix: mix
        .filter((r) => r.material.trim() !== "")
        .map(({ material, parts, colorant }) => ({
          material,
          parts,
          colorant,
        })),
      firingId: firingId || null,
      // 棚位置は焼成の中の位置。焼成の紐付けが無い記録には持たせない
      // （持たせても、どの窯の断面にも描かれないまま書き出しにだけ残る）。
      // 画面側も未選択のときは棚を選ばせない。ここは最後の砦。
      shelf: firingId ? shelf : null,
      results: allResults,
      judgment,
      note: note.trim(),
      photoId: stagedPhotoId,
      supersededPhotoId: pendingReplacedPhotoId,
      // まだ Blob を書けていない写真の印。記録を先に書く以上（順序の約束 1）、記録が
      // 実在しない写真を指す時間が必ずできる。差し替えなら前の写真の印が戻す先になるが、
      // 写真を初めて付けるときは戻す先が無く、印が無いと「保存が進行中」と「中断して
      // もう書かれない」を後から区別できない。区別できないまま参照を外すと書き込み中の
      // 写真を消すことになり、外さなければ存在しない写真を指したままの記録が永久に残る。
      pendingPhotoId: photo.kind === "staged" ? stagedPhotoId : null,
      // 色メモは「写真が無いときの代わり」。写真が付いているなら持たせない。
      colorMemo: stagedPhotoId ? null : colorMemo || null,
      createdAt: editing?.createdAt ?? savedDraft?.createdAt ?? now,
      updatedAt: now,
    };

    // 画面を、実際に書かれた記録に合わせる。
    //
    // 記録の読み込みは1回だけなので（同じ記録を開いたままなら再読み込みは走らない）、
    // 書き込みの中で記録の中身が変わっても、合わせに行かない限り画面は古い値を持ち続ける。
    // 持ち続けた値は次の保存でそのまま書き戻されるので、食い違いは表示だけでは終わらない。
    const settleCommitted = (before: Piece, after: Piece) => {
      // 焼成の紐付けが書き込みの中で外れたとき（別のタブで消えていた焼成）。
      // 画面だけ紐付いたまま残すと、次の保存でまた同じ紐付けを書こうとする。
      if (before.firingId && !after.firingId) {
        setFiringUnlinked(true);
        setFiringId("");
        setMissingFiring(false);
        setShelf(null);
      }
      // 色メモは「写真が無いときの代わり」なので、写真が付いた記録には null が書かれる。
      // 画面に残したままにすると、その写真を外した瞬間に消えたはずのメモが戻り、
      // 次の保存でそれが書き戻される（読み込み直した場合と結果が変わる）。
      setColorMemo(after.colorMemo ?? "");
    };

    // 上書きしてよいのは「この画面が読んだ版がいまも在る」ときだけ（storage の約束 10）。
    // 書けたらこの画面が持つ版も進める。続きの書き込み（写真のあとの印外し・失敗時の
    // 指し直し）は、いま自分が書いた版への上書きとして確かめ直す。
    const advanceBaseVersion = (written: Piece) => {
      baseVersionRef.current = {
        mode: "update",
        updatedAt: written.updatedAt ?? null,
      };
    };

    try {
      // 【順序の約束】記録本体を先にコミットする。
      // 逆にすると容量不足のときに所見まで失われ、この製品の存在価値が消える。
      //
      // 焼成への紐付けは、この書き込みと同じトランザクションの中で実在を確かめる
      // （storage の約束 9）。この画面が持っている焼成の一覧は開いた時点の写しなので、
      // 別のタブで焼成が消されていても選択欄には残っている。確かめずに書くと、
      // 削除で外れたはずの紐付けと棚位置が保存で復活する。
      let committed: Piece = await commitPiece(
        record,
        [],
        baseVersionRef.current,
      );
      settleCommitted(record, committed);
      advanceBaseVersion(committed);

      if (photo.kind === "staged" && stagedPhotoId) {
        try {
          await putPhoto(stagedPhotoId, photo.blob);
        } catch (error) {
          // 写真だけの失敗。記録本体は既に残っているので、そのことを明示する。
          const est = await estimateStorage();
          const quotaExceeded = (error as { quotaExceeded?: boolean })
            ?.quotaExceeded;
          // 差し替えに失敗したときは、前からある写真を残す。
          // ここで photoId を null にして古い Blob を消すと、
          // 「新しい写真は入らなかったのに、前の写真まで消えた」＝保存済みの記録の毀損になる。
          // 前の写真はまだ Blob として無傷なので、レコードの参照もそこへ戻す。
          // 新しい写真は入っていないので、古い写真はまだ参照されている。消さない。
          //
          // 戻す先が本当に残っているかは確かめる。前の差し替えが中断したまま復帰できて
          // いない記録では、いま指している写真の Blob が既に無く、無事なのは印の側だけ、
          // ということがある。確かめずに指し直すと存在しない Blob を指したままになる。
          const keptPhotoId = await firstExistingPhotoId([
            supersededPhotoId,
            carriedPhotoMark,
          ]);
          // 実在を確かめられなかったときは、いま指している前の写真へ戻す
          // （読めなかった＝無いとは限らない。参照を落とすほうが失うものが大きい）。
          const revertPhotoId = keptPhotoId ?? supersededPhotoId;
          let referenceFixed = true;
          // 直しが版の食い違いで止まったか（別のタブがこの記録を消した・書き換えた）。
          let revertConflict: string | null = null;
          try {
            const reverted: Piece = await commitPiece(
              {
                ...committed,
                photoId: revertPhotoId,
                // 前の写真を指し直したので、差し替え中の印は外す（付けたままにすると
                // 掃除がこの Blob を永久に残す＝消せない容量になる）。
                supersededPhotoId: null,
                // 新しい写真はもう書かない（この保存では諦めた）。書けていない印も外す。
                // 残すと、次の読み込みの復帰がこの記録をもう一度直そうとする。
                pendingPhotoId: null,
                // 写真が付かなくなった記録では、色メモが唯一の発色の手がかりになる。
                colorMemo: revertPhotoId ? null : colorMemo || null,
              },
              [],
              baseVersionRef.current,
            );
            settleCommitted(committed, reverted);
            committed = reverted;
            advanceBaseVersion(reverted);
          } catch (revertError) {
            // 直しの書き込みまで失敗した。レコードは「新しい写真あり」を指したままなので、
            // 直せなかったことをそのまま伝える（直ったふりをしない）。
            referenceFixed = false;
            revertConflict = conflictOf(revertError);
          }
          // 保存の途中で、この記録がほかのタブから消されていた。書いた本体はもう無いので、
          // 「保存済みの記録」として握らない（握ると、再試行が存在しない記録への
          // 上書きになり、二度と保存できなくなる）。次の保存は新規作成としてやり直す。
          const recordGone = revertConflict === CONFLICT_MISSING;
          if (recordGone) {
            setSavedDraft(null);
            baseVersionRef.current = { mode: "create" };
          } else {
            // 本体は保存済み。この画面を「新規」のままにすると、再試行の保存で
            // 別の ID が振られ、写真なしの記録が取り残されて二重になる。
            // 保存済みレコードの ID を握り、URL も編集中の記録へ寄せる。
            setSavedDraft({ id, createdAt: record.createdAt });
            if (!editing) {
              router.replace(`/pieces/new/?id=${encodeURIComponent(id)}`);
            }
          }
          // 「前の写真は残っています」と言い切れるのは、その Blob を実際に確かめられて、
          // かつ記録の参照をそこへ戻せたときだけ。確かめられなかった場合と、参照そのものを
          // 直せなかった場合は、別の状態として持つ（同じ文言・同じ後始末にしない）。
          const outcome: PhotoOutcome = recordGone
            ? "gone"
            : !referenceFixed
              ? "unsaved"
              : keptPhotoId
                ? "kept"
                : revertPhotoId
                  ? "kept-unverified"
                  : "none";
          setQuota({
            usage: est?.usage ?? null,
            quota: est?.quota ?? null,
            quotaExceeded: quotaExceeded === true,
            outcome,
            settledPhotoId: referenceFixed ? revertPhotoId : null,
          });
          if (outcome === "gone") {
            setSaveError(
              "写真を保存できませんでした。さらに、この記録は保存の途中でほかのタブ（またはウィンドウ）から削除されたため、記録そのものも残っていません。入力内容はこの画面に残っていますので、必要なら控えてから保存し直してください。",
            );
          } else if (outcome === "unsaved") {
            setSaveError(
              revertConflict !== null
                ? "写真を保存できませんでした。さらに、この記録はほかのタブ（またはウィンドウ）で変更されているため、写真の参照を直せませんでした。ページを再読み込みして、最新の内容を確かめてください。"
                : "写真を保存できませんでした。記録そのものは保存済みですが、この記録は写真ありのままになっています。空きを作ってから、もう一度保存してください。",
            );
          } else if (!quotaExceeded) {
            setSaveError(
              outcome === "none"
                ? "写真を保存できませんでした。記録そのものは保存済みです。"
                : outcome === "kept"
                  ? "新しい写真を保存できませんでした。記録そのものは保存済みで、前の写真もそのまま残っています。"
                  : "新しい写真を保存できませんでした。記録そのものは保存済みで、記録は前の写真を指したままにしています。",
            );
          }
          setSaving(false);
          await reload();
          window.setTimeout(() => quotaRef.current?.focus(), 0);
          return;
        }
      }

      // 新しい写真まで確定してから、記録が抱えている印を外す。
      // 「まだ書けていない」印を外さないと、次の読み込みの復帰がこの記録を中断した保存と
      // 読み、書けているはずの写真を落としかねない。
      // 前の写真を消してよいのは「いまこの保存で差し替えた」ときだけ。書き戻しただけの印
      // （中断から戻っていない記録が抱えているもの）をここで消してはいけない。
      if (photo.kind === "staged" && stagedPhotoId) {
        // 印を外すのと前の Blob を消すのは1トランザクションで行う。別々に書くと、
        // 印だけ外れて Blob が残った時点で誰からも辿れない容量になり、
        // 逆に Blob だけ消えて印が残ると、掃除の保護対象が存在しない ID を指し続ける。
        try {
          // ここも記録の書き込みなので、焼成の実在と記録の版はこのトランザクションの
          // 中で確かめ直す（最初の書き込みのあとに別のタブで消された・変えられた
          // ことがある）。
          const settled: Piece = await commitPiece(
            {
              ...committed,
              pendingPhotoId: null,
              supersededPhotoId: replacingPhoto
                ? null
                : (committed.supersededPhotoId ?? null),
            },
            replacingPhoto && supersededPhotoId
              ? [
                  {
                    store: STORE_PHOTOS,
                    action: "delete" as const,
                    key: supersededPhotoId,
                  },
                ]
              : [],
            baseVersionRef.current,
          );
          settleCommitted(committed, settled);
          committed = settled;
          advanceBaseVersion(settled);
        } catch {
          // 巻き戻っている＝印も前の Blob もそのまま。記録は新しい写真を指していて正しいので
          // 保存の成功は取り消さない。新しい写真は書けているので、次に記録を読み込むときの
          // 復帰（recoverInterruptedReplacements）が印だけを外し、そこで前の Blob が
          // 参照の切れた写真として掃除で回収される。
          // 版の食い違い（別のタブがこの記録を消した・書き換えた）でもここは同じ扱いでよい。
          // 印を外すのはこの記録のためだけの後始末で、相手の変更に触れる必要はなく、
          // 記録ごと消えていれば写真は参照の切れた Blob として掃除が回収する。
        }
      } else {
        await discardPhoto(supersededPhotoId);
      }

      setSaved(record.code);
      setSaving(false);
      await reload();
      // ここまで来たら写真ごと確定している。次の保存で同じ記録を上書きしないよう外す。
      // 外すのは読み直しのあと。先に外すと、読み直しが終わるまでの一瞬だけ
      // 「この記録が見つかりません」と表示される（保存に成功した直後なのに事故に見える）。
      setSavedDraft(null);
      if (!editing) {
        // 続けて記録しやすいよう、新規のときだけ入力をたたむ。
        resetForNext();
      } else {
        // 編集を続けても二重保存にならないよう、いまの写真の状態に合わせ直す。
        beginPhotoOp();
        setPhoto(
          stagedPhotoId
            ? { kind: "existing", photoId: stagedPhotoId }
            : { kind: "none" },
        );
        setOriginalFile(null);
      }
    } catch (error) {
      setSaving(false);
      // 版の食い違いは「書けなかった」ではなく「書かずに止めた」。何も壊れていないので、
      // 何が起きていて次に何をすればよいかを、容量不足とは別の文言で伝える。
      const conflict = conflictOf(error);
      setSaveError(
        conflict === CONFLICT_MISSING
          ? "この記録は、ほかのタブ（またはウィンドウ）で削除されています。このまま保存すると、消したはずの記録が戻ってしまうため、保存を中止しました。入力内容はこの画面に残っています。残しておきたい場合は、内容を控えてから「＋ テストピース」で新しい記録として入れ直してください。"
          : conflict !== null
            ? "この記録は、ほかのタブ（またはウィンドウ）で変更されています。このまま保存するとその変更（写真の差し替えなど）が消えるため、保存を中止しました。入力内容はこの画面に残っています。ページを再読み込みして、最新の内容を確かめてから入れ直してください。"
            : (error as { quotaExceeded?: boolean })?.quotaExceeded
              ? "端末の空き容量が足りず保存できませんでした。入力内容はこの画面に残っています。書き出しや不要な記録の整理で空きを作ってからお試しください。"
              : "保存できませんでした。入力内容はこの画面に残っています。もう一度お試しください。",
      );
    }
  }

  /**
   * 参照されなくなった写真を消す。ここでの失敗は記録の正しさに影響しない
   * （残るのは孤立した Blob だけ）ので、保存の成功を取り消さない。
   *
   * ただし黙って諦めない。保存後のレコードは新しい写真しか指していないので、
   * ここで ID を手放すと二度とその Blob に辿り着けず、消せない容量になる。
   * 失敗したらレコードから参照を引き直して掃除する（記録に無い写真だけが消える）。
   */
  async function discardPhoto(photoId: string | null) {
    if (!photoId) return;
    try {
      await deletePhoto(photoId);
    } catch {
      try {
        await sweepOrphanPhotos();
      } catch {
        // 掃除も失敗した。記録は正しいままなので保存の成功は取り消さず、
        // 次に書き出し画面を開いたときの掃除に回す。
      }
    }
  }

  function resetForNext() {
    // 進行中の圧縮があれば無効にする（次の記録に前の写真が紛れ込まないように）。
    beginPhotoOp();
    // ここから先は次の記録。上書きではなく新規作成として書く。
    baseVersionRef.current = { mode: "create" };
    setCode("");
    setCodeTouched(false);
    setNote("");
    setResults([]);
    setCustomResult("");
    setJudgment(null);
    setPhoto({ kind: "none" });
    setOriginalFile(null);
    setColorMemo("");
    setSavedDraft(null);
  }

  async function handleDelete() {
    if (!editing) return;
    setDeleteError(null);
    try {
      // 記録本体と写真は1トランザクションで消す。別々に消すと、後半で失敗したときに
      // 「あるはずの写真を指したままの記録」や、誰からも参照されない Blob が残る。
      // 差し替えが途中で終わっていると、記録は前の写真の ID も抱えている。
      // 記録と一緒に消さないと、参照元が消えた時点で誰からも辿れない Blob になる。
      //
      // どの写真を消すかは、この画面が持っている写しではなく削除と同じトランザクションの
      // 中で引き直す（storage 側）。別のタブで写真が差し替えられていると、写しの ID は
      // 既に無い Blob を指していて、いま実在する Blob だけが誰からも辿れずに残る。
      await deletePieceWithPhotos(editing.id);
    } catch {
      // 巻き戻っているので、記録も写真もそのまま残っている。
      setDeleteError(
        "削除できませんでした。この記録も写真もそのまま残っています。もう一度お試しください。",
      );
      return;
    }
    dialogRef.current?.close();
    router.push("/");
  }

  const total = mixTotal(mix);

  // 編集で開いた記録を読み終えるまでフォームを出さない。
  // 出すと、読み込み前に打った内容をあとから走る読み込みが黙って上書きし、
  // その間の保存は editing が null のまま新しい ID を振って記録を二重にする。
  // （新規は読み込むものが無いので、そのまま書き始められる。）
  if (editId && state === "loading") {
    return (
      <>
        <div className="lintel">
          <p className="lintel__inner">
            <Link href="/">炉前</Link> / テストピース
          </p>
        </div>
        <main
          id="main"
          tabIndex={-1}
          className="section"
          aria-busy="true"
          style={{ maxWidth: 760 }}
        >
          <h1 className="t-h1">テストピースを編集</h1>
          <p className="muted t-small" style={{ marginTop: 16 }}>
            読み込んでいます…
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <div className="lintel">
        <p className="lintel__inner">
          <Link href="/">炉前</Link> / テストピース /{" "}
          {editing ? editing.code : "新規"}
        </p>
      </div>

      <main
        id="main"
        tabIndex={-1}
        className="section"
        style={{ maxWidth: 760 }}
      >
        <h1 className="t-h1">
          {editing ? "テストピースを編集" : "テストピースを記録"}
        </h1>

        {saved ? (
          <div className="notice" role="status" style={{ marginTop: 16 }}>
            <div className="notice__body">
              <strong>{saved} を保存しました。</strong>
              <div className="notice__actions">
                <Link className="btn btn--secondary btn--small" href="/">
                  窯を見る
                </Link>
                <Link
                  className="btn btn--secondary btn--small"
                  href="/compare/"
                >
                  並べて比べる
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        {saveError ? (
          <div
            className="notice notice--alert"
            role="alert"
            style={{ marginTop: 16 }}
          >
            <div className="notice__body">{saveError}</div>
          </div>
        ) : null}

        {quota ? (
          <QuotaPanel
            panelRef={quotaRef}
            usage={quota.usage}
            quota={quota.quota}
            outcome={quota.outcome}
            quotaExceeded={quota.quotaExceeded}
            canRetrySmaller={originalFile !== null}
            onRetrySmaller={() => void retrySmaller()}
            onDismiss={() => {
              // 記録は既に「前の写真」か「写真なし」で確定している。閉じるときに画面の
              // 写真もそこへ合わせる。合わせないと、警告を閉じただけで未保存の写真が
              // 画面に残り続け、次の普通の保存が取り下げたはずの差し替えをやり直す。
              // 参照を直せなかったとき（unsaved）は、記録がまだこの写真を指しているので
              // 手放さない。記録ごと消えたとき（gone）も、次の保存は新しい記録として
              // 書き直すので、選ばれた写真をここで捨てない（このボタンは警告を閉じるだけ）。
              if (quota.outcome !== "unsaved" && quota.outcome !== "gone")
                settlePhotoTo(quota.settledPhotoId);
              setQuota(null);
            }}
          />
        ) : null}

        {preflight ? (
          <QuotaPreflightPanel
            panelRef={preflightRef}
            usage={preflight.usage}
            quota={preflight.quota}
            bytes={preflight.bytes}
            canRetrySmaller={originalFile !== null}
            onRetrySmaller={() => void retrySmaller()}
            onProceed={() => void save(true)}
            onDismiss={() => setPreflight(null)}
          />
        ) : null}

        {/* 焼成が保存の途中で消えていた場合。黙って外すと、窯の断面にも棚にも
            出てこない記録になった理由が誰にも分からない。 */}
        {firingUnlinked ? (
          <div
            className="notice notice--alert"
            role="alert"
            style={{ marginTop: 16 }}
          >
            <div className="notice__body">
              紐付けようとしていた焼成が見つかりませんでした（別の画面や別のタブで削除された可能性があります）。この記録は焼成の紐付けなし・棚位置なしで保存しています。残す場合は焼成を選び直してから、もう一度保存してください。
            </div>
          </div>
        ) : null}

        {state === "unavailable" ? (
          <div
            className="notice notice--alert"
            role="alert"
            style={{ marginTop: 16 }}
          >
            <div className="notice__body">
              この端末のブラウザでは記録を保存できません。プライベートウィンドウでは保存が制限されることがあります。通常のウィンドウで開き直してください。
            </div>
          </div>
        ) : null}

        {state === "error" ? (
          <div
            className="notice notice--alert"
            role="alert"
            style={{ marginTop: 16 }}
          >
            <div className="notice__body">
              保存済みの記録を読み込めませんでした。既存の記録は消えていませんが、この画面では
              焼成の選択・識別番号の自動採番・編集内容の読み込みができません。ページを再読み込みしてください。
            </div>
          </div>
        ) : null}

        {/* 記録は読めている。そのうえで、開こうとした記録だけが無い。
            黙って新規の入力欄として使わせると、保存が「上書き」ではなく「別の記録の作成」になる。 */}
        {editRecordMissing ? (
          <div
            className="notice notice--alert"
            role="alert"
            style={{ marginTop: 16 }}
          >
            <div className="notice__body">
              <strong>この記録が見つかりません。</strong>
              <p className="t-small" style={{ marginTop: 4 }}>
                削除されたか、リンクが古い可能性があります。入力中の内容はこの画面に残していますが、
                このまま保存すると別の記録が新しくできてしまうため、保存はできません。
              </p>
              <div className="notice__actions">
                <Link className="btn btn--secondary btn--small" href="/">
                  窯を見る
                </Link>
                <Link
                  className="btn btn--secondary btn--small"
                  href="/pieces/new/"
                >
                  新しく記録する
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate>
          <p className="t-small muted" style={{ marginTop: 16 }}>
            <span aria-hidden="true">*</span>{" "}
            は必須です。写真・配合・焼成・結果は空のままでも保存できます。
          </p>

          {/* ── 識別番号 ───────────────────────────── */}
          <div className="field">
            <label className="field__label" htmlFor="code">
              識別番号 <span aria-hidden="true">*</span>
            </label>
            <input
              id="code"
              className="input input--num"
              style={{ textAlign: "left" }}
              value={code}
              onChange={(e) => {
                setCodeTouched(true);
                setCode(e.target.value);
              }}
              aria-invalid={errors.code ? "true" : undefined}
              aria-describedby={errors.code ? "code-error" : "code-hint"}
              autoComplete="off"
              required
            />
            {errors.code ? (
              <p className="field__error" id="code-error">
                {errors.code}
              </p>
            ) : (
              <p className="field__hint" id="code-hint">
                自分がタイルに書いた番号をそのまま。空欄なら自動で振ります。
              </p>
            )}
          </div>

          {/* ── 調合 ───────────────────────────────── */}
          <section className="form-block">
            <h2 className="t-h2">調合</h2>

            <div className="field">
              <label className="field__label" htmlFor="recipe">
                調合名
              </label>
              <input
                id="recipe"
                className="input"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                list="recipe-list"
                autoComplete="off"
              />
              <datalist id="recipe-list">
                {recipeSuggestions.map((r) => (
                  <option value={r} key={r} />
                ))}
              </datalist>
              <p className="field__hint">
                同じ調合名でも、配合が同じものどうしが「比較」で自動的に並びます。
              </p>
            </div>

            <div className="mix-rail" style={{ marginTop: 16 }}>
              {mix.map((row, i) => (
                <div className="mix-row" key={i}>
                  <div className="mix-row__material">
                    <label
                      className="visually-hidden"
                      htmlFor={`material-${i}`}
                    >
                      {i + 1} 行目の材料名
                    </label>
                    <input
                      id={`material-${i}`}
                      className="input"
                      value={row.material}
                      onChange={(e) =>
                        updateMixRow(i, { material: e.target.value })
                      }
                      list="material-list"
                      placeholder="長石"
                      autoComplete="off"
                    />
                  </div>
                  <div className="mix-row__parts">
                    <label className="visually-hidden" htmlFor={`parts-${i}`}>
                      {i + 1} 行目の部数
                    </label>
                    <input
                      id={`parts-${i}`}
                      className="input input--num"
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      value={row.partsText}
                      onChange={(e) =>
                        updateMixRow(i, {
                          partsText: e.target.value,
                          parts: parsePartsInput(e.target.value),
                        })
                      }
                      // 打ち終わったら、保存される値そのものに揃える。
                      // 保存できない入力（負数など）を欄に残すと、画面の値と保存される値が食い違う。
                      onBlur={() =>
                        updateMixRow(i, {
                          partsText: formatPartsInput(row.parts),
                        })
                      }
                      autoComplete="off"
                    />
                  </div>
                  <span className="mix-row__percent num">
                    {total > 0 && row.parts
                      ? `${((row.parts / total) * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                  <button
                    type="button"
                    className="mix-row__remove"
                    onClick={() =>
                      setMix((rows) =>
                        rows.length > 1 ? rows.filter((_, j) => j !== i) : rows,
                      )
                    }
                    aria-label={`${row.material || `${i + 1} 行目`} を削除`}
                  >
                    ×
                  </button>
                  <label className="mix-row__colorant">
                    <input
                      type="checkbox"
                      checked={row.colorant}
                      onChange={(e) =>
                        updateMixRow(i, {
                          colorant: e.target.checked,
                          // 以後この行は推定で上書きしない（選択が確定した）。
                          colorantTouched: true,
                        })
                      }
                    />
                    着色材
                  </label>
                </div>
              ))}

              <datalist id="material-list">
                {materialSuggestions.map((m) => (
                  <option value={m} key={m} />
                ))}
              </datalist>

              <div className="mix-foot">
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={() => setMix((rows) => [...rows, { ...EMPTY_ROW }])}
                >
                  ＋ 材料を追加
                </button>
                <span className="list__spacer" />
                <span className="t-small muted num">合計 {total || 0}</span>
              </div>
            </div>

            {total > 0 ? (
              <div style={{ marginTop: 12 }}>
                <MixBar mix={mix} />
              </div>
            ) : null}
            <p className="field__hint">
              部数のままで大丈夫です。合計が 100 でなくても問題ありません。
            </p>
          </section>

          {/* ── 焼成と位置 ─────────────────────────── */}
          <section className="form-block">
            <h2 className="t-h2">焼成と位置</h2>

            <div className="field">
              <label className="field__label" htmlFor="firing">
                焼成
              </label>
              <select
                id="firing"
                className="select"
                value={firingId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setFiringId(nextId);
                  setMissingFiring(false);
                  // 段数の少ない焼成に変えると、いまの棚位置がその窯に存在しなくなる。
                  // 残したまま保存すると、どの棚にも描かれない＝画面から消えた記録になる。
                  //
                  // 「選ばない」に戻したときも同じく外す。棚位置は焼成の中の位置なので、
                  // 焼成が無ければどの窯の棚でもない。未選択のときの段数は表示用の既定値
                  // （3段）でしかないので、それを根拠に棚位置を残すと、どこにも描かれない
                  // 棚位置が保存され、書き出しにもその棚だけが出る。
                  setShelf((prev) =>
                    nextId && isShelfInRange(prev, shelfCountOf(nextId))
                      ? prev
                      : null,
                  );
                }}
              >
                <option value="">選ばない（あとで紐付ける）</option>
                {sortedFirings.map((f, i) => (
                  <option value={f.id} key={f.id}>
                    {firingOptions[i] ?? firingLabel(f)}
                  </option>
                ))}
              </select>
              {/* 紐付いていた焼成が消えている場合は、黙って外さず理由を出す
                  （選択欄は「選ばない」に見えるので、伝えないと外れた事実に気付けない）。 */}
              {missingFiring ? (
                <p className="field__error">
                  この記録が紐付いていた焼成が見つかりません（削除された可能性があります）。このまま保存すると焼成の紐付けなしになります。
                </p>
              ) : null}
              <p className="field__hint">
                焼成が未選択でも保存できます。{" "}
                <Link href="/firings/">焼成を新しく作る</Link>
              </p>
            </div>

            <div className="field">
              <span className="field__label" id="shelf-label">
                棚位置
              </span>
              {/* 焼成が未選択のときは棚を選ばせない。棚位置は焼成の中の位置なので、
                  焼成なしの棚は「どの窯の棚でもない」ことになり、窯の断面にも出ないまま
                  記録と書き出しにだけ残る。選べる形で出すと、保存されない（外される）値を
                  選ばせることになるので、選択肢そのものを出さない。 */}
              {!firingId ? (
                <>
                  <p className="field__hint">
                    棚位置は焼成の中の位置です。上で焼成を選ぶと、その窯の段から選べます。
                  </p>
                  {shelf !== null ? (
                    <p className="field__error">
                      この記録に残っている「棚 {shelf}
                      」は、焼成の紐付けが無いため保存時に外れます。棚位置を残すなら、先に焼成を選んでください。
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  {/* ドロップダウンではなく窯の断面のミニチュアで選ぶ。トップ画面と同じ形。 */}
                  <div
                    className="shelf-picker"
                    role="radiogroup"
                    aria-labelledby="shelf-label"
                  >
                    {/* 保存済みの棚位置がこの焼成に無い段だったときも、選択状態を隠さずに見せる。
                        （焼成の段数を後から減らすと起こる。見せないと直しようがない） */}
                    {shelf !== null && !isShelfInRange(shelf, shelfCount) ? (
                      <label className="shelf-picker__row">
                        <input type="radio" name="shelf" checked readOnly />棚{" "}
                        {shelf}
                        <span className="t-small muted">
                          この焼成には無い段です
                        </span>
                      </label>
                    ) : null}
                    {shelvesTopDown(shelfCount).map((n) => (
                      <label className="shelf-picker__row" key={n}>
                        <input
                          type="radio"
                          name="shelf"
                          value={n}
                          checked={shelf === n}
                          onChange={() => setShelf(n)}
                        />
                        棚 {n}
                        <span className="t-small muted">
                          {shelfSubLabel(n, shelfCount)}
                        </span>
                      </label>
                    ))}
                    <label className="shelf-picker__row">
                      <input
                        type="radio"
                        name="shelf"
                        checked={shelf === null}
                        onChange={() => setShelf(null)}
                      />
                      指定しない
                    </label>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ── 結果 ───────────────────────────────── */}
          <section className="form-block">
            <h2 className="t-h2">結果</h2>
            <p className="field__hint" style={{ marginTop: 0 }}>
              うまくいかなかったことも、そのまま記録として残します。いくつでも、ゼロでも構いません。
            </p>

            <div className="tags" style={{ marginTop: 12 }}>
              {RESULT_TAGS.map((tag) => (
                <label className="tag" key={tag}>
                  <input
                    type="checkbox"
                    checked={results.includes(tag)}
                    onChange={(e) =>
                      setResults((prev) =>
                        e.target.checked
                          ? [...prev, tag]
                          : prev.filter((t) => t !== tag),
                      )
                    }
                  />
                  <span className="tag__swatch" aria-hidden="true" />
                  {tag}
                </label>
              ))}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="custom-result">
                そのほか（自由入力）
              </label>
              <input
                id="custom-result"
                className="input"
                value={customResult}
                onChange={(e) => setCustomResult(e.target.value)}
                aria-describedby="custom-result-hint"
                autoComplete="off"
              />
              <p className="field__hint" id="custom-result-hint">
                いくつも書くときは <span className="num">・</span>{" "}
                で区切ります。
              </p>
            </div>

            <div className="field">
              <span className="field__label" id="judgment-label">
                判断
              </span>
              <div
                className="segments"
                role="radiogroup"
                aria-labelledby="judgment-label"
              >
                {JUDGMENTS.map((j) => (
                  <label className="segment" key={j.value}>
                    <input
                      type="radio"
                      name="judgment"
                      checked={judgment === j.value}
                      onChange={() => setJudgment(j.value)}
                    />
                    {j.label}
                  </label>
                ))}
                {/* 判断は任意（記録は判断が付かないまま残せる）。3択だけを出すと、
                    一度選んだあとは未選択に戻す操作がラジオボタンに無いため、
                    誤って付けた判断も、あとで意味を失った判断も外せなくなる。
                    棚位置と同じく「指定しない」を明示的な選択肢として出す。 */}
                <label className="segment">
                  <input
                    type="radio"
                    name="judgment"
                    checked={judgment === null}
                    onChange={() => setJudgment(null)}
                  />
                  指定しない
                </label>
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="note">
                所見 <span aria-hidden="true">*</span>
              </label>
              <textarea
                id="note"
                className="textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                aria-invalid={errors.note ? "true" : undefined}
                aria-describedby={errors.note ? "note-error" : "note-count"}
                required
              />
              {errors.note ? (
                <p className="field__error" id="note-error">
                  {errors.note}
                </p>
              ) : (
                <p className="field__hint num" id="note-count">
                  {note.length} / 2000
                </p>
              )}
            </div>
          </section>

          {/* ── 発色 ───────────────────────────────── */}
          <section className="form-block">
            <h2 className="t-h2">発色</h2>

            <div
              className="row-gap"
              style={{ marginTop: 16, alignItems: "flex-start" }}
            >
              <div>
                {photo.kind === "existing" ? (
                  <PhotoImage
                    className="swatch swatch--md"
                    photoId={photo.photoId}
                    alt="登録済みの発色写真"
                  />
                ) : photo.kind === "staged" ? (
                  <StagedPreview blob={photo.blob} />
                ) : photo.kind === "compressing" ? (
                  <span className="swatch swatch--md swatch--none">
                    圧縮中…
                  </span>
                ) : colorMemo ? (
                  <span
                    className="swatch swatch--md"
                    style={{ background: colorMemo }}
                  />
                ) : (
                  <span className="swatch swatch--md swatch--none">
                    写真なし
                  </span>
                )}
              </div>

              <div className="stack-8" style={{ flex: "1 1 240px" }}>
                <label className="field__label" htmlFor="photo">
                  写真を選ぶ
                </label>
                <input
                  id="photo"
                  ref={photoInputRef}
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handlePhotoChange(e.target.files?.[0])}
                />
                <p className="field__hint">
                  長辺 1024px・品質 70%
                  に自動で圧縮してから、この端末の中に保存します。
                </p>
                {photo.kind === "staged" ? (
                  <p className="field__hint" role="status">
                    {formatBytes(photo.originalBytes)} →{" "}
                    {formatBytes(photo.bytes)} に圧縮しました。
                  </p>
                ) : null}
                {photo.kind !== "none" ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    onClick={removePhoto}
                  >
                    写真を外す
                  </button>
                ) : null}
              </div>
            </div>

            {photo.kind === "none" ? (
              <div className="field">
                <span className="field__label" id="color-memo-label">
                  または 色メモ
                </span>
                {/* 色そのものは「付ける」を選んだときだけ保存する。
                    チェックを外した状態で色見本だけを見せると、画面の色と保存される値が
                    食い違う（既定色をそのまま選べない・選んだつもりで空になる）。 */}
                <label
                  className="mix-row__colorant"
                  style={{ marginTop: 8, marginBottom: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={colorMemo !== ""}
                    onChange={(e) =>
                      setColorMemo(e.target.checked ? DEFAULT_COLOR_MEMO : "")
                    }
                  />
                  色を記録する
                </label>
                <input
                  id="color-memo"
                  type="color"
                  aria-labelledby="color-memo-label"
                  value={colorMemo || DEFAULT_COLOR_MEMO}
                  onChange={(e) => setColorMemo(e.target.value)}
                  style={{ width: 64, height: 44, padding: 2 }}
                />
                <p className="field__hint">
                  写真がなくても、だいたいの色を置いておけます。
                  「色を記録する」に印を付けると、表示している色がそのまま保存されます（色を選び直しても付きます）。
                </p>
              </div>
            ) : null}
          </section>

          <div className="row-gap" style={{ marginTop: 32 }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={
                saving || photo.kind === "compressing" || editLoadBlocked
              }
              aria-busy={saving}
            >
              {saving
                ? "保存しています…"
                : photo.kind === "compressing"
                  ? "写真を処理しています…"
                  : editRecordMissing
                    ? "記録が見つかりません"
                    : editLoadBlocked
                      ? "記録を読み込めていません"
                      : "保存する"}
            </button>
            <Link className="btn btn--secondary" href="/">
              キャンセル
            </Link>
            <span className="list__spacer" />
            {editing ? (
              <button
                type="button"
                className="btn btn--danger btn--small"
                onClick={() => dialogRef.current?.showModal()}
              >
                削除
              </button>
            ) : null}
          </div>
          <p className="t-small muted" style={{ marginTop: 8 }}>
            この記録は端末内にのみ保存されます。
          </p>
        </form>
      </main>

      <dialog ref={dialogRef}>
        <h2 className="t-h2">{editing?.code} を削除します</h2>
        <p style={{ marginTop: 12 }}>写真も一緒に消え、元に戻せません。</p>
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

function StagedPreview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  if (!url) return <span className="swatch swatch--md swatch--none" />;
  return (
    // 端末内で作った object URL なので next/image の最適化は通せない。
    // eslint-disable-next-line @next/next/no-img-element
    <img className="swatch swatch--md" src={url} alt="選んだ写真のプレビュー" />
  );
}

type QuotaPreflightPanelProps = {
  usage: number;
  quota: number;
  /** これから書こうとしている写真の大きさ。 */
  bytes: number;
  canRetrySmaller: boolean;
  onRetrySmaller: () => void;
  onProceed: () => void;
  onDismiss: () => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * 写真を書く前の警告。まだ何も書いていないので、そのことを最初に言い切る。
 *
 * 空きを使い切ってから知らせると、「もっと小さくして再試行」は残りの空きが無い状態で
 * しか選べない（差し替えなら、その1回で前の写真も危うくなる）。書く前に選ばせる。
 * 見立ては見立てでしかないので、そのまま進む道も必ず残す。
 */
function QuotaPreflightPanel({
  usage,
  quota,
  bytes,
  canRetrySmaller,
  onRetrySmaller,
  onProceed,
  onDismiss,
  panelRef,
}: QuotaPreflightPanelProps) {
  return (
    <div
      className="notice notice--alert"
      role="alert"
      tabIndex={-1}
      ref={panelRef}
      style={{ marginTop: 16, display: "block" }}
    >
      <strong>この写真を入れると空き容量がほとんど残りません</strong>
      <p className="t-small" style={{ marginTop: 8 }}>
        まだ何も保存していません。写真を小さく作り直すか、書き出して整理してから
        保存すると、この端末の記録が自動削除されにくくなります。
      </p>
      <p className="t-small num" style={{ marginTop: 8 }}>
        使用中 {formatBytes(usage)} / {formatBytes(quota)}（この写真{" "}
        {formatBytes(bytes)}）
      </p>
      <div className="notice__actions">
        {canRetrySmaller ? (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={onRetrySmaller}
          >
            もっと小さくして再試行（長辺 720px・品質 60%）
          </button>
        ) : null}
        <Link className="btn btn--secondary btn--small" href="/export/">
          書き出して整理する
        </Link>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => void requestPersistence()}
        >
          保存領域を確保する
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={onProceed}
        >
          このまま保存する
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={onDismiss}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

type QuotaPanelProps = {
  usage: number | null;
  quota: number | null;
  /** 保存が終わった時点で、この記録の写真がどうなったか。 */
  outcome: PhotoOutcome;
  /** 容量不足だったか。違う原因を容量不足と言い切らないために持つ。 */
  quotaExceeded: boolean;
  canRetrySmaller: boolean;
  onRetrySmaller: () => void;
  onDismiss: () => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
};

/** 記録の写真がどうなったかの説明。書いてあることと記録の中身を一致させる。 */
const OUTCOME_BODY: Record<PhotoOutcome, string> = {
  kept: "記録そのものは保存済みです。新しい写真は入らなかったので、前の写真をそのまま残しています。",
  "kept-unverified":
    "記録そのものは保存済みです。新しい写真は入らなかったので、記録は前の写真を指したままにしています。",
  none: "記録そのものは保存済みです。写真だけが付いていない状態です。",
  unsaved:
    "記録そのものは保存済みですが、この記録は保存できなかった写真を指したままです。空きを作ってから、もう一度保存してください。",
  gone: "この記録は保存の途中でほかのタブ（またはウィンドウ）から削除されたため、記録そのものも残っていません。入力内容はこの画面に残っていますので、必要なら控えてから保存し直してください。",
};

/**
 * 閉じるボタンの文言。押した結果とそのまま一致させる
 * （「前の写真のまま進める」なら、閉じたあとの画面は前の写真になっている）。
 */
const OUTCOME_DISMISS: Record<PhotoOutcome, string> = {
  kept: "前の写真のまま進める",
  "kept-unverified": "前の写真のまま進める",
  none: "写真なしのまま進める",
  unsaved: "閉じる",
  gone: "閉じる",
};

/**
 * 容量不足。記録本体は既に保存済みなので、まずそれを伝える。
 * 「もう一度お試しください」で終わらせず、次に取れる手を具体的な数値で出す。
 */
function QuotaPanel({
  usage,
  quota,
  outcome,
  quotaExceeded,
  canRetrySmaller,
  onRetrySmaller,
  onDismiss,
  panelRef,
}: QuotaPanelProps) {
  return (
    <div
      className="notice notice--alert"
      role="alert"
      tabIndex={-1}
      ref={panelRef}
      style={{ marginTop: 16, display: "block" }}
    >
      <strong>
        写真を保存できませんでした
        {quotaExceeded ? "（端末の空き容量が不足）" : ""}
      </strong>
      <p className="t-small" style={{ marginTop: 8 }}>
        {OUTCOME_BODY[outcome]}
      </p>
      {usage !== null && quota !== null ? (
        <p className="t-small num" style={{ marginTop: 8 }}>
          使用中 {formatBytes(usage)} / {formatBytes(quota)}
        </p>
      ) : (
        <p className="t-small" style={{ marginTop: 8 }}>
          この端末では空き容量を取得できません。
        </p>
      )}
      <div className="notice__actions">
        {canRetrySmaller ? (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={onRetrySmaller}
          >
            もっと小さくして再試行（長辺 720px・品質 60%）
          </button>
        ) : null}
        <Link className="btn btn--secondary btn--small" href="/export/">
          書き出して整理する
        </Link>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => void requestPersistence()}
        >
          保存領域を確保する
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={onDismiss}
        >
          {OUTCOME_DISMISS[outcome]}
        </button>
      </div>
      <p className="t-small muted" style={{ marginTop: 8 }}>
        「保存領域を確保する」を押すと、ブラウザに保存の許可を求めます。許可するとこの端末の記録が自動削除されにくくなります。
      </p>
    </div>
  );
}
