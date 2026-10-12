// 書き込みの完了判定のテスト。
// IndexedDB 本体は node に無いので、トランザクションの振る舞いだけを偽物で再現する。
// ここで守りたいのは1点だけ:「put が成功しても、abort されたら保存済みと言わない」。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFLICT_CHANGED,
  CONFLICT_MISSING,
  conflictOf,
  expectationConflict,
  photoKeysOfPiece,
  reconcilePieceFiring,
  resolveInterruptedReplacement,
  runCommitPiece,
  runCommitRecord,
  runDeleteFiring,
  runDeletePiece,
  runRecoverInterruptedReplacements,
  runSweepOrphanPhotos,
  runWrite,
  unlinkFiringFromPieces,
} from "../lib/storage.mjs";

/** @returns {{ db: object, tx: any, request: any, calls: any[], stores: any }} */
function fakeDb() {
  const request = { onerror: null, error: null };
  /** @type {any[]} */
  const calls = [];
  let stores = null;
  const tx = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: (name) => ({
      put: (value, key) => {
        calls.push({ store: name, action: "put", value, key });
        return request;
      },
      delete: (key) => {
        calls.push({ store: name, action: "delete", key });
        return request;
      },
    }),
    abort() {
      this.onabort?.();
    },
  };
  const db = {
    transaction: (names) => {
      stores = names;
      return tx;
    },
  };
  return { db, tx, request, calls, get stores() {
    return stores;
  } };
}

test("runWrite は complete するまで解決しない", async () => {
  const { db, tx } = fakeDb();
  let settled = false;
  const promise = runWrite(db, "pieces", (store) => store.put({})).then(() => {
    settled = true;
  });
  assert.equal(settled, false);
  tx.oncomplete();
  await promise;
  assert.equal(settled, true);
});

test("runWrite は put 成功のあとの abort を失敗として返す（保存済みと言わない）", async () => {
  const { db, tx, request } = fakeDb();
  const promise = runWrite(db, "pieces", (store) => store.put({}));
  // 個々の put は成功。その後で容量不足などによりトランザクションが巻き戻る。
  request.error = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
  request.onerror?.();
  tx.onabort();
  await assert.rejects(promise, /quota/);
});

test("runWrite は原因が分からない abort でも失敗として返す", async () => {
  const { db, tx } = fakeDb();
  const promise = runWrite(db, "photos", (store) => store.delete("x"));
  tx.onabort();
  await assert.rejects(promise, /indexeddb-transaction-aborted/);
});

test("runWrite は put が同期的に投げてもトランザクションを畳んで失敗を返す", async () => {
  const { db, tx } = fakeDb();
  const promise = runWrite(db, "photos", () => {
    throw new Error("structured-clone-failed");
  });
  await assert.rejects(promise, /structured-clone-failed/);
  // abort 済みなので、あとから complete が来ても解決に変わらない。
  tx.oncomplete?.();
});

/** 参照の掃除用の偽 db。getAll / getAllKeys と delete だけを再現する。 */
function fakeSweepDb(pieces, photoKeys) {
  /** @type {string[]} */
  const deleted = [];
  const piecesRequest = { result: pieces, onsuccess: null, onerror: null, error: null };
  const keysRequest = { result: photoKeys, onsuccess: null, onerror: null, error: null };
  /** @type {string[] | null} */
  let stores = null;
  const tx = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: (name) =>
      name === "pieces"
        ? { getAll: () => piecesRequest }
        : {
            getAllKeys: () => keysRequest,
            delete: (key) => {
              deleted.push(key);
              return { onerror: null, error: null };
            },
          },
    abort() {
      this.onabort?.();
    },
  };
  const db = {
    transaction: (names) => {
      stores = names;
      return tx;
    },
  };
  return {
    db,
    tx,
    keysRequest,
    deleted,
    get stores() {
      return stores;
    },
  };
}

test("runSweepOrphanPhotos は記録が指していない写真だけを消す", async () => {
  const fake = fakeSweepDb(
    [{ id: "p1", photoId: "photo_a" }, { id: "p2", photoId: null }],
    ["photo_a", "photo_b"],
  );
  const promise = runSweepOrphanPhotos(fake.db);
  // 参照の読み出しと削除は同じトランザクションに入れる（読んだ後の割り込みで
  // まだ参照が書かれていない写真を消さないため）。
  assert.deepEqual(fake.stores, ["pieces", "photos"]);
  fake.keysRequest.onsuccess();
  assert.deepEqual(fake.deleted, ["photo_b"]);
  fake.tx.oncomplete();
  assert.equal(await promise, 1);
});

