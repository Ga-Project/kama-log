"use client";

import { fitWithin } from "../../lib/storage.mjs";

export type CompressResult = {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
  bytes: number;
};

/**
 * ブラウザ内で写真を縮小・再圧縮する。外部へは一切送らない。
 *
 * 端末で撮った写真はそのままだと数 MB あり、数十枚で IndexedDB の割当を食い潰す。
 * 発色の判断に必要なのは色と質感なので、長辺 1024・JPEG 品質 0.7 で足りる。
 */
export async function compressPhoto(
  file: File,
  options: { maxEdge: number; quality: number },
): Promise<CompressResult> {
  const bitmap = await loadBitmap(file);
  const { width, height } = fitWithin(
    bitmap.width,
    bitmap.height,
    options.maxEdge,
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    closeBitmap(bitmap);
    throw new Error("canvas-unavailable");
  }
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  closeBitmap(bitmap);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", options.quality);
  });
  if (!blob) throw new Error("compress-failed");

  return {
    blob,
    width,
    height,
    originalBytes: file.size,
    bytes: blob.size,
  };
}

type Bitmap = ImageBitmap | HTMLImageElement;

async function loadBitmap(file: File): Promise<Bitmap> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Safari の一部バージョンなど createImageBitmap が失敗する環境は <img> にフォールバック。
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image-decode-failed"));
    };
    img.src = url;
  });
}

function closeBitmap(bitmap: Bitmap) {
  if (typeof ImageBitmap !== "undefined" && bitmap instanceof ImageBitmap)
    bitmap.close();
}
