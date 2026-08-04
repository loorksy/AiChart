---
name: pattern-atlas
version: 1.0.0
category: analysis
riskLevel: analysis
supportedLocales: ["ar", "en"]
allowedMarkets: ["forex"]
tags: ["patterns", "chart", "candlesticks", "structure", "liquidity", "atlas"]
description: Chart pattern, candlestick, structure and liquidity reference — formation stages, confirmation, invalidation, entries, stops, targets, hybrid and unclassified structures.
---

# Lonora Pattern Atlas

Reference knowledge for reading structure. Every entry answers the same
questions: how the shape builds, what confirms it, what kills it, where you can
enter *during* its formation as well as after, where the stop belongs, and how
the target is measured.

**This atlas is an aid, never a gate.** Three rules govern its use:

1. A pattern is not required for a recommendation. Most tradeable moments are
   not textbook shapes.
2. Never force price into a template that does not fit. An unnamed structure
   described honestly beats a named one described wrongly.
3. A structure still forming is not "nothing yet" — its boundary is often the
   best entry available, at higher risk, which you say out loud.

Detection is deterministic and arrives with each analysis: pattern type, break
state, **stage** (starting / forming / near completion / completed-unconfirmed /
confirmed / failed) and how much of the shape has formed. Use the stage to pick
the plan type; use this atlas to know what the shape implies.

---

## How to read the stages

| Stage | What it means | Typical plan |
|---|---|---|
| starting | The shape has barely begun; anchors are few. | Usually context, not a trade. Trade the level, not the pattern. |
| forming | Building, price inside the boundaries. | **Anticipatory** entry from a boundary with rejection; stop beyond that boundary. |
| near_completion | Pressing the level that would complete it. | Anticipatory from the boundary, or **conditional** on the break. |
| completed_unconfirmed | Closed beyond the boundary, no follow-through yet. | Immediate with a tight invalidation, or conditional on a retest. |
| confirmed | Break plus follow-through. | Immediate, or conditional on a pullback if the move ran too far. |
| failed | Broke the wrong way. | The failure itself is a signal — often the best trade is the other side. |

---

## Chart patterns

### Ascending triangle
Flat resistance with rising lows. Continuation in an uptrend, and a reversal
attempt when it forms after a decline.
- **Forming**: each low higher than the last, resistance touched twice or more.
- **Confirms**: close above resistance, ideally with expansion.
- **Fails**: close below the rising trendline — the demand that built it is gone.
- **Entries**: (a) anticipatory from the rising lows with rejection, stop under
  the last swing low, first target the flat resistance; (b) on the break close;
  (c) conditional on a retest of broken resistance.
- **Target**: triangle height projected from the break.
- **Weak when**: fewer than two clean touches per side, or the apex is very
  close — a squeeze breaks either way.

### Descending triangle
Flat support with falling highs. Mirror of the above.
- **Entries**: anticipatory short from the falling highs; on the break of
  support; or conditional on a retest from below.
- **Fails**: close above the descending trendline.

### Symmetrical triangle
Converging highs and lows; direction unknown until it breaks.
- **Anticipatory entries exist at BOTH boundaries** — trade the edge with a stop
  just beyond it, and let the break decide the bigger move.
- **Weak when**: near the apex, where the range no longer pays for its spread.

### Rising / falling wedge
Both boundaries slope the same way, converging. A rising wedge usually resolves
down, a falling wedge up — including inside trends, where they act as
exhaustion.
- **Entries**: anticipatory at the boundary in the expected resolution
  direction; conditional on the break.
- **Fails**: a decisive close through the boundary opposite the expected one.

### Bull / bear flag, pennant
A sharp impulse, then a shallow counter-drift. Continuation.
- **Forming**: the drift is orderly and shallow, retracing less than half the
  impulse.
- **Entries**: anticipatory from the flag's far boundary; on the break in the
  impulse direction; or conditional on a shallow retest.
- **Target**: flagpole height from the break.
- **Weak when**: the drift retraces most of the impulse — that is not a flag.

### Double top / double bottom
Two rejections at the same area, with a neckline between them.
- **Anticipatory entry is the second rejection**, before the neckline goes:
  stop beyond the extreme, first target the neckline. This is the classic case
  where waiting for confirmation costs most of the move.
- **Confirms**: close beyond the neckline.
- **Fails**: close beyond the two extremes — a failed double top often runs.
- **Target**: height from extreme to neckline, projected from the break.

### Triple top / bottom
As above with three touches. Each additional touch usually weakens the level
rather than strengthening it.