test("runSweepOrphanPhotos は差し替え中の前の写真を消さない", async () => {
  // 差し替えは「記録を新しい写真に向ける → Blob を書く」の順に進むので、その間の
  // 前の写真はどの photoId からも指されない。消してしまうと、新しい写真の保存が
  // 失敗したときに戻す先が無くなる（記録が壊れる）。
  const fake = fakeSweepDb(
    [{ id: "p1", photoId: "photo_new", supersededPhotoId: "photo_old" }],
    ["photo_old", "photo_stray"],
  );
  const promise = runSweepOrphanPhotos(fake.db);
  fake.keysRequest.onsuccess();
  assert.deepEqual(fake.deleted, ["photo_stray"]);
  fake.tx.oncomplete();
  assert.equal(await promise, 1);
});

test("runSweepOrphanPhotos は complete するまで解決しない", async () => {
  const fake = fakeSweepDb([], ["photo_a"]);
  let settled = false;
  const promise = runSweepOrphanPhotos(fake.db).then(() => {
    settled = true;
  });
  fake.keysRequest.onsuccess();
  assert.equal(settled, false);
  fake.tx.oncomplete();
  await promise;
  assert.equal(settled, true);
});

test("runSweepOrphanPhotos は abort を失敗として返す（掃除できたと言わない）", async () => {
  const fake = fakeSweepDb([], ["photo_a"]);
  const promise = runSweepOrphanPhotos(fake.db);
  fake.keysRequest.onsuccess();
  fake.tx.onabort();
  await assert.rejects(promise, /indexeddb-transaction-aborted/);
});

test("resolveInterruptedReplacement は中断された差し替えを前の写真へ戻す", () => {
  // 記録を新しい写真へ向けた直後にタブが閉じられた状態。新しい Blob は無く、
  // 無事なのは印の側だけ。戻さないと次の保存で印が外れ、掃除が唯一の写真を消す。
  assert.deepEqual(
    resolveInterruptedReplacement(
      { id: "p1", photoId: "photo_new", supersededPhotoId: "photo_old" },
      new Set(["photo_old"]),
    ),
    { id: "p1", photoId: "photo_old", supersededPhotoId: null, pendingPhotoId: null },
  );
});

test("resolveInterruptedReplacement は成立済みの差し替えでは印だけを外す", () => {
  // 新しい Blob は書けていて、最後の1トランザクション（印外し＋前の Blob 削除）
  // だけが失敗した状態。写真は新しいままにして、前の Blob を掃除に回す。
  assert.deepEqual(
    resolveInterruptedReplacement(
      { id: "p1", photoId: "photo_new", supersededPhotoId: "photo_old" },
      new Set(["photo_new", "photo_old"]),
    ),
    { id: "p1", photoId: "photo_new", supersededPhotoId: null, pendingPhotoId: null },
  );
});

test("resolveInterruptedReplacement は写真なしの記録の写真を復活させない", () => {
  // 取り外した記録に印だけが残っていても、指し直す先ではない（印だけを外す）。
  assert.deepEqual(
    resolveInterruptedReplacement(
      { id: "p1", photoId: null, supersededPhotoId: "photo_old" },
      new Set(["photo_old"]),
    ),
    { id: "p1", photoId: null, supersededPhotoId: null, pendingPhotoId: null },
  );
});

test("resolveInterruptedReplacement は触らなくてよい記録に手を入れない", () => {
  // 印が無い＝写真の書き込みの途中ではない。
  assert.equal(
    resolveInterruptedReplacement({ id: "p1", photoId: "photo_a" }, new Set(["photo_a"])),
    null,
  );
  // どちらの Blob も無く、書けていない印も無い＝戻す先も判断材料も無いので何も書かない。
  assert.equal(
    resolveInterruptedReplacement(
      { id: "p1", photoId: "photo_new", supersededPhotoId: "photo_old" },
      new Set(),
    ),
    null,
  );
});

test("resolveInterruptedReplacement は中断された初回の写真追加を写真なしに正す", () => {
  // 写真を初めて付ける保存は、記録を書いた直後にタブが閉じられると
  // 「存在しない Blob を指す記録」だけを残す（戻す先の写真が無い）。
  // 正さないと、編集画面は写真ありとして色メモを隠し、書き出しは「あり」と報告し続ける。
  assert.deepEqual(
    resolveInterruptedReplacement(
      { id: "p1", photoId: "photo_new", supersededPhotoId: null, pendingPhotoId: "photo_new" },
      new Set(),
    ),
    { id: "p1", photoId: null, supersededPhotoId: null, pendingPhotoId: null },
  );
});

