"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAll,
  isStorageAvailable,
  recoverInterruptedReplacements,
  STORE_FIRINGS,
  STORE_PIECES,
} from "../../lib/storage.mjs";
import { sortFiringsNewestFirst } from "../../lib/model.mjs";
import type { Firing, Piece } from "../../lib/model.mjs";

// 並べ替えは純関数として lib 側に置く（テストから直接呼べるようにするため）。
export { sortFiringsNewestFirst };

export type LoadState = "loading" | "ready" | "unavailable" | "error";

/**
 * 記録の読み出し。static export なのでサーバは無く、全てこの端末の IndexedDB から読む。
 *
 * 「保存できない環境（プライベートウィンドウ等）」と「読み込みに失敗した」を区別する。
 * 前者はユーザーの操作で直せる（通常ウィンドウで開く）が、後者は直せないので文言が変わる。
 */
export function useRecords() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [firings, setFirings] = useState<Firing[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const reload = useCallback(async () => {
    if (!isStorageAvailable()) {
      setState("unavailable");
      return;
    }
    try {
      // 中断された写真の差し替え（記録は新しい写真を指しているのに Blob が無い）は、
      // 記録を画面に出す前に元へ戻す。戻さないまま編集・保存されると、無事な写真を
      // 指していた印が外れ、そのあとの掃除で唯一の写真が消える。
      // ここが失敗しても記録そのものは読めるので、読み出しは止めない。
      await recoverInterruptedReplacements().catch(() => {});
      const [p, f] = await Promise.all([
        getAll(STORE_PIECES),
        getAll(STORE_FIRINGS),
      ]);
      setPieces((p as Piece[]) ?? []);
      setFirings((f as Firing[]) ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { pieces, firings, state, reload };
}
