// storage.mjs — 端末内保存（IndexedDB）と容量まわり。
//
// 設計上の約束（崩すと製品価値が消える）:
//   1. 書き込み順は「記録本体 → 写真 Blob」。逆にすると容量不足で所見まで失われる。
//   2. 写真の保存に失敗しても記録本体は残す。失敗は写真だけの失敗として扱う。
//   3. 空き容量が取れない環境では推定値を出さない（バーごと出さない）。
//   4. 書き込みの成否は「トランザクションが complete したか」で判定する。
//      個々の put/delete が成功しても、その後に abort（容量不足・I/O 失敗）されれば
//      内容は巻き戻る。request の成功で解決すると「保存しました」と嘘をつくことになる。
//   5. 「まとめて成立させないと記録が壊れる」書き込みは1トランザクションに入れる
//      （テストピースなら commitPiece の後始末として渡す）。1件ずつ書くと、
//      途中で失敗したときに前半だけが確定して残り、画面には「変わっていません」と
//      出すことになる（嘘の報告）。
//   6. 「どの記録が対象か」を画面が持っている一覧から決めない。対象の抽出は書き込みと
//      同じトランザクションの中で引き直す。画面の一覧は開いた時点の写しで、別のタブで
//      追加・付け替え・差し替えされた分が入っていない（変更の通知はそのタブ内にしか届かない）。
//   7. 「まだ消してはいけない」写真はレコード側に印（supersededPhotoId）を残す。
//      写真の差し替え中は前の Blob がどの photoId からも指されない時間ができるので、
//      印が無いと孤児の掃除（別タブでも走る）に消され、差し替えの失敗から戻れなくなる。
//   8. 「まだ書けていない」写真もレコード側に印（pendingPhotoId）を残す。記録を先に書く
//      以上、記録が実在しない Blob を指す時間が必ずできる。印が無いと、その状態が
//      「保存が進行中」なのか「中断して二度と書かれない」のかを後から区別できず、
//      写真を初めて付ける保存が中断した記録は永久に存在しない写真を指したままになる。
//   9. テストピースの焼成への紐付けは、書き込みと同じトランザクションの中で実在を
//      確かめてから書く（約束 6 の、書き込む側から見た形）。画面が持っている焼成の一覧は
//      開いた時点の写しで、別のタブで消された焼成もそのまま残っている。確かめずに書くと、
//      焼成の削除で外したはずの紐付けと棚位置が、開いたままの編集画面の保存で復活する。
//  10. 既にある記録への上書きは、「読んだときの版がいまも在るか」を書き込みと同じ
//      トランザクションの中で確かめてから書く（commitPiece / commitRecord）。画面が持って
//      いる記録は開いた時点の写しで、別のタブの削除も変更も届かない。確かめずに書くと、
//      消した記録が編集画面の保存で復活し（写真の紐付けまで巻き戻る）、別のタブの変更は
//      黙って消える。新規作成は逆に「まだ無い」ことを確かめる。
//      版が食い違ったら書かずに止める（conflict 付きのエラーを投げる）。ここで勝手に
//      混ぜると、どちらの入力も残らない3つ目の内容ができる。
//
// 記録はすべてこの端末の中だけにある。外部へ送信する経路をここに作らないこと。

const DB_NAME = "kama-log";
const DB_VERSION = 1;
export const STORE_PIECES = "pieces";
export const STORE_FIRINGS = "firings";
export const STORE_PHOTOS = "photos";

/** 圧縮の既定。長辺 1024・品質 0.7。 */
export const DEFAULT_COMPRESSION = { maxEdge: 1024, quality: 0.7 };
/** 容量不足時の再試行。より小さく、より粗く。 */
export const RETRY_COMPRESSION = { maxEdge: 720, quality: 0.6 };

/**
 * この環境で保存できるか。プライベートウィンドウ等で indexedDB が無い場合がある。
 * @returns {boolean}
 */
export function isStorageAvailable() {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

/**
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    if (!isStorageAvailable()) {
      reject(new Error("indexeddb-unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PIECES)) {
        db.createObjectStore(STORE_PIECES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_FIRINGS)) {
        db.createObjectStore(STORE_FIRINGS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        // 写真は Blob をそのまま置く。keyPath を持たせず put(blob, id) で入れる。
        db.createObjectStore(STORE_PHOTOS);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb-open-failed"));
  });
}

/**
 * 読み出し用。読みは巻き戻っても失うものが無いので request の成功で解決してよい。
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb-request-failed"));
  });
}

/**
 * 書き込み用。トランザクションが complete するまで解決しない（約束 4）。
 * abort / error では、原因が分かるなら request のエラーを優先して投げる。
 *
 * テストから直接呼べるよう export している（IndexedDB 本体は node では動かないため、
 * 偽の db を渡して「put 成功のあと abort」でも解決しないことを確かめる）。
 *
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {(store: IDBObjectStore) => IDBRequest} run
 * @returns {Promise<void>}
 */
export function runWrite(db, storeName, run) {
  return new Promise((resolve, reject) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      tx = db.transaction(storeName, "readwrite");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("indexeddb-transaction-failed"));
      return;
    }
    /** @type {unknown} */
    let failure = null;
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error("indexeddb-transaction-aborted"));
    tx.onerror = () => {
      // abort が続けて発火するので、ここでは原因の記録だけに留める。
      failure = failure ?? tx.error;
    };
    try {
      const request = run(tx.objectStore(storeName));
      // preventDefault しない＝この失敗はそのままトランザクションを abort させる。
      request.onerror = () => {
        failure = request.error ?? failure;
      };
    } catch (error) {
      // put 呼び出し自体が同期的に投げた場合（構造化複製できない値など）。
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error instanceof Error ? error : new Error("indexeddb-write-failed"));
      }
    }
  });
}

