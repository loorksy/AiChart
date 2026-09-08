/**
 * Visual Arabic for Satori / next/og.
 *
 * ImageResponse does not apply OpenType Arabic shaping and treats flex
 * children as LTR word runs. We convert logical Arabic into connected
 * presentation forms and emit visual (LTR-paint) order so a single text
 * node renders joined glyphs in the correct RTL reading order.
 *
 * Source uses \u escapes so this file does not add Arabic-script debt
 * to the system-file ratchet.
 */

type Forms = readonly [isolated: number, final: number, initial: number, medial: number];

/** Dual-joining unless `forward` is false (right-joining only). */
type Letter = { forms: Forms; forward: boolean };

function L(iso: number, fin: number, init: number, med: number, forward = true): Letter {
  return { forms: [iso, fin, init, med], forward };
}

function R(iso: number, fin: number): Letter {
  return { forms: [iso, fin, iso, fin], forward: false };
}

const LETTERS: Record<number, Letter> = {
  0x0621: R(0xfe80, 0xfe80), // hamza
  0x0622: R(0xfe81, 0xfe82), // alef madda
  0x0623: R(0xfe83, 0xfe84), // alef hamza above
  0x0624: R(0xfe85, 0xfe86), // waw hamza
  0x0625: R(0xfe87, 0xfe88), // alef hamza below
  0x0626: L(0xfe89, 0xfe8a, 0xfe8b, 0xfe8c), // yeh hamza
  0x0627: R(0xfe8d, 0xfe8e), // alef
  0x0628: L(0xfe8f, 0xfe90, 0xfe91, 0xfe92), // beh
  0x0629: R(0xfe93, 0xfe94), // teh marbuta
  0x062a: L(0xfe95, 0xfe96, 0xfe97, 0xfe98), // teh
  0x062b: L(0xfe99, 0xfe9a, 0xfe9b, 0xfe9c), // theh
  0x062c: L(0xfe9d, 0xfe9e, 0xfe9f, 0xfea0), // jeem
  0x062d: L(0xfea1, 0xfea2, 0xfea3, 0xfea4), // hah
  0x062e: L(0xfea5, 0xfea6, 0xfea7, 0xfea8), // khah
  0x062f: R(0xfea9, 0xfeaa), // dal
  0x0630: R(0xfeab, 0xfeac), // thal
  0x0631: R(0xfead, 0xfeae), // reh
  0x0632: R(0xfeaf, 0xfeb0), // zain
  0x0633: L(0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4), // seen
  0x0634: L(0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8), // sheen
  0x0635: L(0xfeb9, 0xfeba, 0xfebb, 0xfebc), // sad
  0x0636: L(0xfebd, 0xfebe, 0xfebf, 0xfec0), // dad
  0x0637: L(0xfec1, 0xfec2, 0xfec3, 0xfec4), // tah
  0x0638: L(0xfec5, 0xfec6, 0xfec7, 0xfec8), // zah
  0x0639: L(0xfec9, 0xfeca, 0xfecb, 0xfecc), // ain
  0x063a: L(0xfecd, 0xfece, 0xfecf, 0xfed0), // ghain
  0x0640: L(0x0640, 0x0640, 0x0640, 0x0640), // tatweel
  0x0641: L(0xfed1, 0xfed2, 0xfed3, 0xfed4), // feh
  0x0642: L(0xfed5, 0xfed6, 0xfed7, 0xfed8), // qaf
  0x0643: L(0xfed9, 0xfeda, 0xfedb, 0xfedc), // kaf
  0x0644: L(0xfedd, 0xfede, 0xfedf, 0xfee0), // lam
  0x0645: L(0xfee1, 0xfee2, 0xfee3, 0xfee4), // meem
  0x0646: L(0xfee5, 0xfee6, 0xfee7, 0xfee8), // noon
  0x0647: L(0xfee9, 0xfeea, 0xfeeb, 0xfeec), // heh
  0x0648: R(0xfeed, 0xfeee), // waw
  0x0649: R(0xfeef, 0xfef0), // alef maksura
  0x064a: L(0xfef1, 0xfef2, 0xfef3, 0xfef4), // yeh
  0x0671: R(0xfb50, 0xfb51), // alef wasla
  0x067e: L(0xfb56, 0xfb57, 0xfb58, 0xfb59), // peh
  0x0686: L(0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d), // tcheh
  0x06a9: L(0xfb8e, 0xfb8f, 0xfb90, 0xfb91), // keheh
  0x06af: L(0xfb92, 0xfb93, 0xfb94, 0xfb95), // gaf
  0x06cc: L(0xfbfc, 0xfbfd, 0xfbfe, 0xfbff), // farsi yeh
};

