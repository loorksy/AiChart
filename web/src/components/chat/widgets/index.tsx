"use client";

import React from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import { TrendingUp, TrendingDown, AlertTriangle, Info, CheckCircle2, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatIntentCard } from "../square/chat-intent-card";
import type { ProcessedIntent } from "@/lib/tradeFlow";
import AnalysisWidget from "./AnalysisWidget";

// Heavy widgets are lazy loaded with suspense fallbacks to minimize bundle footprints
const LazyChartWidget = dynamic(() => import("./ChartWidget"), {
  loading: () => <div className="h-44 w-full animate-pulse bg-zinc-900/40 rounded-xl border border-border/40" />,
  ssr: false,
});

const LazyTableWidget = dynamic(() => import("./TableWidget"), {
  loading: () => <div className="h-28 w-full animate-pulse bg-zinc-900/40 rounded-xl border border-border/40" />,
  ssr: false,
});

const LazyPortfolioWidget = dynamic(() => import("./PortfolioWidget"), {
  loading: () => <div className="h-56 w-full animate-pulse bg-zinc-900/40 rounded-xl border border-border/40" />,
  ssr: false,
});

// Interfaces and schemas contract
export interface UIElement {
  id: string;
  component: string;
  props: Record<string, any>;
  children?: UIElement[];
}

export interface UISchema {
  version: "1.0";
  layout: UIElement[];
}

// Whitelisted widget registry mapping keys to widget components
export const WIDGET_REGISTRY: Record<string, React.ComponentType<any>> = {
  text: TextWidget,
  markdown: MarkdownWidget,
  metric: MetricWidget,
  chart: LazyChartWidget,
  table: LazyTableWidget,
  image: ImageWidget,
  alert: AlertWidget,
  divider: DividerWidget,
  button: ButtonWidget,
  buttons: ButtonGroupWidget,
  form: FormWidget,
  input: InputWidget,
  select: SelectWidget,
  tabs: TabsWidget,
  trade_intent: TradeIntentWidget,
  portfolio: LazyPortfolioWidget,
  container: ContainerWidget,
  grid: GridWidget,
  stack: StackWidget,
  analysis: AnalysisWidget,
};

// 1. Text Widget
export function TextWidget({ value, variant = "body", className }: { value: string; variant?: string; className?: string }) {
  const classes = {
    h1: "text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl",
    h2: "text-xl font-bold tracking-tight text-foreground sm:text-2xl",
    h3: "text-lg font-semibold tracking-tight text-foreground",
    body: "text-sm text-foreground leading-relaxed",
    caption: "text-xs text-muted-foreground",
    muted: "text-sm text-muted-foreground",
  }[variant] || "text-sm text-foreground";
  
  return <p className={cn(classes, className)}>{value}</p>;
}

// 2. Markdown Widget
export function MarkdownWidget({ value, className }: { value: string; className?: string }) {
  return (
    <div className={cn("prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0", className)}>
      <ReactMarkdown>{value}</ReactMarkdown>
    </div>
  );
}

// 3. Metric Widget
export function MetricWidget({ label, value, change, trend, className }: { label: string; value: string | number; change?: string; trend?: "up" | "down" | null; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border/80 bg-background/40 p-3 shadow-sm", className)}>
      <span className="text-[10px] text-muted-foreground block font-medium">{label}</span>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-lg font-bold text-foreground">{value}</span>
        {change && (
          <span className={cn("text-xs font-semibold flex items-center gap-0.5", trend === "up" ? "text-emerald-400" : trend === "down" ? "text-destructive" : "text-muted-foreground")}>
            {trend === "up" ? <TrendingUp className="h-3 w-3" /> : trend === "down" ? <TrendingDown className="h-3 w-3" /> : null}
            {change}
          </span>
        )}
      </div>
    </div>
  );
}

// 4. Divider Widget
export function DividerWidget({ className }: { className?: string }) {
  return <hr className={cn("my-4 border-t border-border/50", className)} />;
}

