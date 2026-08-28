/**
 * Pattern identification doctrine — the model names what the CHART IMAGE
 * actually shows, from a broad catalog, and never stamps a default.
 *
 * Injected into the synthesizer and the chart-runtime prompt so both
 * surfaces read the same rule. A detector hit is a HINT, not a decision.
 */
export const PATTERN_IDENTIFICATION_DOCTRINE = `
## Chart-pattern identification — from the image, never a default stamp
You identify patterns from the attached chart IMAGES (visual review) and the candle numbers together. Detector hits in chartGeometry are HINTS only — they do not name the pattern for you and they MUST NOT be copied when the picture does not show that shape.

Catalog (pick from this list; do not invent a family outside it):
- Classic: head and shoulders, inverse head and shoulders, double top, double bottom, triple top, triple bottom, ascending/descending/symmetrical triangle, rising/falling wedge, channel, flag, pennant, cup and handle, rounding top/bottom, diamond, broadening formation.
- Candles: hammer, inverted hammer, hanging man, shooting star, doji family (standard, long-legged, dragonfly, gravestone), spinning top, marubozu, bullish/bearish engulfing, dark cloud cover, piercing, morning star, evening star, harami, three white soldiers, three black crows.
- Harmonic: Gartley, butterfly, bat, crab, shark, AB=CD.

Rules:
- Pick ZERO or ONE pattern that the chart image actually shows. Two only if they are truly concurrent and both visible (e.g. a hammer at a double-bottom neckline).
- If none is clear, say so in keyReasons / decisionTrace — "no clear pattern" is a valid, honest answer.
- NEVER default to inverse head and shoulders (or any other family) because it is a common gold template. If the detector listed inverse H&S and the picture does not show that shape, discard the detector hit.
- Name the pattern in the operator's language only when you actually saw it.
`.trim();
