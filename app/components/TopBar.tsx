"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  capacityLevel,
  estimateStorage,
  formatBytes,
  subscribeStorageChanged,
} from "../../lib/storage.mjs";

const NAV = [
  { href: "/", label: "炉前" },
  { href: "/firings/", label: "焼成" },
  { href: "/pieces/new/", label: "テストピース" },
  { href: "/compare/", label: "比較" },
  { href: "/export/", label: "書き出し" },
];

export default function TopBar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  // 保存された指定が無いときに実際に見えている配色（OS 設定）。
  // これを持たないと、押したときの動きと読み上げるラベルが逆になる。
  const [systemDark, setSystemDark] = useState(false);
  const [capacity, setCapacity] = useState<{
    usage: number;
    quota: number;
  } | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("kama-log:theme");
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      // localStorage が使えない環境ではテーマ切替を諦め、OS 設定に従う。
    }
  }, []);

  // OS の配色は途中で変わる（システムの自動切替）。購読して追随する。
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    setSystemDark(query.matches);
    const onChange = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // 容量の表示はヘッダーに常設で、この部品はページ遷移でも作り直されない。
  // マウント時に1回だけ測ると、写真を足して 70% / 90% を越えても表示が出ない・古いままになる。
  // 書き込みが確定するたびに測り直す（画面を戻ってきたときも同じ値になる）。
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

  // 未設定なら、いま実際に見えている側。押したときの動きとラベルは必ずこれを共有する。
  const effectiveTheme: "light" | "dark" =
    theme ?? (systemDark ? "dark" : "light");

  function toggleTheme() {
    const next = effectiveTheme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("kama-log:theme", next);
    } catch {
      // 保存できなくても、このセッション中は切り替わったままにする。
    }
  }

  const level = capacity
    ? capacityLevel(capacity.usage, capacity.quota)
    : "hidden";
  const ratio = capacity
    ? Math.min(100, (capacity.usage / capacity.quota) * 100)
    : 0;

  return (
    <header className="topbar">
      <Link className="topbar__mark" href="/">
        <span className="topbar__stack" aria-hidden="true" />
        窯ログ
      </Link>

      <nav className="topbar__nav" aria-label="主要ナビゲーション">
        {NAV.map((item) => (
          <Link
            key={item.href}
            className="topbar__link"
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="topbar__tools">
        {/* 70% 未満では出さない。不安を煽らないための既定。 */}
        {capacity && level !== "hidden" ? (
          <Link className="capacity" href="/export/">
            <span className="capacity__bar" aria-hidden="true">
              <span
                className={`capacity__fill${level === "critical" ? " capacity__fill--critical" : ""}`}
                style={{ width: `${ratio}%` }}
              />
            </span>
            <span>
              {level === "critical" ? "ほぼ満杯" : "残りわずか"}（
              {formatBytes(capacity.usage)} / {formatBytes(capacity.quota)}）
            </span>
          </Link>
        ) : null}

        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={
            effectiveTheme === "dark"
              ? "明るい配色に切り替える"
              : "暗い配色に切り替える"
          }
        >
          <ThemeMark />
        </button>
      </div>
    </header>
  );
}

/** 半分だけ塗られた矩形。円を使わない（角丸の規約に合わせる）。 */
function ThemeMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1.5"
        y="1.5"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M9 1.5h7.5v15H9z" fill="currentColor" />
    </svg>
  );
}
