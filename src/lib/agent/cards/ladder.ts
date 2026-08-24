/**
 * Where each level sits on the plan's price axis.
 *
 * Split out of the card purely so it can be tested: this is the only real
 * arithmetic in the signal card, and getting it wrong does not throw or fail
 * to compile — it draws a trade that isn't the trade, which is worse than
 * drawing nothing. A stop rendered on the profit side of the entry is a lie
 * told in a language the reader trusts more than prose.
 *
 * The axis carries no direction flag. A sell's stop is simply its highest
 * number and its targets its lowest, so plotting by price alone puts every
 * level where it belongs for both sides — one code path, no orientation branch
 * to get backwards.
 */

export type RungRole = "stop" | "entry" | "target" | "live";

export interface Rung {
  price: number;
  role: RungRole;
  /** 0 at the axis bottom (lowest price), 1 at the top (highest). */
  pos: number;
  /** Reward:risk at this target. Only ever set on targets. */
  rr?: number;
}

export interface LadderGeometry {
  rungs: Rung[];
  /** The stretch between entry and stop — what being wrong costs. */
  riskBand: { from: number; to: number };
  /** Entry to the furthest target — what being right pays. */
  rewardBand: { from: number; to: number };
}

export function buildLadder(input: {
  entry: number;
  stopLoss: number;
  targets: number[];
  livePrice?: number;
}): LadderGeometry {
  const risk = Math.abs(input.entry - input.stopLoss);
  const targets = input.targets.filter((v) => Number.isFinite(v));

  const raw: { price: number; role: RungRole; rr?: number }[] = [
    { price: input.stopLoss, role: "stop" },
    { price: input.entry, role: "entry" },
    ...targets.map((price) => ({
      price,
      role: "target" as const,
      // Undefined rather than Infinity when entry and stop coincide: a
      // reward:risk against zero risk is not a large number, it is no number.
      rr: risk > 0 ? Math.abs(price - input.entry) / risk : undefined,
    })),
  ];
  if (input.livePrice != null && Number.isFinite(input.livePrice)) {
    raw.push({ price: input.livePrice, role: "live" });
  }

  const prices = raw.map((r) => r.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min;
  // Every level at one price is not a plan; centre it rather than dividing
  // by zero and painting NaN into the style attribute.
  const pos = (price: number) => (span > 0 ? (price - min) / span : 0.5);

  const entryPos = pos(input.entry);
  const furthestTarget = targets.length
    ? targets.reduce(
        (far, v) => (Math.abs(v - input.entry) > Math.abs(far - input.entry) ? v : far),
        targets[0]!,
      )
    : input.entry;

  return {
    rungs: raw.map((r) => ({ ...r, pos: pos(r.price) })),
    riskBand: { from: entryPos, to: pos(input.stopLoss) },
    rewardBand: { from: entryPos, to: pos(furthestTarget) },
  };
}
