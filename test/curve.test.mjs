import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atmosphereSegments,
  atmosphereSignature,
  curveAriaLabel,
  curvePolyline,
  curveSignature,
  curveSummary,
  dominantAtmosphere,
  firingConditionSummary,
  formatDuration,
  parseDuration,
  sortPoints,
} from "../lib/curve.mjs";

const CURVE = [
  { minutes: 0, temp: 20, atmosphereFrom: null },
  { minutes: 240, temp: 620, atmosphereFrom: null },
  { minutes: 480, temp: 1180, atmosphereFrom: "reduction" },
  { minutes: 690, temp: 1250, atmosphereFrom: null },
];

test("formatDuration は H:MM で返す", () => {
  assert.equal(formatDuration(690), "11:30");
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
});

test("parseDuration は H:MM と分の両方を読む", () => {
  assert.equal(parseDuration("11:30"), 690);
  assert.equal(parseDuration("690"), 690);
  assert.equal(parseDuration(690), 690);
  assert.equal(parseDuration("1:05"), 65);
});

test("parseDuration は読めない入力を null にする（0 と混同しない）", () => {
  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration("あとで"), null);
  assert.equal(parseDuration("1:75"), null);
});

test("sortPoints は経過分の昇順に整え、壊れた点を落とす", () => {
  const sorted = sortPoints([
    { minutes: 480, temp: 1180 },
    { minutes: 0, temp: 20 },
    { minutes: "x", temp: 100 },
  ]);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].minutes, 0);
  assert.equal(sorted[1].minutes, 480);
});

test("curveSummary は最高温度と総時間を返す", () => {
  const s = curveSummary(CURVE);
  assert.equal(s.maxTemp, 1250);
  assert.equal(s.maxAt, 690);
  assert.equal(s.totalMinutes, 690);
  assert.equal(s.pointCount, 4);
});

test("curveSummary は点が無いとき 0 ではなく null を返す", () => {
  const s = curveSummary([]);
  assert.equal(s.maxTemp, null);
  assert.equal(s.totalMinutes, null);
  assert.equal(s.pointCount, 0);
});

test("curvePolyline は箱の中に収まる座標を返す", () => {
  const poly = curvePolyline(CURVE, { width: 200, height: 100, padX: 4, padY: 4 });
  assert.ok(poly);
  assert.equal(poly.coords.length, 4);
  for (const c of poly.coords) {
    assert.ok(c.x >= 0 && c.x <= 200, `x が範囲外: ${c.x}`);
    assert.ok(c.y >= 0 && c.y <= 100, `y が範囲外: ${c.y}`);
  }
});

test("curvePolyline は温度が高い点ほど y が小さい（SVG は上が 0）", () => {
  const poly = curvePolyline(CURVE, { width: 200, height: 100 });
  const coldest = poly.coords[0];
  const hottest = poly.coords[3];
  assert.ok(hottest.y < coldest.y);
});

test("curvePolyline は全点が同温でも破綻しない", () => {
  const flat = [
    { minutes: 0, temp: 1000 },
    { minutes: 60, temp: 1000 },
  ];
  const poly = curvePolyline(flat, { width: 100, height: 50 });
  assert.ok(poly);
  for (const c of poly.coords) assert.ok(Number.isFinite(c.y));
});

test("curvePolyline は時間軸を 0:00 起点で取る（記録していない時間を詰めない）", () => {
  // 最初の記録が 2:00（120分）から。0:00 から始まる軸なので、左端には来ない。
  const late = [
    { minutes: 120, temp: 300 },
    { minutes: 240, temp: 900 },
  ];
  const poly = curvePolyline(late, { width: 200, height: 100, padX: 0, padY: 0 });
  assert.ok(poly);
  // 120 / 240 = 0.5 → 幅の中央
  assert.equal(poly.coords[0].x, 100);
  assert.equal(poly.coords[1].x, 200);
});