/**
 * @typedef {object} WriteOperation
 * @property {string} store
 * @property {"put" | "delete"} action
 * @property {any} [value] put する値
 * @property {string} [key]  delete するキー / keyPath を持たないストアへの put のキー
 */

/**
 * 書き込み操作を1つ、開いているトランザクションに出す。
 * 出し方（keyPath の有無による put の呼び分け）を1か所に持つ。
 * @param {IDBTransaction} tx
 * @param {WriteOperation} operation
 * @returns {IDBRequest}
 */
function applyOperation(tx, operation) {
  const store = tx.objectStore(operation.store);
  if (operation.action === "delete") return store.delete(operation.key);
  return operation.key === undefined
    ? store.put(operation.value)
    : store.put(operation.value, operation.key);
}

// ---------------------------------------------------------------------------
// 版の確認（約束 10）
// ---------------------------------------------------------------------------

/** 上書きしようとした記録が、もう無い。 */
export const CONFLICT_MISSING = "record-missing";
/** 上書きしようとした記録が、読んだときから変わっている（新規のはずが既に在る場合も含む）。 */
export const CONFLICT_CHANGED = "record-changed";

/**
 * 版の食い違いで書き込みを止めたことを示すエラー。
 * 容量不足（asQuotaError）と同じく、呼び出し側が文言を選べるよう種別を付ける。
 * @param {"record-missing" | "record-changed"} kind
 * @returns {Error & { conflict: string }}
 */
export function conflictError(kind) {
  const error = /** @type {Error & { conflict: string }} */ (new Error(kind));
  error.conflict = kind;
  return error;
}

/**
 * そのエラーが版の食い違いなら種別を返す。違えば null。
 * @param {unknown} error
 * @returns {"record-missing" | "record-changed" | null}
 */
export function conflictOf(error) {
  const kind = /** @type {{ conflict?: string }} */ (error)?.conflict ?? null;
  if (kind === CONFLICT_MISSING) return CONFLICT_MISSING;
  if (kind === CONFLICT_CHANGED) return CONFLICT_CHANGED;
  return null;
}

/**
 * 書き込みが前提にしている記録の状態。
 *   create … まだ無いはず（新規作成）
 *   update … 読んだ版が在るはず。updatedAt を渡せばその版であることまで確かめる
 *            （渡せないとき＝版が分からない記録では、実在だけを確かめる）
 * @typedef {{ mode: "create" } | { mode: "update", updatedAt?: string | null }} WriteExpectation
 */

/** 新規作成の前提（まだ無いはず）。 */
export const EXPECT_CREATE = /** @type {WriteExpectation} */ ({ mode: "create" });

/**
 * いまストアに在る記録と、書き込みが前提にしている状態を突き合わせる（純関数）。
 *
 * 画面が持っている記録は開いた時点の写しでしかない。別のタブで消された記録を
 * そのまま書けば消したはずの記録が復活し、別のタブで変わった記録をそのまま書けば
 * そちらの変更（写真の差し替えなど）が黙って消える。
 * @param {any} stored いまストアに在る記録（無ければ undefined / null）
 * @param {WriteExpectation} [expectation]
 * @returns {"record-missing" | "record-changed" | null} 食い違いの種別。無ければ null
 */
export function expectationConflict(stored, expectation) {
  const mode = expectation?.mode ?? "create";
  if (mode === "create") return stored ? CONFLICT_CHANGED : null;
  if (!stored) return CONFLICT_MISSING;
  const expected =
    /** @type {{ updatedAt?: string | null }} */ (expectation)?.updatedAt ?? null;
  // 版が分からない記録（updatedAt を持たない古い記録）では実在だけを確かめる。
  // ここで弾くと、その記録が二度と編集できなくなる。
  if (expected === null) return null;
  return (stored.updatedAt ?? null) === expected ? null : CONFLICT_CHANGED;
}

/**
 * 保存しようとしているテストピースを、いま実在する焼成に合わせて正す（純関数）。
 *
 * 棚位置は焼成の中の位置なので、紐付け先が無くなれば一緒に外す
 * （unlinkFiringFromPieces＝焼成を消す側と同じ扱い）。
 * @param {any} piece
 * @param {boolean} firingExists 紐付け先の焼成がいま実在するか
 * @returns {any} 実際に書く記録（直す必要が無ければ元のまま）
 */