test("resolveInterruptedReplacement は書けている写真を印だけで落とさない", () => {
  // Blob は書けていて、印を外す最後の書き込みだけが失敗した状態。
  // 写真はそのまま、印だけを外す（保存が進行中の記録を巻き込まないための順序）。
  assert.deepEqual(
    resolveInterruptedReplacement(
      { id: "p1", photoId: "photo_new", supersededPhotoId: null, pendingPhotoId: "photo_new" },
      new Set(["photo_new"]),
    ),
    { id: "p1", photoId: "photo_new", supersededPhotoId: null, pendingPhotoId: null },
  );
});

test("resolveInterruptedReplacement は書けていない印が別の写真を指すなら判断しない", () => {
  // 印といま指している写真が食い違う＝この経路が作った状態ではない。
  // 判断材料が無いので何も書かない（勝手に写真を落とさない）。
  assert.equal(
    resolveInterruptedReplacement(
      { id: "p1", photoId: "photo_new", supersededPhotoId: null, pendingPhotoId: "photo_other" },
      new Set(),
    ),
    null,
  );
});

test("resolveInterruptedReplacement は中断された差し替えでは前の写真を優先する", () => {
  // 差し替えの中断。前の Blob が無事なら、写真なしにせず前の写真へ戻す。
  assert.deepEqual(
    resolveInterruptedReplacement(
      {
        id: "p1",
        photoId: "photo_new",
        supersededPhotoId: "photo_old",
        pendingPhotoId: "photo_new",
      },
      new Set(["photo_old"]),
    ),
    { id: "p1", photoId: "photo_old", supersededPhotoId: null, pendingPhotoId: null },
  );
  // 前の Blob まで失われていれば、指し直す先が無いので写真なしの記録に正す。
  assert.deepEqual(
    resolveInterruptedReplacement(
      {
        id: "p1",
        photoId: "photo_new",
        supersededPhotoId: "photo_old",
        pendingPhotoId: "photo_new",
      },
      new Set(),
    ),
    { id: "p1", photoId: null, supersededPhotoId: null, pendingPhotoId: null },
  );
});

test("unlinkFiringFromPieces はその焼成に紐付いた記録だけを外す（棚位置も一緒に）", () => {
  const pieces = [
    { id: "p1", firingId: "f1", shelf: 2, updatedAt: "old" },
    { id: "p2", firingId: "f2", shelf: 1, updatedAt: "old" },
    { id: "p3", firingId: null, shelf: null, updatedAt: "old" },
  ];
  assert.deepEqual(unlinkFiringFromPieces(pieces, "f1", "now"), [
    { id: "p1", firingId: null, shelf: null, updatedAt: "now" },
  ]);
  // 焼成 ID が無いときに全件を外さない（消す対象が決まっていないのに書き換えない）。
  assert.deepEqual(unlinkFiringFromPieces(pieces, "", "now"), []);
});

/** 焼成削除用の偽 db。pieces の getAll / put と firings の delete を再現する。 */
function fakeDeleteFiringDb(pieces) {
  /** @type {any[]} */
  const written = [];
  /** @type {string[]} */
  const deleted = [];
  const piecesRequest = { result: pieces, onsuccess: null, onerror: null, error: null };
  /** @type {string[] | null} */
  let stores = null;
  const tx = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: (name) =>
      name === "pieces"
        ? {
            getAll: () => piecesRequest,
            put: (value) => {
              written.push(value);
              return { onerror: null, error: null };
            },
          }
        : {
            delete: (key) => {
              deleted.push(key);
              return { onerror: null, error: null };
            },
          },
    abort() {
      this.onabort?.();
    },
  };
  return {
    db: {
      transaction: (names) => {
        stores = names;
        return tx;
      },
    },
    tx,
    piecesRequest,
    written,
    deleted,
    get stores() {
      return stores;
    },
  };
}

