//+------------------------------------------------------------------+
//|                                              AiChartBridge.mq5    |
//|       Connects a MetaTrader 5 terminal to the AiChart platform   |
//|       via the self-hosted EA bridge API (heartbeat + commands).  |
//+------------------------------------------------------------------+
#property copyright "AiChart"
#property link      "https://aichart.lork.cloud"
#property version   "4.01"
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
input int     ChartQuoteThrottleMs = 300;                       // Min ms between chart-symbol quote pushes on OnTick
input int     QuoteWaitAttempts = 8;                            // Ticks to wait before off-quotes fail
input int     QuoteWaitDelayMs  = 250;                          // Delay between quote wait attempts (ms)

CTrade  trade;
long    g_last_acked = 0;
long    g_acked_ids[32];
int     g_acked_count = 0;
int     g_hb_failures = 0;
int     g_quote_failures = 0;
bool    g_trading_halted = false;
datetime g_last_sync_hb = 0;
datetime g_last_hb_time = 0;
datetime g_last_quote_flush = 0;
ulong   g_last_chart_quote_ms = 0;
long    g_last_trade_ticket = 0;
double  g_last_trade_price = 0;
string  g_last_trade_error = "";
const string EA_VERSION = "4.01";

//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| NEVER call ChartSetSymbolPeriod — MT5 disables AutoTrading.      |
//| Drawing coords: iTime(sym, tf, offset) only.                     |
//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(EaToken) < 8)
   {
      Print("AiChartBridge: EaToken is not set. Open EA properties and paste your token.");
      return(INIT_FAILED);
   }
   EventSetTimer(1);
   Print("AiChartBridge MT5 v4.01 started. Base=", ApiBase, " hb=", HeartbeatSeconds, "s poll=", PollIntervalMs, "ms quotes=", QuoteFlushSeconds, "s chartQuoteMs=", ChartQuoteThrottleMs);
   PreWarmSymbols();
   LogAvailableSymbols();
   // FIX: 1 — immediate heartbeat on attach
   SendHeartbeat();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
void ArmKeepaliveTimer()
{
   EventSetTimer(1);
}

//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long& lparam,
                  const double& dparam, const string& sparam)
{
   if(id != CHARTEVENT_CHART_CHANGE) return;
   Print("AiChartBridge: chart symbol/period changed — re-enable AutoTrading if disabled.");
   ArmKeepaliveTimer();
   g_last_hb_time = 0;
   SendHeartbeat();
}

//+------------------------------------------------------------------+
void ProcessBridgeTick()
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
void OnTick()
{
   FlushChartSymbolQuote();
   ProcessBridgeTick();
}
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
   ArmKeepaliveTimer();
   ProcessBridgeTick();
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
   // FIX: 6 — process server flags from heartbeat (commands via PollCommands)
   ProcessHeartbeatFlags(resp);
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

// v3.01 — broker execution / filling helpers (used by heartbeat + order paths)
string TradeExecutionToString(long mode)
{
   if(mode == SYMBOL_TRADE_EXECUTION_INSTANT) return "instant";
   if(mode == SYMBOL_TRADE_EXECUTION_EXCHANGE) return "exchange";
   if(mode == SYMBOL_TRADE_EXECUTION_MARKET) return "market";
   if(mode == SYMBOL_TRADE_EXECUTION_REQUEST) return "request";
   return "unknown";
}

