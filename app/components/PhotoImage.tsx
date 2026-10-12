"use client";

import { useEffect, useState } from "react";
import { getPhoto } from "../../lib/storage.mjs";

type Props = {
  photoId: string | null;
  alt: string;
  className?: string;
};

type State = "loading" | "ready" | "missing";

/**
 * IndexedDB の Blob を objectURL にして表示する。
 * 写真が見つからなくても記録本体は生きているので、欠損は「壊れた記録」ではなく
 * 「写真だけが無い状態」として中立に見せる（赤やエラーアイコンを使わない）。
 */
export default function PhotoImage({ photoId, alt, className }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<State>(photoId ? "loading" : "missing");

  useEffect(() => {
    if (!photoId) {
      setState("missing");
      setUrl(null);
      return;
    }

    let revoked = false;
    let objectUrl: string | null = null;
    setState("loading");

    void getPhoto(photoId)
      .then((blob) => {
        if (revoked) return;
        if (!blob) {
          setState("missing");
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setState("ready");
      })
      .catch(() => {
        if (!revoked) setState("missing");
      });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  if (state === "ready" && url) {
    // 端末内 Blob の objectURL なので next/image の最適化対象にならない。
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={url} alt={alt} />;
  }

  if (state === "loading") {
    return <span className="visually-hidden">写真を読み込んでいます</span>;
  }

  return null;
}