export function reconcilePieceFiring(piece, firingExists) {
  if (!piece || !piece.firingId || firingExists) return piece;
  return { ...piece, firingId: null, shelf: null };
}

/**
 * テストピースを、紐付け先の焼成の実在を同じトランザクションで確かめてから書く（約束 9）。
 *
 * 編集画面は開いた時点の焼成の一覧を持ち続ける（別のタブの削除は届かない）。確かめずに
 * 書くと、削除で外したはずの紐付けと棚位置が、開いたままの画面の保存で復活する
 * （どの窯の断面にも描かれない記録＝画面から消えた記録になる）。
 *
 * 記録そのものの版も同じトランザクションの中で確かめる（約束 10）。編集画面が持って
 * いるのは開いた時点の写しなので、確かめずに書くと、別のタブで消された記録が復活し、
 * 別のタブで差し替えられた写真の参照が古い ID に巻き戻る（巻き戻ると、新しい写真は
 * どの記録からも指されない Blob になって掃除に消える）。
 *
 * 焼成の削除（runDeleteFiring）と同じ2ストアの readwrite なので、両者が同時に走っても
 * ブラウザが直列化する。削除が先ならここで紐付けが外れ、ここが先なら削除側の数え直しが
 * この記録を拾う。どちらの順でも、消えた焼成を指したままの記録は残らない。
 *
 * 写真の後始末など、まとめて成立させたい操作も同じトランザクションに入れられる。
 *
 * テストから直接呼べるよう export している（IndexedDB 本体は node では動かない）。
 * @param {IDBDatabase} db
 * @param {string[]} storeNames
 * @param {any} piece
 * @param {WriteOperation[]} [operations]
 * @param {WriteExpectation} [expectation] 書き込みが前提にしている記録の状態
 * @returns {Promise<any>} 実際に書かれた記録
 */
export function runCommitPiece(db, storeNames, piece, operations = [], expectation = EXPECT_CREATE) {
  return new Promise((resolve, reject) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      tx = db.transaction(storeNames, "readwrite");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("indexeddb-transaction-failed"));
      return;
    }
    /** @type {unknown} */
    let failure = null;
    let written = piece;
    tx.oncomplete = () => resolve(written);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("indexeddb-transaction-aborted"));
    tx.onerror = () => {
      failure = failure ?? tx.error;
    };
    try {
      const pieces = tx.objectStore(STORE_PIECES);
      const commit = (/** @type {boolean} */ firingExists) => {
        written = reconcilePieceFiring(piece, firingExists);
        const request = pieces.put(written);
        request.onerror = () => {
          failure = request.error ?? failure;
        };
        for (const operation of operations ?? []) {
          const extra = applyOperation(tx, operation);
          extra.onerror = () => {
            failure = extra.error ?? failure;
          };
        }
      };
      const commitWithFiringCheck = () => {
        if (!piece?.firingId) {
          commit(true);
          return;
        }
        // 実在を確かめられなかったとき（読み出しの失敗）はトランザクションごと巻き戻る。
        // 「確かめられなかったから紐付けたまま書く」にはしない（それが約束 9 の穴になる）。
        const lookup = tx.objectStore(STORE_FIRINGS).get(piece.firingId);
        lookup.onerror = () => {
          failure = lookup.error ?? failure;
        };
        lookup.onsuccess = () => commit(Boolean(lookup.result));
      };
      // 先に版を確かめる（約束 10）。食い違っていれば1つも書かずに巻き戻す。
      const current = pieces.get(piece?.id);
      current.onerror = () => {
        failure = current.error ?? failure;
      };
      current.onsuccess = () => {
        const conflict = expectationConflict(current.result, expectation);
        if (conflict) {
          failure = conflictError(conflict);
          tx.abort();
          return;
        }
        commitWithFiringCheck();
      };
    } catch (error) {
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error instanceof Error ? error : new Error("indexeddb-write-failed"));
      }
    }
  });
}

/**
 * テストピースの保存。紐付け先の焼成の実在と、記録そのものの版を
 * 同じトランザクションで確かめる。
 * @param {any} piece
 * @param {WriteOperation[]} [operations] 同じトランザクションに入れる後始末
 * @param {WriteExpectation} [expectation] 書き込みが前提にしている記録の状態
 * @returns {Promise<any>} 実際に書かれた記録（紐付けが外れていれば外れた形で返る）
 */
export async function commitPiece(piece, operations = [], expectation = EXPECT_CREATE) {
  const ops = (operations ?? []).filter(Boolean);
  const storeNames = [
    ...new Set([STORE_PIECES, STORE_FIRINGS, ...ops.map((op) => op.store)]),
  ];
  const db = await openDb();
  /** @type {any} */
  let written;
  try {
    written = await runCommitPiece(db, storeNames, piece, ops, expectation);
  } catch (error) {
    throw asQuotaError(error);
  } finally {
    db.close();
  }
  notifyStorageChanged();
  return written;
}

