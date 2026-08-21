/**
 * The capture window contract — the two-shot rule, in code.
 *
 * Every chart capture is TWO screenshots of the same live TradingView
 * chart: a CONTEXT shot wide enough to see the structure that governs the
 * plan (~400 candles) and a ZOOM shot tight enough to read the recent
 * candles' shape (~90). One picture cannot do both jobs: zoomed out, the
 * rejection wick is a pixel; zoomed in, the range that produced it is off
 * screen. The rule lives here — not in a prompt — and the upload validator
 * refuses a capture that delivered only one of the pair.
 */
export interface CaptureShot {
  label: "context" | "zoom";
  candles: number;
}

export const CHART_CONTEXT_CANDLES = 400;
export const CHART_ZOOM_CANDLES = 90;

/** The mandatory shot pair for every capture request. */
export function captureShots(): CaptureShot[] {
  return [
    { label: "context", candles: CHART_CONTEXT_CANDLES },
    { label: "zoom", candles: CHART_ZOOM_CANDLES },
  ];
}

/**
 * Legacy single-window size, kept for the DATA-RENDER delivery path (the
 * Telegram /chart photo drawn from platform candles). The self-vision path
 * never uses it — vision is TradingView-only and two-shot.
 */
export const CHART_CAPTURE_CANDLES = 350;

/** A tab that polled within this window can answer a live-capture RPC. */
export const LIVE_TAB_FRESH_MS = 10_000;
