//+------------------------------------------------------------------+
//|                                              AiChartBridge.mq5    |
//|       Connects a MetaTrader 5 terminal to the AiChart platform   |
//|       via the self-hosted EA bridge API (heartbeat + commands).  |
//+------------------------------------------------------------------+
#property copyright "AiChart"
#property link      "https://aichart.lork.cloud"
#property version   "3.00"
#property strict

#include <Trade/Trade.mqh>

//--- Inputs --------------------------------------------------------
input string  ApiBase          = "https://aichart.lork.cloud"; // AiChart base URL (ApiKey = EaToken)
input string  EaToken          = "";                            // EA token from AiChart settings
input string  StreamSymbol     = "EURUSD";                      // Symbol to stream candles for
input ENUM_TIMEFRAMES StreamTF = PERIOD_H1;                     // Candle timeframe
input int     CandleCount      = 200;                           // Candles per heartbeat
input int     HeartbeatSeconds = 30;                            // Heartbeat interval (seconds)
input int     PollIntervalMs   = 1000;                          // Command poll interval (ms)
input bool    AllowNoSL        = false;                         // Allow trades without stop loss
input int     MaxRetries       = 3;                             // Retries for broker busy / requote
input int     RetryDelayMs     = 500;                           // Delay between retries (ms)
input bool    AutoSync         = true;                          // Immediate heartbeat on position change
input int     MaxSymbols       = 40;                            // Max symbols in Market Watch to report
input int     QuoteFlushSeconds = 1;                            // Live quote push interval (seconds)
input int     QuoteWaitAttempts = 8;                            // Ticks to wait before off-quotes fail
input int     QuoteWaitDelayMs  = 250;                          // Delay between quote wait attempts (ms)

CTrade  trade;
long    g_last_acked = 0;
long    g_acked_ids[32];
int     g_acked_count = 0;
int     g_hb_failures = 0;
bool    g_trading_halted = false;
datetime g_last_sync_hb = 0;
datetime g_last_hb_time = 0;
datetime g_last_quote_flush = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(EaToken) < 8)
   {
      Print("AiChartBridge: EaToken is not set. Open EA properties and paste your token.");
      return(INIT_FAILED);
   }
   // FIX: 1 — millisecond timer drives poll + heartbeat scheduling in OnTimer
   EventSetMillisecondTimer(MathMax(200, PollIntervalMs));
   Print("AiChartBridge MT5 v3 started. Base=", ApiBase, " hb=", HeartbeatSeconds, "s poll=", PollIntervalMs, "ms quotes=", QuoteFlushSeconds, "s");
   PreWarmSymbols();
   // FIX: 1 — immediate heartbeat on attach
   SendHeartbeat();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
// FIX: 1 — OnTradeTransaction triggers debounced sync heartbeat
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(!AutoSync) return;
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD &&
      trans.type != TRADE_TRANSACTION_ORDER_ADD &&
      trans.type != TRADE_TRANSACTION_POSITION)
      return;
   datetime now = TimeCurrent();
   if(now - g_last_sync_hb < 2) return;
   g_last_sync_hb = now;
   // v3 — immediate trade event + sync heartbeat
   SendTradeEvent("trade_transaction", trans.symbol, (long)trans.deal);
   SendHeartbeat();
}

//+------------------------------------------------------------------+
void OnTimer()
{
   static ulong lastPollMs = 0;
   ulong nowMs = GetTickCount64();
   if(nowMs - lastPollMs >= (ulong)MathMax(200, PollIntervalMs))
   {
      lastPollMs = nowMs;
      PollCommands();
   }

   datetime now = TimeCurrent();
   if(g_last_hb_time == 0 || now - g_last_hb_time >= HeartbeatSeconds)
   {
      g_last_hb_time = now;
      SendHeartbeat();
   }

   if(QuoteFlushSeconds > 0 &&
      (g_last_quote_flush == 0 || now - g_last_quote_flush >= QuoteFlushSeconds))
   {
      g_last_quote_flush = now;
      FlushLiveQuotes();
   }
}

//+------------------------------------------------------------------+
// FIX: 1 — resilient heartbeat (no silent drop on transient failure)
void SendHeartbeat()
{
   string body = BuildHeartbeat();
   string resp = "";
   if(!HttpPost("/api/ea/heartbeat", body, resp))
   {
      g_hb_failures++;
      if(g_hb_failures == 1 || g_hb_failures % 10 == 0)
         Print("AiChartBridge: heartbeat failed (", g_hb_failures, "). Check WebRequest URL and network.");
      return;
   }
   if(g_hb_failures > 0)
   {
      Print("AiChartBridge: heartbeat restored after ", g_hb_failures, " failure(s).");
      g_hb_failures = 0;
   }
   // FIX: 6 — process kill switch flags from server (commands via PollCommands)
   ProcessKillSwitchFlags(resp);
}

//+------------------------------------------------------------------+
void PollCommands()
{
   string resp = "";
   if(!HttpGet("/api/ea/commands", resp))
      return;
   ProcessCommands(resp);
}

//+------------------------------------------------------------------+
//| Heartbeat JSON                                                   |
//+------------------------------------------------------------------+
string BuildHeartbeat()
{
   string login    = (string)AccountInfoInteger(ACCOUNT_LOGIN);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   string broker   = AccountInfoString(ACCOUNT_COMPANY);
   long   tradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string modeStr  = "demo";
   if(tradeMode == ACCOUNT_TRADE_MODE_REAL) modeStr = "live";
   else if(tradeMode == ACCOUNT_TRADE_MODE_CONTEST) modeStr = "contest";

   string json = "{";
   json += "\"account\":{";
   json += "\"login\":\"" + login + "\",";
   json += "\"currency\":\"" + currency + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"broker\":" + JsonStr(broker) + ",";
   json += "\"trade_mode\":" + JsonStr(modeStr);
   json += "},";
   json += "\"symbols\":" + BuildSymbols() + ",";
   json += "\"positions\":" + BuildPositions() + ",";
   json += "\"candles\":" + BuildCandles();
   json += "}";
   return json;
}