/**
 * 記録（焼成など）を、版を同じトランザクションの中で確かめてから書く（約束 10）。
 *
 * 編集画面が持っている記録は開いた時点の写しでしかない。確かめずに書くと、
 * 別のタブで消された焼成が保存で復活する。しかも削除で外れたテストピースの紐付けは
 * 戻らないので、復活した焼成は「空の窯」として残り、記録が指す先が食い違ったままになる。
 *
 * テストから直接呼べるよう export している（IndexedDB 本体は node では動かない）。
 * @param {IDBDatabase} db
 * @param {string} store
 * @param {any} record
 * @param {WriteExpectation} [expectation]
 * @returns {Promise<any>} 実際に書かれた記録
 */
export function runCommitRecord(db, store, record, expectation = EXPECT_CREATE) {
  return new Promise((resolve, reject) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      tx = db.transaction(store, "readwrite");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("indexeddb-transaction-failed"));
      return;
    }
    /** @type {unknown} */
    let failure = null;
    tx.oncomplete = () => resolve(record);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("indexeddb-transaction-aborted"));
    tx.onerror = () => {
      failure = failure ?? tx.error;
    };
    try {
      const objectStore = tx.objectStore(store);
      const current = objectStore.get(record?.id);
      current.onerror = () => {
        failure = current.error ?? failure;
      };
      current.onsuccess = () => {
        const conflict = expectationConflict(current.result, expectation);
        if (conflict) {
          failure = conflictError(conflict);
          tx.abort();
          return;
        }
        const request = objectStore.put(record);
        request.onerror = () => {
          failure = request.error ?? failure;
        };
      };
    } catch (error) {
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error instanceof Error ? error : new Error("indexeddb-write-failed"));
      }
    }
  });
}

/**
 * 記録（焼成など）の保存。写真はここでは触らない（順序の約束 1）。
 * @param {string} store
 * @param {any} record
 * @param {WriteExpectation} [expectation] 書き込みが前提にしている記録の状態
 * @returns {Promise<any>} 実際に書かれた記録
 */
export async function commitRecord(store, record, expectation = EXPECT_CREATE) {
  const db = await openDb();
  /** @type {any} */
  let written;
  try {
    written = await runCommitRecord(db, store, record, expectation);
  } catch (error) {
    throw asQuotaError(error);
  } finally {
    db.close();
  }
  notifyStorageChanged();
  return written;
}

/**
 * 焼成を消すときに書き戻すテストピース（純関数）。
 *
 * 棚位置は焼成の中の位置なので、焼成が消えた時点で意味を持たない。一緒に外す。
 * @param {any[] | null | undefined} pieces
 * @param {string} firingId
 * @param {string} updatedAt
 * @returns {any[]} 紐付けを外した記録（変更が要るものだけ）
 */
export function unlinkFiringFromPieces(pieces, firingId, updatedAt) {
  if (!firingId) return [];
  return (pieces ?? [])
    .filter((piece) => piece && piece.firingId === firingId)
    .map((piece) => ({
      ...piece,
      firingId: null,
      shelf: null,
      updatedAt: updatedAt ?? piece.updatedAt,
    }));
}

/**
 * 焼成を消し、その焼成に紐付いているテストピースの紐付けを外す。
 *
 * 「どのテストピースが紐付いているか」は、画面が持っている一覧ではなくこの
 * トランザクションの中で数え直す。画面の一覧は開いた時点の写しでしかなく、別のタブで
 * 追加・付け替えされた記録は入っていない（保存領域の通知はそのタブの中にしか届かない）。
 * 写しを元に外すと、後から紐付いた記録だけが消えた焼成を指したまま残る。
 *
 * 紐付けの解除と焼成の削除は1トランザクション。1件ずつ書くと、途中で失敗したときに
 * 前半のテストピースだけ紐付けが外れて確定し、画面には「そのまま残っています」と出る。
 *
 * テストから直接呼べるよう export している（IndexedDB 本体は node では動かない）。
 * @param {IDBDatabase} db
 * @param {string} firingId
 * @param {string} updatedAt
 * @returns {Promise<number>} 紐付けを外した件数
 */
export function runDeleteFiring(db, firingId, updatedAt) {
  return new Promise((resolve, reject) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      tx = db.transaction([STORE_PIECES, STORE_FIRINGS], "readwrite");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("indexeddb-transaction-failed"));
      return;
    }
    /** @type {unknown} */
    let failure = null;
    let unlinked = 0;
    tx.oncomplete = () => resolve(unlinked);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("indexeddb-transaction-aborted"));
    tx.onerror = () => {
      failure = failure ?? tx.error;
    };
    try {
      const pieces = tx.objectStore(STORE_PIECES);
      const firings = tx.objectStore(STORE_FIRINGS);
      const piecesRequest = pieces.getAll();
      piecesRequest.onerror = () => {
        failure = piecesRequest.error ?? failure;
      };
      piecesRequest.onsuccess = () => {
        for (const piece of unlinkFiringFromPieces(
          piecesRequest.result ?? [],
          firingId,
          updatedAt,
        )) {
          const request = pieces.put(piece);
          request.onerror = () => {
            failure = request.error ?? failure;
          };
          unlinked += 1;
        }
        // 紐付けを外し終えてから焼成を消す（同じトランザクションなので、
        // どれか1つでも失敗すれば焼成も消えない）。
        const removal = firings.delete(firingId);
        removal.onerror = () => {
          failure = removal.error ?? failure;
        };
      };
    } catch (error) {
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error instanceof Error ? error : new Error("indexeddb-write-failed"));
      }
    }
  });
}