test("curvePolyline は 0:00 から始まる記録では左端から引く", () => {
  const poly = curvePolyline(CURVE, { width: 200, height: 100, padX: 0, padY: 0 });
  assert.equal(poly.coords[0].x, 0);
  assert.equal(poly.coords[3].x, 200);
});

test("curvePolyline の座標は元の点の雰囲気切替をそのまま持つ", () => {
  const poly = curvePolyline(CURVE, { width: 200, height: 100 });
  assert.deepEqual(
    poly.coords.map((c) => c.atmosphereFrom),
    [null, null, "reduction", null],
  );
});

test("curvePolyline は同じ時刻・同じ温度の点でも雰囲気を取り違えない", () => {
  // 同時刻・同温度で雰囲気だけが違う2点（sortPoints は落とさない）。
  // 座標が雰囲気を持たないと、経過分と温度で引き直した先頭の点が両方に当たる。
  const points = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 480, temp: 1180, atmosphereFrom: null },
    { minutes: 480, temp: 1180, atmosphereFrom: "reduction" },
  ];
  const poly = curvePolyline(points, { width: 200, height: 100 });
  assert.deepEqual(
    poly.coords.map((c) => c.atmosphereFrom),
    [null, null, "reduction"],
  );
});

test("curvePolyline は点が無ければ null", () => {
  assert.equal(curvePolyline([], { width: 100, height: 50 }), null);
});

test("atmosphereSegments は切替点で区間を割る", () => {
  const segs = atmosphereSegments(CURVE);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], { from: 0, to: 480, atmosphere: "oxidation" });
  assert.deepEqual(segs[1], { from: 480, to: 690, atmosphere: "reduction" });
});

test("atmosphereSegments は最後の点での切替を落とさない（長さ0でも残す）", () => {
  const segs = atmosphereSegments([
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 480, temp: 1180, atmosphereFrom: "reduction" },
  ]);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], { from: 0, to: 480, atmosphere: "oxidation" });
  assert.deepEqual(segs[1], { from: 480, to: 480, atmosphere: "reduction" });
  // 要約（もっとも長い区間）は塗り替えない。
  assert.equal(
    dominantAtmosphere([
      { minutes: 0, temp: 20, atmosphereFrom: null },
      { minutes: 480, temp: 1180, atmosphereFrom: "reduction" },
    ]),
    "oxidation",
  );
});

test("atmosphereSegments は点が1つでも記録された切替なら残す", () => {
  assert.deepEqual(atmosphereSegments([{ minutes: 30, temp: 900, atmosphereFrom: "reduction" }]), [
    { from: 30, to: 30, atmosphere: "reduction" },
  ]);
  // 切替が記録されていなければ区間は作らない（既定値の「酸化」を主張しない）。
  assert.deepEqual(atmosphereSegments([{ minutes: 30, temp: 900, atmosphereFrom: null }]), []);
  assert.deepEqual(atmosphereSegments([]), []);
});

test("atmosphereSignature は最後の点での切替を持つ焼成を別の焼成と区別する", () => {
  const withTail = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 480, temp: 1180, atmosphereFrom: "reduction" },
  ];
  const without = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 480, temp: 1180, atmosphereFrom: null },
  ];
  assert.equal(atmosphereSignature(withTail), "oxidation|480:reduction");
  assert.equal(atmosphereSignature(without), "oxidation");
  assert.notEqual(atmosphereSignature(withTail), atmosphereSignature(without));
});

test("dominantAtmosphere は最も長い区間を採る", () => {
  // 酸化 480 分 > 還元 210 分
  assert.equal(dominantAtmosphere(CURVE), "oxidation");
});

test("dominantAtmosphere は区間が無ければ null（勝手に酸化と言わない）", () => {
  assert.equal(dominantAtmosphere([]), null);
  assert.equal(dominantAtmosphere([{ minutes: 0, temp: 20 }]), null);
});

