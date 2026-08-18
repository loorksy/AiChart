/**
 * Unified widget runtime injected into every card. Detects the host:
 * - ChatGPT Apps SDK: `window.openai` bridge (toolOutput / callTool / events).
 * - MCP Apps (Claude & co.): postMessage JSON-RPC per spec 2026-01-26
 *   (ui/initialize handshake, ui/notifications/tool-result, tools/call).
 * Exposes a read-only data API: AIC.getData / onData / callTool (data polling
 * only) / localization (t / applyStaticLabels). Cards render no action buttons.
 */
export const RUNTIME_JS = `
(function () {
  var listeners = [];
  var latest = null;
  var currentLocale = "ar";
  var I18N = {
    en: {
      yes: "Yes", no: "No",
      buy: "Buy", sell: "Sell", wait: "Wait", opportunity: "Opportunity",
      bullish: "Bullish", bearish: "Bearish", sideways: "Sideways", neutral: "Neutral",
      bridgeOffline: "Bridge offline — no live data",
      staleQuotes: "Stale quotes ({s}s)",
      connected: "Connected",
      connStaleLabel: "Offline / stale data",
      noOpenTrades: "No open trades",
      moreTrades: "+{n} more trades",
      noDataYet: "No data yet — try refreshing.",
      equity: "Equity", balance: "Balance", openPnl: "Open PnL",
      price: "Price", trend: "Trend",
      refresh: "Refresh", manage: "Manage", deep: "Deeper", analyze: "Analyze",
      chart: "Chart", open: "Open", pause: "Pause", resume: "Resume",
      support: "Support", resistance: "Resistance", change24h: "24h",
      totalPnl: "Total PnL", connection: "Connection",
      connLive: "Live", connStale: "Stale",
      noSymbol: "No symbol yet",
      noSymbolHint: "No symbol yet — ask Lonora to show a chart for a pair.",
      noCandles: "No candles available — link a MetaTrader account; all data comes from your own account.",
      updateFailed: "Update failed", pausedStatus: "Paused",
      entry: "Entry", stop: "Stop", target: "Target",
      stopLoss: "Stop loss", targetLabel: "Target", entryLabel: "Entry",
      pattern: "Pattern", factors: "Factors",
      noData: "No data available", noOpportunities: "No opportunities",
      noRecommendation: "No recommendation yet",
      trades: "Trades", items: "Items", candidates: "Candidates",
      pending: "Pending", status: "Status", capital: "Capital",
      todayPnl: "Today PnL",
      bridgeNoTrades: "Bridge offline — no phantom trades",
      followUpManage: "Open my active trades in Lonora.",
      pairPickerTitle: "Pick a pair",
      pairPickerSubtitle: "Choose a pair before analysis.",
      refreshPairs: "Refresh pairs",
      riskStatusTitle: "Position sizing",
      riskStatusSubtitle: "Current Risk per Trade and verified account facts.",
      pendingApprovalsTitle: "Pending approvals",
      pendingApprovalsSubtitle: "Execution requests awaiting your approval.",
      tradeReadinessTitle: "Trade readiness",
      tradeReadinessSubtitle: "Technical pre-execution check via Lonora.",
      lessonsTitle: "Trading lessons",
      lessonsSubtitle: "Performance memory and similar lessons.",
      chartTitle: "Chart",
      noDataAvailable: "No data available",
      updated: "Last updated",
      approve: "Approve", reject: "Reject",
      previewBadge: "Preview", sending: "Sending…", actionFailed: "Action failed — try again",
      noPending: "No pending approvals",
      confidence: "Confidence", riskReward: "Risk/Reward", setup: "Setup",
      freeMargin: "Free Margin", floatingPnl: "Floating P/L",
      "status.pending": "Pending", "status.pending_entry": "Pending entry",
      "status.triggered": "Entered", "status.tp1_hit": "TP1 reached",
      "status.tp2_hit": "TP2 reached", "status.tp3_hit": "TP3 reached",
      "status.sl_hit": "Stop loss hit", "status.expired": "Expired",
      "status.cancelled": "Cancelled", "status.invalidated": "Invalidated",
      "trend.uptrend": "Uptrend", "trend.downtrend": "Downtrend",
      "trend.range": "Range", "trend.sideways": "Sideways",
      "trend.neutral": "Neutral", "trend.unknown": "Unknown",
    },
    ar: {
      yes: "نعم", no: "لا",
      buy: "شراء", sell: "بيع", wait: "انتظار", opportunity: "فرصة",
      bullish: "صاعد", bearish: "هابط", sideways: "عرضي", neutral: "محايد",
      bridgeOffline: "الجسر غير متصل — لا بيانات حية",
      staleQuotes: "أسعار قديمة ({s}s)",
      connected: "متصل",
      connStaleLabel: "غير متصل / بيانات قديمة",
      noOpenTrades: "لا صفقات مفتوحة",
      moreTrades: "+{n} صفقات أخرى",
      noDataYet: "لم تصل بيانات بعد — جرّب التحديث.",
      equity: "حقوق الملكية", balance: "الرصيد", openPnl: "PnL المفتوح",
      price: "السعر", trend: "الاتجاه",
      refresh: "تحديث", manage: "إدارة", deep: "أعمق", analyze: "تحليل",
      chart: "شارت", open: "فتح", pause: "إيقاف", resume: "استئناف",
      support: "الدعم", resistance: "المقاومة", change24h: "24س",
      totalPnl: "إجمالي PnL", connection: "الاتصال",
      connLive: "مباشر", connStale: "قديم",
      noSymbol: "لا يوجد رمز بعد",
      noSymbolHint: "لا يوجد رمز بعد — اطلب من Lonora عرض شارت لرمز معين.",
      noCandles: "لا شموع متاحة الآن — اربط حساب MetaTrader؛ كل البيانات تأتي من حسابك أنت.",
      updateFailed: "تعذر التحديث", pausedStatus: "متوقف",
      entry: "دخول", stop: "وقف", target: "هدف",
      stopLoss: "وقف الخسارة", targetLabel: "الهدف", entryLabel: "الدخول",
      pattern: "النمط", factors: "العوامل",
      noData: "لا توجد بيانات متاحة", noOpportunities: "لا فرص",
      noRecommendation: "لا توصية بعد",
      trades: "الصفقات", items: "العناصر", candidates: "الفرص",
      pending: "المعلّق", status: "الحالة", capital: "رأس المال",
      todayPnl: "PnL اليوم",
      bridgeNoTrades: "الجسر غير متصل — لا صفقات وهمية",
      followUpManage: "افتح صفقاتي النشطة في Lonora.",
      pairPickerTitle: "اختيار زوج",
      pairPickerSubtitle: "اختر الزوج المناسب قبل التحليل.",
      refreshPairs: "تحديث الأزواج",
      riskStatusTitle: "حجم الصفقة",
      riskStatusSubtitle: "المخاطرة لكل صفقة وبيانات الحساب الموثقة.",
      pendingApprovalsTitle: "الموافقات المعلقة",
      pendingApprovalsSubtitle: "طلبات التنفيذ التي تنتظر موافقتك.",
      tradeReadinessTitle: "جاهزية الصفقة",
      tradeReadinessSubtitle: "فحص تقني قبل التنفيذ عبر Lonora.",
      lessonsTitle: "دروس التداول",
      lessonsSubtitle: "ذاكرة الأداء والدروس المشابهة.",
      chartTitle: "الشارت",
      noDataAvailable: "لا توجد بيانات متاحة",
      updated: "آخر تحديث",
      approve: "موافقة", reject: "رفض",
      previewBadge: "معاينة", sending: "جارٍ الإرسال…", actionFailed: "فشل الإجراء — حاول مجدداً",
      noPending: "لا توجد طلبات معلّقة",
      confidence: "نسبة الثقة", riskReward: "نسبة العائد إلى المخاطرة", setup: "نوع الصفقة",
      freeMargin: "الهامش المتاح", floatingPnl: "الربح/الخسارة العائمة",
      "status.pending": "معلقة", "status.pending_entry": "بانتظار الدخول",
      "status.triggered": "تم الدخول", "status.tp1_hit": "تحقق الهدف الأول",
      "status.tp2_hit": "تحقق الهدف الثاني", "status.tp3_hit": "تحقق الهدف الثالث",
      "status.sl_hit": "ضُرب وقف الخسارة", "status.expired": "منتهية",
      "status.cancelled": "ملغاة", "status.invalidated": "مبطلة",
      "trend.uptrend": "اتجاه صاعد", "trend.downtrend": "اتجاه هابط",
      "trend.range": "نطاق عرضي", "trend.sideways": "حركة جانبية",
      "trend.neutral": "محايد", "trend.unknown": "غير معروف",
    },
  };
  function msg(key, vars) {
    var s = (I18N[currentLocale] || I18N.en)[key] || (I18N.en[key] || key);
    if (vars) {
      for (var vk in vars) s = s.split("{" + vk + "}").join(String(vars[vk]));
    }
    return s;
  }
  function normLoc(v) {
    if (v == null) return null;
    v = String(v).toLowerCase().split("_").join("-");
    if (v === "ar" || v.indexOf("ar-") === 0 || v.slice(0, 2) === "ar") return "ar";
    if (v === "en" || v.indexOf("en-") === 0 || v.slice(0, 2) === "en") return "en";
    return null;
  }
  /* Precedence: explicit payload → account → request/client meta → host/browser
     → default Arabic. Never guessed from symbols or market data. */
  function resolveLocale(data) {
    data = data && typeof data === "object" ? data : {};
    var order = [
      data.locale, data.lang,
      data.accountLocale, data.operatorLocale,
      data.uiLocale, data.clientLocale, data.requestLocale,
    ];
    for (var i = 0; i < order.length; i++) {
      var n = normLoc(order[i]);
      if (n) return n;
    }
    try {
      var host = normLoc(navigator.language || navigator.userLanguage || "");
      if (host) return host;
    } catch (e) {}
    return "ar";
  }
  function applyDocLocale() {
    var el = document.documentElement;
    if (!el) return;
    el.lang = currentLocale === "ar" ? "ar" : "en";
    el.dir = currentLocale === "ar" ? "rtl" : "ltr";
  }
  function applyStaticLabels(root) {
    root = root || document;
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-i18n");
      if (key) nodes[i].textContent = msg(key);
    }
  }
  function setLocale(loc) {
    loc = loc === "ar" ? "ar" : "en";
    if (loc === currentLocale) return;
    currentLocale = loc;
    applyDocLocale();
    applyStaticLabels();
  }
  function emit() {
    if (latest != null) setLocale(resolveLocale(latest));
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](latest); } catch (e) {}
    }
  }

  /* Card scripts run AFTER this runtime and only assign window.__aicReady —
     an interception setter fires the callback immediately once both sides
     exist, regardless of load order. */
  var readyCb = null, readyFired = false;
  function fireReady() {
    if (readyFired || !window.AIC || typeof readyCb !== "function") return;
    readyFired = true;
    try { readyCb(window.AIC); } catch (e) {}
  }
  try {
    Object.defineProperty(window, "__aicReady", {
      configurable: true,
      get: function () { return readyCb; },
      set: function (fn) { readyCb = fn; fireReady(); },
    });
  } catch (e) {}

  function finishApi(api) {
    var rawCallTool = api.callTool;
    api.callTool = function (name, args) {
      return rawCallTool(name, args || {}).then(function (result) {
        var normalized = normalizeToolResult(result);
        if (normalized != null) {
          latest = normalized;
          emit();
          setTimeout(function () { try { api.notifySize(); } catch (e) {} }, 50);
        }
        return normalized;
      });
    };
    api.onData = function (cb) {
      listeners.push(cb);
      if (latest != null) { try { cb(latest); } catch (e) {} }
    };
    api.getData = function () { return latest; };
    api.fmt = function (n, d) {
      if (n == null || isNaN(n)) return "—";
      return Number(n).toLocaleString(undefined, { maximumFractionDigits: d == null ? 5 : d });
    };
    /* Strict numeric extraction: finite number out, or null. Objects yield
       their first finite price-like field — never NaN, never 0-for-missing. */
    api.num = function (v) {
      if (typeof v === "number") return isFinite(v) ? v : null;
      if (typeof v === "string" && v.trim() !== "") {
        var p = Number(v);
        return isFinite(p) ? p : null;
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        var keys = ["price", "value", "level", "close", "mid", "bid"];
        for (var i = 0; i < keys.length; i++) {
          var inner = v[keys[i]];
          if (typeof inner === "number" && isFinite(inner)) return inner;
        }
      }
      return null;
    };
    /* Safe display cell: string for the UI or null (= hide the row).
       Never "[object Object]", never a fabricated number. */
    api.cell = function (v, d) {
      if (v == null || v === "") return null;
      if (typeof v === "number") return isFinite(v) ? api.fmt(v, d) : null;
      if (typeof v === "boolean") return v ? msg("yes") : msg("no");
      if (typeof v === "string") return v;
      var n = api.num(v);
      return n == null ? null : api.fmt(n, d);
    };
    api.formatOpenTrades = function (v) {
      if (v == null) return "—";
      if (typeof v === "number") return String(v);
      if (typeof v === "string") return v;
      if (!Array.isArray(v)) return String(v);
      if (!v.length) return "0";
      return v.map(function (tr) {
        if (!tr || typeof tr !== "object") return String(tr);
        var sym = tr.symbol || tr.sym || "?";
        var side = String(tr.side || "").toLowerCase();
        var sideLbl = side === "buy" ? msg("buy") : side === "sell" ? msg("sell") : side || "—";
        var pnl = tr.pnl != null ? tr.pnl : (tr.open_pnl != null ? tr.open_pnl : tr.profit);
        var pnlStr = (pnl != null && !isNaN(pnl)) ? " · PnL " + Number(pnl).toFixed(2) : "";
        return sym + " " + sideLbl + pnlStr;
      }).join(" | ");
    };
    api.pickTrades = function (data) {
      data = data || {};
      if (Array.isArray(data.trades)) return data.trades;
      if (Array.isArray(data.openTrades)) return data.openTrades;
      if (Array.isArray(data.open_trades)) return data.open_trades;
      if (Array.isArray(data.positions)) return data.positions;
      if (Array.isArray(data.aichartTrades) && data.aichartTrades.length) return data.aichartTrades;
      var bp = data.brokerPositions || {};
      if (Array.isArray(bp.mt5) && bp.mt5.length) return bp.mt5;
      var fx = data.forex || {};
      if (Array.isArray(fx.positions)) return fx.positions;
      var live = data.live || {};
      var liveFx = live.forex || {};
      if (Array.isArray(liveFx.positions)) return liveFx.positions;
      var p = data.portfolio || {};
      if (Array.isArray(p.openTrades)) return p.openTrades;
      if (Array.isArray(p.open_trades)) return p.open_trades;
      if (Array.isArray(p.trades)) return p.trades;
      return [];
    };
    api.bridgeLinkState = function (data) {
      data = data || {};
      var live = data.live || {};
      var forex = live.forex || data.forex || {};
      var envForex = (data.executionEnv && data.executionEnv.forex) || {};
      var quoteAge = data.quoteAgeMs;
      if (data.bridgeOffline === true || data.offline === true) {
        return { stale: true, label: msg("bridgeOffline") };
      }
      var offline = forex.heartbeatFresh === false || envForex.online === false;
      if (offline) return { stale: true, label: msg("bridgeOffline") };
      if (quoteAge != null && quoteAge > 5000) {
        return { stale: true, label: msg("staleQuotes", { s: Math.round(quoteAge / 1000) }) };
      }
      var evidence = forex.heartbeatFresh === true || envForex.online === true || quoteAge != null;
      /* No connectivity signal in the payload → say nothing, don't claim online. */
      return evidence ? { stale: false, label: msg("connected") } : { stale: false, label: "" };
    };
    api.applyBridgeBadge = function (el, data) {
      if (!el) return;
      var s = api.bridgeLinkState(data);
      if (!s.stale) {
        el.textContent = "";
        el.className = "status";
        return;
      }
      el.textContent = s.label;
      el.className = "status stale";
    };
    api.renderTradeLines = function (container, trades, fmt) {
      if (!container) return;
      container.innerHTML = "";
      if (!trades.length) {
        container.innerHTML = '<div class="empty">' + msg("noOpenTrades") + '</div>';
        return;
      }
      trades.slice(0, 4).forEach(function (tr) {
        if (!tr || typeof tr !== "object") return;
        var sym = tr.symbol || tr.sym || "?";
        var side = String(tr.side || "").toLowerCase();
        var sideLbl = side === "buy" ? msg("buy") : side === "sell" ? msg("sell") : side || "—";
        var vol = tr.volume != null ? tr.volume : (tr.lots != null ? tr.lots : tr.qty);
        var line = document.createElement("div");
        line.className = "pair";
        line.innerHTML = "<strong>" + sym + "</strong><span class=\\\"" +
          (side === "buy" ? "green" : side === "sell" ? "red" : "") + "\\\">" +
          sideLbl + (vol != null ? " " + vol : "") + "</span>";
        container.appendChild(line);
      });
      if (trades.length > 4) {
        var more = document.createElement("div");
        more.className = "sub";
        more.textContent = msg("moreTrades", { n: trades.length - 4 });
        container.appendChild(more);
      }
    };
    api.unwrapBridge = function (v) {
      v = v && typeof v === "object" ? v : {};
      if (v.ok === true && v.data != null && typeof v.data === "object") return v.data;
      return v;
    };
    api.first = function () {
      for (var i = 0; i < arguments.length; i++) {
        var v = arguments[i];
        if (v !== undefined && v !== null && v !== "") return v;
      }
      return null;
    };
    api.parseAccountOverview = function (data) {
      data = data && typeof data === "object" ? data : {};
      if (!data.live && !data.risk && (data.forex || data.openTrades || data.open_trades)) {
        data = { portfolio: data, live: data };
      }
      var risk = api.unwrapBridge(data.risk);
      var portfolio = api.unwrapBridge(data.portfolio);
      var live = api.unwrapBridge(data.live);
      var cap = risk.capital || {};
      var liveForex = live.forex || {};
      var dataForex = data.forex || {};
      var conn = api.first(live.connection, portfolio.connection, data.connection, liveForex.connection, dataForex.connection) || {};
      var legacy = api.first(portfolio.account, live.account, data.account, conn) || {};
      var online = api.first(conn.online, liveForex.online, dataForex.online, live.online, data.online);
      var status = String(api.first(conn.connection_status, conn.state, liveForex.status, dataForex.status, live.status, data.status) || "");
      var hasAccountNumbers = api.first(
        conn.balance, conn.equity, legacy.balance, legacy.equity, portfolio.balance, portfolio.equity,
        live.balance, live.equity, data.balance, data.equity
      ) != null;
      var fresh = online === true || /online|connected|live/i.test(status);
      var stale = online === false || /offline|stale|down|revoked/i.test(status);
      var known = online != null || status !== "" || hasAccountNumbers;
      var usable = !stale && (fresh || hasAccountNumbers);
      var conn_status = { fresh: usable, stale: stale, label: !known ? "" : (stale ? msg("connStaleLabel") : (usable ? msg("connected") : "")) };
      var balance = api.num(api.first(conn.balance, legacy.balance, portfolio.balance, live.balance, data.balance));
      var equity = api.num(api.first(conn.equity, legacy.equity, portfolio.equity, live.equity, data.equity));
      var freeMargin = api.num(api.first(
        conn.freeMargin, conn.free_margin, conn.margin_free,
        legacy.freeMargin, legacy.free_margin, legacy.margin_free,
        portfolio.freeMargin, portfolio.free_margin, live.freeMargin, data.freeMargin
      ));
      var openPnl = api.num(api.first(portfolio.openPnl, portfolio.open_pnl, legacy.openPnl, legacy.pnl, live.openPnl, live.open_pnl, data.openPnl, data.open_pnl));
      if (openPnl == null) {
        var arrs = [liveForex.positions, dataForex.positions, live.positions, data.positions, portfolio.openTrades, portfolio.open_trades, data.openTrades, data.trades];
        for (var ai = 0; ai < arrs.length; ai++) {
          var arr = arrs[ai];
          if (!Array.isArray(arr) || !arr.length) continue;
          var sum = 0, seen = false;
          for (var j = 0; j < arr.length; j++) {
            var tr = arr[j] || {};
            var p = api.num(api.first(tr.profit, tr.pnl, tr.open_pnl, tr.openPnl));
            if (p != null) { sum += p; seen = true; }
          }
          if (seen) { openPnl = sum; break; }
        }
      }
      var openTrades = api.first(portfolio.openTrades, portfolio.open_trades, data.openTrades, data.open_trades, data.trades, live.openTrades, live.open_trades);
      var tradeCount = Array.isArray(openTrades) ? openTrades.length : (typeof openTrades === "number" ? openTrades : null);
      var broker = String(api.first(conn.server, legacy.broker) || "MT5");
      var mode = String(api.first(conn.account_trade_mode, legacy.mode) || "live").toLowerCase();
      var login = api.first(conn.login, legacy.login);
      var acctTitle = broker + (mode === "live" ? " Real" : mode === "demo" ? " Demo" : "");
      var tag = mode === "live" ? "LIVE" : (mode === "demo" ? "DEMO" : String(mode).toUpperCase());
      if (conn_status.stale) tag = "Stale";
      return {
        conn: conn_status, balance: balance, equity: equity, freeMargin: freeMargin, openPnl: openPnl,
        openTrades: openTrades, tradeCount: tradeCount, acctTitle: acctTitle, tag: tag,
        login: login,
      };
    };
    api.t = msg;
    api.locale = function () { return currentLocale; };
    api.setLocale = setLocale;
    api.applyStaticLabels = applyStaticLabels;
    api.applyDocLocale = applyDocLocale;
    api.actInfo = function (a) {
      a = String(a || "").toLowerCase();
      if (/buy|long|bull|شراء|صاعد/.test(a)) return { cls: "buy", label: msg("buy"), dir: 1 };
      if (/sell|short|bear|بيع|هابط/.test(a)) return { cls: "sell", label: msg("sell"), dir: -1 };
      if (/opportunity|candidate|فرصة/.test(a)) return { cls: "wait", label: msg("opportunity"), dir: 0 };
      return { cls: "wait", label: msg("wait"), dir: 0 };
    };
    api.trendInfo = function (v) {
      v = String(v || "").toLowerCase();
      if (/up|bull|buy|صاعد/.test(v)) return ["buy", msg("bullish")];
      if (/down|bear|sell|هابط/.test(v)) return ["sell", msg("bearish")];
      if (/side|range|flat|neutral|عرضي|محايد/.test(v)) return ["wait", msg("sideways")];
      return ["wait", v ? msg("neutral") : msg("neutral")];
    };
    window.AIC = api;
    /* If the host never delivers data, swap loading skeletons for an honest
       empty state instead of pulsing forever. */
    setTimeout(function () {
      if (latest != null) return;
      var sk = document.querySelectorAll(".skel");
      if (!sk.length) return;
      var parent = sk[0].parentNode;
      if (parent) parent.innerHTML = '<div class="empty">' + msg("noDataYet") + '</div>';
    }, 6000);
    fireReady();
  }

  /* Newer web routes (withBridge) wrap payloads as {ok, data, meta}; older
     ones return bare JSON. Unwrap centrally so EVERY card reads the real
     payload — never {ok,data} whose fields all read as missing. Envelopes
     that carry their fields alongside ok (e.g. create_recommendation) are
     left intact (no inner data object). */
  function unwrapEnvelope(d) {
    if (d && typeof d === "object" && !Array.isArray(d) &&
        (d.ok === true || d.ok === false) &&
        d.data && typeof d.data === "object") {
      return d.data;
    }
    return d;
  }

  function normalizeToolResult(r) {
    if (r && r.structuredContent) return unwrapEnvelope(r.structuredContent);
    /* Tools without structuredContent carry JSON in the text block. */
    if (r && Array.isArray(r.content)) {
      for (var i = 0; i < r.content.length; i++) {
        var c = r.content[i];
        if (c && c.type === "text" && typeof c.text === "string") {
          try {
            var p = JSON.parse(c.text);
            if (p && typeof p === "object") return unwrapEnvelope(p);
          } catch (e) {}
        }
      }
    }
    return r;
  }

  if (window.openai) {
    /* ── ChatGPT (Apps SDK / skybridge) ── */
    function readOpenAiData() {
      var meta = window.openai.toolResponseMetadata || null;
      return unwrapEnvelope(window.openai.toolOutput || (meta && (meta.structuredContent || meta.toolOutput || meta.data)) || meta || null);
    }
    latest = readOpenAiData();
    window.addEventListener("openai:set_globals", function () {
      latest = readOpenAiData() || latest;
      emit();
    });
    finishApi({
      host: "chatgpt",
      callTool: function (name, args) {
        return window.openai.callTool(name, args || {}).then(function (r) {
          return normalizeToolResult(r);
        });
      },
      notifySize: function () {},
    });
    if (latest != null) setTimeout(emit, 0);
  } else {
    /* ── MCP Apps (postMessage JSON-RPC) ── */
    var reqId = 1;
    var pending = {};
    function send(msg) { window.parent.postMessage(msg, "*"); }
    function request(method, params) {
      return new Promise(function (resolve, reject) {
        var id = reqId++;
        pending[id] = { resolve: resolve, reject: reject };
        send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
      });
    }
    window.addEventListener("message", function (ev) {
      var m = ev.data;
      if (!m) return;
      if (m.method === "render-data" || m.method === "ui/lifecycle/render-data" || m.type === "render-data") {
        var rd = m.params || m.payload || m.data || {};
        latest = unwrapEnvelope(rd.structuredContent || rd.toolOutput || rd.data || rd);
        emit();
        setTimeout(notifySize, 50);
        return;
      }
      if (m.jsonrpc !== "2.0") return;
      if (m.id != null && pending[m.id]) {
        var p = pending[m.id];
        delete pending[m.id];
        if (m.error) p.reject(new Error((m.error && m.error.message) || "host error"));
        else p.resolve(m.result);
        return;
      }
      if (m.method === "ui/notifications/tool-result") {
        var pr = m.params || {};
        latest = normalizeToolResult(pr);
        emit();
        setTimeout(notifySize, 50);
      }
    });
    function notifySize() {
      try {
        send({
          jsonrpc: "2.0",
          method: "ui/notifications/size-changed",
          params: { width: document.body.clientWidth, height: document.body.scrollHeight },
        });
      } catch (e) {}
    }
    request("ui/initialize", {
      protocolVersion: "2026-01-26",
      capabilities: {},
      clientInfo: { name: "aichart-widget", version: "1.0.0" },
      appCapabilities: { availableDisplayModes: ["inline"] },
    })
      .then(function () {
        send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
      })
      .catch(function () {});
    finishApi({
      host: "mcp-apps",
      callTool: function (name, args) {
        return request("tools/call", { name: name, arguments: args || {} }).then(function (r) {
          return normalizeToolResult(r);
        });
      },
      notifySize: notifySize,
    });
    window.addEventListener("load", function () { setTimeout(notifySize, 100); });
  }
})();
`;