/**
 * 焼成の削除。紐付いているテストピースの解除まで含めて1トランザクションで行う。
 * @param {string} firingId
 * @param {string} [updatedAt]
 * @returns {Promise<number>} 紐付けを外した件数
 */
export async function deleteFiringWithUnlink(firingId, updatedAt) {
  if (!firingId) return 0;
  const stamp = updatedAt ?? new Date().toISOString();
  const db = await openDb();
  /** @type {number} */
  let unlinked;
  try {
    unlinked = await runDeleteFiring(db, firingId, stamp);
  } catch (error) {
    throw asQuotaError(error);
  } finally {
    db.close();
  }
  notifyStorageChanged();
  return unlinked;
}

/**
 * その記録が抱えている写真のキー（純関数）。
 * 差し替えが途中で終わっていると、記録は前の写真の ID も抱えている。
 * @param {{ photoId?: string | null, supersededPhotoId?: string | null, pendingPhotoId?: string | null } | null | undefined} piece
 * @returns {string[]}
 */
export function photoKeysOfPiece(piece) {
  return [
    ...new Set(
      [piece?.photoId, piece?.supersededPhotoId, piece?.pendingPhotoId].filter(
        (key) => typeof key === "string" && key !== "",
      ),
    ),
  ];
}

/**
 * テストピースを写真ごと消す。
 *
 * 消す写真のキーは、画面が持っている写しではなくこのトランザクションの中で引き直す。
 * 別のタブで写真が差し替えられていると、写しのキーは既に消えた Blob を指していて、
 * いま実在する Blob は誰からも参照されないまま残る。
 *
 * 記録本体と写真は同じトランザクションで消す。別々に消すと、後半で失敗したときに
 * 「あるはずの写真を指したままの記録」や、誰からも参照されない Blob が残る。
 *
 * テストから直接呼べるよう export している（IndexedDB 本体は node では動かない）。
 * @param {IDBDatabase} db
 * @param {string} pieceId
 * @returns {Promise<number>} 消した写真の件数
 */
export function runDeletePiece(db, pieceId) {
  return new Promise((resolve, reject) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      tx = db.transaction([STORE_PIECES, STORE_PHOTOS], "readwrite");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("indexeddb-transaction-failed"));
      return;
    }
    /** @type {unknown} */
    let failure = null;
    let removed = 0;
    tx.oncomplete = () => resolve(removed);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("indexeddb-transaction-aborted"));
    tx.onerror = () => {
      failure = failure ?? tx.error;
    };
    try {
      const pieces = tx.objectStore(STORE_PIECES);
      const photos = tx.objectStore(STORE_PHOTOS);
      const pieceRequest = pieces.get(pieceId);
      pieceRequest.onerror = () => {
        failure = pieceRequest.error ?? failure;
      };
      pieceRequest.onsuccess = () => {
        for (const key of photoKeysOfPiece(pieceRequest.result)) {
          const request = photos.delete(key);
          request.onerror = () => {
            failure = request.error ?? failure;
          };
          removed += 1;
        }
        const removal = pieces.delete(pieceId);
        removal.onerror = () => {
          failure = removal.error ?? failure;
        };
      };
    } catch (error) {
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error instanceof Error ? error : new Error("indexeddb-write-failed"));
      }
    }
  });
}

/**
 * テストピースの削除。写真も一緒に消す。
 * @param {string} pieceId
 * @returns {Promise<number>} 消した写真の件数
 */
export async function deletePieceWithPhotos(pieceId) {
  if (!pieceId) return 0;
  const db = await openDb();
  /** @type {number} */
  let removed;
  try {
    removed = await runDeletePiece(db, pieceId);
  } catch (error) {
    throw asQuotaError(error);
  } finally {
    db.close();
  }
  notifyStorageChanged();
  return removed;
}

/**
 * @param {string} store
 * @returns {Promise<any[]>}
 */
export async function getAll(store) {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readonly");
    return await promisify(tx.objectStore(store).getAll());
  } finally {
    db.close();
  }
}

/**
 * @param {string} store
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function getOne(store, id) {
  const db = await openDb();
  try {
    const tx = db.transaction(store, "readonly");
    return await promisify(tx.objectStore(store).get(id));
  } finally {
    db.close();
  }
}

/**
 * 写真 Blob を保存する。容量不足は呼び出し側で扱えるよう、種別を付けて投げ直す。
 * @param {string} photoId
 * @param {Blob} blob
 * @returns {Promise<void>}
 */
export async function putPhoto(photoId, blob) {
  const db = await openDb();
  try {
    await runWrite(db, STORE_PHOTOS, (objectStore) => objectStore.put(blob, photoId));
  } catch (error) {
    throw asQuotaError(error);
  } finally {
    db.close();
  }
  notifyStorageChanged();
}