test("runDeleteFiring は紐付けの解除対象をトランザクションの中で数え直す", async () => {
  // 画面が持っている一覧は開いた時点の写し。別のタブで後から紐付いた記録
  // （ここでは p3）も、削除と同じトランザクションで読み直せば必ず外れる。
  const fake = fakeDeleteFiringDb([
    { id: "p1", firingId: "f1", shelf: 3, updatedAt: "old" },
    { id: "p2", firingId: "f2", shelf: 1, updatedAt: "old" },
    { id: "p3", firingId: "f1", shelf: null, updatedAt: "old" },
  ]);
  const promise = runDeleteFiring(fake.db, "f1", "now");
  assert.deepEqual(fake.stores, ["pieces", "firings"]);
  fake.piecesRequest.onsuccess();
  assert.deepEqual(fake.written, [
    { id: "p1", firingId: null, shelf: null, updatedAt: "now" },
    { id: "p3", firingId: null, shelf: null, updatedAt: "now" },
  ]);
  assert.deepEqual(fake.deleted, ["f1"]);
  fake.tx.oncomplete();
  assert.equal(await promise, 2);
});

test("runDeleteFiring は abort を失敗として返す（焼成も紐付けも消えていない）", async () => {
  const fake = fakeDeleteFiringDb([{ id: "p1", firingId: "f1", shelf: 1 }]);
  const promise = runDeleteFiring(fake.db, "f1", "now");
  fake.piecesRequest.onsuccess();
  fake.tx.onabort();
  await assert.rejects(promise, /indexeddb-transaction-aborted/);
});

test("photoKeysOfPiece は記録が抱えている写真を重複なく返す", () => {
  assert.deepEqual(
    photoKeysOfPiece({ photoId: "photo_new", supersededPhotoId: "photo_old" }),
    ["photo_new", "photo_old"],
  );
  assert.deepEqual(photoKeysOfPiece({ photoId: "photo_a", supersededPhotoId: "photo_a" }), [
    "photo_a",
  ]);
  assert.deepEqual(photoKeysOfPiece({ photoId: null, supersededPhotoId: null }), []);
  assert.deepEqual(photoKeysOfPiece(null), []);
  // 書き込み中の印も記録が抱えている写真。数え落とすと、削除でその Blob だけが
  // 誰からも辿れずに残り、掃除は参照されていると見なして消さない。
  assert.deepEqual(
    photoKeysOfPiece({ photoId: "photo_new", pendingPhotoId: "photo_new" }),
    ["photo_new"],
  );
});

/** テストピース削除用の偽 db。pieces の get / delete と photos の delete を再現する。 */
function fakeDeletePieceDb(piece) {
  const pieceRequest = { result: piece, onsuccess: null, onerror: null, error: null };
  /** @type {{ store: string, key: string }[]} */
  const deleted = [];
  /** @type {string[] | null} */
  let stores = null;
  const tx = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: (name) =>
      name === "pieces"
        ? {
            get: () => pieceRequest,
            delete: (key) => {
              deleted.push({ store: name, key });
              return { onerror: null, error: null };
            },
          }
        : {
            delete: (key) => {
              deleted.push({ store: name, key });
              return { onerror: null, error: null };
            },
          },
    abort() {
      this.onabort?.();
    },
  };
  return {
    db: {
      transaction: (names) => {
        stores = names;
        return tx;
      },
    },
    tx,
    pieceRequest,
    deleted,
    get stores() {
      return stores;
    },
  };
}

test("runDeletePiece は消す写真をトランザクションの中で引き直す", async () => {
  // 別のタブで写真が差し替えられていると、画面の写しは既に無い Blob を指している。
  // 消すべきは、いまレコードが抱えているキー（新しい写真と、差し替え中の印）。
  const fake = fakeDeletePieceDb({
    id: "p1",
    photoId: "photo_new",
    supersededPhotoId: "photo_old",
  });
  const promise = runDeletePiece(fake.db, "p1");
  assert.deepEqual(fake.stores, ["pieces", "photos"]);
  fake.pieceRequest.onsuccess();
  assert.deepEqual(fake.deleted, [
    { store: "photos", key: "photo_new" },
    { store: "photos", key: "photo_old" },
    { store: "pieces", key: "p1" },
  ]);
  fake.tx.oncomplete();
  assert.equal(await promise, 2);
});

test("runDeletePiece は記録が既に無くても失敗にしない", async () => {
  const fake = fakeDeletePieceDb(undefined);
  const promise = runDeletePiece(fake.db, "p1");
  fake.pieceRequest.onsuccess();
  assert.deepEqual(fake.deleted, [{ store: "pieces", key: "p1" }]);
  fake.tx.oncomplete();
  assert.equal(await promise, 0);
});