/** Shared inline trading-card theme (host iframe sandbox blocks external assets). */
export const THEME_CSS = `
  :root{
    --surface:#131922; --surface-2:#192231; --surface-3:#202b3b;
    --txt:#f8fafc; --muted:#9aa6b2; --faint:#64748b;
    --amber:#f5c26b; --up:#2dd4bf; --down:#fb7185; --info:#60a5fa;
    --line:rgba(148,163,184,.2); --line-soft:rgba(148,163,184,.12);
    --shadow:0 18px 44px rgba(2,6,23,.34);
    --sans:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:transparent}
  body{font-family:var(--sans);color:var(--txt);padding:4px;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  .card{
    position:relative;isolation:isolate;
    min-width:260px;max-width:560px;width:100%;min-height:300px;margin:0 auto;
    border:1px solid var(--line);border-radius:8px;
    background:linear-gradient(180deg,var(--surface),#101620 100%);
    box-shadow:var(--shadow);
    padding:18px;display:flex;flex-direction:column;gap:14px;overflow:hidden;
  }
  .card.buy{border-color:rgba(45,212,191,.42)}
  .card.sell{border-color:rgba(251,113,133,.42)}
  .card.wait{border-color:rgba(245,194,107,.42)}
  .top,.hd{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .label{font-size:13px;font-weight:700;color:var(--muted)}
  .title{margin-top:4px;font-size:20px;line-height:1.15;font-weight:900;letter-spacing:0;color:var(--txt);overflow-wrap:anywhere}
  .tag,.badge{
    border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;white-space:nowrap;
    border:1px solid rgba(245,194,107,.32);color:var(--amber);background:rgba(245,194,107,.1);
    display:inline-flex;align-items:center;gap:6px
  }
  .tag.green,.badge.buy{border-color:rgba(45,212,191,.35);color:var(--up);background:rgba(45,212,191,.12)}
  .tag.red,.badge.sell{border-color:rgba(251,113,133,.35);color:var(--down);background:rgba(251,113,133,.12)}
  .tag.amber,.badge.wait{border-color:rgba(245,194,107,.35);color:var(--amber);background:rgba(245,194,107,.1)}
  .main{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;gap:10px;min-height:96px;overflow:visible}
  .value{font-size:40px;line-height:1;font-weight:950;letter-spacing:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  .signal{font-size:38px;line-height:1;font-weight:1000;letter-spacing:0;overflow-wrap:anywhere}
  .sub{color:var(--muted);font-size:13px;font-weight:700;line-height:1.6;overflow-wrap:anywhere}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:10px;position:relative}
  .row.flex{display:flex;gap:8px;align-items:center;flex-wrap:wrap;grid-template-columns:none}
  .mini{
    border-radius:8px;border:1px solid var(--line-soft);background:var(--surface-2);padding:12px;min-width:0;
  }
  .mini span{display:block;color:var(--muted);font-size:12px;font-weight:700}
  .mini strong{display:block;margin-top:5px;font-size:17px;font-weight:900;font-variant-numeric:tabular-nums;word-break:break-word}
  .pair{
    display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:9px 0;border-bottom:1px solid var(--line-soft);position:relative;
  }
  .pair:last-child{border-bottom:0}
  .pair strong{font-size:14px;overflow-wrap:anywhere}
  .pair span{font-size:13px;color:var(--muted);font-weight:800;font-variant-numeric:tabular-nums;text-align:left;overflow-wrap:anywhere}
  .confidence{width:100%;height:8px;border-radius:99px;background:rgba(148,163,184,.16);overflow:hidden}
  .bar{height:100%;border-radius:inherit;max-width:100%}
  .bar.green{background:var(--up)} .bar.red{background:var(--down)} .bar.amber{background:var(--amber)}
  .green{color:var(--up)} .red{color:var(--down)} .amber{color:var(--amber)} .blue{color:var(--info)}
  .muted{color:var(--muted);font-size:12px}
  .chart{width:100%;height:128px;margin-top:8px;display:block;border-radius:8px}
  .chart-wrap{position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--line-soft);background:var(--surface-2);flex:1;min-height:128px}
  .chart-wrap canvas{width:100%;height:128px;display:block}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .kv,.mini-kv{border-radius:8px;border:1px solid var(--line-soft);background:var(--surface-2);padding:12px}
  .kv .k,.mini-kv .k{font-size:12px;color:var(--muted);font-weight:700;margin-bottom:6px}
  .kv .v,.mini-kv .v{font-size:18px;font-weight:900;font-variant-numeric:tabular-nums;word-break:break-word}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{color:var(--muted);font-weight:700;text-align:start;padding:7px 4px;border-bottom:1px solid var(--line-soft);font-size:11px}
  td{padding:8px 4px;border-bottom:1px solid var(--line-soft);font-variant-numeric:tabular-nums;font-weight:700}
  .foot{
    position:relative;padding-top:12px;border-top:1px solid var(--line-soft);
    display:flex;gap:8px;align-items:center;flex-wrap:wrap;
  }
  .empty{text-align:center;color:var(--faint);padding:18px 10px;font-size:12px;font-weight:700;
    border:1px dashed var(--line-soft);border-radius:8px;background:var(--surface-2)}
  .banner{padding:12px;border-radius:8px;font-size:12px;font-weight:700;line-height:1.5;
    border:1px solid var(--line-soft);background:var(--surface-2)}
  .banner.ok{border-color:rgba(45,212,191,.35);color:var(--up);background:rgba(45,212,191,.1)}
  .banner.bad{border-color:rgba(251,113,133,.35);color:var(--down);background:rgba(251,113,133,.1)}
  .banner.warn{border-color:rgba(245,194,107,.35);color:var(--amber);background:rgba(245,194,107,.1)}
  .card button{font:inherit;cursor:pointer;border:none;-webkit-appearance:none;appearance:none}
  .card button:disabled{opacity:.5;cursor:not-allowed}
  .card button:focus-visible{outline:2px solid var(--info);outline-offset:2px}
  .actions{display:flex;gap:8px;flex-wrap:wrap}
  .actions button{flex:1;min-width:96px;text-align:center;justify-content:center}
  .qrow{display:flex;flex-direction:column;gap:6px;padding:10px 0;border-bottom:1px solid var(--line-soft)}
  .qrow:last-child{border-bottom:0}
  .qrow .qtop{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .qrow .qactions{display:flex;gap:6px}
  .qrow .qactions button{padding:5px 10px;font-size:11px;border-radius:999px;font-weight:900}
  .status{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--muted);min-height:16px}
  .status:empty{display:none}
  .status.stale{color:var(--amber)} .status.live{color:var(--up)}
  .status.live::before,.status.stale::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
  .trade-line,.pair-line{display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:10px 0;border-bottom:1px solid var(--line-soft);font-variant-numeric:tabular-nums}
  .trade-line:last-child,.pair-line:last-child{border-bottom:0}
  .skel{min-height:48px;border-radius:8px;border:1px solid var(--line-soft);
    background:var(--surface-2);opacity:.55;animation:skel 1.4s ease infinite}
  @media (max-width:640px){
    body{padding:2px}
    .card{padding:16px;max-width:100%;min-height:292px}
  }
  @media (max-width:360px){
    .row,.grid{grid-template-columns:1fr}
    .value{font-size:34px}
    .signal{font-size:32px}
  }
  @keyframes skel{0%,100%{opacity:.45}50%{opacity:.75}}
`;

/** Public origin for shared widget assets (runtime.js / theme.css). */
export function publicAssetOrigin(): string {
  const raw =
    process.env.AICHART_PUBLIC_URL ??
    process.env.MCP_PUBLIC_URL ??
    "https://aichart.lork.cloud/mcp";
  try {
    return new URL(raw).origin;
  } catch {
    return "https://aichart.lork.cloud";
  }
}

export const STATIC_ASSETS = {
  runtimeJs: { path: "aic-runtime.js", body: RUNTIME_JS, mimeType: "application/javascript; charset=utf-8" },
  themeCss: { path: "aic-theme.css", body: THEME_CSS, mimeType: "text/css; charset=utf-8" },
} as const;

/** Self-contained shell: theme + runtime + card script all inline. Host
 *  sandboxes (Claude MCP Apps) block external assets, so nothing may be
 *  fetched at render time — the /mcp-ui endpoints remain only for legacy
 *  shells and manual inspection. */
export function widgetHtml(title: string, body: string, script: string, extraCss = ""): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${THEME_CSS}${extraCss}</style>
</head>
<body>
${body}
<script>${RUNTIME_JS}</script>
<script>${script}</script>
</body>
</html>`;
}