/**
 * @param {string} photoId
 * @returns {Promise<Blob | null>}
 */
export async function getPhoto(photoId) {
  if (!photoId) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_PHOTOS, "readonly");
    const blob = await promisify(tx.objectStore(STORE_PHOTOS).get(photoId));
    return blob ?? null;
  } finally {
    db.close();
  }
}

/**
 * @param {string} photoId
 * @returns {Promise<void>}
 */
export async function deletePhoto(photoId) {
  if (!photoId) return;
  const db = await openDb();
  try {
    await runWrite(db, STORE_PHOTOS, (objectStore) => objectStore.delete(photoId));
  } finally {
    db.close();
  }
  notifyStorageChanged();
}

/**
 * どのテストピースからも参照されていない写真 Blob を消す。
 *
 * 写真の後始末（差し替え・取り外しで参照が切れた Blob の削除）は失敗しうる。
 * 失敗した ID をその場で捨てると、レコードは新しい写真しか指していないので
 * 誰も二度とその Blob に辿り着けず、消せない容量として残り続ける。
 * 消す対象を「覚えておく」代わりに、レコードから毎回引き直す。
 * こうすると、途中で中断された保存や過去の取りこぼしも同じ経路で回収できる。
 *
 * 参照の読み出しと削除は1トランザクションに入れる。別々にすると、参照を読んだ後・
 * 削除する前に保存された写真（＝レコードを先に書いてから Blob を書く順序の途中）を
 * 孤児と見なして消してしまう。
 *
 * 参照は photoId だけでなく supersededPhotoId（差し替え中の前の写真）も見る。
 * 差し替えは「レコードを新しい写真に向けてから Blob を書く」順で進むので、その間の
 * 前の写真はどのレコードの photoId にも現れない。photoId だけで孤児と判定すると、
 * 別のタブで開いたこの掃除が前の写真を消してしまい、新しい写真の保存が失敗したときに
 * 戻す先が無くなる（画面には「前の写真はそのまま残っています」と出る＝嘘になる）。
 *
 * テストから直接呼べるよう export している（IndexedDB 本体は node では動かない）。
 * @param {IDBDatabase} db
 * @returns {Promise<number>} 消した件数
 */
export function runSweepOrphanPhotos(db) {
  return new Promise((resolve, reject) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      tx = db.transaction([STORE_PIECES, STORE_PHOTOS], "readwrite");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("indexeddb-transaction-failed"));
      return;
    }
    /** @type {unknown} */
    let failure = null;
    let removed = 0;
    tx.oncomplete = () => resolve(removed);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("indexeddb-transaction-aborted"));
    tx.onerror = () => {
      failure = failure ?? tx.error;
    };
    try {
      const photos = tx.objectStore(STORE_PHOTOS);
      const piecesRequest = tx.objectStore(STORE_PIECES).getAll();
      const keysRequest = photos.getAllKeys();
      piecesRequest.onerror = () => {
        failure = piecesRequest.error ?? failure;
      };
      keysRequest.onerror = () => {
        failure = keysRequest.error ?? failure;
      };
      // 同一トランザクション内の要求は発行順に実行されるので、
      // ここでは既にテストピースの読み出しが終わっている。
      keysRequest.onsuccess = () => {
        const referenced = new Set(
          (piecesRequest.result ?? []).flatMap((piece) => photoKeysOfPiece(piece)),
        );
        for (const key of keysRequest.result ?? []) {
          if (referenced.has(key)) continue;
          const request = photos.delete(key);
          request.onerror = () => {
            failure = request.error ?? failure;
          };
          removed += 1;
        }
      };
    } catch (error) {
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error instanceof Error ? error : new Error("indexeddb-write-failed"));
      }
    }
  });
}

/**
 * 参照の切れた写真をまとめて消す。失敗しても記録の正しさには影響しない
 * （残るのは孤立した Blob だけ）ので、呼び出し側は握り潰してよい。
 * @returns {Promise<number>} 消した件数
 */
export async function sweepOrphanPhotos() {
  const db = await openDb();
  /** @type {number} */
  let removed;
  try {
    removed = await runSweepOrphanPhotos(db);
  } finally {
    db.close();
  }
  if (removed > 0) notifyStorageChanged();
  return removed;
}

/**
 * 中断された写真の書き込みを、記録1件について解決する（純関数）。
 *
 * 写真の保存は「記録を新しい写真へ向ける → Blob を書く → 印を外す（差し替えなら前の
 * Blob も同時に消す）」の順に進む。1つ目と2つ目の間でタブが閉じられる・ブラウザが落ちると、
 * 記録は存在しない Blob を指したまま残る。
 *
 * 記録が抱える印は2つ。
 *   supersededPhotoId … 差し替え中の前の写真。無事な前の写真はここにしか現れないので、
 *     放置すると次の保存で印が外れ、掃除が唯一無事な写真を消す。
 *   pendingPhotoId … まだ Blob を書けていない写真。写真を初めて付けるときは戻す先の
 *     写真が無く、印が無ければ「実在しない Blob を指した記録」と「保存が進行中の記録」を
 *     区別できない。区別できないまま参照を外すと、書き込み中の写真を消すことになる。
 *
 * どちらの印も無ければ、この記録は中断していない（判断しない）。
 *
 * @param {{ photoId?: string | null, supersededPhotoId?: string | null, pendingPhotoId?: string | null }} piece
 * @param {Set<string>} photoKeys いま実在する写真 Blob のキー
 * @returns {object | null} 書き戻すべき記録。直す必要が無ければ null
 */
