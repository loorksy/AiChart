import { z } from "zod";
import { READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zInterval, zSymbol } from "./shapes.js";

const zLayoutId = z
  .string()
  .regex(/^[A-Za-z0-9]{8,16}$/)
  .optional()
  .describe("معرّف شارت المستخدم (من list_chart_layouts) — الافتراضي شارته الأساسي");

const zPoint = z.object({
  price: z.number().describe("السعر"),
  time: z
    .number()
    .nullable()
    .optional()
    .describe("Unix time (ثوانٍ أو ms) — إلزامي للنقاط التاريخية"),
  barsAhead: z
    .number()
    .nullable()
    .optional()
    .describe("عدد شموع للأمام — لنقاط forecast_path المستقبلية فقط"),
});

const zDrawing = z.object({
  type: z
    .string()
    .describe(
      "نوع الرسم: price_line | trend_line | ray | channel | parallel_channel | regression_trend | zone | supply_zone | demand_zone | range_box | fib_retracement | forecast_path | polyline_pattern | triangle | neckline | long_position | short_position | labeled_arrow | arrow_up | arrow_down | text | pattern_label",
    ),
  confidence: z.number().min(0).max(100).default(70),
  label: z.string().max(64).optional().describe("تسمية عربية تظهر على الشارت"),
  color: z.string().max(24).optional().describe("لون hex مثل #22c55e"),
  width: z.number().min(1).max(4).optional().describe("سماكة الخط 1–4"),
  style: z.enum(["solid", "dashed", "dotted"]).optional(),
  fill: z.boolean().optional().describe("تعبئة المناطق"),
  fill_color: z.string().max(24).optional(),
  semanticRole: z
    .string()
    .max(32)
    .optional()
    .describe("support | resistance | entry | stop_loss | take_profit | trendline | pattern | forecast"),
  patternType: z
    .string()
    .max(40)
    .optional()
    .describe("مثل double_bottom | head_and_shoulders | ascending_triangle"),
  points: z
    .array(zPoint)
    .max(10)
    .describe("نقاط الرسم (time+price). long/short_position: نقطة الدخول + meta"),
  meta: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("للمراكز: {entry, stopLoss, takeProfit}"),
});

const zRecommendation = z.object({
  action: z.enum(["buy", "sell", "wait"]),
  entry: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  take_profit: z.number().nullable().optional(),
  confidence: z.number().min(0).max(100).optional(),
});

export const CHARTS_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_chart_layouts",
    domain: "charts",
    description:
      "متى: قبل الرسم — اجلب شارتات المستخدم المحفوظة (id + رمز + رابط). read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_chart_state",
    domain: "charts",
    description:
      "متى: قراءة حالة شارت المستخدم الحالية (الرمز/الفريم/الرسومات/التوصية) قبل التعديل عليها. read-only. مثال: layout_id اختياري.",
    inputSchema: { layout_id: zLayoutId },
    annotations: READ_ONLY,
  },
  {
    name: "draw_on_chart",
    domain: "charts",
    description:
      "متى: الرسم مباشرة على شارت المستخدم الحي (TradingView) — يدعم كل الأدوات: خطوط/قنوات/مناطق/فيبوناتشي/نماذج/مراكز شراء وبيع/توقّع مستقبلي، مع الألوان والسماكة والنمط. الرسومات تظهر على شاشة المستخدم خلال ثوانٍ بلا تحديث. mode=set يستبدل، add يضيف. مرّر recommendation لرسم مركز صفقة كامل (دخول/وقف/أهداف).",
    inputSchema: {
      layout_id: zLayoutId,
      symbol: zSymbol.optional().describe("تغيير رمز الشارت (اختياري)"),
      interval: zInterval,
      mode: z.enum(["set", "add"]).default("set"),
      drawings: z.array(zDrawing).max(24),
      recommendation: zRecommendation.nullable().optional(),
      targets: z.array(z.number()).max(6).optional().describe("أهداف ربح إضافية"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    ui: { widget: "chart-drawn" },
  },
  {
    name: "clear_chart_drawings",
    domain: "charts",
    description:
      "متى: مسح كل رسومات وتوصية شارت المستخدم. لا يمس الشموع ولا رسومات المستخدم اليدوية داخل TradingView.",
    inputSchema: { layout_id: zLayoutId },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "run_market_analysis",
    domain: "charts",
    description:
      "متى: تحليل AI كامل لزوج (نفس زر «تحليل» في المنصة): توصية + رسومات فنية تُرسم تلقائياً على شارت المستخدم عند تمرير layout_id. يستهلك رصيد المستخدم (4). قد يستغرق ≤120 ثانية.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market: z.enum(["crypto", "forex"]).optional(),
      layout_id: zLayoutId,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    ui: { widget: "recommendation-card" },
  },
];