// 5. Alert Widget
export function AlertWidget({ type = "info", title, text, className }: { type?: "success" | "warning" | "info" | "error"; title?: string; text: string; className?: string }) {
  const Icon = {
    success: CheckCircle2,
    warning: AlertTriangle,
    info: Info,
    error: AlertOctagon,
  }[type] || Info;
  
  const styles = {
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    info: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    error: "border-destructive/30 bg-destructive/10 text-destructive",
  }[type] || "border-border bg-card text-foreground";
  
  return (
    <div className={cn("flex gap-2.5 rounded-xl border p-3.5 text-xs shadow-sm", styles, className)}>
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div>
        {title && <h5 className="font-bold mb-0.5">{title}</h5>}
        <p className="leading-normal">{text}</p>
      </div>
    </div>
  );
}

// 6. Button Widget
export function ButtonWidget({ label, action, payload, variant = "primary", className, onAction }: { label: string; action: string; payload?: any; variant?: "primary" | "secondary" | "danger" | "ghost"; className?: string; onAction?: (action: string, payload: any) => void }) {
  const buttonStyles = {
    primary: "bg-green-500 hover:bg-green-600 text-white shadow-md shadow-green-500/10 border border-green-400/20",
    secondary: "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-border/60",
    danger: "bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20",
    ghost: "hover:bg-white/[0.06] text-muted-foreground hover:text-foreground",
  }[variant] || "bg-primary text-primary-foreground";
  
  return (
    <button
      type="button"
      onClick={() => onAction?.(action, payload)}
      className={cn("px-3.5 py-2 text-xs font-semibold rounded-lg transition-all active:scale-[0.98] duration-150 cursor-pointer", buttonStyles, className)}
    >
      {label}
    </button>
  );
}

// 7. Button Group Widget
export function ButtonGroupWidget({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap gap-2 mt-2", className)}>{children}</div>;
}

// 8. Form Widget
export function FormWidget({ children, onSubmitAction, payload, className, onAction }: { children?: React.ReactNode; onSubmitAction?: string; payload?: any; className?: string; onAction?: (action: string, payload: any) => void }) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmitAction) {
      onAction?.(onSubmitAction, payload);
    }
  };
  return <form onSubmit={handleSubmit} className={cn("space-y-3.5", className)}>{children}</form>;
}

// 9. Input Widget
export function InputWidget({ label, placeholder, name, type = "text", value, className }: { label?: string; placeholder?: string; name: string; type?: string; value?: string; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <label className="text-[10px] font-semibold text-muted-foreground block">{label}</label>}
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        defaultValue={value}
        className="w-full rounded-lg border border-border bg-background/50 px-3 py-2 text-xs focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none text-zinc-100 placeholder:text-zinc-500 transition"
      />
    </div>
  );
}

// 10. Select Widget
export function SelectWidget({ label, name, options = [], value, className }: { label?: string; name: string; options: { label: string; value: string }[]; value?: string; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <label className="text-[10px] font-semibold text-muted-foreground block">{label}</label>}
      <select
        name={name}
        defaultValue={value}
        className="w-full rounded-lg border border-border bg-background/50 px-3 py-2 text-xs focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none text-zinc-100 transition"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// 11. Tabs Widget
export function TabsWidget({ tabs = [], children, className }: { tabs: { id: string; label: string }[]; children?: React.ReactNode; className?: string }) {
  const [activeTab, setActiveTab] = React.useState(tabs[0]?.id || "");
  const tabElements = React.Children.toArray(children);
  
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex border-b border-border/60">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-xs font-semibold border-b-2 transition cursor-pointer -mb-px",
              activeTab === tab.id
                ? "border-green-500 text-green-400 font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>
        {tabElements.map((child: any) => {
          if (child.props?.tabId === activeTab || child.props?.id === activeTab) {
            return child;
          }
          return null;
        })}
      </div>
    </div>
  );
}

// 12. Container Widget
export function ContainerWidget({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border/80 bg-card/45 p-4 shadow-sm", className)}>
      {children}
    </div>
  );
}

// 13. Grid Widget
export function GridWidget({ cols = 2, children, className }: { cols?: number; children?: React.ReactNode; className?: string }) {
  const colClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-4",
  }[cols] || "grid-cols-1 sm:grid-cols-2";
  
  return <div className={cn("grid gap-2.5", colClass, className)}>{children}</div>;
}

// 14. Stack Widget
export function StackWidget({ direction = "vertical", children, className }: { direction?: "vertical" | "horizontal"; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-2.5", direction === "horizontal" ? "flex-row flex-wrap items-center" : "flex-col", className)}>
      {children}
    </div>
  );
}