export function resolveInterruptedReplacement(piece, photoKeys) {
  if (!piece) return null;
  const superseded = piece.supersededPhotoId ?? null;
  const pending = piece.pendingPhotoId ?? null;
  if (!superseded && !pending) return null;
  const exists = (id) => Boolean(id) && photoKeys.has(id);
  // 写真を持たない記録の印は、書き込みではなく取り外しの跡。指し直す先ではないので外す
  // （外さないと、誰も見ない Blob が掃除の対象から永久に外れて容量を占め続ける）。
  if (!piece.photoId) return clearPhotoMarks(piece, {});
  // 新しい写真が書けている＝保存は成立している。印を外して前の Blob を解放する
  // （最後の1トランザクションだけが失敗した場合。掃除がこの後で前の Blob を回収する）。
  if (exists(piece.photoId)) return clearPhotoMarks(piece, {});
  // ここから下は「記録が指している Blob が無い」。
  // 前の写真が無事＝差し替えは成立していない。参照を前へ戻す。
  if (exists(superseded)) return clearPhotoMarks(piece, { photoId: superseded });
  // 戻す先が無い。ただし、いま指している写真が「まだ書けていない」印そのものなら、
  // その Blob は最初から存在しない（＝写真を付ける保存が中断した）。写真なしの記録に正す。
  // 正さないと、記録は永久に存在しない Blob を指し、編集画面は写真ありとして色メモを
  // 隠し、書き出しは「あり」と報告し続ける（＝記録が嘘をつく）。
  if (pending && pending === piece.photoId) return clearPhotoMarks(piece, { photoId: null });
  // 印が別の写真を指している・印が無い。判断材料が無いので何も書かない。
  return null;
}

/**
 * 中断の印を外した記録を作る。印は必ず両方まとめて外す
 * （片方だけ残すと、次の復帰がその印を根拠に別の判断をする）。
 * @param {object} piece
 * @param {{ photoId?: string | null }} patch
 * @returns {object}
 */
function clearPhotoMarks(piece, patch) {
  return { ...piece, ...patch, supersededPhotoId: null, pendingPhotoId: null };
}

/**
 * 中断された写真の書き込み（差し替え・初回の追加）を、記録を読む前に元へ戻す。
 *
 * 参照の読み出しと書き戻しは1トランザクションに入れる。別々にすると、読んだ後・
 * 書く前に進んだ保存（記録を先に書いてから Blob を書く順序の途中）を取り違えて、
 * 成立しかけている差し替えを巻き戻してしまう。
 *
 * 掃除（runSweepOrphanPhotos）と同じ2ストアの readwrite なので、両者が同時に走っても
 * ブラウザが直列化する。掃除が先なら印が守るので前の Blob は残り、ここが先なら
 * 印を外した Blob だけが掃除の対象になる。どちらの順でも無事な写真は消えない。
 *
 * テストから直接呼べるよう export している（IndexedDB 本体は node では動かない）。
 * @param {IDBDatabase} db
 * @returns {Promise<number>} 直した件数
 */
export function runRecoverInterruptedReplacements(db) {
  return new Promise((resolve, reject) => {
    /** @type {IDBTransaction} */
    let tx;
    try {
      tx = db.transaction([STORE_PIECES, STORE_PHOTOS], "readwrite");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("indexeddb-transaction-failed"));
      return;
    }
    /** @type {unknown} */
    let failure = null;
    let repaired = 0;
    tx.oncomplete = () => resolve(repaired);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("indexeddb-transaction-aborted"));
    tx.onerror = () => {
      failure = failure ?? tx.error;
    };
    try {
      const pieces = tx.objectStore(STORE_PIECES);
      const piecesRequest = pieces.getAll();
      const keysRequest = tx.objectStore(STORE_PHOTOS).getAllKeys();
      piecesRequest.onerror = () => {
        failure = piecesRequest.error ?? failure;
      };
      keysRequest.onerror = () => {
        failure = keysRequest.error ?? failure;
      };
      // 同一トランザクション内の要求は発行順に実行されるので、
      // ここでは既にテストピースの読み出しが終わっている。
      keysRequest.onsuccess = () => {
        const photoKeys = new Set(keysRequest.result ?? []);
        for (const piece of piecesRequest.result ?? []) {
          const fixed = resolveInterruptedReplacement(piece, photoKeys);
          if (!fixed) continue;
          const request = pieces.put(fixed);
          request.onerror = () => {
            failure = request.error ?? failure;
          };
          repaired += 1;
        }
      };
    } catch (error) {
      failure = error;
      try {
        tx.abort();
      } catch {
        reject(error instanceof Error ? error : new Error("indexeddb-write-failed"));
      }
    }
  });
}