string FillingModeToString(int mode)
{
   string s = "";
   if((mode & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
   {
      if(s != "") s += "|";
      s += "fok";
   }
   if((mode & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
   {
      if(s != "") s += "|";
      s += "ioc";
   }
   if(s == "") s = "return";
   return s;
}

string FillingEnumLabel(ENUM_ORDER_TYPE_FILLING fill)
{
   if(fill == ORDER_FILLING_FOK) return "FOK";
   if(fill == ORDER_FILLING_IOC) return "IOC";
   return "RETURN";
}

ENUM_ORDER_TYPE_FILLING ResolveFillingMode(string sym)
{
   int mode = (int)SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);
   if((mode & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
      return ORDER_FILLING_IOC;
   if((mode & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
      return ORDER_FILLING_FOK;
   return ORDER_FILLING_RETURN;
}

uint DeviationForSymbol(string sym)
{
   long stopsLevel = SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL);
   return (uint)MathMax(20, (int)stopsLevel + 5);
}

void ConfigureTradeForSymbol(string sym)
{
   trade.SetTypeFilling(ResolveFillingMode(sym));
   trade.SetDeviationInPoints(DeviationForSymbol(sym));
}

bool GetFreshTick(string sym, MqlTick &tick)
{
   if(!SymbolSelect(sym, true)) return false;
   if(SymbolInfoTick(sym, tick) && tick.bid > 0 && tick.ask > 0)
      return true;
   tick.bid = SymbolInfoDouble(sym, SYMBOL_BID);
   tick.ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   tick.time = TimeCurrent();
   return (tick.bid > 0 && tick.ask > 0);
}

double NormalizeSymbolPrice(string sym, double price)
{
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   return NormalizeDouble(price, digits);
}

double MarketOrderPrice(string sym, string side)
{
   MqlTick tick;
   if(!GetFreshTick(sym, tick)) return 0;
   double price = (side == "buy") ? tick.ask : tick.bid;
   return NormalizeSymbolPrice(sym, price);
}

string TradingPermissionError(string sym)
{
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      return "terminal trading disabled — enable AutoTrading button";
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED))
      return "EA trading not allowed — check Allow Algo Trading in EA properties";
   if(!SymbolInfoInteger(sym, SYMBOL_SELECT))
      return "symbol not selected: " + sym;
   long tradeMode = SymbolInfoInteger(sym, SYMBOL_TRADE_MODE);
   if(tradeMode == SYMBOL_TRADE_MODE_DISABLED)
      return "symbol trade disabled: " + sym;
   return "";
}

bool SendMarketDealDirect(string sym, string side, double lots, double sl, double tp,
                          ENUM_ORDER_TYPE_FILLING fill, bool useFillType, uint deviation,
                          uint &retcode, long &outTicket, double &outPrice)
{
   g_last_trade_error = "";
   string permErr = TradingPermissionError(sym);
   if(permErr != "")
   {
      g_last_trade_error = permErr;
      retcode = 10017;
      Print("AiChartBridge: ", permErr);
      return false;
   }

   MqlTick tick;
   if(!GetFreshTick(sym, tick))
   {
      g_last_trade_error = "no fresh tick";
      retcode = 10026;
      return false;
   }

   MqlTradeRequest req;
   MqlTradeResult  res;
   ZeroMemory(req);
   ZeroMemory(res);
   req.action       = TRADE_ACTION_DEAL;
   req.symbol       = sym;
   req.volume       = lots;
   req.type         = (side == "buy") ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   req.price        = (side == "buy") ? tick.ask : tick.bid;
   req.sl           = (sl > 0) ? sl : 0;
   req.tp           = (tp > 0) ? tp : 0;
   req.deviation    = deviation;
   if(useFillType)
      req.type_filling = fill;
   req.comment      = "AiChart";

   long execMode = SymbolInfoInteger(sym, SYMBOL_TRADE_EXEMODE);
   string fillLabel = useFillType ? FillingEnumLabel(fill) : "DEFAULT";
   LogTradeRequest("deal-" + fillLabel, sym, side, lots, req.price, sl, tp,
                   deviation, useFillType ? fill : ORDER_FILLING_RETURN, execMode);

   MqlTradeCheckResult chk;
   if(!OrderCheck(req, chk))
   {
      retcode = chk.retcode;
      g_last_trade_error = "OrderCheck " + (string)chk.retcode + ": " + chk.comment;
      Print("AiChartBridge: ", g_last_trade_error);
      return false;
   }

   if(!OrderSend(req, res))
   {
      retcode = res.retcode;
      g_last_trade_error = "OrderSend " + (string)res.retcode + ": " + res.comment;
      LogTradeRequest("deal-fail-" + fillLabel, sym, side, lots, req.price, sl, tp,
                      deviation, useFillType ? fill : ORDER_FILLING_RETURN, execMode, retcode);
      return false;
   }

   retcode = res.retcode;
   if(retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_PLACED)
   {
      outTicket = (long)res.order;
      outPrice  = res.price;
      return true;
   }
   g_last_trade_error = "OrderSend retcode " + (string)retcode + ": " + res.comment;
   LogTradeRequest("deal-fail-" + fillLabel, sym, side, lots, req.price, sl, tp,
                   deviation, useFillType ? fill : ORDER_FILLING_RETURN, execMode, retcode);
   return false;
}

int AppendDealFillCandidates(string sym, ENUM_ORDER_TYPE_FILLING &fills[])
{
   int fillCount = 0;
   long execMode = SymbolInfoInteger(sym, SYMBOL_TRADE_EXEMODE);
   int mode = (int)SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);

   // Market execution: FOK from symbol flags often applies to pending only — not deals.
   if(execMode == SYMBOL_TRADE_EXECUTION_MARKET)
   {
      if((mode & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
         fills[fillCount++] = ORDER_FILLING_IOC;
      fills[fillCount++] = ORDER_FILLING_RETURN;
   }
   else
   {
      if((mode & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
         fills[fillCount++] = ORDER_FILLING_FOK;
      if((mode & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
         fills[fillCount++] = ORDER_FILLING_IOC;
      fills[fillCount++] = ORDER_FILLING_RETURN;
   }
   return fillCount;
}

bool ModifyOpenPositionStops(string sym, double sl, double tp, uint &retcode)
{
   if(sl <= 0 && tp <= 0) return true;
   for(int i = 0; i < 5; i++)
   {
      if(!PositionSelect(sym))
      {
         Sleep(100);
         continue;
      }
      ulong ticket = (ulong)PositionGetInteger(POSITION_TICKET);
      double curSl = PositionGetDouble(POSITION_SL);
      double curTp = PositionGetDouble(POSITION_TP);
      double newSl = (sl > 0) ? sl : curSl;
      double newTp = (tp > 0) ? tp : curTp;
      if(TryPositionModify(ticket, newSl, newTp, retcode))
         return true;
      if(retcode != 10004 && retcode != 10027)
         break;
      Sleep(100);
   }
   return false;
}

bool TryMarketDealFillings(string sym, string side, double lots, double sl, double tp,
                           uint deviation, uint &retcode, long &outTicket, double &outPrice)
{
   ENUM_ORDER_TYPE_FILLING fills[3];
   int fillCount = AppendDealFillCandidates(sym, fills);

   for(int i = 0; i < fillCount; i++)
   {
      if(SendMarketDealDirect(sym, side, lots, sl, tp, fills[i], true, deviation, retcode, outTicket, outPrice))
         return true;
      if(retcode != 10026 && retcode != 10004 && retcode != 10027 && retcode != 10030 && retcode != 10016)
         break;
      Sleep(MathMax(100, RetryDelayMs));
   }

   if(SendMarketDealDirect(sym, side, lots, sl, tp, ORDER_FILLING_RETURN, false, deviation, retcode, outTicket, outPrice))
      return true;

   if(sl <= 0 && tp <= 0)
      return false;

   Print("AiChartBridge: retry market deal without SL/TP then modify");
   for(int j = 0; j < fillCount; j++)
   {
      if(SendMarketDealDirect(sym, side, lots, 0, 0, fills[j], true, deviation, retcode, outTicket, outPrice))
      {
         Sleep(150);
         if(ModifyOpenPositionStops(sym, sl, tp, retcode))
            return true;
         g_last_trade_error = "opened but modify SL/TP failed retcode " + (string)retcode;
         return true;
      }
      if(retcode != 10026 && retcode != 10004 && retcode != 10027 && retcode != 10030)
         break;
      Sleep(MathMax(100, RetryDelayMs));
   }

   if(SendMarketDealDirect(sym, side, lots, 0, 0, ORDER_FILLING_RETURN, false, deviation, retcode, outTicket, outPrice))
   {
      Sleep(150);
      if(ModifyOpenPositionStops(sym, sl, tp, retcode))
         return true;
      g_last_trade_error = "opened but modify SL/TP failed retcode " + (string)retcode;
      return true;
   }
   return false;
}

void LogTradeRequest(string context, string sym, string side, double lots, double price,
                     double sl, double tp, uint deviation, ENUM_ORDER_TYPE_FILLING fill,
                     long execMode, uint retcode = 0)
{
   string msg = "AiChartBridge: ORDER " + context +
                " sym=" + sym + " side=" + side +
                " lots=" + DoubleToString(lots, 2) +
                " price=" + DoubleToString(price, 8) +
                " sl=" + DoubleToString(sl, 8) +
                " tp=" + DoubleToString(tp, 8) +
                " deviation=" + (string)deviation +
                " filling=" + FillingEnumLabel(fill) +
                " execution=" + TradeExecutionToString(execMode);
   if(retcode > 0)
      msg += " retcode=" + (string)retcode;
   Print(msg);
}

// Heartbeat symbols: live bid/ask from MT5 at SendHeartbeat() time (~30s snapshot)
// plus contract specs. NOT the tick stream — use FlushLiveQuotes for trade pricing.
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
      arr += "\"freeze_level\":" + (string)freezeLevel + ",";
      long   execMode  = SymbolInfoInteger(sym, SYMBOL_TRADE_EXEMODE);
      int    fillMode  = (int)SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);
      long   spreadPts = SymbolInfoInteger(sym, SYMBOL_SPREAD);
      arr += "\"trade_execution\":" + JsonStr(TradeExecutionToString(execMode)) + ",";
      arr += "\"filling_mode\":" + JsonStr(FillingModeToString(fillMode)) + ",";
      arr += "\"spread_points\":" + (string)spreadPts;
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
      string symRaw = PayloadStrVal(payload, obj, "symbol");
      string sym  = ResolveBrokerSymbol(symRaw);
      string side = PayloadStrVal(payload, obj, "side");
      double lots = PayloadNum(payload, obj, "lots");
      double sl   = PayloadNum(payload, obj, "stop_loss");
      double tp   = PayloadNum(payload, obj, "take_profit");
      if(sym == "")
      {
         AckCommand(id, "failed", 0, 0, 0,
                    "symbol not found: " + symRaw + " | Available: " + GetMarketWatchSymbols());
         return;
      }
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
      string symRaw = PayloadStrVal(payload, obj, "symbol");
      string sym = ResolveBrokerSymbol(symRaw);
      string side = PayloadStrVal(payload, obj, "side");
      string orderType = PayloadStrVal(payload, obj, "order_type");
      double lots = PayloadNum(payload, obj, "lots");
      double price = PayloadNum(payload, obj, "price");
      double sl = PayloadNum(payload, obj, "stop_loss");
      double tp = PayloadNum(payload, obj, "take_profit");
      if(sym == "")
      {
         AckCommand(id, "failed", 0, 0, 0,
                    "symbol not found: " + symRaw + " | Available: " + GetMarketWatchSymbols());
         return;
      }
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
      string symRaw = PayloadStrVal(payload, obj, "symbol");
      string sym = ResolveBrokerSymbol(symRaw);
      if(sym == "")
      {
         AckCommand(id, "failed", 0, 0, 0,
                    "symbol not found: " + symRaw + " | Available: " + GetMarketWatchSymbols());
         return;
      }
      EnsureSymbol(id, sym);
   }
   else if(type == "query_terminal")
   {
      QueryTerminal(id);
   }
   else if(type == "get_ohlc")
   {
      GetOhlc(id, payload, obj);
   }
   else
   {
      AckCommand(id, "failed", 0, 0, 0, "unsupported command type");
   }
}

// v3.06 — resolve broker-exact symbol case (Exness EURUSDm). NEVER StringToUpper on symbols.
string ResolveBrokerSymbol(string requested)
{
   if(requested == "") return "";

   if(SymbolSelect(requested, true))
      return requested;

   int total = SymbolsTotal(true);
   for(int i = 0; i < total; i++)
   {
      string brokerSym = SymbolName(i, true);
      if(brokerSym == "") continue;
      if(StringCompare(requested, brokerSym, false) == 0)
      {
         SymbolSelect(brokerSym, true);
         return brokerSym;
      }
   }

   total = SymbolsTotal(false);
   for(int j = 0; j < total; j++)
   {
      string brokerSym = SymbolName(j, false);
      if(brokerSym == "") continue;
      if(StringCompare(requested, brokerSym, false) == 0)
      {
         SymbolSelect(brokerSym, true);
         return brokerSym;
      }
   }

   return "";
}

// v3.05 — Market Watch symbol helpers (case-sensitive broker names)
string GetMarketWatchSymbols(const int maxCount = 20)
{
   string symbols = "";
   int total = SymbolsTotal(true);
   int limit = MathMin(total, maxCount);
   for(int i = 0; i < limit; i++)
   {
      string s = SymbolName(i, true);
      if(s == "") continue;
      if(symbols != "") symbols += ", ";
      symbols += s;
   }
   if(total > maxCount)
      symbols += " … +" + (string)(total - maxCount) + " more";
   return symbols;
}

bool IsSymbolValid(string symbol)
{
   return ResolveBrokerSymbol(symbol) != "";
}

void LogAvailableSymbols()
{
   Print("Market Watch symbols: ", GetMarketWatchSymbols(50));
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
   g_last_trade_ticket = 0;
   g_last_trade_price = 0;

   for(int attempt = 0; attempt < MathMax(1, MaxRetries); attempt++)
   {
      if(!WaitForLiveQuotes(sym))
      {
         retcode = 10026;
         Sleep(MathMax(100, RetryDelayMs));
         continue;
      }

      ConfigureTradeForSymbol(sym);
      uint deviation = DeviationForSymbol(sym);
      long outTicket = 0;
      double outPrice = 0;

      if(TryMarketDealFillings(sym, side, lots, sl, tp, deviation, retcode, outTicket, outPrice))
      {
         g_last_trade_ticket = outTicket;
         g_last_trade_price = outPrice;
         return true;
      }

      long execMode = SymbolInfoInteger(sym, SYMBOL_TRADE_EXEMODE);
      ENUM_ORDER_TYPE_FILLING fill = ResolveFillingMode(sym);
      double price = MarketOrderPrice(sym, side);
      if(price <= 0)
      {
         retcode = 10026;
         Sleep(MathMax(100, RetryDelayMs));
         continue;
      }

      LogTradeRequest("ctrade-fallback", sym, side, lots, price, sl, tp, deviation, fill, execMode);

      bool ok = false;
      if(side == "buy")
         ok = trade.Buy(lots, sym, price, sl, tp, "AiChart");
      else
         ok = trade.Sell(lots, sym, price, sl, tp, "AiChart");

      if(ok)
      {
         retcode = trade.ResultRetcode();
         g_last_trade_ticket = (long)trade.ResultOrder();
         g_last_trade_price = trade.ResultPrice();
         return true;
      }

      retcode = trade.ResultRetcode();
      LogTradeRequest("ctrade-fail", sym, side, lots, price, sl, tp, deviation, fill, execMode, retcode);
      if(retcode == 10027 || retcode == 10004 || retcode == 10026 || retcode == 10030)
      {
         Sleep(MathMax(100, RetryDelayMs));
         continue;
      }
      break;
   }
   return false;
}

bool TryPendingOrder(string sym, string side, string orderType, double lots, double price,
                     double sl, double tp, uint &retcode, long &placedTicket)
{
   placedTicket = 0;
   price = NormalizeSymbolPrice(sym, price);
   bool isBuy = (side == "buy");

   for(int attempt = 0; attempt < MathMax(1, MaxRetries); attempt++)
   {
      if(!WaitForLiveQuotes(sym))
      {
         retcode = 10026;
         Sleep(MathMax(100, RetryDelayMs));
         continue;
      }

      ConfigureTradeForSymbol(sym);
      long execMode = SymbolInfoInteger(sym, SYMBOL_TRADE_EXEMODE);
      ENUM_ORDER_TYPE_FILLING fill = ResolveFillingMode(sym);
      uint deviation = DeviationForSymbol(sym);
      bool ok = false;

      LogTradeRequest("pending-" + orderType, sym, side, lots, price, sl, tp, deviation, fill, execMode);

      if(orderType == "limit")
      {
         if(isBuy)
            ok = trade.BuyLimit(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, "AiChart");
         else
            ok = trade.SellLimit(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, "AiChart");
      }
      else if(orderType == "stop")
      {
         if(isBuy)
            ok = trade.BuyStop(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, "AiChart");
         else
            ok = trade.SellStop(lots, price, sym, sl, tp, ORDER_TIME_GTC, 0, "AiChart");
      }
      else if(orderType == "stop_limit")
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
         req.type_filling = fill;
         req.deviation    = deviation;
         req.comment      = "AiChart";
         ok = OrderSend(req, res) &&
              (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED);
         if(ok) placedTicket = (long)res.order;
         if(!ok) retcode = res.retcode;
      }

      if(ok)
      {
         if(orderType != "stop_limit")
            retcode = trade.ResultRetcode();
         return true;
      }

      if(orderType != "stop_limit")
         retcode = trade.ResultRetcode();

      LogTradeRequest("pending-fail-" + orderType, sym, side, lots, price, sl, tp,
                      deviation, fill, execMode, retcode);
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
   string requestedSym = sym;
   sym = ResolveBrokerSymbol(sym);
   if(sym == "")
   {
      AckCommand(id, "failed", 0, 0, 0,
                 "symbol not found: " + requestedSym + " | Available: " + GetMarketWatchSymbols());
      return;
   }
   Sleep(200);
   if(!WaitForLiveQuotes(sym))
   {
      AckCommand(id, "failed", 0, 0, 0, "off quotes: no live bid/ask for " + sym);
      return;
   }

   uint retcode = 0;
   if(TryMarketOrder(sym, side, lots, sl, tp, retcode))
   {
      long   ticket = g_last_trade_ticket > 0 ? g_last_trade_ticket : (long)trade.ResultOrder();
      double price  = g_last_trade_price > 0 ? g_last_trade_price : trade.ResultPrice();
      MarkCommandAcked(id);
      AckCommand(id, "acked", ticket, price, lots, "");
   }
   else
   {
      string err = "retcode " + (string)retcode;
      if(g_last_trade_error != "")
         err = g_last_trade_error;
      AckCommand(id, "failed", 0, 0, 0, err);
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
   string requestedSym = sym;
   sym = ResolveBrokerSymbol(sym);
   if(sym == "")
   {
      AckCommand(id, "failed", 0, 0, 0,
                 "symbol not found: " + requestedSym + " | Available: " + GetMarketWatchSymbols());
      return;
   }
   Sleep(200);
   if(!WaitForLiveQuotes(sym))
   {
      AckCommand(id, "failed", 0, 0, 0, "off quotes: no live bid/ask for " + sym);
      return;
   }

   string ot = orderType;
   if(ot != "limit" && ot != "stop" && ot != "stop_limit")
   {
      AckCommand(id, "failed", 0, 0, 0, "unsupported order_type: " + ot);
      return;
   }

   uint retcode = 0;
   long placedTicket = 0;
   if(TryPendingOrder(sym, side, ot, lots, price, sl, tp, retcode, placedTicket))
   {
      long ticket = placedTicket > 0 ? placedTicket : (long)trade.ResultOrder();
      MarkCommandAcked(id);
      AckCommand(id, "acked", ticket, price, lots, "");
   }
   else
      AckCommand(id, "failed", 0, 0, 0, "retcode " + (string)retcode);
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

   string refSym = (StreamSymbol != "") ? StreamSymbol : "EURUSD";
   string inner = "\"ea_version\":" + JsonStr(EA_VERSION) + ",";
   inner += "\"trade_allowed\":" + (string)(TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "true" : "false") + ",";
   inner += "\"mql_trade_allowed\":" + (string)(MQLInfoInteger(MQL_TRADE_ALLOWED) ? "true" : "false") + ",";
   inner += "\"balance\":" + DoubleToString(balance, 2) + ",";
   inner += "\"equity\":" + DoubleToString(equity, 2) + ",";
   inner += "\"margin\":" + DoubleToString(margin, 2) + ",";
   inner += "\"free_margin\":" + DoubleToString(freeMargin, 2) + ",";
   inner += "\"profit\":" + DoubleToString(profit, 2) + ",";
   inner += "\"leverage\":" + (string)leverage + ",";
   inner += "\"positions_count\":" + (string)PositionsTotal() + ",";
   if(SymbolSelect(refSym, true))
   {
      inner += "\"reference_symbol\":" + JsonStr(refSym) + ",";
      inner += "\"trade_execution\":" + JsonStr(TradeExecutionToString(SymbolInfoInteger(refSym, SYMBOL_TRADE_EXEMODE))) + ",";
      inner += "\"filling_mode\":" + JsonStr(FillingModeToString((int)SymbolInfoInteger(refSym, SYMBOL_FILLING_MODE))) + ",";
      inner += "\"spread_points\":" + (string)SymbolInfoInteger(refSym, SYMBOL_SPREAD) + ",";
      inner += "\"bid\":" + DoubleToString(SymbolInfoDouble(refSym, SYMBOL_BID), (int)SymbolInfoInteger(refSym, SYMBOL_DIGITS)) + ",";
      inner += "\"ask\":" + DoubleToString(SymbolInfoDouble(refSym, SYMBOL_ASK), (int)SymbolInfoInteger(refSym, SYMBOL_DIGITS)) + ",";
   }
   inner += "\"pending_orders\":" + pending;

   MarkCommandAcked(id);
   AckCommandEx(id, "acked", inner, "");
}

// v4 — on-demand OHLC via CopyRates
void GetOhlc(long id, string payload, string root)
{
   string symRaw = PayloadStrVal(payload, root, "symbol");
   string sym = ResolveBrokerSymbol(symRaw);
   string tfStr = PayloadStrVal(payload, root, "timeframe");
   if(tfStr == "")
      tfStr = PayloadStrVal(payload, root, "interval");
   int count = (int)PayloadNum(payload, root, "count");
   if(count <= 0) count = 200;
   if(count > 500) count = 500;

   if(sym == "")
   {
      AckCommand(id, "failed", 0, 0, 0,
                 "symbol not found: " + symRaw + " | Available: " + GetMarketWatchSymbols());
      return;
   }
   if(tfStr == "")
      tfStr = "1h";

   ENUM_TIMEFRAMES tf = ResolveTimeframe(tfStr);
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int got = CopyRates(sym, tf, 0, count, rates);
   if(got <= 0)
   {
      AckCommand(id, "failed", 0, 0, 0, "CopyRates failed for " + sym + " " + tfStr);
      return;
   }

   string candles = "[";
   for(int i = got - 1; i >= 0; i--)
   {
      if(candles != "[") candles += ",";
      candles += "{";
      candles += "\"time\":" + (string)(long)rates[i].time + ",";
      candles += "\"open\":" + DoubleToString(rates[i].open, 8) + ",";
      candles += "\"high\":" + DoubleToString(rates[i].high, 8) + ",";
      candles += "\"low\":" + DoubleToString(rates[i].low, 8) + ",";
      candles += "\"close\":" + DoubleToString(rates[i].close, 8) + ",";
      candles += "\"volume\":" + (string)(long)rates[i].tick_volume;
      candles += "}";
   }
   candles += "]";

   string interval = TfToString(tf);
   string inner = "\"symbol\":" + JsonStr(sym) + ",";
   inner += "\"timeframe\":" + JsonStr(interval) + ",";
   inner += "\"count\":" + (string)got + ",";
   inner += "\"candles\":" + candles;

   MarkCommandAcked(id);
   AckCommandEx(id, "acked", inner, "");
}

// v4.01 — immediate chart-symbol quote (tick stream for attached symbol)
void FlushChartSymbolQuote()
{
   ulong nowMs = GetTickCount64();
   if(g_last_chart_quote_ms > 0 &&
      nowMs - g_last_chart_quote_ms < (ulong)MathMax(100, ChartQuoteThrottleMs))
      return;

   string sym = Symbol();
   if(sym == "") return;

   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   if(bid <= 0 && ask <= 0) return;

   datetime tickTime = (datetime)SymbolInfoInteger(sym, SYMBOL_TIME);
   string body = "{\"quotes\":[{";
   body += "\"symbol\":" + JsonStr(sym) + ",";
   body += "\"bid\":" + DoubleToString(bid, 8) + ",";
   body += "\"ask\":" + DoubleToString(ask, 8) + ",";
   body += "\"tick_time\":" + (string)(long)tickTime;
   body += "}]}";

   string resp = "";
   if(!HttpPost("/api/ea/quotes", body, resp))
   {
      g_quote_failures++;
      if(g_quote_failures == 1 || g_quote_failures % 10 == 0)
         Print("AiChartBridge: chart quote push failed (", g_quote_failures, ").");
      return;
   }
   if(g_quote_failures > 0)
   {
      Print("AiChartBridge: chart quote push restored after ", g_quote_failures, " failure(s).");
      g_quote_failures = 0;
   }
   g_last_chart_quote_ms = nowMs;
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
   if(!HttpPost("/api/ea/quotes", body, resp))
   {
      g_quote_failures++;
      if(g_quote_failures == 1 || g_quote_failures % 10 == 0)
         Print("AiChartBridge: batch quote push failed (", g_quote_failures, ").");
      return;
   }
   if(g_quote_failures > 0)
   {
      Print("AiChartBridge: batch quote push restored after ", g_quote_failures, " failure(s).");
      g_quote_failures = 0;
   }
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

// FIX: 6 — parse server flags from heartbeat JSON (kill switch + reconnect)
void ProcessHeartbeatFlags(string resp)
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
   bool reconnect = JsonBool(flagsBlock, "reconnect");
   bool resyncCandles = JsonBool(flagsBlock, "resync_candles");

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

   if(reconnect || resyncCandles)
      HandleServerReconnect(reconnect, resyncCandles);
}

// v4 — server-requested reconnect: re-arm bridge, flush quotes, re-push symbols
void HandleServerReconnect(bool fullReconnect, bool resyncCandles)
{
   Print("AiChartBridge: server reconnect",
         fullReconnect ? " (full)" : "",
         resyncCandles ? " + resync_candles" : "",
         " — re-syncing bridge.");
   g_hb_failures = 0;
   g_last_hb_time = 0;
   if(fullReconnect)
   {
      PreWarmSymbols();
      FlushLiveQuotes();
   }
   if(resyncCandles || fullReconnect)
      g_last_hb_time = 0;
   SendHeartbeat();
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

ENUM_TIMEFRAMES ResolveTimeframe(string interval)
{
   string iv = interval;
   StringTrimLeft(iv);
   StringTrimRight(iv);
   if(iv == "" || iv == "chart") return Period();

   if(iv == "1m" || iv == "M1")  return PERIOD_M1;
   if(iv == "5m" || iv == "M5")  return PERIOD_M5;
   if(iv == "15m" || iv == "M15") return PERIOD_M15;
   if(iv == "30m" || iv == "M30") return PERIOD_M30;
   if(iv == "1h" || iv == "H1")  return PERIOD_H1;
   if(iv == "4h" || iv == "H4")  return PERIOD_H4;
   if(iv == "1d" || iv == "D1")  return PERIOD_D1;
   if(iv == "1w" || iv == "W1")  return PERIOD_W1;
   if(iv == "MN" || iv == "1mn") return PERIOD_MN1;

   return Period();
}

ENUM_TIMEFRAMES TfFromInterval(string interval)
{
   return ResolveTimeframe(interval);
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
//| Chart drawing + screenshot (v3.09)                               |
//+------------------------------------------------------------------+
color DRAW_COLOR_DEFAULT = C'58,134,255'; // #3A86FF

long HexCharToLong(string hex)
{
   StringToUpper(hex);
   long result = 0;
   for(int i = 0; i < StringLen(hex); i++)
   {
      ushort c = StringGetCharacter(hex, i);
      result *= 16;
      if(c >= '0' && c <= '9') result += c - '0';
      else if(c >= 'A' && c <= 'F') result += c - 'A' + 10;
   }
   return result;
}

color HexToColor(string hex, color fallback)
{
   if(StringGetCharacter(hex, 0) == '#')
      hex = StringSubstr(hex, 1);
   if(StringLen(hex) != 6) return fallback;
   long r = HexCharToLong(StringSubstr(hex, 0, 2));
   long g = HexCharToLong(StringSubstr(hex, 2, 2));
   long b = HexCharToLong(StringSubstr(hex, 4, 2));
   return (color)((r << 16) | (g << 8) | b);
}

void ApplyFillStyle(string name, color fillClr, bool doFill)
{
   if(doFill)
   {
      ObjectSetInteger(0, name, OBJPROP_FILL, true);
      ObjectSetInteger(0, name, OBJPROP_BGCOLOR, fillClr);
   }
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
}

int ClampDrawWidth(int w)
{
   if(w < 1) return 1;
   if(w > 5) return 5;
   return w;
}

ENUM_LINE_STYLE LineStyleFromString(string style)
{
   if(style == "dashed") return STYLE_DASH;
   if(style == "dotted") return STYLE_DOT;
   return STYLE_SOLID;
}

datetime TimeFromBarOffset(string sym, ENUM_TIMEFRAMES tf, int barOffset, double unixOverride)
{
   if(unixOverride > 0) return (datetime)(long)unixOverride;

   datetime t = iTime(sym, tf, barOffset);
   if(t > 0) return t;

   t = iTime(sym, tf, 0);
   if(t > 0) return t;

   Print("AiChartBridge: iTime empty for ", sym, " tf=", (int)tf, " offset=", barOffset);
   return TimeCurrent();
}

void ApplyObjectLabel(string name, string label, int fsize, color clr)
{
   if(label == "") return;
   ObjectSetString(0, name, OBJPROP_TEXT, label);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, fsize > 0 ? fsize : 9);
   ObjectSetString(0, name, OBJPROP_FONT, "Arial");
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
}

void ApplyLineStyle(string name, color clr, int width, ENUM_LINE_STYLE lineStyle)
{
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, ClampDrawWidth(width));
   ObjectSetInteger(0, name, OBJPROP_STYLE, lineStyle);
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
            int timeOffset = (int)JsonNum(pt, "time_offset");
            int barOff = (timeOffset != 0 || StringFind(pt, "\"time_offset\"") >= 0) ? timeOffset : barsAhead;
            double price = JsonNum(pt, "price");
            double timeVal = JsonNum(pt, "time");
            times[count] = TimeFromBarOffset(sym, tf, barOff, timeVal);
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

int ReadDrawingCoords(string drawingJson, string sym, ENUM_TIMEFRAMES tf,
                      datetime &times[], double &prices[], int maxPts)
{
   int n = ParsePointsArray(drawingJson, sym, tf, times, prices, maxPts);
   if(n > 0) return n;

   double price = JsonNum(drawingJson, "price");
   if(price <= 0) return 0;

   ArrayResize(times, maxPts);
   ArrayResize(prices, maxPts);

   int tOff = (int)JsonNum(drawingJson, "time_offset");
   if(tOff == 0 && StringFind(drawingJson, "\"time_offset\"") < 0)
      tOff = (int)JsonNum(drawingJson, "barsAhead");
   times[0] = TimeFromBarOffset(sym, tf, tOff, JsonNum(drawingJson, "time"));
   prices[0] = price;
   n = 1;

   double price2 = JsonNum(drawingJson, "price2");
   if(price2 > 0)
   {
      int tOff2 = (int)JsonNum(drawingJson, "time_offset2");
      if(tOff2 == 0 && StringFind(drawingJson, "\"time_offset2\"") < 0) tOff2 = 10;
      times[1] = TimeFromBarOffset(sym, tf, tOff2, 0);
      prices[1] = price2;
      n = 2;
   }

   double price3 = JsonNum(drawingJson, "price3");
   if(price3 > 0)
   {
      int tOff3 = (int)JsonNum(drawingJson, "time_offset3");
      if(tOff3 == 0 && StringFind(drawingJson, "\"time_offset3\"") < 0) tOff3 = 5;
      times[2] = TimeFromBarOffset(sym, tf, tOff3, 0);
      prices[2] = price3;
      n = 3;
   }
   return n;
}

string ResolveDrawingType(string dtype, string label)
{
   if(dtype == "price_line" || dtype == "baseline") return "hline";
   if(dtype == "trend_line" || dtype == "forecast_path") return "trend_path";
   if(dtype == "zone" || dtype == "histogram_band") return "rectangle";
   if(dtype == "channel") return "channel";
   if(dtype == "fib_retracement") return "fibo";
   if(dtype == "marker")
   {
      string low = label;
      StringToLower(low);
      if(StringFind(low, "buy") >= 0 || StringFind(low, "شراء") >= 0) return "arrow_up";
      if(StringFind(low, "sell") >= 0 || StringFind(low, "بيع") >= 0) return "arrow_down";
      return "arrow";
   }
   if(dtype == "trendline") return "trend";
   if(dtype == "fibonacci") return "fibo";
   return dtype;
}

void DrawMt5Object(string name, string dtype, string drawingJson, string sym, ENUM_TIMEFRAMES tf,
                   datetime &times[], double &prices[], int n)
{
   string label = JsonStrVal(drawingJson, "label");
   string colorHex = JsonStrVal(drawingJson, "color");
   if(colorHex == "") colorHex = JsonStrVal(drawingJson, "fill_color");
   color clr = HexToColor(colorHex, DRAW_COLOR_DEFAULT);
   int width = (int)JsonNum(drawingJson, "width");
   if(width <= 0) width = 2;
   string style = JsonStrVal(drawingJson, "style");
   if(style == "") style = "solid";
   ENUM_LINE_STYLE lineStyle = LineStyleFromString(style);
   int fsize = (int)JsonNum(drawingJson, "font_size");
   bool fill = JsonBool(drawingJson, "fill");
   string fillHex = JsonStrVal(drawingJson, "fill_color");
   color fillClr = HexToColor(fillHex, clr);

   datetime t1 = (n > 0) ? times[0] : 0;
   datetime t2 = (n > 1) ? times[1] : t1;
   double p1 = (n > 0) ? prices[0] : 0;
   double p2 = (n > 1) ? prices[1] : p1;
   datetime t3 = (n > 2) ? times[2] : t1;
   double p3 = (n > 2) ? prices[2] : p1;

   if(dtype == "hline")
   {
      if(p1 <= 0) return;
      ObjectCreate(0, name, OBJ_HLINE, 0, 0, p1);
      ApplyLineStyle(name, clr, width, lineStyle);
      ApplyObjectLabel(name, label, fsize, clr);
   }
   else if(dtype == "vline")
   {
      if(t1 == 0) return;
      ObjectCreate(0, name, OBJ_VLINE, 0, t1, p1);
      ApplyLineStyle(name, clr, width, lineStyle);
   }
   else if(dtype == "trend" || dtype == "ray")
   {
      if(t1 == 0 || t2 == 0) return;
      ObjectCreate(0, name, OBJ_TREND, 0, t2, p2, t1, p1);
      ApplyLineStyle(name, clr, width, lineStyle);
      ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, (dtype == "ray"));
      ApplyObjectLabel(name, label, fsize, clr);
   }
   else if(dtype == "trend_path")
   {
      for(int i = 1; i < n; i++)
      {
         string seg = name + "_seg" + (string)i;
         if(times[i-1] == 0 || times[i] == 0) continue;
         ObjectCreate(0, seg, OBJ_TREND, 0, times[i-1], prices[i-1], times[i], prices[i]);
         ApplyLineStyle(seg, clr, width, lineStyle);
         ObjectSetInteger(0, seg, OBJPROP_RAY_RIGHT, false);
      }
      if(label != "" && n > 0)
         ApplyObjectLabel(name + "_lbl", label, fsize, clr);
   }
   else if(dtype == "channel" && n >= 4)
   {
      ObjectCreate(0, name + "_a", OBJ_TREND, 0, times[0], prices[0], times[1], prices[1]);
      ApplyLineStyle(name + "_a", clr, width, lineStyle);
      ObjectCreate(0, name + "_b", OBJ_TREND, 0, times[2], prices[2], times[3], prices[3]);
      ApplyLineStyle(name + "_b", clr, width, lineStyle);
      ApplyObjectLabel(name + "_lbl", label, fsize, clr);
   }
   else if(dtype == "rectangle" || dtype == "zone")
   {
      if(t1 == 0 || t2 == 0) return;
      ObjectCreate(0, name, OBJ_RECTANGLE, 0, t2, p2, t1, p1);
      ApplyLineStyle(name, clr, width, lineStyle);
      bool doFill = fill || dtype == "zone" || dtype == "rectangle";
      ApplyFillStyle(name, fillClr, doFill);
      ApplyObjectLabel(name, label, fsize, clr);
   }
   else if(dtype == "triangle" && n >= 3)
   {
      ObjectCreate(0, name, OBJ_TRIANGLE, 0, t1, p1, t2, p2, t3, p3);
      ApplyLineStyle(name, clr, width, lineStyle);
      if(fill) ApplyFillStyle(name, fillClr, true);
      ApplyObjectLabel(name, label, fsize, clr);
   }
   else if(dtype == "ellipse")
   {
      if(t1 == 0 || t2 == 0) return;
      ObjectCreate(0, name, OBJ_ELLIPSE, 0, t2, p2, t1, p1);
      ApplyLineStyle(name, clr, width, lineStyle);
      if(fill) ApplyFillStyle(name, fillClr, true);
      ApplyObjectLabel(name, label, fsize, clr);
   }
   else if(dtype == "arrow_down" || dtype == "arrow_sell")
   {
      if(t1 == 0 || p1 <= 0) return;
      ObjectCreate(0, name, OBJ_ARROW_DOWN, 0, t1, p1);
      ApplyLineStyle(name, clr, width + 1, lineStyle);
   }
   else if(dtype == "arrow_up" || dtype == "arrow_buy")
   {
      if(t1 == 0 || p1 <= 0) return;
      ObjectCreate(0, name, OBJ_ARROW_UP, 0, t1, p1);
      ApplyLineStyle(name, clr, width + 1, lineStyle);
   }
   else if(dtype == "arrow_stop")
   {
      if(t1 == 0 || p1 <= 0) return;
      ObjectCreate(0, name, OBJ_ARROW_STOP, 0, t1, p1);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "arrow_check")
   {
      if(t1 == 0 || p1 <= 0) return;
      ObjectCreate(0, name, OBJ_ARROW_CHECK, 0, t1, p1);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "arrow_thumb_up")
   {
      if(t1 == 0 || p1 <= 0) return;
      ObjectCreate(0, name, OBJ_ARROW_THUMB_UP, 0, t1, p1);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "arrow_thumb_down")
   {
      if(t1 == 0 || p1 <= 0) return;
      ObjectCreate(0, name, OBJ_ARROW_THUMB_DOWN, 0, t1, p1);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "arrow")
   {
      if(t1 == 0 || p1 <= 0) return;
      int code = (int)JsonNum(drawingJson, "arrow_code");
      if(code <= 0) code = 242;
      ObjectCreate(0, name, OBJ_ARROW, 0, t1, p1);
      ObjectSetInteger(0, name, OBJPROP_ARROWCODE, code);
      ApplyLineStyle(name, clr, width, lineStyle);
   }
   else if(dtype == "fibo")
   {
      if(t1 == 0 || t2 == 0) return;
      ObjectCreate(0, name, OBJ_FIBO, 0, t2, p2, t1, p1);
      ApplyLineStyle(name, clr, 1, STYLE_SOLID);
      ApplyObjectLabel(name, label, fsize, clr);
   }
   else if(dtype == "fibo_fan")
   {
      if(t1 == 0 || t2 == 0) return;
      ObjectCreate(0, name, OBJ_FIBOFAN, 0, t2, p2, t1, p1);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "fibo_arc")
   {
      if(t1 == 0 || t2 == 0) return;
      ObjectCreate(0, name, OBJ_FIBOARC, 0, t2, p2, t1, p1);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "expansion" && n >= 3)
   {
      ObjectCreate(0, name, OBJ_EXPANSION, 0, t2, p2, t1, p1, t3, p3);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "pitchfork" && n >= 3)
   {
      ObjectCreate(0, name, OBJ_PITCHFORK, 0, t2, p2, t1, p1, t3, p3);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "gann_line")
   {
      if(t1 == 0 || t2 == 0) return;
      ObjectCreate(0, name, OBJ_GANNLINE, 0, t2, p2, t1, p1);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "gann_fan")
   {
      if(t1 == 0 || t2 == 0) return;
      ObjectCreate(0, name, OBJ_GANNFAN, 0, t2, p2, t1, p1);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   }
   else if(dtype == "text")
   {
      if(t1 == 0) return;
      ObjectCreate(0, name, OBJ_TEXT, 0, t1, p1);
      ObjectSetString(0, name, OBJPROP_TEXT, label);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, fsize > 0 ? fsize : 10);
      ObjectSetString(0, name, OBJPROP_FONT, "Arial Bold");
   }
   else if(dtype == "label")
   {
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
      ObjectSetString(0, name, OBJPROP_TEXT, label);
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, fsize > 0 ? fsize : 10);
      int xdist = (int)JsonNum(drawingJson, "x");
      int ydist = (int)JsonNum(drawingJson, "y");
      if(xdist <= 0) xdist = 20;
      if(ydist <= 0) ydist = 20;
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, xdist);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, ydist);
      ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   }
   else
   {
      Print("AiChartBridge: unsupported drawing type: ", dtype);
      return;
   }

   if(label != "" && dtype != "text" && dtype != "label" && dtype != "trend_path" && dtype != "channel")
      ApplyObjectLabel(name, label, fsize, clr);
}

void DrawSingleDrawing(string prefix, int idx, string drawingJson, string sym, ENUM_TIMEFRAMES tf)
{
   string rawType = JsonStrVal(drawingJson, "type");
   if(rawType == "") return;
   string label = JsonStrVal(drawingJson, "label");
   string dtype = ResolveDrawingType(rawType, label);

   datetime times[];
   double prices[];
   int n = ReadDrawingCoords(drawingJson, sym, tf, times, prices, 16);

   if(n <= 0 && dtype != "label") return;

   string base = prefix + rawType + "_" + (string)idx;
   DrawMt5Object(base, dtype, drawingJson, sym, tf, times, prices, n);
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
   string symRaw = PayloadStrVal(payload, payload, "symbol");
   string sym = ResolveBrokerSymbol(symRaw);
   string interval = PayloadStrVal(payload, payload, "interval");
   long recId = (long)PayloadNum(payload, payload, "recommendation_id");
   string captureKey = PayloadStrVal(payload, payload, "capture_key");
   if(captureKey == "" && recId > 0) captureKey = (string)recId;

   ENUM_TIMEFRAMES tf = ResolveTimeframe(interval);
   if(sym == "")
   {
      AckCommand(id, "failed", 0, 0, 0, "symbol not available: " + symRaw + " | Available: " + GetMarketWatchSymbols());
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
   long recId = (long)PayloadNum(payload, payload, "recommendation_id");

   DeleteAichartObjects(recId);
   ChartRedraw(0);
   MarkCommandAcked(id);
   AckCommand(id, "acked", recId, 0, 0, "");
}
//+------------------------------------------------------------------+
