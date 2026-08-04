/**
 * Bid / ask as native TradingView horizontal lines on the price scale.
 *
 * Not markup layered on the pane — `createShape({ shape: "horizontal_line" })`
 * so the gap is a library-owned price-scale feature. Replaces the old
 * ChartLivePriceBadge dash card.
 */
import type { EntityId, IChartWidgetApi } from "@/vendor/tradingview/charting_library";

export type SpreadBook = {
  bid: number;
  ask: number;
};

const BID_COLOR = "#22c55e";
const ASK_COLOR = "#ef4444";

export class SpreadPriceLines {
  private bidId: EntityId | null = null;
  private askId: EntityId | null = null;
  private lastKey = "";

  constructor(private readonly chart: IChartWidgetApi) {}

  async update(book: SpreadBook | null): Promise<void> {
    if (
      !book ||
      !Number.isFinite(book.bid) ||
      !Number.isFinite(book.ask) ||
      book.bid <= 0 ||
      book.ask <= 0
    ) {
      await this.clear();
      return;
    }
    const key = `${book.bid}|${book.ask}`;
    if (key === this.lastKey && this.bidId && this.askId) return;
    this.lastKey = key;
    await this.clear();
    const now = Math.floor(Date.now() / 1000);
    try {
      this.bidId = await this.chart.createShape(
        { time: now, price: book.bid },
        {
          shape: "horizontal_line",
          text: `Bid ${book.bid}`,
          lock: true,
          disableSelection: true,
          disableSave: true,
          overrides: {
            linecolor: BID_COLOR,
            linewidth: 1,
            linestyle: 0,
            showLabel: true,
            textcolor: BID_COLOR,
            horzLabelsAlign: "right",
          },
        },
      );
      this.askId = await this.chart.createShape(
        { time: now, price: book.ask },
        {
          shape: "horizontal_line",
          text: `Ask ${book.ask}`,
          lock: true,
          disableSelection: true,
          disableSave: true,
          overrides: {
            linecolor: ASK_COLOR,
            linewidth: 1,
            linestyle: 0,
            showLabel: true,
            textcolor: ASK_COLOR,
            horzLabelsAlign: "right",
          },
        },
      );
    } catch {
      this.bidId = null;
      this.askId = null;
      this.lastKey = "";
    }
  }

  async clear(): Promise<void> {
    for (const id of [this.bidId, this.askId]) {
      if (!id) continue;
      try {
        this.chart.removeEntity(id);
      } catch {
        /* already gone */
      }
    }
    this.bidId = null;
    this.askId = null;
    this.lastKey = "";
  }
}
