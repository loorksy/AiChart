//+------------------------------------------------------------------+
//|                                              AiChartBridge.mq5    |
//|       Connects a MetaTrader 5 terminal to the AiChart platform   |
//|       via the self-hosted EA bridge API (heartbeat + commands).  |
//+------------------------------------------------------------------+
#property copyright "AiChart"
#property link      "https://aichart.lork.cloud"
#property version   "1.01"
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

   string payload = PayloadBlock(obj);

   if(type == "open_market")
   {
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
   else if(type == "draw_and_capture")
   {
      DrawAndCapture(id, payload);
   }
   else if(type == "clear_chart")
   {
      ClearChartCommand(id, payload);
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
   g_last_acked = id;
   AckCommand(id, "acked", recId, 0, 0, "");
}
//+------------------------------------------------------------------+