string BuildPositions()
{
   string arr = "[";
   int total = PositionsTotal();
   int count = 0;
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;

      string sym  = PositionGetString(POSITION_SYMBOL);
      long   ptype = PositionGetInteger(POSITION_TYPE);
      double lots = PositionGetDouble(POSITION_VOLUME);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      double prof = PositionGetDouble(POSITION_PROFIT);
      string side = (ptype == POSITION_TYPE_SELL) ? "sell" : "buy";

      if(count > 0) arr += ",";
      arr += "{";
      arr += "\"ticket\":" + (string)ticket + ",";
      arr += "\"symbol\":" + JsonStr(sym) + ",";
      arr += "\"side\":" + JsonStr(side) + ",";
      arr += "\"lots\":" + DoubleToString(lots, 2) + ",";
      arr += "\"open_price\":" + DoubleToString(open, 5) + ",";
      arr += "\"sl\":" + DoubleToString(sl, 5) + ",";
      arr += "\"tp\":" + DoubleToString(tp, 5) + ",";
      arr += "\"profit\":" + DoubleToString(prof, 2);
      arr += "}";
      count++;
   }
   arr += "]";
   return arr;
}

string BuildSymbols()
{
   string arr = "[";
   int total = SymbolsTotal(true);
   int count = 0;
   for(int i = 0; i < total && count < MaxSymbols; i++)
   {
      string sym = SymbolName(i, true);
      if(sym == "") continue;
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      long   digits = SymbolInfoInteger(sym, SYMBOL_DIGITS);
      double point  = SymbolInfoDouble(sym, SYMBOL_POINT);
      double cs     = SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);
      double tv     = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
      double ts     = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
      double minlot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
      double maxlot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
      double lstep  = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
      long   stopsLevel  = SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL);
      long   freezeLevel = SymbolInfoInteger(sym, SYMBOL_TRADE_FREEZE_LEVEL);

      if(count > 0) arr += ",";
      arr += "{";
      arr += "\"symbol\":" + JsonStr(sym) + ",";
      arr += "\"bid\":" + DoubleToString(bid, (int)digits) + ",";
      arr += "\"ask\":" + DoubleToString(ask, (int)digits) + ",";
      arr += "\"digits\":" + (string)digits + ",";
      arr += "\"point\":" + DoubleToString(point, 8) + ",";
      arr += "\"contract_size\":" + DoubleToString(cs, 2) + ",";
      arr += "\"tick_value\":" + DoubleToString(tv, 5) + ",";
      arr += "\"tick_size\":" + DoubleToString(ts, 8) + ",";
      arr += "\"min_lot\":" + DoubleToString(minlot, 2) + ",";
      arr += "\"max_lot\":" + DoubleToString(maxlot, 2) + ",";
      arr += "\"lot_step\":" + DoubleToString(lstep, 2) + ",";
      arr += "\"stops_level\":" + (string)stopsLevel + ",";
      arr += "\"freeze_level\":" + (string)freezeLevel;
      arr += "}";
      count++;
   }
   arr += "]";
   return arr;
}

string BuildCandles()
{
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int got = CopyRates(StreamSymbol, StreamTF, 0, CandleCount, rates);
   string interval = TfToString(StreamTF);
   string bars = "[";
   for(int i = got - 1; i >= 0; i--)
   {
      if(bars != "[") bars += ",";
      bars += "{";
      bars += "\"time\":" + (string)(long)rates[i].time + ",";
      bars += "\"open\":" + DoubleToString(rates[i].open, 5) + ",";
      bars += "\"high\":" + DoubleToString(rates[i].high, 5) + ",";
      bars += "\"low\":" + DoubleToString(rates[i].low, 5) + ",";
      bars += "\"close\":" + DoubleToString(rates[i].close, 5);
      bars += "}";
   }
   bars += "]";
   string json = "{";
   json += "\"symbol\":" + JsonStr(StreamSymbol) + ",";
   json += "\"interval\":" + JsonStr(interval) + ",";
   json += "\"bars\":" + bars;
   json += "}";
   return json;
}

//+------------------------------------------------------------------+
//| Command processing                                               |
//+------------------------------------------------------------------+
void ProcessCommands(string resp)
{
   int ci = StringFind(resp, "\"commands\"");
   if(ci < 0) return;
   int br = StringFind(resp, "[", ci);
   if(br < 0) return;

   int depth = 0;
   int objStart = -1;
   for(int p = br; p < StringLen(resp); p++)
   {
      ushort ch = StringGetCharacter(resp, p);
      if(ch == '{')
      {
         if(depth == 0) objStart = p;
         depth++;
      }
      else if(ch == '}')
      {
         depth--;
         if(depth == 0 && objStart >= 0)
         {
            string obj = StringSubstr(resp, objStart, p - objStart + 1);
            HandleCommand(obj);
            objStart = -1;
         }
      }
      else if(ch == ']' && depth == 0)
         break;
   }
}