### Head and shoulders (and inverse)
Three peaks, the middle highest, with a neckline under the troughs.
- **Anticipatory entry is the right shoulder's rejection**, stop above it.
- **Confirms**: close beyond the neckline.
- **Weak when**: the shoulders are badly asymmetric, or the neckline slopes
  steeply against the expected break.
- **Target**: head-to-neckline height from the break.

### Rectangle / range
Horizontal support and resistance.
- **Entries**: from either edge with rejection (the bread and butter of a
  ranging market); on a break with expansion; or conditional on a retest.
- **Mid-range is a poor immediate entry** — it is not an absent opportunity, it
  is a plan waiting at an edge.
- **Watch for**: the sweep of one edge that reverses — often better than the
  break itself.

### Channel
Parallel boundaries, sloping.
- **Entries**: from the boundary in the trend direction; a counter-trend touch
  is a scalp, not a reversal, unless structure breaks.

### Cup and handle (and inverted)
A rounded base then a small drift against it. Continuation.
- **Entries**: anticipatory from the handle's low; on the break of the rim.
- **Weak when**: the cup is V-shaped rather than rounded.

---

## Breakouts, retests, and false breaks

- A **break** is a CLOSE beyond the level. A wick through is a sweep, not a
  break — that distinction is enforced by the detector and should be enforced in
  your language too.
- A **retest** is one option among several, never a rule to wait for: enter on
  the break, enter early from a good location, take part now and add on the
  retest, wait for the retest as a conditional plan, or skip the retest entirely
  when momentum makes a deep pullback unlikely. Say why this market got that
  choice.
- A **false break** — a close beyond that immediately reclaims — is one of the
  strongest reversal signals available. The stop sits beyond the false-break
  extreme.

---

## Candlestick shapes

Detected live and delivered with each analysis. They mark a moment, not a trade:
they matter most **at a level**, and mean little in the middle of a range.

- **Doji** — indecision. Meaningful at an extreme, noise elsewhere.
- **Hammer** (after a decline) / **hanging man** (after a rally) — same shape,
  opposite meaning; the prior move is what names it.
- **Inverted hammer** / **shooting star** — long upper shadow; the second, after
  a rally, is the rejection you can act on.
- **Marubozu** — a body with almost no shadows; conviction in that direction.
- **Spinning top** — small body, both shadows; balance.
- **Bullish / bearish engulfing** — the new body swallows the last; strongest at
  a zone edge.
- **Morning star / evening star** — three bars: impulse, pause, reversal.
- **Three white soldiers / three black crows** — three consecutive conviction
  bars; continuation, and often late.
- **Harami** — inside bar; momentum stalling, not yet reversing.
- **Tweezer top / bottom** — matched extremes on consecutive bars; a level being
  defended.

---

## Structure and liquidity

- **Break of structure (BOS)** — a close beyond the prior swing in the trend
  direction. Continuation evidence.
- **Change of character (CHoCH) / market structure shift** — the first close
  beyond the opposing swing. The earliest reversal evidence, and the anchor for
  anticipatory reversal entries.
- **Liquidity sweep** — a wick through an obvious pool (equal highs/lows, a
  session extreme) that closes back inside. A sweep ALONE is not a trade; a
  sweep followed by a structure shift usually is.
- **Equal highs / equal lows** — resting orders. Price tends to reach for them,
  which makes them targets as often as barriers.
- **Supply / demand rejection** — an impulse leaving a zone marks it; the first
  return is the cleanest test, and each subsequent one is weaker.
- **Accumulation / distribution** — range with sweeps in both directions before
  a decisive move. Trade the edges until the range resolves.

---

## Hybrid structures

Two shapes overlapping, or one that shares features of several — a triangle
whose upper boundary is also a double-top neckline, a flag inside a wedge.

- Do not pick a name and force the rest to fit. Describe what is actually there:
  the boundaries, the touches, the direction of pressure.
- The entry and stop come from the **level**, not the label.
- Say "hybrid" plainly. It is more honest and more useful than a wrong name.

## Unclassified structures

Price forms shapes with no name at all. This is normal, not a failure of
analysis, and it is never a reason to withhold a direction.

- Work from primitives: where are the highs and lows, which side is being
  defended, where is liquidity resting, where did the last impulse start?
- Build the plan from those levels exactly as you would from a named pattern:
  an entry area, a stop where the idea is wrong, a target at real structure.
- State that the structure is unclassified so the operator knows the plan rests
  on direct reading rather than a known template — and that the absence of a
  name says nothing about the quality of the setup.
