export type TradingCardActionHandler = (action: string, payload?: Record<string, unknown>) => void | Promise<void>;

export const CARD_ACTIONS = {
  openChart: "chart.open",
  showDrawing: "drawing.show",
  hideDrawing: "drawing.hide",
  clearDrawings: "drawing.clear",
  sendDrawingToMt5: "drawing.send_mt5",
  drawTradePlan: "trade_plan.draw",
  editTradePlan: "trade_plan.edit",
  sendTradePlanToMt5: "trade_plan.send_mt5",
  confirmOrder: "order_ticket.confirm",
  cancelOrder: "order_ticket.cancel",
  closePosition: "position.close",
  modifySlTp: "position.modify_sltp",
  moveSlBreakeven: "position.move_sl_breakeven",
  partialClose: "position.partial_close",
} as const;