void HandleCommand(string obj)
{
   long   id   = (long)JsonNum(obj, "id");
   string type = JsonStrVal(obj, "type");
   if(id <= 0) return;
   if(IsCommandAcked(id)) return;

   string payload = PayloadBlock(obj);

   if(type == "open_market")
   {
      // FIX: 6 — reject new trades while kill switch active
      if(g_trading_halted)
      {
         AckCommand(id, "failed", 0, 0, 0, "kill switch active");
         return;
      }
      string sym  = PayloadStrVal(payload, obj, "symbol");
      string side = PayloadStrVal(payload, obj, "side");
      double lots = PayloadNum(payload, obj, "lots");
      double sl   = PayloadNum(payload, obj, "stop_loss");
      double tp   = PayloadNum(payload, obj, "take_profit");
      ExecuteMarket(id, sym, side, lots, sl, tp);
   }
   else if(type == "close_position")
   {
      long ticket = (long)PayloadNum(payload, obj, "ticket");
      ClosePosition(id, ticket);
   }
   else if(type == "modify_sl_tp")
   {
      // FIX: 5 — remote SL/TP modify
      long ticket = (long)PayloadNum(payload, obj, "ticket");
      double sl = PayloadNum(payload, obj, "stop_loss");
      double tp = PayloadNum(payload, obj, "take_profit");
      ModifyPosition(id, ticket, sl, tp);
   }
   else if(type == "draw_and_capture")
   {
      DrawAndCapture(id, payload);
   }
   else if(type == "clear_chart")
   {
      ClearChartCommand(id, payload);
   }
   else if(type == "open_pending")
   {
      if(g_trading_halted)
      {
         AckCommand(id, "failed", 0, 0, 0, "kill switch active");
         return;
      }
      string sym = PayloadStrVal(payload, obj, "symbol");
      string side = PayloadStrVal(payload, obj, "side");
      string orderType = PayloadStrVal(payload, obj, "order_type");
      double lots = PayloadNum(payload, obj, "lots");
      double price = PayloadNum(payload, obj, "price");
      double sl = PayloadNum(payload, obj, "stop_loss");
      double tp = PayloadNum(payload, obj, "take_profit");
      ExecutePending(id, sym, side, orderType, lots, price, sl, tp);
   }
   else if(type == "cancel_order")
   {
      long ticket = (long)PayloadNum(payload, obj, "ticket");
      CancelOrderCommand(id, ticket);
   }
   else if(type == "close_partial")
   {
      long ticket = (long)PayloadNum(payload, obj, "ticket");
      double lots = PayloadNum(payload, obj, "lots");
      ClosePartial(id, ticket, lots);
   }
   else if(type == "ensure_symbol")
   {
      string sym = PayloadStrVal(payload, obj, "symbol");
      EnsureSymbol(id, sym);
   }
   else if(type == "query_terminal")
   {
      QueryTerminal(id);
   }
   else
   {
      AckCommand(id, "failed", 0, 0, 0, "unsupported command type");
   }
}

// v3 — pre-warm Market Watch symbols for live ticks
void PreWarmSymbols()
{
   string core[] = {"EURUSD", "GBPUSD", "USDJPY", "XAUUSD"};
   for(int i = 0; i < ArraySize(core); i++)
      SymbolSelect(core[i], true);
   if(StreamSymbol != "")
      SymbolSelect(StreamSymbol, true);
   int total = SymbolsTotal(true);
   for(int j = 0; j < total && j < MaxSymbols; j++)
   {
      string s = SymbolName(j, true);
      if(s != "") SymbolSelect(s, true);
   }
}

// v3 — wait for live bid/ask after SymbolSelect
bool WaitForLiveQuotes(string sym)
{
   if(!SymbolSelect(sym, true)) return false;
   for(int attempt = 0; attempt < MathMax(1, QuoteWaitAttempts); attempt++)
   {
      long tradeMode = SymbolInfoInteger(sym, SYMBOL_TRADE_MODE);
      if(tradeMode == SYMBOL_TRADE_MODE_DISABLED) return false;

      MqlTick tick;
      if(SymbolInfoTick(sym, tick) && tick.bid > 0 && tick.ask > 0)
         return true;

      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      if(bid > 0 && ask > 0) return true;

      Sleep(MathMax(50, QuoteWaitDelayMs));
   }
   return false;
}

// FIX: 3 — retry broker busy (10027), requote (10004), off quotes (10026)
bool TryMarketOrder(string sym, string side, double lots, double sl, double tp, uint &retcode)
{
   for(int attempt = 0; attempt < MathMax(1, MaxRetries); attempt++)
   {
      if(!WaitForLiveQuotes(sym))
      {
         retcode = 10026;
         Sleep(MathMax(100, RetryDelayMs));
         continue;
      }

      trade.SetDeviationInPoints(20);
      bool ok = false;
      if(side == "buy")
         ok = trade.Buy(lots, sym, 0.0, sl, tp, "AiChart");
      else
         ok = trade.Sell(lots, sym, 0.0, sl, tp, "AiChart");

      if(ok)
      {
         retcode = trade.ResultRetcode();
         return true;
      }

      retcode = trade.ResultRetcode();
      if(retcode == 10027 || retcode == 10004 || retcode == 10026)
      {
         Sleep(MathMax(100, RetryDelayMs));
         continue;
      }
      break;
   }
   return false;
}

bool TryPositionClose(ulong ticket, uint &retcode)
{
   for(int attempt = 0; attempt < MathMax(1, MaxRetries); attempt++)
   {
      if(trade.PositionClose(ticket))
      {
         retcode = trade.ResultRetcode();
         return true;
      }
      retcode = trade.ResultRetcode();
      if(retcode == 10027 || retcode == 10004)
      {
         Sleep(MathMax(100, RetryDelayMs));
         continue;
      }
      break;
   }
   return false;
}

bool TryPositionModify(ulong ticket, double sl, double tp, uint &retcode)
{
   for(int attempt = 0; attempt < MathMax(1, MaxRetries); attempt++)
   {
      if(trade.PositionModify(ticket, sl, tp))
      {
         retcode = trade.ResultRetcode();
         return true;
      }
      retcode = trade.ResultRetcode();
      if(retcode == 10027 || retcode == 10004)
      {
         Sleep(MathMax(100, RetryDelayMs));
         continue;
      }
      break;
   }
   return false;
}

void ExecuteMarket(long id, string sym, string side, double lots, double sl, double tp)
{
   if(sym == "" || lots <= 0)
   {
      AckCommand(id, "failed", 0, 0, 0, "invalid order params");
      return;
   }
   // FIX: 7 — require stop loss unless explicitly allowed
   if(!AllowNoSL && sl <= 0)
   {
      AckCommand(id, "failed", 0, 0, 0, "stop_loss required");
      return;
   }
   if(!SymbolSelect(sym, true))
   {
      AckCommand(id, "failed", 0, 0, 0, "symbol not found: " + sym);
      return;
   }
   if(!WaitForLiveQuotes(sym))
   {
      AckCommand(id, "failed", 0, 0, 0, "off quotes: no live bid/ask for " + sym);
      return;
   }

   uint retcode = 0;
   if(TryMarketOrder(sym, side, lots, sl, tp, retcode))
   {
      long   ticket = (long)trade.ResultOrder();
      double price  = trade.ResultPrice();
      MarkCommandAcked(id);
      AckCommand(id, "acked", ticket, price, lots, "");
   }
   else
   {
      AckCommand(id, "failed", 0, 0, 0, "retcode " + (string)retcode);
   }
}