test("runDeletePiece は abort を失敗として返す（記録も写真も残っている）", async () => {
  const fake = fakeDeletePieceDb({ id: "p1", photoId: "photo_a" });
  const promise = runDeletePiece(fake.db, "p1");
  fake.pieceRequest.onsuccess();
  fake.tx.onabort();
  await assert.rejects(promise, /indexeddb-transaction-aborted/);
});

/** 復帰用の偽 db。pieces の getAll / put と photos の getAllKeys を再現する。 */
function fakeRecoverDb(pieces, photoKeys) {
  /** @type {any[]} */
  const written = [];
  const piecesRequest = { result: pieces, onsuccess: null, onerror: null, error: null };
  const keysRequest = { result: photoKeys, onsuccess: null, onerror: null, error: null };
  /** @type {string[] | null} */
  let stores = null;
  const tx = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: (name) =>
      name === "pieces"
        ? {
            getAll: () => piecesRequest,
            put: (value) => {
              written.push(value);
              return { onerror: null, error: null };
            },
          }
        : { getAllKeys: () => keysRequest },
    abort() {
      this.onabort?.();
    },
  };
  return {
    db: {
      transaction: (names) => {
        stores = names;
        return tx;
      },
    },
    tx,
    keysRequest,
    written,
    get stores() {
      return stores;
    },
  };
}

test("runRecoverInterruptedReplacements は参照の読み出しと書き戻しを1トランザクションで行う", async () => {
  const fake = fakeRecoverDb(
    [
      { id: "p1", photoId: "photo_new", supersededPhotoId: "photo_old" },
      { id: "p2", photoId: "photo_b", supersededPhotoId: null },
    ],
    ["photo_old", "photo_b"],
  );
  const promise = runRecoverInterruptedReplacements(fake.db);
  // 掃除と同じ2ストアの readwrite。別トランザクションに分けると、読んだ後・書く前に
  // 進んだ保存を取り違えて、成立しかけている差し替えを巻き戻す。
  assert.deepEqual(fake.stores, ["pieces", "photos"]);
  fake.keysRequest.onsuccess();
  assert.deepEqual(fake.written, [
    { id: "p1", photoId: "photo_old", supersededPhotoId: null, pendingPhotoId: null },
  ]);
  fake.tx.oncomplete();
  assert.equal(await promise, 1);
});

test("runRecoverInterruptedReplacements は complete するまで解決しない", async () => {
  const fake = fakeRecoverDb(
    [{ id: "p1", photoId: "photo_new", supersededPhotoId: "photo_old" }],
    ["photo_old"],
  );
  let settled = false;
  const promise = runRecoverInterruptedReplacements(fake.db).then(() => {
    settled = true;
  });
  fake.keysRequest.onsuccess();
  assert.equal(settled, false);
  fake.tx.oncomplete();
  await promise;
  assert.equal(settled, true);
});

test("runRecoverInterruptedReplacements は abort を失敗として返す（直したと言わない）", async () => {
  const fake = fakeRecoverDb(
    [{ id: "p1", photoId: "photo_new", supersededPhotoId: "photo_old" }],
    ["photo_old"],
  );
  const promise = runRecoverInterruptedReplacements(fake.db);
  fake.keysRequest.onsuccess();
  fake.tx.onabort();
  await assert.rejects(promise, /indexeddb-transaction-aborted/);
});

test("reconcilePieceFiring は消えた焼成への紐付けと棚位置を一緒に外す", () => {
  const piece = { id: "p1", firingId: "f1", shelf: 2 };
  // 棚位置は焼成の中の位置なので、紐付けが消えれば意味を持たない（焼成を消す側と同じ扱い）。
  assert.deepEqual(reconcilePieceFiring(piece, false), { id: "p1", firingId: null, shelf: null });
  // 実在するならそのまま。紐付けの無い記録にも手を入れない。
  assert.equal(reconcilePieceFiring(piece, true), piece);
  const unlinked = { id: "p2", firingId: null, shelf: null };
  assert.equal(reconcilePieceFiring(unlinked, false), unlinked);
});

/**
 * テストピースの保存用の偽 db。
 * pieces の get / put、firings の get、写真の delete を再現する。
 * @param {any} firing 紐付け先の焼成（undefined なら「消えている」）
 * @param {any} [stored] いま pieces に入っている同じ ID の記録（undefined なら「まだ無い」）
 */
