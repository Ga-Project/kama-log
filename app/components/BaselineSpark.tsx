"use client";

import { useEffect, useRef, useState } from "react";
import Spark from "./Spark";
import type { CurvePoint } from "../../lib/model.mjs";

const MIN_WIDTH = 480;

type Props = {
  points: CurvePoint[];
  targetTemp?: number | null;
};

/**
 * 基線の温度カーブ。器の幅いっぱいに引く。
 *
 * 固定幅にすると広い画面で右側が死に、狭い画面では潰れる。
 * SVG を CSS で伸縮させると点のマーカーまで歪むので、実測した幅で描き直す。
 * 狭い画面では MIN_WIDTH を保って横スクロールに逃がす（カーブは潰すと読めない）。
 */
export default function BaselineSpark({ points, targetTemp = null }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const measure = () =>
      setWidth(Math.max(MIN_WIDTH, Math.floor(el.clientWidth)));
    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef}>
      {/* 幅が決まるまでは高さだけ確保して、確定時にレイアウトが跳ねないようにする。 */}
      {width === null ? (
        <div style={{ height: 200 }} aria-hidden="true" />
      ) : (
        <Spark
          points={points}
          width={width}
          height={160}
          detailed
          targetTemp={targetTemp}
        />
      )}
    </div>
  );
}