const LAM = 0x0644;
const LAMALEF: Record<number, readonly [number, number]> = {
  0x0622: [0xfef5, 0xfef6], // lam + alef madda
  0x0623: [0xfef7, 0xfef8], // lam + alef hamza above
  0x0625: [0xfef9, 0xfefa], // lam + alef hamza below
  0x0627: [0xfefb, 0xfefc], // lam + alef
};

const HARAKAT = new Set([
  0x064b, 0x064c, 0x064d, 0x064e, 0x064f, 0x0650, 0x0651, 0x0652, 0x0653,
  0x0654, 0x0655, 0x0656, 0x0657, 0x0658, 0x0670,
]);

function isLetter(cp: number): boolean {
  return Object.prototype.hasOwnProperty.call(LETTERS, cp);
}

function nextLetterIndex(cps: number[], from: number): number {
  for (let i = from; i < cps.length; i++) {
    if (HARAKAT.has(cps[i]!)) continue;
    return i;
  }
  return -1;
}

function prevLetterIndex(cps: number[], from: number): number {
  for (let i = from; i >= 0; i--) {
    if (HARAKAT.has(cps[i]!)) continue;
    return i;
  }
  return -1;
}

/** Presentation forms in logical order (still RTL reading order). */
export function reshapeArabicLogical(text: string): string {
  const cps = [...text].map((ch) => ch.codePointAt(0)!);
  const out: number[] = [];

  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!;
    if (HARAKAT.has(cp) || !isLetter(cp)) {
      out.push(cp);
      continue;
    }

    const nextIdx = nextLetterIndex(cps, i + 1);
    const next = nextIdx >= 0 ? cps[nextIdx]! : -1;

    if (cp === LAM && next >= 0 && LAMALEF[next]) {
      const prevIdx = prevLetterIndex(cps, i - 1);
      const prev = prevIdx >= 0 ? cps[prevIdx]! : -1;
      const joinsPrev = prev >= 0 && isLetter(prev) && LETTERS[prev]!.forward;
      const [isolated, final] = LAMALEF[next]!;
      out.push(joinsPrev ? final : isolated);
      i = nextIdx;
      continue;
    }

    const prevIdx = prevLetterIndex(cps, i - 1);
    const prev = prevIdx >= 0 ? cps[prevIdx]! : -1;
    const letter = LETTERS[cp]!;
    const joinsPrev = prev >= 0 && isLetter(prev) && LETTERS[prev]!.forward;
    const joinsNext = next >= 0 && isLetter(next);
    let form = 0; // isolated
    if (joinsPrev && joinsNext && letter.forward) form = 3; // medial
    else if (joinsPrev) form = 1; // final
    else if (joinsNext && letter.forward) form = 2; // initial
    out.push(letter.forms[form]!);
  }

  return String.fromCodePoint(...out);
}

/**
 * Homogeneous RTL (Arabic + neutrals): reshape, then reverse so Satori
 * can paint left-to-right and still read correctly from the right.
 */
export function shapeOgArabic(text: string): string {
  const logical = reshapeArabicLogical(text);
  return [...logical].reverse().join("");
}