function fakeCommitPieceDb(firing, stored) {
  /** @type {any[]} */
  const written = [];
  /** @type {string[]} */
  const deleted = [];
  /** @type {any[]} */
  const put = [];
  const lookup = { result: firing, key: null, onsuccess: null, onerror: null, error: null };
  const current = { result: stored, key: null, onsuccess: null, onerror: null, error: null };
  /** @type {string[] | null} */
  let stores = null;
  const tx = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: (name) => {
      if (name === "pieces") {
        return {
          get: (key) => {
            current.key = key;
            return current;
          },
          put: (value) => {
            written.push(value);
            return { onerror: null, error: null };
          },
        };
      }
      if (name === "firings") {
        return {
          get: (key) => {
            lookup.key = key;
            return lookup;
          },
        };
      }
      return {
        delete: (key) => {
          deleted.push(key);
          return { onerror: null, error: null };
        },
        put: (value, key) => {
          put.push({ value, key });
          return { onerror: null, error: null };
        },
      };
    },
    abort() {
      this.onabort?.();
    },
  };
  return {
    db: {
      transaction: (names) => {
        stores = names;
        return tx;
      },
    },
    tx,
    lookup,
    current,
    written,
    deleted,
    put,
    get stores() {
      return stores;
    },
  };
}

test("runCommitPiece は消えた焼成への紐付けを書き込みと同じトランザクションで外す", async () => {
  // 編集画面が持っている焼成の一覧は開いた時点の写し。別のタブで焼成が消えていても
  // 選択欄には残っているので、書く直前に同じトランザクションの中で確かめる。
  const fake = fakeCommitPieceDb(undefined);
  const promise = runCommitPiece(fake.db, ["pieces", "firings"], {
    id: "p1",
    firingId: "f1",
    shelf: 2,
  });
  assert.deepEqual(fake.stores, ["pieces", "firings"]);
  fake.current.onsuccess();
  assert.equal(fake.lookup.key, "f1");
  fake.lookup.onsuccess();
  assert.deepEqual(fake.written, [{ id: "p1", firingId: null, shelf: null }]);
  fake.tx.oncomplete();
  assert.deepEqual(await promise, { id: "p1", firingId: null, shelf: null });
});

test("runCommitPiece は実在する焼成の紐付けをそのまま書く", async () => {
  const fake = fakeCommitPieceDb({ id: "f1" });
  const piece = { id: "p1", firingId: "f1", shelf: 2 };
  const promise = runCommitPiece(fake.db, ["pieces", "firings"], piece);
  fake.current.onsuccess();
  fake.lookup.onsuccess();
  assert.deepEqual(fake.written, [piece]);
  fake.tx.oncomplete();
  assert.deepEqual(await promise, piece);
});

test("runCommitPiece は後始末も同じトランザクションに入れる", async () => {
  // 印を外すのと前の Blob を消すのは、まとめて成立しないと記録が壊れる（約束 5）。
  const fake = fakeCommitPieceDb({ id: "f1" });
  const promise = runCommitPiece(
    fake.db,
    ["pieces", "firings", "photos"],
    { id: "p1", firingId: "f1", shelf: 2, supersededPhotoId: null },
    [{ store: "photos", action: "delete", key: "photo_old" }],
  );
  fake.current.onsuccess();
  fake.lookup.onsuccess();
  assert.deepEqual(fake.deleted, ["photo_old"]);
  fake.tx.oncomplete();
  await promise;
});

test("runCommitPiece は keyPath を持たないストアへ put(value, key) で入れる", async () => {
  const fake = fakeCommitPieceDb({ id: "f1" });
  const promise = runCommitPiece(
    fake.db,
    ["pieces", "firings", "photos"],
    { id: "p1", firingId: "f1", shelf: 2 },
    [{ store: "photos", action: "put", value: "blob", key: "photo_1" }],
  );
  fake.current.onsuccess();
  fake.lookup.onsuccess();
  assert.deepEqual(fake.put, [{ value: "blob", key: "photo_1" }]);
  fake.tx.oncomplete();
  await promise;
});

test("runCommitPiece は紐付けの無い記録では焼成を引かない", async () => {
  const fake = fakeCommitPieceDb(undefined);
  const piece = { id: "p1", firingId: null, shelf: null };
  const promise = runCommitPiece(fake.db, ["pieces", "firings"], piece);
  fake.current.onsuccess();
  assert.equal(fake.lookup.key, null);
  assert.deepEqual(fake.written, [piece]);
  fake.tx.oncomplete();
  await promise;
});

