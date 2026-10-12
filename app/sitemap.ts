import type { MetadataRoute } from "next";
import { absoluteUrl } from "../lib/site.mjs";

// static export では sitemap も out/ に書き出される。
// canonical と同じ absoluteUrl を通すことで、basePath の取りこぼしを防ぐ。
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/firings/", "/pieces/new/", "/compare/", "/export/"].map(
    (path) => ({
      url: absoluteUrl(path),
      changeFrequency: "monthly",
      priority: path === "/" ? 1 : 0.6,
    }),
  );
}