void ClosePosition(long id, long ticket)
{
   uint retcode = 0;
   if(TryPositionClose((ulong)ticket, retcode))
   {
      MarkCommandAcked(id);
      AckCommand(id, "acked", ticket, 0, 0, "");
   }
   else
      AckCommand(id, "failed", ticket, 0, 0, "close failed retcode " + (string)retcode);
}

// FIX: 5 — modify SL/TP on open position
void ModifyPosition(long id, long ticket, double sl, double tp)
{
   if(ticket <= 0)
   {
      AckCommand(id, "failed", 0, 0, 0, "invalid ticket");
      return;
   }
   if(!PositionSelectByTicket((ulong)ticket))
   {
      AckCommand(id, "failed", ticket, 0, 0, "position not found");
      return;
   }

   double curSl = PositionGetDouble(POSITION_SL);
   double curTp = PositionGetDouble(POSITION_TP);
   double newSl = (sl > 0) ? sl : curSl;
   double newTp = (tp > 0) ? tp : curTp;

   uint retcode = 0;
   if(TryPositionModify((ulong)ticket, newSl, newTp, retcode))
   {
      MarkCommandAcked(id);
      AckCommand(id, "acked", ticket, 0, 0, "");
   }
   else
      AckCommand(id, "failed", ticket, 0, 0, "modify failed retcode " + (string)retcode);
}

// v3 — pending limit/stop orders
void ExecutePending(long id, string sym, string side, string orderType, double lots, double price, double sl, double tp)
{
   if(sym == "" || lots <= 0 || price <= 0)
   {
      AckCommand(id, "failed", 0, 0, 0, "invalid pending order params");
      return;
   }
   if(!AllowNoSL && sl <= 0)
   {
      AckCommand(id, "failed", 0, 0, 0, "stop_loss required");
      return;
   }
   if(!SymbolSelect(sym, true))
   {
      AckCommand(id, "failed", 0, 0, 0, "symbol not found: " + sym);
      return;
   }
   if(!WaitForLiveQuotes(sym))
   {
      AckCommand(id, "failed", 0, 0, 0, "off quotes: no live bid/ask for " + sym);
      return;
   }

   trade.SetDeviationInPoints(20);
   bool ok = false;
   long placedTicket = 0;
   bool isBuy = (side == "buy");
   string ot = orderType;
   if(ot == "limit")
   {
      if(isBuy)
         ok = trade.BuyLimit(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, "AiChart");
      else
         ok = trade.SellLimit(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, "AiChart");
   }
   else if(ot == "stop")
   {
      if(isBuy)
         ok = trade.BuyStop(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, "AiChart");
      else
         ok = trade.SellStop(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, "AiChart");
   }
   else if(ot == "stop_limit")
   {
      MqlTradeRequest req;
      MqlTradeResult  res;
      ZeroMemory(req);
      ZeroMemory(res);
      req.action       = TRADE_ACTION_PENDING;
      req.symbol       = sym;
      req.volume       = lots;
      req.type         = isBuy ? ORDER_TYPE_BUY_STOP_LIMIT : ORDER_TYPE_SELL_STOP_LIMIT;
      req.price        = price;
      req.stoplimit    = price;
      req.sl           = (sl > 0) ? sl : 0;
      req.tp           = (tp > 0) ? tp : 0;
      req.type_time    = ORDER_TIME_GTC;
      req.type_filling = ORDER_FILLING_RETURN;
      req.comment      = "AiChart";
      ok = OrderSend(req, res) &&
           (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED);
      if(ok) placedTicket = (long)res.order;
   }
   else
   {
      AckCommand(id, "failed", 0, 0, 0, "unsupported order_type: " + ot);
      return;
   }

   if(ok)
   {
      long ticket = placedTicket > 0 ? placedTicket : (long)trade.ResultOrder();
      MarkCommandAcked(id);
      AckCommand(id, "acked", ticket, price, lots, "");
   }
   else
      AckCommand(id, "failed", 0, 0, 0, "retcode " + (string)trade.ResultRetcode());
}

void CancelOrderCommand(long id, long ticket)
{
   if(ticket <= 0)
   {
      AckCommand(id, "failed", 0, 0, 0, "invalid ticket");
      return;
   }
   if(trade.OrderDelete((ulong)ticket))
   {
      MarkCommandAcked(id);
      AckCommand(id, "acked", ticket, 0, 0, "");
   }
   else
      AckCommand(id, "failed", ticket, 0, 0, "cancel failed retcode " + (string)trade.ResultRetcode());
}

void ClosePartial(long id, long ticket, double lots)
{
   if(ticket <= 0 || lots <= 0)
   {
      AckCommand(id, "failed", 0, 0, 0, "invalid partial close params");
      return;
   }
   if(!PositionSelectByTicket((ulong)ticket))
   {
      AckCommand(id, "failed", ticket, 0, 0, "position not found");
      return;
   }
   uint retcode = 0;
   for(int attempt = 0; attempt < MathMax(1, MaxRetries); attempt++)
   {
      if(trade.PositionClosePartial((ulong)ticket, lots))
      {
         retcode = trade.ResultRetcode();
         MarkCommandAcked(id);
         AckCommand(id, "acked", ticket, trade.ResultPrice(), lots, "");
         return;
      }
      retcode = trade.ResultRetcode();
      if(retcode == 10027 || retcode == 10004 || retcode == 10026)
      {
         Sleep(MathMax(100, RetryDelayMs));
         continue;
      }
      break;
   }
   AckCommand(id, "failed", ticket, 0, 0, "partial close retcode " + (string)retcode);
}

void EnsureSymbol(long id, string sym)
{
   if(sym == "")
   {
      AckCommand(id, "failed", 0, 0, 0, "symbol required");
      return;
   }
   if(WaitForLiveQuotes(sym))
   {
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      string inner = "\"symbol\":" + JsonStr(sym) + ",\"bid\":" + DoubleToString(bid, 5) + ",\"ask\":" + DoubleToString(ask, 5);
      MarkCommandAcked(id);
      AckCommandEx(id, "acked", inner, "");
   }
   else
      AckCommand(id, "failed", 0, 0, 0, "off quotes: no live bid/ask for " + sym);
}

