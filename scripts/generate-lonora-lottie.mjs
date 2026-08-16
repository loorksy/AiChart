#!/usr/bin/env node
/**
 * Builds the seamless Lonora logo Lottie used by the landing finale.
 * Geometry is derived from public/brand/aichart-mark.svg (viewBox 0 350 3000 2250).
 * First and last frames are identical so the sting loops without a visible seam.
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const FR = 60;
const OP = 150;
const W = 960;
const H = 720;

const WHITE = [1, 1, 1, 1];

const ENTRANCE = { o: { x: [0.2], y: [0.75] }, i: { x: [0.34], y: [0.94] } };
const SETTLE = { o: { x: [0.0], y: [0.65] }, i: { x: [0.51], y: [0.99] } };
const TRAVEL = { o: { x: [1.0], y: [0.49] }, i: { x: [0.0], y: [0.55] } };
const EXIT = { o: { x: [1.0], y: [0.02] }, i: { x: [0.54], y: [0.42] } };

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
        const ease = point.out ?? (next.in ? undefined : hold());
        if (ease?.o) frame.o = ease.o;
        else if (ease) frame.o = ease.o ?? hold().o;
      }
      if (prev) {
        const ease = prev.out ?? hold();
        if (ease?.i) frame.i = ease.i;
        else if (ease) frame.i = ease.i ?? hold().i;
      }
      return frame;
    }),
  };
}

function cycle({ hidden, rest, appearAt, landAt, holdUntil, goneAt, easeIn, easeOut }) {
  return keyframes([
    { t: 0, s: hidden, out: hold() },
    { t: appearAt, s: hidden, out: easeIn },
    { t: landAt, s: rest, out: hold() },
    { t: holdUntil, s: rest, out: easeOut },
    { t: goneAt, s: hidden, out: hold() },
    { t: OP, s: hidden },
  ]);
}

function transform({ p, s, o, r = 0 }) {
  return {
    o,
    r: typeof r === "number" ? staticProp(r) : r,
    p,
    a: staticProp([0, 0, 0]),
    s,
  };
}

function fill(sid) {
  return {
    ty: "fl",
    nm: "Fill",
    c: { a: 0, k: WHITE, sid },
    o: staticProp(100),
    r: 1,
  };
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

function ellipseLayer({ nm, ind, cx, cy, diameter, appearAt, landAt, holdUntil, goneAt, rise = 18 }) {
  return {
    ddd: 0,
    ty: 4,
    ind,
    nm,
    sr: 1,
    ip: 0,
    op: OP,
    st: 0,
    ks: transform({
      p: cycle({
        hidden: [cx, cy + rise, 0],
        rest: [cx, cy, 0],
        appearAt,
        landAt,
        holdUntil,
        goneAt,
        easeIn: SETTLE,
        easeOut: TRAVEL,
      }),
      s: cycle({
        hidden: [72, 72, 100],
        rest: [100, 100, 100],
        appearAt,
        landAt,
        holdUntil,
        goneAt,
        easeIn: SETTLE,
        easeOut: EXIT,
      }),
      o: cycle({
        hidden: [0],
        rest: [100],
        appearAt: appearAt + 2,
        landAt: landAt - 4,
        holdUntil: holdUntil + 2,
        goneAt: goneAt - 2,
        easeIn: ENTRANCE,
        easeOut: EXIT,
      }),
    }),
    shapes: [
      {
        ty: "gr",
        nm: `${nm} Group`,
        it: [
          {
            ty: "el",
            nm: "Eye",
            p: staticProp([0, 0]),
            s: staticProp([diameter, diameter]),
          },
          fill("markColor"),
          groupTransform(),
        ],
      },
    ],
  };
}

function diamondLayer({ nm, ind, cx, cy, appearAt, landAt, holdUntil, goneAt }) {
  return {
    ddd: 0,
    ty: 4,
    ind,
    nm,
    sr: 1,
    ip: 0,
    op: OP,
    st: 0,
    ks: transform({
      p: cycle({
        hidden: [cx, cy + 28, 0],
        rest: [cx, cy, 0],
        appearAt,
        landAt,
        holdUntil,
        goneAt,
        easeIn: SETTLE,
        easeOut: TRAVEL,
      }),
      s: cycle({
        hidden: [78, 78, 100],
        rest: [100, 100, 100],
        appearAt,
        landAt,
        holdUntil,
        goneAt,
        easeIn: SETTLE,
        easeOut: EXIT,
      }),
      o: cycle({
        hidden: [0],
        rest: [100],
        appearAt: appearAt + 2,
        landAt: landAt - 6,
        holdUntil: holdUntil + 2,
        goneAt: goneAt - 2,
        easeIn: ENTRANCE,
        easeOut: EXIT,
      }),
    }),
    shapes: [
      {
        ty: "gr",
        nm: `${nm} Group`,
        it: [
          {
            ty: "sh",
            nm: "Diamond",
            ks: {
              a: 0,
              k: {
                c: true,
                v: [
                  [0, -100.07],
                  [124.48, 0],
                  [0, 100.07],
                  [-124.48, 0],
                ],
                i: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                o: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
              },
            },
          },
          fill("markColor"),
          groupTransform(),
        ],
      },
    ],
  };
}

function textDocument() {
  return {
    t: "Lonora",
    f: "InterDisplaySemiBold",
    s: 72,
    fc: [1, 1, 1],
    sc: [1, 1, 1],
    sw: 0,
    of: false,
    j: 2,
    tr: 60,
    lh: 86,
    ls: 0,
  };
}

function wordmarkLayer() {
  const doc = textDocument();
  return {
    ddd: 0,
    ty: 5,
    ind: 4,
    nm: "Wordmark",
    sr: 1,
    ip: 0,
    op: OP,
    st: 0,
    ks: transform({
      p: cycle({
        hidden: [480, 656, 0],
        rest: [480, 640, 0],
        appearAt: 34,
        landAt: 64,
        holdUntil: 86,
        goneAt: 118,
        easeIn: SETTLE,
        easeOut: TRAVEL,
      }),
      s: staticProp([100, 100, 100]),
      o: cycle({
        hidden: [0],
        rest: [100],
        appearAt: 36,
        landAt: 60,
        holdUntil: 88,
        goneAt: 116,
        easeIn: ENTRANCE,
        easeOut: EXIT,
      }),
    }),
    t: {
      d: {
        k: [{ t: 0, s: doc }],
        sid: "brandName",
      },
      p: {
        a: 0,
        k: [0, 0],
      },
      m: {
        a: 0,
        k: 0,
      },
      a: [],
    },
  };
}

const lottie = {
  v: "5.7.0",
  fr: FR,
  ip: 0,
  op: OP,
  w: W,
  h: H,
  nm: "Lonora logo loop",
  ddd: 0,
  assets: [],
  fonts: {
    list: [
      {
        fName: "InterDisplaySemiBold",
        fFamily: "Inter Display SemiBold",
        fStyle: "Regular",
        ascent: 75,
      },
    ],
  },
  slots: {
    markColor: { p: { a: 0, k: WHITE } },
    brandName: {
      p: {
        a: 1,
        k: [{ t: 0, s: textDocument() }],
      },
    },
  },
  layers: [
    wordmarkLayer(),
    diamondLayer({
      nm: "Diamond",
      ind: 3,
      cx: 480,
      cy: 448.34,
      appearAt: 22,
      landAt: 54,
      holdUntil: 96,
      goneAt: 128,
    }),
    ellipseLayer({
      nm: "Right eye",
      ind: 2,
      cx: 705,
      cy: 178.13,
      diameter: 270,
      appearAt: 14,
      landAt: 44,
      holdUntil: 104,
      goneAt: 136,
    }),
    ellipseLayer({
      nm: "Left eye",
      ind: 1,
      cx: 255,
      cy: 178.13,
      diameter: 270,
      appearAt: 6,
      landAt: 38,
      holdUntil: 110,
      goneAt: 144,
    }),
  ],
};

const controls = {
  controls: [
    { sid: "markColor", label: "Mark color" },
    { sid: "brandName", label: "Brand name" },
  ],
};

function writeScene(dir, withFont) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "lottie.json"), `${JSON.stringify(lottie, null, 2)}\n`);
  writeFileSync(resolve(dir, "controls.json"), `${JSON.stringify(controls, null, 2)}\n`);
  if (withFont) {
    const fontSrc = resolve("/tmp/fonts/InterDisplay-SemiBold-Lonora.ttf");
    const committed = resolve(root, "public/brand/InterDisplay-SemiBold.ttf");
    const fallback = resolve("/tmp/fonts/extras/ttf/InterDisplay-SemiBold.ttf");
    const src = existsSync(fontSrc)
      ? fontSrc
      : existsSync(committed)
        ? committed
        : fallback;
    if (!existsSync(src)) {
      throw new Error(`Missing font at ${src}`);
    }
    copyFileSync(src, resolve(dir, "InterDisplay-SemiBold.ttf"));
  }
}

const playerScene = resolve("/tmp/text-to-lottie/public/projects/lonora/scene-1");
const appBrand = resolve(root, "public/brand");
const appLottie = resolve(appBrand, "lonora-logo-loop.json");

writeScene(playerScene, true);
writeFileSync(appLottie, `${JSON.stringify(lottie, null, 2)}\n`);
const appFontSrc = existsSync("/tmp/fonts/InterDisplay-SemiBold-Lonora.ttf")
  ? "/tmp/fonts/InterDisplay-SemiBold-Lonora.ttf"
  : "/tmp/fonts/extras/ttf/InterDisplay-SemiBold.ttf";
copyFileSync(appFontSrc, resolve(appBrand, "InterDisplay-SemiBold.ttf"));

JSON.parse(readFileSync(resolve(playerScene, "lottie.json"), "utf8"));
JSON.parse(readFileSync(appLottie, "utf8"));

console.log(`Wrote ${playerScene}/lottie.json`);
console.log(`Wrote ${appLottie}`);