// 15. Image Widget
export function ImageWidget({ src, alt = "Image", className }: { src: string; alt?: string; className?: string }) {
  const [showLightbox, setShowLightbox] = React.useState(false);
  
  const LazyLightbox = dynamic(() => import("@/components/ui/chart-lightbox").then(m => m.ChartLightbox), { ssr: false });

  return (
    <>
      <img
        src={src}
        alt={alt}
        onClick={() => setShowLightbox(true)}
        className={cn("rounded-xl border border-border/60 hover:border-primary/30 transition shadow-md max-w-full h-auto cursor-zoom-in object-cover", className)}
        loading="lazy"
      />
      {showLightbox && (
        <LazyLightbox
          src={src}
          alt={alt}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </>
  );
}

// 16. Trade Intent Widget
interface TradeIntentWidgetProps {
  intentId: number;
  symbol: string;
  side: "buy" | "sell";
  notional: number;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  reason?: string | null;
  onAction?: (action: string, payload: any) => void;
}

export function TradeIntentWidget({
  intentId,
  symbol,
  side,
  notional,
  status,
  reason,
  onAction,
}: TradeIntentWidgetProps) {
  const mockIntent: ProcessedIntent = {
    id: intentId,
    symbol,
    side,
    notional,
    status,
    reason: reason ?? undefined,
  };
  
  return (
    <ChatIntentCard
      intent={mockIntent}
      onApprove={(id: number) => onAction?.("execute_trade", { intentId: id })}
      onReject={(id: number) => onAction?.("reject_trade", { intentId: id })}
    />
  );
}

// Dynamic elements layout renderer
export function UILayoutRenderer({
  layout,
  onAction,
}: {
  layout: UIElement[];
  onAction: (actionType: string, payload: any) => void;
}) {
  return (
    <div className="space-y-3.5 my-3 animate-in fade-in duration-300">
      {layout.map((element) => (
        <UIElementRenderer key={element.id} element={element} onAction={onAction} />
      ))}
    </div>
  );
}

export function UIElementRenderer({
  element,
  onAction,
}: {
  element: UIElement;
  onAction: (actionType: string, payload: any) => void;
}) {
  const Widget = WIDGET_REGISTRY[element.component];
  if (!Widget) {
    console.warn(`Widget type not registered: ${element.component}`);
    return null;
  }

  const renderChildren = () => {
    if (!element.children || element.children.length === 0) return null;
    return (
      <UILayoutRenderer layout={element.children} onAction={onAction} />
    );
  };

  return (
    <Widget {...element.props} onAction={onAction}>
      {renderChildren()}
    </Widget>
  );
}

// Strict schema validation layer
export function validateUISchema(schema: any): UISchema | null {
  // Accept any key order and a missing version (default "1.0") — the agent's
  // emitted block may omit version; requiring it silently dropped every card.
  if (!schema || typeof schema !== "object" || !Array.isArray(schema.layout)) {
    return null;
  }
  if (schema.version !== undefined && schema.version !== "1.0") {
    return null;
  }
  
  const validatedLayout: UIElement[] = [];
  
  for (const item of schema.layout) {
    const validatedItem = validateUIElement(item);
    if (validatedItem) {
      validatedLayout.push(validatedItem);
    }
  }
  
  if (validatedLayout.length === 0) return null;
  
  return { version: "1.0", layout: validatedLayout };
}

function validateUIElement(item: any): UIElement | null {
  if (!item || typeof item !== "object") return null;
  if (typeof item.id !== "string" || typeof item.component !== "string") return null;
  
  // Whitelist check
  if (!Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, item.component)) {
    console.warn(`Blocked unapproved component type: ${item.component}`);
    return null;
  }
  
  const propsObj = item.props && typeof item.props === "object" ? item.props : {};
  const sanitizedProps = sanitizeProps(propsObj);
  
  const validatedChildren: UIElement[] = [];
  if (Array.isArray(item.children)) {
    for (const child of item.children) {
      const valChild = validateUIElement(child);
      if (valChild) {
        validatedChildren.push(valChild);
      }
    }
  }
  
  return {
    id: item.id,
    component: item.component,
    props: sanitizedProps,
    children: validatedChildren.length > 0 ? validatedChildren : undefined,
  };
}

function sanitizeProps(props: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(props)) {
    // block 'onEvent' attributes to defend against XSS / remote code execution
    if (key.toLowerCase().startsWith("on")) {
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeProps(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