void QueryTerminal(long id)
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin = AccountInfoDouble(ACCOUNT_MARGIN);
   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double profit = AccountInfoDouble(ACCOUNT_PROFIT);
   long leverage = AccountInfoInteger(ACCOUNT_LEVERAGE);

   string pending = "[";
   int pc = 0;
   for(int i = 0; i < OrdersTotal(); i++)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(!OrderSelect(ticket)) continue;
      if(pc > 0) pending += ",";
      pending += "{";
      pending += "\"ticket\":" + (string)(long)ticket + ",";
      pending += "\"symbol\":" + JsonStr(OrderGetString(ORDER_SYMBOL)) + ",";
      pending += "\"type\":" + (string)OrderGetInteger(ORDER_TYPE) + ",";
      pending += "\"volume\":" + DoubleToString(OrderGetDouble(ORDER_VOLUME_CURRENT), 2) + ",";
      pending += "\"price\":" + DoubleToString(OrderGetDouble(ORDER_PRICE_OPEN), 5);
      pending += "}";
      pc++;
   }
   pending += "]";

   string inner = "\"balance\":" + DoubleToString(balance, 2) + ",";
   inner += "\"equity\":" + DoubleToString(equity, 2) + ",";
   inner += "\"margin\":" + DoubleToString(margin, 2) + ",";
   inner += "\"free_margin\":" + DoubleToString(freeMargin, 2) + ",";
   inner += "\"profit\":" + DoubleToString(profit, 2) + ",";
   inner += "\"leverage\":" + (string)leverage + ",";
   inner += "\"positions_count\":" + (string)PositionsTotal() + ",";
   inner += "\"pending_orders\":" + pending;

   MarkCommandAcked(id);
   AckCommandEx(id, "acked", inner, "");
}

// v3 — push live quotes to server
void FlushLiveQuotes()
{
   string arr = "[";
   int total = SymbolsTotal(true);
   int count = 0;
   for(int i = 0; i < total && count < MaxSymbols; i++)
   {
      string sym = SymbolName(i, true);
      if(sym == "") continue;
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      if(bid <= 0 && ask <= 0) continue;
      datetime tickTime = (datetime)SymbolInfoInteger(sym, SYMBOL_TIME);

      if(count > 0) arr += ",";
      arr += "{";
      arr += "\"symbol\":" + JsonStr(sym) + ",";
      arr += "\"bid\":" + DoubleToString(bid, 8) + ",";
      arr += "\"ask\":" + DoubleToString(ask, 8) + ",";
      arr += "\"tick_time\":" + (string)(long)tickTime;
      arr += "}";
      count++;
   }
   arr += "]";
   if(count == 0) return;

   string body = "{\"quotes\":" + arr + "}";
   string resp = "";
   HttpPost("/api/ea/quotes", body, resp);
}

// v3 — immediate trade event push
void SendTradeEvent(string eventType, string sym, long dealId)
{
   string body = "{";
   body += "\"type\":" + JsonStr(eventType) + ",";
   body += "\"symbol\":" + JsonStr(sym) + ",";
   body += "\"deal_id\":" + (string)dealId + ",";
   body += "\"time\":" + (string)(long)TimeCurrent();
   body += "}";
   string resp = "";
   HttpPost("/api/ea/event", body, resp);
}

// FIX: 6 — close every open position (kill switch)
void CloseAllPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      uint retcode = 0;
      TryPositionClose(ticket, retcode);
   }
}

// FIX: 6 — parse kill_switch flags from heartbeat JSON
void ProcessKillSwitchFlags(string resp)
{
   int fi = StringFind(resp, "\"flags\"");
   if(fi < 0) return;
   int blockStart = StringFind(resp, "{", fi);
   if(blockStart < 0) return;

   int depth = 0;
   string flagsBlock = "";
   for(int p = blockStart; p < StringLen(resp); p++)
   {
      ushort ch = StringGetCharacter(resp, p);
      if(ch == '{') depth++;
      else if(ch == '}')
      {
         depth--;
         if(depth == 0)
         {
            flagsBlock = StringSubstr(resp, blockStart, p - blockStart + 1);
            break;
         }
      }
   }
   if(flagsBlock == "") return;

   bool killOn = JsonBool(flagsBlock, "kill_switch");
   bool closeOpen = JsonBool(flagsBlock, "close_open_trades");

   if(killOn && !g_trading_halted)
   {
      g_trading_halted = true;
      Print("AiChartBridge: KILL SWITCH active — new trades blocked.");
   }
   else if(!killOn && g_trading_halted)
   {
      g_trading_halted = false;
      Print("AiChartBridge: Kill switch cleared — trading resumed.");
   }

   if(closeOpen)
   {
      Print("AiChartBridge: Kill switch requested close of all open positions.");
      CloseAllPositions();
   }
}

bool IsCommandAcked(long id)
{
   if(id == g_last_acked) return true;
   for(int i = 0; i < g_acked_count; i++)
      if(g_acked_ids[i] == id) return true;
   return false;
}

void MarkCommandAcked(long id)
{
   if(IsCommandAcked(id)) return;
   if(g_acked_count >= 32)
   {
      for(int i = 0; i < 31; i++)
         g_acked_ids[i] = g_acked_ids[i + 1];
      g_acked_count = 31;
   }
   g_acked_ids[g_acked_count++] = id;
   g_last_acked = id;
}

void AckCommand(long id, string status, long ticket, double price, double lots, string err)
{
   string body = "{";
   body += "\"status\":\"" + status + "\",";
   body += "\"result\":{";
   body += "\"ticket\":" + (string)ticket + ",";
   body += "\"price\":" + DoubleToString(price, 5) + ",";
   body += "\"lots\":" + DoubleToString(lots, 2);
   if(err != "") body += ",\"error\":" + JsonStr(err);
   body += "}}";
   string resp = "";
   HttpPost("/api/ea/commands/" + (string)id + "/ack", body, resp);
}

