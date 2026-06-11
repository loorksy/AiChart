//+------------------------------------------------------------------+
//|                                              AiChartBridge.mq5    |
//|       Connects a MetaTrader 5 terminal to the AiChart platform   |
//|       via the self-hosted EA bridge API (heartbeat + commands).  |
//+------------------------------------------------------------------+
#property copyright "AiChart"
#property link      "https://aichart.lork.cloud"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

//--- Inputs --------------------------------------------------------
input string  ApiBase          = "https://aichart.lork.cloud"; // AiChart base URL
input string  EaToken          = "";                            // EA token from AiChart settings
input string  StreamSymbol     = "EURUSD";                      // Symbol to stream candles for
input ENUM_TIMEFRAMES StreamTF = PERIOD_H1;                     // Candle timeframe
input int     CandleCount      = 200;                           // Candles per heartbeat
input int     HeartbeatSeconds = 1;                             // Heartbeat interval
input int     MaxSymbols       = 40;                            // Max symbols in Market Watch to report

CTrade  trade;
long    g_last_acked = 0;     // last executed command id (idempotency)

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(EaToken) < 8)
   {
      Print("AiChartBridge: EaToken is not set. Open EA properties and paste your token.");
      return(INIT_FAILED);
   }
   EventSetTimer(MathMax(1, HeartbeatSeconds));
   Print("AiChartBridge MT5 started. Base=", ApiBase);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { EventKillTimer(); }

//+------------------------------------------------------------------+
void OnTimer()
{
   string body = BuildHeartbeat();
   string resp = "";
   if(!HttpPost("/api/ea/heartbeat", body, resp))
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

   string json = "{";
   json += "\"account\":{";
   json += "\"login\":\"" + login + "\",";
   json += "\"currency\":\"" + currency + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"broker\":" + JsonStr(broker);
   json += "},";
   json += "\"symbols\":" + BuildSymbols() + ",";
   json += "\"candles\":" + BuildCandles();
   json += "}";
   return json;
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
      arr += "\"lot_step\":" + DoubleToString(lstep, 2);
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
   if(id == g_last_acked) return; // idempotency

   if(type == "open_market")
   {
      string sym  = JsonStrVal(obj, "symbol");
      string side = JsonStrVal(obj, "side");
      double lots = JsonNum(obj, "lots");
      double sl   = JsonNum(obj, "stop_loss");
      double tp   = JsonNum(obj, "take_profit");
      ExecuteMarket(id, sym, side, lots, sl, tp);
   }
   else if(type == "close_position")
   {
      long ticket = (long)JsonNum(obj, "ticket");
      ClosePosition(id, ticket);
   }
   else
   {
      AckCommand(id, "failed", 0, 0, 0, "unsupported command type");
   }
}

void ExecuteMarket(long id, string sym, string side, double lots, double sl, double tp)
{
   if(sym == "" || lots <= 0)
   {
      AckCommand(id, "failed", 0, 0, 0, "invalid order params");
      return;
   }
   if(!SymbolSelect(sym, true))
   {
      AckCommand(id, "failed", 0, 0, 0, "symbol not found: " + sym);
      return;
   }
   trade.SetDeviationInPoints(20);
   bool ok = false;
   if(side == "buy")
      ok = trade.Buy(lots, sym, 0.0, sl, tp, "AiChart");
   else
      ok = trade.Sell(lots, sym, 0.0, sl, tp, "AiChart");

   if(ok)
   {
      long   ticket = (long)trade.ResultOrder();
      double price  = trade.ResultPrice();
      g_last_acked  = id;
      AckCommand(id, "acked", ticket, price, lots, "");
   }
   else
   {
      AckCommand(id, "failed", 0, 0, 0, "retcode " + (string)trade.ResultRetcode());
   }
}

void ClosePosition(long id, long ticket)
{
   if(trade.PositionClose((ulong)ticket))
   {
      g_last_acked = id;
      AckCommand(id, "acked", ticket, 0, 0, "");
   }
   else
      AckCommand(id, "failed", ticket, 0, 0, "close failed " + (string)trade.ResultRetcode());
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

//+------------------------------------------------------------------+
//| HTTP                                                             |
//+------------------------------------------------------------------+
bool HttpPost(string path, string body, string &response)
{
   string url = ApiBase + path;
   string headers = "Content-Type: application/json\r\n";
   headers += "Authorization: Bearer " + EaToken + "\r\n";
   headers += "X-EA-Token: " + EaToken + "\r\n";

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
      Print("WebRequest failed (", err, "). Add ", ApiBase,
            " to Tools > Options > Expert Advisors > Allow WebRequest.");
      return false;
   }
   response = CharArrayToString(result, 0, ArraySize(result), CP_UTF8);
   return (res >= 200 && res < 300);
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
//+------------------------------------------------------------------+
