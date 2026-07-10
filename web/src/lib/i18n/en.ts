/**
 * English messages — the canonical dictionary. Its keys define `TranslationKey`,
 * so `ar.ts` must provide every key here (enforced by the compiler).
 */
export const en = {
  // Navigation & Shell (existing keys — do not remove; landing depends on them)
  "sidebar.chat": "Chat",
  "sidebar.dashboard": "Dashboard",
  "sidebar.command": "Command",
  "sidebar.agent": "Agent",
  "sidebar.market": "Market",
  "sidebar.signals": "Signals",
  "sidebar.settings": "Settings",
  "sidebar.admin": "Admin Panel",
  "sidebar.new_chat": "New Chat",
  "sidebar.recent_chats": "Recent Chats",
  "sidebar.no_chats": "No chats yet",
  "sidebar.delete": "Delete",
  "sidebar.credits": "Balance",

  // Welcoming Phase
  "welcome.title": "Welcome, {name} 👋",
  "welcome.subtitle": "Type your message to begin — forex via MetaTrader.",
  "welcome.session_settings": "Session Settings",
  "welcome.response_mode": "Response Type",
  "welcome.trading_style": "Trading Style",
  "welcome.execution_mode": "Execution Mode",
  "welcome.market": "Market",

  // Terminology (Strict Transliterations/Originals)
  "term.scalping": "Scalping",
  "term.stop_loss": "Stop Loss",
  "term.take_profit": "Take Profit",
  "term.trailing": "Trailing",
  "term.spot": "Spot",
  "term.futures": "Futures",
  "term.day_trading": "Day Trading",
  "term.swing_trading": "Swing Trading",
  "term.margin": "Margin / Free Margin",
  "term.equity": "Equity",
  "settings.position": "Position",

  // Response Modes
  "response.fast": "Fast",
  "response.expert": "Expert",
  "response.vision": "Vision",

  // Execution Modes
  "mode.approval": "Approval",
  "mode.direct": "Direct",
  "mode.auto": "Auto",

  // Market types
  "market.forex": "Forex",

  // Profile menu items
  "profile.settings": "Global Settings",
  "profile.analytics": "Analytics",
  "profile.account": "Account Parameters",
  "profile.theme": "Theme",
  "profile.theme.dark": "Dark",
  "profile.theme.light": "Light",
  "profile.language": "Language",
  "profile.language.ar": "العربية",
  "profile.language.en": "English",
  "profile.logout": "Logout",
  "profile.free_plan": "Free",

  // Placeholders (existing)
  "chat.placeholder": "Ask the expert about the market or your account…",
  "chat.placeholder_followup": "Follow up message…",
  "chat.placeholder_image": "Add a question about the chart (optional)…",
  "chat.no_agent_key": "AI agent not active — add OPENAI_API_KEY from Admin Panel.",
  "chat.chart_preview": "Chart Preview",
  "chat.close_chart": "Close Chart",
  "chat.resize_chart": "Resize Chart",

  // --- Part 5 additions: agent sidebar + chat shell ---
  "nav.new_chat": "New Chat",
  "nav.no_chats": "No chats yet",
  "nav.chats": "Chats",
  "nav.statistics": "Statistics",
  "nav.recommendations": "Recommendations",
  "nav.settings": "Settings",
  "nav.integrations": "Integrations",

  "profile.profile": "Profile",
  "profile.trading_settings": "Trading settings",
  "profile.account_menu": "Account",
  "profile.coming_soon": "Soon",
  "profile.select_language": "Language",

  "agent.title": "Smart Chart Agent",
  "agent.empty": "Ask the agent or start a chart analysis",
  "agent.analyze_chart": "Analyze chart",
  "agent.news_risk": "News risk",
  "agent.send": "Send",
  "agent.stop": "Stop",
  "agent.cancel": "Cancel",
  "agent.close": "Close",
  "agent.input_placeholder": "Ask the agent about this chart…",
  "agent.confidence": "confidence",
  "agent.decision_reason": "Reason for the decision:",
  "agent.needs_confirmation": "This trade needs your confirmation before execution",
  "agent.account_live": "LIVE account",
  "agent.account_demo": "demo / simulation",

  "decision.buy": "Buy",
  "decision.sell": "Sell",
  "decision.wait": "Wait",
  "decision.informational": "Info",
  "decision.action_required": "Action required",

  "language.arabic": "العربية",
  "language.english": "English",
} as const;

export type TranslationKey = keyof typeof en;