test("runCommitPiece は complete するまで解決しない", async () => {
  const fake = fakeCommitPieceDb({ id: "f1" });
  let settled = false;
  const promise = runCommitPiece(fake.db, ["pieces", "firings"], {
    id: "p1",
    firingId: "f1",
    shelf: 2,
  }).then(() => {
    settled = true;
  });
  fake.current.onsuccess();
  fake.lookup.onsuccess();
  assert.equal(settled, false);
  fake.tx.oncomplete();
  await promise;
  assert.equal(settled, true);
});

test("runCommitPiece は abort を失敗として返す（保存済みと言わない）", async () => {
  const fake = fakeCommitPieceDb({ id: "f1" });
  const promise = runCommitPiece(fake.db, ["pieces", "firings"], {
    id: "p1",
    firingId: "f1",
    shelf: 2,
  });
  fake.current.onsuccess();
  fake.lookup.onsuccess();
  fake.tx.onabort();
  await assert.rejects(promise, /indexeddb-transaction-aborted/);
});

test("expectationConflict は削除された記録への上書きと、割り込まれた変更を見分ける", () => {
  // 新規作成のつもりの ID が既に在る＝この画面が知らない記録を潰すことになる。
  assert.equal(expectationConflict(undefined, { mode: "create" }), null);
  assert.equal(expectationConflict({ id: "p1" }, { mode: "create" }), CONFLICT_CHANGED);
  // 上書きのつもりの記録が消えている＝書けば消したはずの記録が復活する。
  assert.equal(
    expectationConflict(undefined, { mode: "update", updatedAt: "t1" }),
    CONFLICT_MISSING,
  );
  // 読んだときの版と違う＝別のタブの変更を黙って消すことになる。
  assert.equal(
    expectationConflict({ id: "p1", updatedAt: "t2" }, { mode: "update", updatedAt: "t1" }),
    CONFLICT_CHANGED,
  );
  assert.equal(
    expectationConflict({ id: "p1", updatedAt: "t1" }, { mode: "update", updatedAt: "t1" }),
    null,
  );
  // 版が分からない記録（updatedAt を持たない古い記録）は実在だけを確かめる。
  // ここで弾くと、その記録が二度と編集できなくなる。
  assert.equal(expectationConflict({ id: "p1" }, { mode: "update" }), null);
  assert.equal(expectationConflict({ id: "p1" }, { mode: "update", updatedAt: null }), null);
});

test("runCommitPiece は別のタブで消された記録を復活させない", async () => {
  // 編集画面が持っているのは開いた時点の写し。そのまま書くと、別のタブで消した記録が
  // （写真の紐付けごと）保存で戻る。
  const fake = fakeCommitPieceDb({ id: "f1" }, undefined);
  const promise = runCommitPiece(
    fake.db,
    ["pieces", "firings"],
    { id: "p1", firingId: "f1", shelf: 2, updatedAt: "t2" },
    [],
    { mode: "update", updatedAt: "t1" },
  );
  fake.current.onsuccess();
  // 焼成すら引かずに畳む（1つも書かない）。
  assert.equal(fake.lookup.key, null);
  assert.deepEqual(fake.written, []);
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  assert.equal(conflictOf(error), CONFLICT_MISSING);
});

test("runCommitPiece は別のタブで変わった記録を上書きしない", async () => {
  // 別のタブで写真が差し替えられた記録を古い写しで上書きすると、新しい写真は
  // どの記録からも指されない Blob になり、掃除に消える。
  const fake = fakeCommitPieceDb({ id: "f1" }, { id: "p1", updatedAt: "t2" });
  const promise = runCommitPiece(
    fake.db,
    ["pieces", "firings"],
    { id: "p1", firingId: "f1", photoId: "photo_old", updatedAt: "t3" },
    [],
    { mode: "update", updatedAt: "t1" },
  );
  fake.current.onsuccess();
  assert.deepEqual(fake.written, []);
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  assert.equal(conflictOf(error), CONFLICT_CHANGED);
});

test("runCommitPiece は読んだ版のままなら後始末ごと書く", async () => {
  const fake = fakeCommitPieceDb({ id: "f1" }, { id: "p1", updatedAt: "t1" });
  const piece = { id: "p1", firingId: "f1", shelf: 2, updatedAt: "t2" };
  const promise = runCommitPiece(fake.db, ["pieces", "firings", "photos"], piece, [
    { store: "photos", action: "delete", key: "photo_old" },
  ], { mode: "update", updatedAt: "t1" });
  fake.current.onsuccess();
  assert.equal(fake.current.key, "p1");
  fake.lookup.onsuccess();
  assert.deepEqual(fake.written, [piece]);
  assert.deepEqual(fake.deleted, ["photo_old"]);
  fake.tx.oncomplete();
  assert.deepEqual(await promise, piece);
});