test("atmosphereSignature は切替の時刻が違えば別の鍵になる（要約では同じでも）", () => {
  const early = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 120, temp: 400, atmosphereFrom: "reduction" },
    { minutes: 690, temp: 1250, atmosphereFrom: null },
  ];
  // どちらも「もっとも長い区間」は同じでも、還元に入る時刻が違う＝焼成条件が違う。
  assert.notEqual(atmosphereSignature(CURVE), atmosphereSignature(early));
  assert.equal(atmosphereSignature(CURVE), "oxidation|480:reduction");
});

test("atmosphereSignature は記録の開始時刻や総焼成時間では変わらない", () => {
  const from0 = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 600, temp: 1230, atmosphereFrom: null },
  ];
  const from10 = [
    { minutes: 10, temp: 40, atmosphereFrom: null },
    { minutes: 700, temp: 1230, atmosphereFrom: null },
  ];
  assert.equal(atmosphereSignature(from0), atmosphereSignature(from10));
  assert.equal(atmosphereSignature([]), "");
});

test("curveAriaLabel は図を見なくても内容が分かる", () => {
  const label = curveAriaLabel(CURVE);
  assert.match(label, /1250/);
  assert.match(label, /11:30/);
  assert.match(label, /還元/);
});

test("curveAriaLabel は目標温度を伝える（線が引けない範囲でも消さない）", () => {
  // 最高 900℃ で止まった焼成に 1250℃ の目標。目標線はスケール外で引けない。
  const aborted = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 300, temp: 900, atmosphereFrom: null },
  ];
  assert.match(curveAriaLabel(aborted, 1250), /目標 1250℃/);
  // 目標が無ければ言わない。
  assert.ok(!/目標/.test(curveAriaLabel(aborted)));
  // 点が1つも無くても、入力された目標は伝える。
  assert.match(curveAriaLabel([], 1250), /目標 1250℃/);
});

test("firingConditionSummary は狙いと実測と雰囲気を1行に畳む", () => {
  assert.equal(
    firingConditionSummary({ targetTemp: 1230, points: CURVE }),
    "目標1230℃ 最高1250℃ 11:30 酸化→8:00還元",
  );
});

test("firingConditionSummary は記録されていない項目を書かない", () => {
  // 空欄を埋めると、条件の違う焼成がどれも同じ顔になり、選択肢の見分けに使えなくなる。
  assert.equal(firingConditionSummary({ targetTemp: null, points: [] }), "");
  assert.equal(firingConditionSummary({}), "");
  assert.equal(
    firingConditionSummary({ targetTemp: 1230, points: [] }),
    "目標1230℃",
  );
});

test("curveSignature は要約が同じでも途中の形が違えば別の鍵になる", () => {
  // 最高温度も総焼成時間も同じで、途中の昇温だけが違う2本。
  const slowStart = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 300, temp: 400, atmosphereFrom: null },
    { minutes: 600, temp: 1230, atmosphereFrom: null },
  ];
  const fastStart = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 300, temp: 900, atmosphereFrom: null },
    { minutes: 600, temp: 1230, atmosphereFrom: null },
  ];
  assert.equal(curveSummary(slowStart).maxTemp, curveSummary(fastStart).maxTemp);
  assert.equal(
    curveSummary(slowStart).totalMinutes,
    curveSummary(fastStart).totalMinutes,
  );
  assert.notEqual(curveSignature(slowStart), curveSignature(fastStart));
});

test("curveSignature は打った順ではなく記録された形で比べる", () => {
  const points = [
    { minutes: 600, temp: 1230, atmosphereFrom: null },
    { minutes: 0, temp: 20, atmosphereFrom: null },
  ];
  assert.equal(curveSignature(points), curveSignature([...points].reverse()));
  assert.equal(curveSignature([]), "");
});

test("curveSignature は同じ時刻・同じ温度で雰囲気だけが違う点を区別する", () => {
  const withSwitch = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 480, temp: 1180, atmosphereFrom: "reduction" },
  ];
  const without = [
    { minutes: 0, temp: 20, atmosphereFrom: null },
    { minutes: 480, temp: 1180, atmosphereFrom: null },
  ];
  assert.notEqual(curveSignature(withSwitch), curveSignature(without));
});
