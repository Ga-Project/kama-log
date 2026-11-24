import type { MetadataRoute } from "next";
import { absoluteUrl } from "../lib/site.mjs";
import { GUIDE_PATH } from "../lib/guide.mjs";
import { TILE_PATH } from "../lib/tile-guide.mjs";

// static export では sitemap も out/ に書き出される。
// canonical と同じ absoluteUrl を通すことで、basePath の取りこぼしを防ぐ。
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "/",
    "/firings/",
    "/pieces/new/",
    "/compare/",
    "/export/",
    GUIDE_PATH,
    TILE_PATH,
  ].map(
    (path) => ({
      url: absoluteUrl(path),
      changeFrequency: "monthly",
      priority: path === "/" ? 1 : 0.6,
    }),
  );
}