/** 焼成の保存用の偽 db。1ストアの get / put を再現する。 */
function fakeCommitRecordDb(stored) {
  /** @type {any[]} */
  const written = [];
  const current = { result: stored, key: null, onsuccess: null, onerror: null, error: null };
  /** @type {string | null} */
  let store = null;
  const tx = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    objectStore: () => ({
      get: (key) => {
        current.key = key;
        return current;
      },
      put: (value) => {
        written.push(value);
        return { onerror: null, error: null };
      },
    }),
    abort() {
      this.onabort?.();
    },
  };
  return {
    db: {
      transaction: (name) => {
        store = name;
        return tx;
      },
    },
    tx,
    current,
    written,
    get store() {
      return store;
    },
  };
}

test("runCommitRecord は読んだ版のままなら書く", async () => {
  const fake = fakeCommitRecordDb({ id: "f1", updatedAt: "t1" });
  const record = { id: "f1", updatedAt: "t2" };
  const promise = runCommitRecord(fake.db, "firings", record, {
    mode: "update",
    updatedAt: "t1",
  });
  assert.equal(fake.store, "firings");
  fake.current.onsuccess();
  assert.equal(fake.current.key, "f1");
  assert.deepEqual(fake.written, [record]);
  fake.tx.oncomplete();
  assert.deepEqual(await promise, record);
});

test("runCommitRecord は別のタブで消された焼成を復活させない", async () => {
  // 焼成を消すと、置かれていたテストピースの紐付けは外れる。ここで焼成だけを
  // 書き戻すと、中身の無い焼成が戻り、記録の指す先が食い違ったままになる。
  const fake = fakeCommitRecordDb(undefined);
  const promise = runCommitRecord(
    fake.db,
    "firings",
    { id: "f1", updatedAt: "t2" },
    { mode: "update", updatedAt: "t1" },
  );
  fake.current.onsuccess();
  assert.deepEqual(fake.written, []);
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  assert.equal(conflictOf(error), CONFLICT_MISSING);
});

test("runCommitRecord は別のタブで変わった焼成を上書きしない", async () => {
  const fake = fakeCommitRecordDb({ id: "f1", updatedAt: "t2" });
  const promise = runCommitRecord(
    fake.db,
    "firings",
    { id: "f1", updatedAt: "t3" },
    { mode: "update", updatedAt: "t1" },
  );
  fake.current.onsuccess();
  assert.deepEqual(fake.written, []);
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  assert.equal(conflictOf(error), CONFLICT_CHANGED);
});

test("runCommitRecord は新規作成では既にある記録を潰さない", async () => {
  const fake = fakeCommitRecordDb({ id: "f1", updatedAt: "t1" });
  const promise = runCommitRecord(fake.db, "firings", { id: "f1" }, { mode: "create" });
  fake.current.onsuccess();
  assert.deepEqual(fake.written, []);
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  assert.equal(conflictOf(error), CONFLICT_CHANGED);
});

test("runCommitRecord は complete するまで解決しない", async () => {
  const fake = fakeCommitRecordDb(undefined);
  let settled = false;
  const promise = runCommitRecord(fake.db, "firings", { id: "f1" }).then(() => {
    settled = true;
  });
  fake.current.onsuccess();
  assert.equal(settled, false);
  fake.tx.oncomplete();
  await promise;
  assert.equal(settled, true);
});

test("runCommitRecord は abort を失敗として返す（保存済みと言わない）", async () => {
  const fake = fakeCommitRecordDb(undefined);
  const promise = runCommitRecord(fake.db, "firings", { id: "f1" });
  fake.current.onsuccess();
  fake.tx.onabort();
  await assert.rejects(promise, /indexeddb-transaction-aborted/);
});

test("conflictOf は版の食い違い以外を食い違いと言わない", () => {
  assert.equal(conflictOf(new Error("indexeddb-transaction-aborted")), null);
  assert.equal(conflictOf(null), null);
  assert.equal(conflictOf(Object.assign(new Error("x"), { conflict: "何か別のもの" })), null);
});
