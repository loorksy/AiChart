#!/usr/bin/env node
/**
 * Lonora owl-face ↔ candlestick morph.
 * Geometry from public/brand/aichart-mark.svg (viewBox 0 350 3000 2250).
 * 1080×1080, 30fps, 8s. Frame 0 === last frame for a seamless loop.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const FR = 30;
const OP = 240;
const W = 1080;
const H = 1080;

const WHITE = [1, 1, 1, 1];
const BLACK = [0, 0, 0, 1];
const GREEN = [0.08235294117647059, 0.5019607843137255, 0.23921568627450981, 1];
const RED = [0.8627450980392157, 0.14901960784313725, 0.14901960784313725, 1];

const EASE = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
const SETTLE = { o: { x: [0], y: [0.65] }, i: { x: [0.51], y: [0.99] } };
const BLINK = { o: { x: [0.2], y: [0.75] }, i: { x: [0.34], y: [0.94] } };

const K = 0.5522847498;

function staticProp(k) {
  return { a: 0, k };
}

function hold() {
  return { i: { x: [0.5], y: [0.5] }, o: { x: [0.5], y: [0.5] } };
}

function keyframes(points) {
  return {
    a: 1,
    k: points.map((point, index) => {
      const next = points[index + 1];
      const prev = points[index - 1];
      const frame = { t: point.t, s: point.s };
      if (next) {
        const ease = point.out ?? hold();
        frame.o = ease.o ?? hold().o;
      }
      if (prev) {
        const ease = prev.out ?? hold();
        frame.i = ease.i ?? hold().i;
      }
      return frame;
    }),
  };
}

function bookend(rest, beats) {
  return keyframes([{ t: 0, s: rest, out: hold() }, ...beats, { t: OP, s: rest }]);
}

function circlePath(r) {
  const h = r * K;
  return {
    c: true,
    v: [
      [0, -r],
      [r, 0],
      [0, r],
      [-r, 0],
    ],
    i: [
      [-h, 0],
      [0, -h],
      [h, 0],
      [0, h],
    ],
    o: [
      [h, 0],
      [0, h],
      [-h, 0],
      [0, -h],
    ],
  };
}

function diamondPath(rx, ry, round = 22) {
  const hx = Math.min(round, rx * 0.28);
  const hy = Math.min(round, ry * 0.28);
  return {
    c: true,
    v: [
      [0, -ry],
      [rx, 0],
      [0, ry],
      [-rx, 0],
    ],
    i: [
      [-hx, 0],
      [0, -hy],
      [hx, 0],
      [0, hy],
    ],
    o: [
      [hx, 0],
      [0, hy],
      [-hx, 0],
      [0, -hy],
    ],
  };
}

function capsulePath(hw, hh) {
  const hx = hw * 0.94;
  const hy = hh * 0.94;
  return {
    c: true,
    v: [
      [0, -hh],
      [hw, 0],
      [0, hh],
      [-hw, 0],
    ],
    i: [
      [-hx, 0],
      [0, -hy],
      [hx, 0],
      [0, hy],
    ],
    o: [
      [hx, 0],
      [0, hy],
      [-hx, 0],
      [0, -hy],
    ],
  };
}

function sparklinePath(side) {
  const s = side;
  return {
    c: true,
    v: [
      [-78 * s, 10],
      [-22 * s, -38],
      [36 * s, 24],
      [82 * s, -14],
    ],
    i: [
      [-18, 4],
      [8, -10],
      [-10, 8],
      [12, 6],
    ],
    o: [
      [18, -4],
      [-6, 12],
      [12, -8],
      [-10, -4],
    ],
  };
}

function fill(color, sid) {
  const c = { a: 0, k: color };
  if (sid) c.sid = sid;
  return { ty: "fl", nm: "Fill", c, o: staticProp(100), r: 1 };
}

function groupTransform() {
  return {
    ty: "tr",
    p: staticProp([0, 0]),
    a: staticProp([0, 0]),
    s: staticProp([100, 100]),
    r: staticProp(0),
    o: staticProp(100),
  };
}

function layerTransform({ p, s, o, r = 0 }) {
  return {
    o,
    r: typeof r === "number" ? staticProp(r) : r,
    p,
    a: staticProp([0, 0, 0]),
    s,
  };
}

function shapeLayer({ nm, ind, ks, shapes, parent, tt, masksProperties, td }) {
  const layer = {
    ddd: 0,
    ty: 4,
    ind,
    nm,
    sr: 1,
    ip: 0,
    op: OP,
    st: 0,
    ks,
    shapes,
  };
  if (parent) layer.parent = parent;
  if (tt) layer.tt = tt;
  if (td) layer.td = td;
  if (masksProperties) layer.masksProperties = masksProperties;
  return layer;
}

function pathShape(nm, pathProp) {
  return { ty: "sh", nm, ks: pathProp };
}

function circleMask(r) {
  return [
    {
      inv: false,
      mode: "a",
      pt: { a: 0, k: circlePath(r) },
      o: staticProp(100),
      x: staticProp(0),
    },
  ];
}

// --- Brand geometry (owl face), optically centered in 1080² ----------
const S = 0.248;
const OX = 168;
const OY = 279;
const LEFT = { x: 562.5 * S + OX, y: (992.2 - 429.7) * S + OY };
const RIGHT = { x: 2437.5 * S + OX, y: LEFT.y };
const BEAK = { x: 1500 * S + OX, y: (2118.1 - 429.7) * S + OY };
const EYE_R = 562.5 * S;
const DIA_RX = 518.66 * S;
const DIA_RY = 417 * S;

const CANDLES = [
  { x: 318, body: 168, wickU: 28, wickD: 22 },
  { x: 430, body: 228, wickU: 34, wickD: 18 },
  { x: 540, body: 148, wickU: 22, wickD: 30 },
  { x: 650, body: 248, wickU: 20, wickD: 26 },
  { x: 762, body: 188, wickU: 30, wickD: 20 },
];
const CANDLE_Y = 548;
const CANDLE_W = 40;

const REST_SCALE = [100, 100, 100];
const OWL = circlePath(EYE_R);
const DIAMOND = diamondPath(DIA_RX, DIA_RY, 18);

function candleCapsule(height) {
  return capsulePath(CANDLE_W / 2, height / 2);
}

function thinLine(height) {
  return capsulePath(2.2, height / 2);
}

function pathProp(rest, beats) {
  return {
    a: 1,
    k: bookend(rest, beats).k.map((frame) => ({
      ...frame,
      s: Array.isArray(frame.s) && frame.s[0]?.c !== undefined ? frame.s : [frame.s],
    })),
  };
}

function pathBookend(restPath, beats) {
  const points = [
    { t: 0, s: [restPath], out: hold() },
    ...beats.map((b) => ({ t: b.t, s: [b.path], out: b.out ?? EASE })),
    { t: OP, s: [restPath] },
  ];
  return keyframes(points);
}

// Timeline
const T = {
  blinkIn: 18,
  blinkMid: 24,
  blinkOut: 32,
  rotPeak: 28,
  compress: 30,
  morphStart: 42,
  candles: 78,
  marketA: 96,
  marketB: 114,
  marketC: 128,
  lineStart: 132,
  lines: 154,
  circleIn: 168,
  chartsOn: 174,
  chartsPeak: 186,
  chartsOff: 198,
  reform: 216,
  rest: 228,
};

function eyeBody(nm, ind, rest, candle, inwardRot) {
  const restP = [rest.x, rest.y, 0];
  const candleP = [candle.x, CANDLE_Y, 0];
  const lineP = [rest.x, rest.y + 8, 0];
  return shapeLayer({
    nm,
    ind,
    ks: layerTransform({
      p: bookend(restP, [
        { t: T.morphStart, s: restP, out: EASE },
        { t: T.candles, s: candleP, out: EASE },
        { t: T.marketA, s: [candle.x, CANDLE_Y - 6, 0], out: EASE },
        { t: T.marketB, s: [candle.x, CANDLE_Y + 5, 0], out: EASE },
        { t: T.marketC, s: candleP, out: EASE },
        { t: T.lines, s: lineP, out: EASE },
        { t: T.circleIn, s: restP, out: SETTLE },
        { t: T.rest, s: restP, out: hold() },
      ]),
      s: bookend(REST_SCALE, [
        { t: T.blinkIn, s: REST_SCALE, out: BLINK },
        { t: T.blinkMid, s: [100, 10, 100], out: BLINK },
        { t: T.blinkOut, s: REST_SCALE, out: SETTLE },
        { t: T.morphStart, s: REST_SCALE, out: EASE },
        { t: T.candles, s: REST_SCALE, out: EASE },
        { t: T.lineStart, s: REST_SCALE, out: EASE },
        { t: T.lines, s: [18, 86, 100], out: EASE },
        { t: T.circleIn, s: REST_SCALE, out: SETTLE },
        { t: T.rest, s: REST_SCALE, out: hold() },
      ]),
      r: bookend([0], [
        { t: T.blinkIn, s: [0], out: EASE },
        { t: T.rotPeak, s: [inwardRot], out: EASE },
        { t: T.blinkOut + 6, s: [0], out: SETTLE },
        { t: T.rest, s: [0], out: hold() },
      ]),
      o: staticProp(100),
    }),
    shapes: [
      {
        ty: "gr",
        nm: `${nm} Group`,
        it: [
          pathShape(
            "Body",
            pathBookend(OWL, [
              { t: T.morphStart, path: OWL, out: EASE },
              { t: T.candles, path: candleCapsule(candle.body), out: EASE },
              { t: T.marketA, path: candleCapsule(candle.body - 16), out: EASE },
              { t: T.marketB, path: candleCapsule(candle.body + 18), out: EASE },
              { t: T.marketC, path: candleCapsule(candle.body), out: EASE },
              { t: T.lines, path: sparklinePath(nm.startsWith("Left") ? 1 : -1), out: EASE },
              { t: T.circleIn, path: OWL, out: SETTLE },
              { t: T.rest, path: OWL, out: hold() },
            ]),
          ),
          fill(WHITE, "markColor"),
          groupTransform(),
        ],
      },
    ],
  });
}

function beakBody(nm, ind, candle, xSign) {
  const restP = [BEAK.x, BEAK.y, 0];
  const candleP = [candle.x, CANDLE_Y, 0];
  const absorbP = [xSign < 0 ? LEFT.x : xSign > 0 ? RIGHT.x : BEAK.x, LEFT.y + 10, 0];
  const compress = [88, 92, 100];
  return shapeLayer({
    nm,
    ind,
    ks: layerTransform({
      p: bookend(restP, [
        { t: T.compress, s: restP, out: EASE },
        { t: T.morphStart, s: restP, out: EASE },
        { t: T.candles, s: candleP, out: EASE },
        { t: T.marketA, s: [candle.x, CANDLE_Y + 4, 0], out: EASE },
        { t: T.marketB, s: [candle.x, CANDLE_Y - 5, 0], out: EASE },
        { t: T.marketC, s: candleP, out: EASE },
        { t: T.lines, s: absorbP, out: EASE },
        { t: T.circleIn, s: restP, out: SETTLE },
        { t: T.reform, s: restP, out: hold() },
      ]),
      s: bookend(REST_SCALE, [
        { t: T.blinkIn, s: REST_SCALE, out: EASE },
        { t: T.compress, s: compress, out: SETTLE },
        { t: T.morphStart, s: REST_SCALE, out: EASE },
        { t: T.lineStart, s: REST_SCALE, out: EASE },
        { t: T.lines, s: [12, 70, 100], out: EASE },
        { t: T.circleIn, s: [0, 0, 100], out: EASE },
        { t: T.chartsOff, s: [0, 0, 100], out: EASE },
        { t: T.reform, s: REST_SCALE, out: SETTLE },
        { t: T.rest, s: REST_SCALE, out: hold() },
      ]),
      o: bookend([100], [
        { t: T.marketC, s: [100], out: EASE },
        { t: T.lines, s: [0], out: EASE },
        { t: T.chartsOff, s: [0], out: EASE },
        { t: T.reform, s: [100], out: SETTLE },
        { t: T.rest, s: [100], out: hold() },
      ]),
    }),
    shapes: [
      {
        ty: "gr",
        nm: `${nm} Group`,
        it: [
          pathShape(
            "Beak",
            pathBookend(DIAMOND, [
              { t: T.morphStart, path: DIAMOND, out: EASE },
              { t: T.candles, path: candleCapsule(candle.body), out: EASE },
              { t: T.marketA, path: candleCapsule(candle.body + 12), out: EASE },
              { t: T.marketB, path: candleCapsule(candle.body - 14), out: EASE },
              { t: T.marketC, path: candleCapsule(candle.body), out: EASE },
              { t: T.lines, path: thinLine(200), out: EASE },
              { t: T.circleIn, path: DIAMOND, out: hold() },
              { t: T.rest, path: DIAMOND, out: hold() },
            ]),
          ),
          fill(WHITE, "markColor"),
          groupTransform(),
        ],
      },
    ],
  });
}

function wickLayer(nm, ind, rest, candle, fromBeak) {
  const restP = fromBeak ? [BEAK.x, BEAK.y, 0] : [rest.x, rest.y, 0];
  const candleP = [candle.x, CANDLE_Y, 0];
  const half = candle.body / 2;
  const wickPath = {
    c: false,
    v: [
      [0, -half - candle.wickU],
      [0, half + candle.wickD],
    ],
    i: [
      [0, 0],
      [0, 0],
    ],
    o: [
      [0, 0],
      [0, 0],
    ],
  };
  const hiddenWick = {
    c: false,
    v: [
      [0, 0],
      [0, 0],
    ],
    i: [
      [0, 0],
      [0, 0],
    ],
    o: [
      [0, 0],
      [0, 0],
    ],
  };
  return shapeLayer({
    nm,
    ind,
    ks: layerTransform({
      p: bookend(restP, [
        { t: T.morphStart, s: restP, out: EASE },
        { t: T.candles, s: candleP, out: EASE },
        { t: T.marketA, s: [candle.x, CANDLE_Y - 6, 0], out: EASE },
        { t: T.marketB, s: [candle.x, CANDLE_Y + 5, 0], out: EASE },
        { t: T.marketC, s: candleP, out: EASE },
        { t: T.lineStart, s: candleP, out: EASE },
        { t: T.lines, s: restP, out: EASE },
        { t: T.rest, s: restP, out: hold() },
      ]),
      s: staticProp(REST_SCALE),
      o: bookend([0], [
        { t: T.morphStart, s: [0], out: EASE },
        { t: T.candles, s: [100], out: EASE },
        { t: T.marketC, s: [100], out: EASE },
        { t: T.lines, s: [0], out: EASE },
        { t: T.rest, s: [0], out: hold() },
      ]),
    }),
    shapes: [
      {
        ty: "gr",
        nm: `${nm} Group`,
        it: [
          pathShape(
            "Wick",
            pathBookend(hiddenWick, [
              { t: T.morphStart, path: hiddenWick, out: EASE },
              { t: T.candles, path: wickPath, out: EASE },
              { t: T.marketC, path: wickPath, out: EASE },
              { t: T.lines, path: hiddenWick, out: EASE },
              { t: T.rest, path: hiddenWick, out: hold() },
            ]),
          ),
          {
            ty: "st",
            nm: "Stroke",
            c: { a: 0, k: WHITE, sid: "markColor" },
            o: staticProp(100),
            w: staticProp(3),
            lc: 2,
            lj: 2,
          },
          groupTransform(),
        ],
      },
    ],
  });
}

function miniCandle(x, y, h, color) {
  return {
    ty: "gr",
    nm: "Mini",
    it: [
      {
        ty: "rc",
        p: staticProp([x, y]),
        s: staticProp([7, h]),
        r: staticProp(2),
      },
      fill(color),
      {
        ty: "st",
        c: { a: 0, k: color },
        o: staticProp(100),
        w: staticProp(1.4),
        lc: 2,
        lj: 2,
      },
      {
        ty: "sh",
        ks: {
          a: 0,
          k: {
            c: false,
            v: [
              [x, y - h / 2 - 6],
              [x, y + h / 2 + 5],
            ],
            i: [
              [0, 0],
              [0, 0],
            ],
            o: [
              [0, 0],
              [0, 0],
            ],
          },
        },
      },
      groupTransform(),
    ],
  };
}

function eyeChart(nm, ind, center) {
  const chart = [
    miniCandle(-28, 8, 22, GREEN),
    miniCandle(-14, -4, 30, RED),
    miniCandle(0, 6, 18, GREEN),
    miniCandle(14, -10, 34, RED),
    miniCandle(28, 2, 24, GREEN),
  ];
  return shapeLayer({
    nm,
    ind,
    masksProperties: circleMask(EYE_R - 8),
    ks: layerTransform({
      p: bookend([center.x, center.y, 0], [
        { t: T.rest, s: [center.x, center.y, 0], out: hold() },
      ]),
      s: bookend(REST_SCALE, [
        { t: T.chartsOn, s: [86, 86, 100], out: SETTLE },
        { t: T.chartsPeak, s: REST_SCALE, out: EASE },
        { t: T.chartsOff, s: [92, 92, 100], out: EASE },
      ]),
      o: bookend([0], [
        { t: T.circleIn, s: [0], out: EASE },
        { t: T.chartsOn, s: [0], out: EASE },
        { t: T.chartsPeak, s: [100], out: EASE },
        { t: T.chartsOff, s: [0], out: EASE },
        { t: T.rest, s: [0], out: hold() },
      ]),
    }),
    shapes: chart,
  });
}

function background() {
  return shapeLayer({
    nm: "Background",
    ind: 20,
    ks: layerTransform({
      p: staticProp([W / 2, H / 2, 0]),
      s: staticProp(REST_SCALE),
      o: staticProp(100),
    }),
    shapes: [
      {
        ty: "gr",
        nm: "BG",
        it: [
          {
            ty: "rc",
            p: staticProp([0, 0]),
            s: staticProp([W, H]),
            r: staticProp(0),
          },
          fill(BLACK, "bgColor"),
          groupTransform(),
        ],
      },
    ],
  });
}

const lottie = {
  v: "5.7.0",
  fr: FR,
  ip: 0,
  op: OP,
  w: W,
  h: H,
  nm: "Lonora owl morph loop",
  ddd: 0,
  assets: [],
  slots: {
    markColor: { p: { a: 0, k: WHITE } },
    bgColor: { p: { a: 0, k: BLACK } },
  },
  layers: [
    eyeChart("Left eye chart", 1, LEFT),
    eyeChart("Right eye chart", 2, RIGHT),
    eyeBody("Left eye", 3, LEFT, CANDLES[1], 11),
    eyeBody("Right eye", 4, RIGHT, CANDLES[3], -11),
    beakBody("Beak left", 5, CANDLES[0], -1),
    beakBody("Beak center", 6, CANDLES[2], 0),
    beakBody("Beak right", 7, CANDLES[4], 1),
    wickLayer("Wick 1", 8, LEFT, CANDLES[0], true),
    wickLayer("Wick 2", 9, LEFT, CANDLES[1], false),
    wickLayer("Wick 3", 10, BEAK, CANDLES[2], true),
    wickLayer("Wick 4", 11, RIGHT, CANDLES[3], false),
    wickLayer("Wick 5", 12, RIGHT, CANDLES[4], true),
    background(),
  ],
};

const controls = {
  controls: [
    { sid: "markColor", label: "Mark color" },
    { sid: "bgColor", label: "Background" },
  ],
};

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const playerDir = resolve("/tmp/text-to-lottie/public/projects/lonora/scene-2");
mkdirSync(playerDir, { recursive: true });
writeJson(resolve(playerDir, "lottie.json"), lottie);
writeJson(resolve(playerDir, "controls.json"), controls);

const appPath = resolve(root, "public/brand/lonora-logo-loop.json");
writeJson(appPath, lottie);

JSON.parse(readFileSync(resolve(playerDir, "lottie.json"), "utf8"));
JSON.parse(readFileSync(appPath, "utf8"));
console.log(`Wrote ${playerDir}/lottie.json`);
console.log(`Wrote ${appPath}`);