/**
 * 中断された差し替えをまとめて直す。記録を読む前に呼ぶ。
 * 失敗しても記録そのものは読めるので、呼び出し側は握り潰してよい。
 * @returns {Promise<number>} 直した件数
 */
export async function recoverInterruptedReplacements() {
  const db = await openDb();
  /** @type {number} */
  let repaired;
  try {
    repaired = await runRecoverInterruptedReplacements(db);
  } finally {
    db.close();
  }
  if (repaired > 0) notifyStorageChanged();
  return repaired;
}

/**
 * 候補を順に見て、写真 Blob が実在する最初の ID を返す。
 *
 * 差し替えの失敗から戻すとき、戻す先そのものが中断で失われていることがある
 * （復帰が走っていない端末で、同じ記録の差し替えが二重に中断した場合）。
 * 実在を確かめずに指し直すと、記録が存在しない Blob を指したままになる。
 * 読み出しに失敗した候補は「無い」と断定できないので、判断材料にしない。
 * @param {(string | null | undefined)[]} ids
 * @returns {Promise<string | null>}
 */
export async function firstExistingPhotoId(ids) {
  for (const id of ids ?? []) {
    if (!id) continue;
    try {
      if (await getPhoto(id)) return id;
    } catch {
      // この候補は確かめられなかった。次の候補へ。
    }
  }
  return null;
}

/**
 * 保存領域の中身が変わったことを知らせる。
 *
 * 容量の表示（常設のヘッダーと書き出し画面）は「いま何バイト使っているか」なので、
 * 初回マウント時に1度だけ測ると、写真を足して閾値を越えても表示が古いまま残る。
 * 書き込みが確定した時点でここから知らせ、見ている側が測り直せるようにする。
 */
export const STORAGE_CHANGED_EVENT = "kama-log:storage-changed";

function notifyStorageChanged() {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new Event(STORAGE_CHANGED_EVENT));
  } catch {
    // 通知に失敗しても書き込みは成立している。表示の更新だけを諦める。
  }
}

/**
 * 保存領域の変化を購読する。解除関数を返す。
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribeStorageChanged(listener) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => {};
  }
  window.addEventListener(STORAGE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(STORAGE_CHANGED_EVENT, listener);
}

/**
 * 容量不足かどうかを判定して、扱いやすいエラーに包み直す。
 * @param {unknown} error
 * @returns {Error & { quotaExceeded?: boolean }}
 */
export function asQuotaError(error) {
  const name = /** @type {{ name?: string }} */ (error)?.name ?? "";
  const wrapped = /** @type {Error & { quotaExceeded?: boolean }} */ (
    error instanceof Error ? error : new Error(String(error))
  );
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    wrapped.quotaExceeded = true;
  }
  return wrapped;
}

/**
 * 空き容量の実測。取得できない環境では null を返す（推定値を作らない）。
 * @returns {Promise<{ usage: number, quota: number } | null>}
 */
export async function estimateStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== "number" || typeof quota !== "number" || quota <= 0) return null;
    return { usage, quota };
  } catch {
    return null;
  }
}

/**
 * ブラウザの自動削除を受けにくくする。権限プロンプトが出ることがある。
 * @returns {Promise<boolean>}
 */
export async function requestPersistence() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ここから下は純関数（DOM に触れない＝テスト対象）
// ---------------------------------------------------------------------------

/**
 * バイト数を読みやすい単位にする。
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * 容量の警戒段階。70% 未満では何も出さない（不安を煽らない）。
 * @param {number} usage
 * @param {number} quota
 * @returns {"hidden" | "low" | "critical"}
 */
export function capacityLevel(usage, quota) {
  const u = Number(usage);
  const q = Number(quota);
  if (!Number.isFinite(u) || !Number.isFinite(q) || q <= 0) return "hidden";
  const ratio = u / q;
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.7) return "low";
  return "hidden";
}

/**
 * 保存前の事前チェック。95% を超える見込みなら圧縮前に知らせる。
 * @param {number} usage
 * @param {number} quota
 * @param {number} incomingBytes
 * @returns {boolean}
 */
export function willExceedQuota(usage, quota, incomingBytes) {
  const u = Number(usage);
  const q = Number(quota);
  const incoming = Number(incomingBytes) || 0;
  if (!Number.isFinite(u) || !Number.isFinite(q) || q <= 0) return false;
  return u + incoming > q * 0.95;
}

/**
 * 圧縮後の寸法。長辺を maxEdge に収め、元より大きくはしない。
 * @param {number} width
 * @param {number} height
 * @param {number} maxEdge
 * @returns {{ width: number, height: number }}
 */
export function fitWithin(width, height, maxEdge) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const edge = Math.max(1, Math.round(Number(maxEdge) || 1));
  const longest = Math.max(w, h);
  if (longest <= edge) return { width: w, height: h };
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * 一意なキー。crypto があれば使い、無ければ時刻＋乱数で代替する。
 * @param {string} [prefix]
 * @returns {string}
 */
export function newId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
