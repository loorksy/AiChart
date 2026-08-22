/**
 * Lot arithmetic for manual execution — pure and broker-parameterized.
 *
 * The USER picks the lots; these functions only (a) precompute an honest
 * suggestion from their own Risk-per-Trade setting and stop distance, and
 * (b) let the SERVER refuse impossible values (off-step, out of the
 * broker's bounds, or beyond free margin) with a short factual reason.
 * Nothing here advises, warns, or lectures.
 */

export interface VolumeBounds {
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
}

/** Decimal places implied by the step (0.01 → 2), for clean display math. */
function stepDecimals(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(6, text.length - dot - 1);
}

export function roundToStep(volume: number, step: number): number {
  if (!(step > 0)) return volume;
  const steps = Math.round(volume / step);
  return Number((steps * step).toFixed(stepDecimals(step)));
}

function floorToStep(volume: number, step: number): number {
  if (!(step > 0)) return volume;
  const steps = Math.floor(volume / step + 1e-9);
  return Number((steps * step).toFixed(stepDecimals(step)));
}

export interface SuggestVolumeInput extends VolumeBounds {
  balance: number;
  /** The operator's own Risk per Trade, percent (0.1–5). */
  riskPct: number;
  entry: number;
  stopLoss: number;
  contractSize: number;
}

export interface VolumeSuggestion {
  volume: number;
  riskAmount: number;
  stopDistance: number;
}

/**
 * Risk-based lots: riskAmount = balance × riskPct; one lot loses
 * stopDistance × contractSize at the stop, so lots = riskAmount / that.
 * Floored to the step (never rounds risk UP), clamped to broker bounds.
 */
export function suggestVolume(input: SuggestVolumeInput): VolumeSuggestion {
  const stopDistance = Math.abs(input.entry - input.stopLoss);
  const riskAmount = Math.max(0, input.balance) * (Math.max(0, input.riskPct) / 100);
  const perLotLoss = stopDistance * input.contractSize;
  const raw = perLotLoss > 0 ? riskAmount / perLotLoss : input.minVolume;
  const floored = floorToStep(raw, input.volumeStep);
  const volume = Math.min(
    input.maxVolume,
    Math.max(input.minVolume, floored > 0 ? floored : input.minVolume),
  );
  return { volume, riskAmount, stopDistance };
}

export type VolumeValidation =
  | { ok: true; volume: number }
  | { ok: false; code: "invalid_volume"; detail: string };

/** The server's own check of a user-chosen size against the broker's rules. */
export function validateVolume(
  requested: number,
  bounds: VolumeBounds,
): VolumeValidation {
  if (!Number.isFinite(requested) || requested <= 0) {
    return { ok: false, code: "invalid_volume", detail: "volume must be positive" };
  }
  if (requested < bounds.minVolume - 1e-9) {
    return {
      ok: false,
      code: "invalid_volume",
      detail: `below the broker minimum ${bounds.minVolume}`,
    };
  }
  if (requested > bounds.maxVolume + 1e-9) {
    return {
      ok: false,
      code: "invalid_volume",
      detail: `above the broker maximum ${bounds.maxVolume}`,
    };
  }
  const aligned = roundToStep(requested, bounds.volumeStep);
  if (Math.abs(aligned - requested) > 1e-9) {
    return {
      ok: false,
      code: "invalid_volume",
      detail: `volume must align to the ${bounds.volumeStep} step`,
    };
  }
  return { ok: true, volume: aligned };
}

/**
 * Margin the order would take, approximately: notional / leverage. The
 * broker remains the final authority — this exists so an impossible size is
 * refused HERE with "insufficient margin" instead of a broker round-trip.
 */
export function approxRequiredMargin(input: {
  volume: number;
  contractSize: number;
  price: number;
  leverage: number | null;
}): number | null {
  if (!input.leverage || input.leverage <= 0) return null;
  return (input.volume * input.contractSize * input.price) / input.leverage;
}