void AckCommandEx(long id, string status, string innerFields, string err)
{
   string body = "{";
   body += "\"status\":\"" + status + "\",";
   body += "\"result\":{";
   body += innerFields;
   if(err != "") body += ",\"error\":" + JsonStr(err);
   body += "}}";
   string resp = "";
   HttpPost("/api/ea/commands/" + (string)id + "/ack", body, resp);
}

//+------------------------------------------------------------------+
//| HTTP                                                             |
//+------------------------------------------------------------------+
bool HttpPost(string path, string body, string &response)
{
   string url = ApiBase + path;
   string headers = BuildAuthHeaders("Content-Type: application/json\r\n");

   char post[], result[];
   string result_headers;
   StringToCharArray(body, post, 0, StringLen(body), CP_UTF8);
   int size = ArraySize(post);
   if(size > 0 && post[size - 1] == 0) ArrayResize(post, size - 1);

   ResetLastError();
   int res = WebRequest("POST", url, headers, 5000, post, result, result_headers);
   if(res == -1)
   {
      int err = GetLastError();
      Print("WebRequest POST failed (", err, "). Add ", ApiBase,
            " to Tools > Options > Expert Advisors > Allow WebRequest.");
      return false;
   }
   response = CharArrayToString(result, 0, ArraySize(result), CP_UTF8);
   return (res >= 200 && res < 300);
}

bool HttpGet(string path, string &response)
{
   string url = ApiBase + path;
   string headers = BuildAuthHeaders("");

   char empty[];
   char result[];
   string result_headers;
   ArrayResize(empty, 0);

   ResetLastError();
   int res = WebRequest("GET", url, headers, 5000, empty, result, result_headers);
   if(res == -1)
   {
      int err = GetLastError();
      if(err != 0)
         Print("WebRequest GET failed (", err, ").");
      return false;
   }
   response = CharArrayToString(result, 0, ArraySize(result), CP_UTF8);
   return (res >= 200 && res < 300);
}

string BuildAuthHeaders(string prefix)
{
   string headers = prefix;
   headers += "Authorization: Bearer " + EaToken + "\r\n";
   headers += "X-EA-Token: " + EaToken + "\r\n";
   return headers;
}

//+------------------------------------------------------------------+
//| Minimal JSON helpers (naive key search)                          |
//+------------------------------------------------------------------+
double JsonNum(string json, string key)
{
   string pat = "\"" + key + "\"";
   int k = StringFind(json, pat);
   if(k < 0) return 0;
   int c = StringFind(json, ":", k);
   if(c < 0) return 0;
   int p = c + 1;
   string num = "";
   while(p < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, p);
      if((ch >= '0' && ch <= '9') || ch == '.' || ch == '-' || ch == '+')
         num += ShortToString(ch);
      else if(num != "")
         break;
      else if(ch == ' ')
         {}
      else
         break;
      p++;
   }
   if(num == "" || num == "null") return 0;
   return StringToDouble(num);
}

bool JsonBool(string json, string key)
{
   string pat = "\"" + key + "\"";
   int k = StringFind(json, pat);
   if(k < 0) return false;
   int c = StringFind(json, ":", k);
   if(c < 0) return false;
   int p = c + 1;
   while(p < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, p);
      if(ch == 't' || ch == 'T')
      {
         if(StringFind(json, "true", p) == p) return true;
         return false;
      }
      if(ch == 'f' || ch == 'F')
      {
         if(StringFind(json, "false", p) == p) return false;
         return false;
      }
      if(ch == '1') return true;
      if(ch == '0') return false;
      if(ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n')
         break;
      p++;
   }
   return false;
}

string JsonStrVal(string json, string key)
{
   string pat = "\"" + key + "\"";
   int k = StringFind(json, pat);
   if(k < 0) return "";
   int c = StringFind(json, ":", k);
   if(c < 0) return "";
   int q1 = StringFind(json, "\"", c + 1);
   if(q1 < 0) return "";
   int q2 = StringFind(json, "\"", q1 + 1);
   if(q2 < 0) return "";
   return StringSubstr(json, q1 + 1, q2 - q1 - 1);
}

string JsonStr(string s)
{
   string out = "\"";
   for(int i = 0; i < StringLen(s); i++)
   {
      ushort ch = StringGetCharacter(s, i);
      if(ch == '"' || ch == '\\') out += "\\";
      out += ShortToString(ch);
   }
   out += "\"";
   return out;
}

string TfToString(ENUM_TIMEFRAMES tf)
{
   switch(tf)
   {
      case PERIOD_M1:  return "1m";
      case PERIOD_M5:  return "5m";
      case PERIOD_M15: return "15m";
      case PERIOD_H1:  return "1h";
      case PERIOD_H4:  return "4h";
      case PERIOD_D1:  return "1d";
      case PERIOD_W1:  return "1w";
      default:         return "1h";
   }
}

ENUM_TIMEFRAMES TfFromInterval(string interval)
{
   if(interval == "1m")  return PERIOD_M1;
   if(interval == "5m")  return PERIOD_M5;
   if(interval == "15m") return PERIOD_M15;
   if(interval == "1h")  return PERIOD_H1;
   if(interval == "4h")  return PERIOD_H4;
   if(interval == "1d")  return PERIOD_D1;
   if(interval == "1w")  return PERIOD_W1;
   return PERIOD_H1;
}

//+------------------------------------------------------------------+
//| Payload helpers (commands nest fields under "payload")           |
//+------------------------------------------------------------------+
string PayloadBlock(string json)
{
   int k = StringFind(json, "\"payload\"");
   if(k < 0) return json;
   int brace = StringFind(json, "{", k);
   if(brace < 0) return json;
   int depth = 0;
   for(int p = brace; p < StringLen(json); p++)
   {
      ushort ch = StringGetCharacter(json, p);
      if(ch == '{') depth++;
      else if(ch == '}')
      {
         depth--;
         if(depth == 0)
            return StringSubstr(json, brace, p - brace + 1);
      }
   }
   return json;
}

string PayloadStrVal(string payload, string root, string key)
{
   string v = JsonStrVal(payload, key);
   if(v != "") return v;
   return JsonStrVal(root, key);
}

