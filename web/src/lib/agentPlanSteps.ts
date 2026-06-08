export type PlanStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "failed"
  | "need-help";

export interface PlanSubtask {
  id: string;
  title: string;
  description: string;
  status: PlanStatus;
  tools?: string[];
}

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  status: PlanStatus;
  subtasks: PlanSubtask[];
}

export type AgentPlanMode = "analysis" | "trade";

function cloneTasks(tasks: PlanTask[]): PlanTask[] {
  return tasks.map((t) => ({
    ...t,
    status: "pending" as PlanStatus,
    subtasks: t.subtasks.map((s) => ({ ...s, status: "pending" as PlanStatus })),
  }));
}

export const ANALYSIS_PLAN_TEMPLATE: PlanTask[] = [
  {
    id: "1",
    title: "جمع بيانات السوق",
    description: "جلب الأسعار والشموع والمؤشرات من Binance",
    status: "pending",
    subtasks: [
      {
        id: "1.1",
        title: "قراءة السعر اللحظي",
        description: "get_price — آخر سعر للرمز",
        status: "pending",
        tools: ["Binance API"],
      },
      {
        id: "1.2",
        title: "لقطة فنية",
        description: "get_market_snapshot — RSI، MACD، المتوسطات",
        status: "pending",
        tools: ["Binance API"],
      },
      {
        id: "1.3",
        title: "إشارات الأموال الذكية",
        description: "smart_money_signals عند الحاجة",
        status: "pending",
        tools: ["Binance Web3"],
      },
    ],
  },
  {
    id: "2",
    title: "تحليل المخاطر",
    description: "التحقق من حدود الحساب والإعدادات",
    status: "pending",
    subtasks: [
      {
        id: "2.1",
        title: "فحص Kill Switch",
        description: "التأكد أن التداول غير موقوف",
        status: "pending",
        tools: ["Risk Guard"],
      },
      {
        id: "2.2",
        title: "حدود الخسارة والرأسمال",
        description: "مطابقة الإعدادات مع سقوف الإدارة",
        status: "pending",
        tools: ["Risk Guard"],
      },
      {
        id: "2.3",
        title: "الأصول المسموحة",
        description: "الرمز ضمن القائمة المفعّلة",
        status: "pending",
        tools: ["Settings"],
      },
    ],
  },
  {
    id: "3",
    title: "صياغة التوصية",
    description: "الوكيل يحلّل ويقرر: شراء، بيع، أو انتظار",
    status: "pending",
    subtasks: [
      {
        id: "3.1",
        title: "استدعاء Claude",
        description: "تحليل السياق والأدوات",
        status: "pending",
        tools: ["Claude Agent"],
      },
      {
        id: "3.2",
        title: "تسجيل التوصية",
        description: "حفظ التوصية وإنشاء نية صفقة إن لزم",
        status: "pending",
        tools: ["SQLite"],
      },
    ],
  },
];

export const TRADE_PLAN_TEMPLATE: PlanTask[] = [
  {
    id: "1",
    title: "التحقق قبل التنفيذ",
    description: "فحوصات أمنية قبل إرسال الأمر",
    status: "pending",
    subtasks: [
      {
        id: "1.1",
        title: "Kill Switch",
        description: "التداول مفعّل على مستوى الحساب والمنصة",
        status: "pending",
        tools: ["Risk Guard"],
      },
      {
        id: "1.2",
        title: "حدود المخاطر",
        description: "الخسارة اليومية ورأس المال ضمن الحدود",
        status: "pending",
        tools: ["Risk Guard"],
      },
      {
        id: "1.3",
        title: "صلاحية التنفيذ",
        description: "موافقة الإدارة والوضع التلقائي",
        status: "pending",
        tools: ["Admin Limits"],
      },
    ],
  },
  {
    id: "2",
    title: "تنفيذ الأمر",
    description: "إرسال الأمر إلى Binance",
    status: "pending",
    subtasks: [
      {
        id: "2.1",
        title: "التحقق من الرصيد",
        description: "رصيد USDT/العملة كافٍ",
        status: "pending",
        tools: ["Binance API"],
      },
      {
        id: "2.2",
        title: "إرسال الأمر",
        description: "تنفيذ شراء أو بيع بالحجم المحدد",
        status: "pending",
        tools: ["Execution"],
      },
      {
        id: "2.3",
        title: "تأكيد التنفيذ",
        description: "تسجيل الصفقة وإشعار تليجرام",
        status: "pending",
        tools: ["Notify"],
      },
    ],
  },
];

export function getPlanTemplate(mode: AgentPlanMode): PlanTask[] {
  const base = mode === "analysis" ? ANALYSIS_PLAN_TEMPLATE : TRADE_PLAN_TEMPLATE;
  return cloneTasks(base);
}

/** Flat list of subtask keys in execution order */
export function flattenSubtaskKeys(tasks: PlanTask[]): string[] {
  const keys: string[] = [];
  for (const t of tasks) {
    for (const s of t.subtasks) {
      keys.push(`${t.id}:${s.id}`);
    }
  }
  return keys;
}

export function applyProgress(tasks: PlanTask[], stepIndex: number): PlanTask[] {
  const keys = flattenSubtaskKeys(tasks);
  const clamped = Math.min(stepIndex, keys.length);
  return tasks.map((task) => {
    const subtasks = task.subtasks.map((sub) => {
      const key = `${task.id}:${sub.id}`;
      const idx = keys.indexOf(key);
      let status: PlanStatus = "pending";
      if (idx < clamped) status = "completed";
      else if (idx === clamped) status = "in-progress";
      return { ...sub, status };
    });

    const done = subtasks.every((s) => s.status === "completed");
    const anyProgress = subtasks.some(
      (s) => s.status === "in-progress" || s.status === "completed",
    );
    const taskStatus: PlanStatus = done
      ? "completed"
      : anyProgress
        ? "in-progress"
        : "pending";

    return { ...task, subtasks, status: taskStatus };
  });
}