double PayloadNum(string payload, string root, string key)
{
   double v = JsonNum(payload, key);
   if(v != 0) return v;
   return JsonNum(root, key);
}

//+------------------------------------------------------------------+
//| Chart drawing + screenshot                                     |
//+------------------------------------------------------------------+
color ParseHexColor(string hex, color fallback)
{
   if(StringLen(hex) < 7 || StringGetCharacter(hex, 0) != '#') return fallback;
   int r = (int)StringToInteger("0x" + StringSubstr(hex, 1, 2));
   int g = (int)StringToInteger("0x" + StringSubstr(hex, 3, 2));
   int b = (int)StringToInteger("0x" + StringSubstr(hex, 5, 2));
   return (color)((b << 16) | (g << 8) | r);
}

datetime BarsAheadToTime(string sym, ENUM_TIMEFRAMES tf, int barsAhead, double timeOverride)
{
   if(timeOverride > 0)
      return (datetime)(long)timeOverride;
   datetime t0 = iTime(sym, tf, 0);
   if(t0 == 0) t0 = TimeCurrent();
   if(barsAhead <= 0) return t0;
   return t0 + (datetime)(barsAhead * PeriodSeconds(tf));
}

void DeleteAichartObjects(long recId)
{
   string prefix = (recId > 0) ? ("AICHART_" + (string)recId + "_") : "AICHART_";
   int total = ObjectsTotal(0, 0, -1);
   for(int i = total - 1; i >= 0; i--)
   {
      string name = ObjectName(0, i, 0, -1);
      if(StringFind(name, prefix) == 0)
         ObjectDelete(0, name);
   }
}

bool EnsureChartSymbol(string sym, ENUM_TIMEFRAMES tf)
{
   if(sym == "" || !SymbolSelect(sym, true))
      return false;
   ChartSetSymbolPeriod(0, sym, tf);
   ChartRedraw(0);
   Sleep(200);
   return true;
}

void DrawHLine(string name, double price, color clr, string label)
{
   if(price <= 0) return;
   ObjectCreate(0, name, OBJ_HLINE, 0, 0, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
   ObjectSetString(0, name, OBJPROP_TEXT, label);
}

void DrawTrendSegment(string name, datetime t1, double p1, datetime t2, double p2, color clr)
{
   if(t1 == 0 || t2 == 0) return;
   ObjectCreate(0, name, OBJ_TREND, 0, t1, p1, t2, p2);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
}

void DrawRectangle(string name, datetime t1, double p1, datetime t2, double p2, color clr)
{
   if(t1 == 0 || t2 == 0) return;
   ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, p1, t2, p2);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FILL, true);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
}

void DrawFib(string name, datetime t1, double p1, datetime t2, double p2, color clr)
{
   if(t1 == 0 || t2 == 0) return;
   ObjectCreate(0, name, OBJ_FIBO, 0, t1, p1, t2, p2);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
}

void DrawArrowMarker(string name, datetime t, double price, color clr)
{
   if(t == 0 || price <= 0) return;
   ObjectCreate(0, name, OBJ_ARROW, 0, t, price);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_ARROWCODE, 233);
}

int ParsePointsArray(string drawingJson, string sym, ENUM_TIMEFRAMES tf,
                     datetime &times[], double &prices[], int maxPts)
{
   ArrayResize(times, maxPts);
   ArrayResize(prices, maxPts);
   int count = 0;
   int arrStart = StringFind(drawingJson, "\"points\"");
   if(arrStart < 0) return 0;
   arrStart = StringFind(drawingJson, "[", arrStart);
   if(arrStart < 0) return 0;

   int depth = 0;
   int objStart = -1;
   for(int p = arrStart; p < StringLen(drawingJson) && count < maxPts; p++)
   {
      ushort ch = StringGetCharacter(drawingJson, p);
      if(ch == '{')
      {
         if(depth == 0) objStart = p;
         depth++;
      }
      else if(ch == '}')
      {
         depth--;
         if(depth == 0 && objStart >= 0)
         {
            string pt = StringSubstr(drawingJson, objStart, p - objStart + 1);
            int barsAhead = (int)JsonNum(pt, "barsAhead");
            double price = JsonNum(pt, "price");
            double timeVal = JsonNum(pt, "time");
            times[count] = BarsAheadToTime(sym, tf, barsAhead, timeVal);
            prices[count] = price;
            count++;
            objStart = -1;
         }
      }
      else if(ch == ']' && depth == 0)
         break;
   }
   return count;
}

void DrawSingleDrawing(string prefix, int idx, string drawingJson, string sym, ENUM_TIMEFRAMES tf)
{
   string dtype = JsonStrVal(drawingJson, "type");
   string label = JsonStrVal(drawingJson, "label");
   string colorHex = JsonStrVal(drawingJson, "color");
   color clr = ParseHexColor(colorHex, clrDodgerBlue);

   datetime times[];
   double prices[];
   int n = ParsePointsArray(drawingJson, sym, tf, times, prices, 16);
   if(n <= 0) return;

   string base = prefix + dtype + "_" + (string)idx;

   if(dtype == "price_line" || dtype == "baseline")
   {
      DrawHLine(base, prices[0], clr, label);
   }
   else if(dtype == "trend_line" || dtype == "forecast_path")
   {
      for(int i = 1; i < n; i++)
         DrawTrendSegment(base + "_seg" + (string)i, times[i-1], prices[i-1], times[i], prices[i], clr);
   }
   else if(dtype == "zone" || dtype == "histogram_band")
   {
      if(n >= 2)
         DrawRectangle(base, times[0], prices[0], times[1], prices[1], clr);
   }
   else if(dtype == "channel" && n >= 4)
   {
      DrawTrendSegment(base + "_a", times[0], prices[0], times[1], prices[1], clr);
      DrawTrendSegment(base + "_b", times[2], prices[2], times[3], prices[3], clr);
   }
   else if(dtype == "fib_retracement" && n >= 2)
   {
      DrawFib(base, times[0], prices[0], times[1], prices[1], clr);
   }
   else if(dtype == "marker")
   {
      DrawArrowMarker(base, times[0], prices[0], clr);
   }
}

void DrawAllDrawings(string payload, string sym, ENUM_TIMEFRAMES tf, long recId)
{
   string prefix = "AICHART_" + (string)recId + "_";
   int arrStart = StringFind(payload, "\"drawings\"");
   if(arrStart < 0) return;
   arrStart = StringFind(payload, "[", arrStart);
   if(arrStart < 0) return;

   int depth = 0;
   int objStart = -1;
   int idx = 0;
   for(int p = arrStart; p < StringLen(payload); p++)
   {
      ushort ch = StringGetCharacter(payload, p);
      if(ch == '{')
      {
         if(depth == 0) objStart = p;
         depth++;
      }
      else if(ch == '}')
      {
         depth--;
         if(depth == 0 && objStart >= 0)
         {
            string drawing = StringSubstr(payload, objStart, p - objStart + 1);
            DrawSingleDrawing(prefix, idx, drawing, sym, tf);
            idx++;
            objStart = -1;
         }
      }
      else if(ch == ']' && depth == 0)
         break;
   }
}

bool HttpPostMultipart(string path, long recId, string captureKey, string fileName, uchar &fileData[], string &response)
{
   string url = ApiBase + path;
   string boundary = "----AiChart" + (string)GetTickCount();
   string hdr = "Content-Type: multipart/form-data; boundary=" + boundary + "\r\n";
   hdr += "Authorization: Bearer " + EaToken + "\r\n";
   hdr += "X-EA-Token: " + EaToken + "\r\n";

   string part1 = "--" + boundary + "\r\n";
   part1 += "Content-Disposition: form-data; name=\"recommendation_id\"\r\n\r\n";
   part1 += (string)recId + "\r\n";
   part1 += "--" + boundary + "\r\n";
   part1 += "Content-Disposition: form-data; name=\"capture_key\"\r\n\r\n";
   part1 += captureKey + "\r\n";
   part1 += "--" + boundary + "\r\n";
   part1 += "Content-Disposition: form-data; name=\"chart\"; filename=\"" + fileName + "\"\r\n";
   part1 += "Content-Type: image/png\r\n\r\n";

   string partEnd = "\r\n--" + boundary + "--\r\n";

   uchar head[];
   uchar tail[];
   StringToCharArray(part1, head, 0, StringLen(part1), CP_UTF8);
   StringToCharArray(partEnd, tail, 0, StringLen(partEnd), CP_UTF8);
   int hLen = ArraySize(head);
   if(hLen > 0 && head[hLen-1] == 0) ArrayResize(head, hLen - 1);
   int tLen = ArraySize(tail);
   if(tLen > 0 && tail[tLen-1] == 0) ArrayResize(tail, tLen - 1);

   uchar post[];
   int pos = 0;
   ArrayResize(post, ArraySize(head) + ArraySize(fileData) + ArraySize(tail));
   ArrayCopy(post, head, 0, 0, WHOLE_ARRAY);
   pos += ArraySize(head);
   ArrayCopy(post, fileData, pos, 0, WHOLE_ARRAY);
   pos += ArraySize(fileData);
   ArrayCopy(post, tail, pos, 0, WHOLE_ARRAY);

   char result[];
   string result_headers;
   ResetLastError();
   int res = WebRequest("POST", url, hdr, 15000, post, result, result_headers);
   if(res == -1)
   {
      Print("Multipart upload failed (", GetLastError(), ")");
      return false;
   }
   response = CharArrayToString(result, 0, ArraySize(result), CP_UTF8);
   return (res >= 200 && res < 300);
}

void DrawAndCapture(long id, string payload)
{
   string sym = PayloadStrVal(payload, payload, "symbol");
   string interval = PayloadStrVal(payload, payload, "interval");
   long recId = (long)PayloadNum(payload, payload, "recommendation_id");
   string captureKey = PayloadStrVal(payload, payload, "capture_key");
   if(captureKey == "" && recId > 0) captureKey = (string)recId;

   ENUM_TIMEFRAMES tf = TfFromInterval(interval);
   if(!EnsureChartSymbol(sym, tf))
   {
      AckCommand(id, "failed", 0, 0, 0, "symbol not available: " + sym);
      return;
   }

   DeleteAichartObjects(recId);
   DrawAllDrawings(payload, sym, tf, recId);
   ChartRedraw(0);
   Sleep(400);

   string shotName = "aichart_" + captureKey + ".png";
   if(!ChartScreenShot(0, shotName, 1280, 720, ALIGN_RIGHT))
   {
      AckCommand(id, "failed", 0, 0, 0, "ChartScreenShot failed");
      return;
   }

   int fh = FileOpen(shotName, FILE_READ|FILE_BIN);
   if(fh == INVALID_HANDLE)
   {
      AckCommand(id, "failed", 0, 0, 0, "cannot read screenshot file");
      return;
   }
   int fsize = (int)FileSize(fh);
   uchar fileData[];
   ArrayResize(fileData, fsize);
   FileReadArray(fh, fileData, 0, fsize);
   FileClose(fh);
   FileDelete(shotName);

   string uploadResp = "";
   if(!HttpPostMultipart("/api/ea/chart-upload", recId, captureKey, shotName, fileData, uploadResp))
   {
      AckCommand(id, "failed", 0, 0, 0, "chart upload failed");
      return;
   }

   g_last_acked = id;
   MarkCommandAcked(id);
   AckCommand(id, "acked", recId, 0, 0, "");
}

void ClearChartCommand(long id, string payload)
{
   string sym = PayloadStrVal(payload, payload, "symbol");
   string interval = PayloadStrVal(payload, payload, "interval");
   long recId = (long)PayloadNum(payload, payload, "recommendation_id");

   if(sym != "")
   {
      ENUM_TIMEFRAMES tf = TfFromInterval(interval);
      EnsureChartSymbol(sym, tf);
   }

   DeleteAichartObjects(recId);
   ChartRedraw(0);
   MarkCommandAcked(id);
   AckCommand(id, "acked", recId, 0, 0, "");
}
//+------------------------------------------------------------------+
