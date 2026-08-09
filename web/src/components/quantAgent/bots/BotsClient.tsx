"use client";

/**
 * `/quant-agent/bots` — configure an automated bot, see the ladder it would
 * arm, save it, replay it, and arm it bot-by-bot.
 *
 * Live orders never leave this page for a venue SDK: arming sets
 * `execution_mode`, and orders go through createIntent → executeIntent.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `quantdinger-vue/src/views/executor-strategies/index.vue`.
 *
 * What changed:
 *  - Upstream is a three-pane desktop workbench (catalog aside, config centre,
 *    preview right). This console is mobile-first, so the three panes stack:
 *    type chips, then the config, then the ladder.
 *  - Per-bot `execution_mode` is owner-controlled; account demo/live comes
 *    from the linked broker, not a second bot toggle.
 *  - Percent inputs are 0-100 in the UI and 0-100 on the wire; the service's
 *    `ratio()` applies upstream's own `> 1 → /100` conversion, so there is no
 *    second conversion here to disagree with it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, Play, Sparkles, Trash2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import {
  AccountTypeBadge,
  type AccountType,
} from "@/components/agent/AccountTypeBadge";
import { EmptyState, PageHeader, Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import { Label } from "@/components/squareui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/squareui/select";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  QuantBot,
  QuantBotExecutionModeWire,
  QuantBotPreview,
  QuantBotRun,
  QuantBotType,
} from "@/lib/quantAgent/bots/types";
import { QUANT_BOT_SIMULATABLE_TYPES, QUANT_BOT_TYPES } from "@/lib/quantAgent/bots/types";
import { BotLevelLadder } from "./BotLevelLadder";
import { BotRunSummary } from "./BotRunSummary";
import { BotModeBadge, BotStatusBanner } from "./BotStatusBanner";

const INTERVALS = ["5m", "15m", "30m", "1h", "4h", "1d"] as const;
const PREVIEW_DEBOUNCE_MS = 400;

type FieldKind = "number" | "select";

interface FieldSpec {
  key: string;
  labelKey: string;
  kind: FieldKind;
  step?: number;
  options?: { value: string; labelKey: string }[];
}

/**
 * One field list per bot type, in the order upstream's config pane shows them.
 * Keys are the EXECUTOR vocabulary — the names the engine actually reads.
 */
const FIELDS: Record<QuantBotType, FieldSpec[]> = {
  grid: [
    {
      key: "side",
      labelKey: "qa.bots.form.side",
      kind: "select",
      options: [
        { value: "long", labelKey: "qa.bots.form.side.long" },
        { value: "short", labelKey: "qa.bots.form.side.short" },
      ],
    },
    { key: "start_price", labelKey: "qa.bots.form.start_price", kind: "number", step: 0.0001 },
    { key: "end_price", labelKey: "qa.bots.form.end_price", kind: "number", step: 0.0001 },
    { key: "grid_count", labelKey: "qa.bots.form.grid_count", kind: "number", step: 1 },
    {
      key: "grid_mode",
      labelKey: "qa.bots.form.grid_mode",
      kind: "select",
      options: [
        { value: "arithmetic", labelKey: "qa.bots.form.grid_mode.arithmetic" },
        { value: "geometric", labelKey: "qa.bots.form.grid_mode.geometric" },
      ],
    },
    {
      key: "total_amount_quote",
      labelKey: "qa.bots.form.total_amount_quote",
      kind: "number",
      step: 1,
    },
    { key: "max_open_orders", labelKey: "qa.bots.form.max_open_orders", kind: "number", step: 1 },
  ],
  dca: [
    { key: "entry_price", labelKey: "qa.bots.form.entry_price", kind: "number", step: 0.0001 },
    { key: "dca_max_orders", labelKey: "qa.bots.form.dca_max_orders", kind: "number", step: 1 },
    {
      key: "dca_interval_minutes",
      labelKey: "qa.bots.form.dca_interval_minutes",
      kind: "number",
      step: 1,
    },
    {
      key: "dca_total_budget_pct",
      labelKey: "qa.bots.form.dca_total_budget_pct",
      kind: "number",
      step: 1,
    },
    { key: "take_profit_pct", labelKey: "qa.bots.form.take_profit_pct", kind: "number", step: 0.1 },
  ],
  martingale: [
    {
      key: "side",
      labelKey: "qa.bots.form.side",
      kind: "select",
      options: [
        { value: "long", labelKey: "qa.bots.form.side.long" },
        { value: "short", labelKey: "qa.bots.form.side.short" },
      ],
    },
    { key: "entry_price", labelKey: "qa.bots.form.entry_price", kind: "number", step: 0.0001 },
    { key: "base_order_size", labelKey: "qa.bots.form.base_order_size", kind: "number", step: 1 },
    {
      key: "safety_order_size",
      labelKey: "qa.bots.form.safety_order_size",
      kind: "number",
      step: 1,
    },
    { key: "max_layers", labelKey: "qa.bots.form.max_layers", kind: "number", step: 1 },
    {
      key: "price_deviation_pct",
      labelKey: "qa.bots.form.price_deviation_pct",
      kind: "number",
      step: 0.1,
    },
    { key: "step_multiplier", labelKey: "qa.bots.form.step_multiplier", kind: "number", step: 0.1 },
    {
      key: "volume_multiplier",
      labelKey: "qa.bots.form.volume_multiplier",
      kind: "number",
      step: 0.1,
    },
    { key: "take_profit_pct", labelKey: "qa.bots.form.take_profit_pct", kind: "number", step: 0.1 },
    { key: "hard_stop_pct", labelKey: "qa.bots.form.hard_stop_pct", kind: "number", step: 0.1 },
  ],
  layered_martingale: [
    {
      key: "side",
      labelKey: "qa.bots.form.side",
      kind: "select",
      options: [
        { value: "long", labelKey: "qa.bots.form.side.long" },
        { value: "short", labelKey: "qa.bots.form.side.short" },
      ],
    },
    { key: "entry_price", labelKey: "qa.bots.form.entry_price", kind: "number", step: 0.0001 },
    { key: "layer_count", labelKey: "qa.bots.form.layer_count", kind: "number", step: 1 },
    { key: "orders_per_layer", labelKey: "qa.bots.form.orders_per_layer", kind: "number", step: 1 },
    { key: "base_order_size", labelKey: "qa.bots.form.base_order_size", kind: "number", step: 1 },
    {
      key: "volume_multiplier",
      labelKey: "qa.bots.form.volume_multiplier",
      kind: "number",
      step: 0.1,
    },
    { key: "take_profit_pct", labelKey: "qa.bots.form.take_profit_pct", kind: "number", step: 0.1 },
    { key: "hard_stop_pct", labelKey: "qa.bots.form.hard_stop_pct", kind: "number", step: 0.1 },
  ],
};

const DEFAULTS: Record<QuantBotType, Record<string, string>> = {
  grid: {
    side: "long",
    start_price: "",
    end_price: "",
    grid_count: "8",
    grid_mode: "arithmetic",
    total_amount_quote: "800",
    max_open_orders: "4",
  },
  dca: {
    entry_price: "",
    dca_max_orders: "5",
    dca_interval_minutes: "1440",
    dca_total_budget_pct: "95",
    take_profit_pct: "0.6",
  },
  martingale: {
    side: "long",
    entry_price: "",
    base_order_size: "10",
    safety_order_size: "10",
    max_layers: "5",
    price_deviation_pct: "1.2",
    step_multiplier: "1.4",
    volume_multiplier: "1.6",
    take_profit_pct: "0.5",
    hard_stop_pct: "12",
  },
  layered_martingale: {
    side: "long",
    entry_price: "",
    layer_count: "5",
    orders_per_layer: "3",
    base_order_size: "10",
    volume_multiplier: "1.8",
    take_profit_pct: "0.6",
    hard_stop_pct: "12",
  },
};

function toConfig(botType: QuantBotType, values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { market_type: "spot" };
  for (const field of FIELDS[botType]) {
    const raw = (values[field.key] ?? "").trim();
    if (raw === "") continue;
    out[field.key] = field.kind === "number" ? Number(raw) : raw;
  }
  return out;
}

export function BotsClient() {
  const { t, dir, locale } = useLocale();

  const [botType, setBotType] = useState<QuantBotType>("grid");
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS.grid);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [interval, setIntervalValue] = useState<string>("1h");
  const [initialCapital, setInitialCapital] = useState("1000");

  const [preview, setPreview] = useState<QuantBotPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [bots, setBots] = useState<QuantBot[] | null>(null);
  const [accountType, setAccountType] = useState<AccountType>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modeBusyId, setModeBusyId] = useState<string | null>(null);

  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [run, setRun] = useState<QuantBotRun | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const config = useMemo(() => toConfig(botType, values), [botType, values]);
  const configKey = useMemo(() => JSON.stringify(config), [config]);
  const previewSeq = useRef(0);

  // The list reloads when `botsRevision` changes. Mutations bump it rather
  // than calling a loader directly, so the fetch stays inside one effect with
  // one `alive` guard — the same shape the analysis page uses.
  const [botsRevision, setBotsRevision] = useState(0);
  const reloadBots = useCallback(() => setBotsRevision((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/quant-agent/bots", { cache: "no-store" });
        if (!res.ok) throw new Error("list failed");
        const json = (await res.json()) as {
          bots?: QuantBot[];
          accountType?: AccountType;
        };
        if (!alive) return;
        setBots(json.bots ?? []);
        setAccountType(json.accountType ?? null);
        setListError(null);
      } catch {
        if (!alive) return;
        setBots([]);
        setListError(t("qa.bots.error"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [botsRevision, t]);

  // Debounced preview. `previewSeq` discards a stale response that lands after
  // a newer one — otherwise fast typing can leave an older ladder on screen.
  useEffect(() => {
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    const timer = setTimeout(() => {
      setPreviewing(true);
      void (async () => {
        try {
          const res = await fetch("/api/quant-agent/bots/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ botType, config }),
          });
          const json = (await res.json().catch(() => ({}))) as { preview?: QuantBotPreview };
          if (previewSeq.current !== seq) return;
          setPreview(json.preview ?? null);
        } catch {
          if (previewSeq.current === seq) setPreview(null);
        } finally {
          if (previewSeq.current === seq) setPreviewing(false);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `configKey` is the stable identity of `config`; depending on the object
    // itself would re-fire on every render.
  }, [botType, configKey, config]);

  const selectType = useCallback((next: QuantBotType) => {
    setBotType(next);
    setValues(DEFAULTS[next]);
    setPreview(null);
  }, []);

  const saveBot = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/quant-agent/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botType,
          name: name.trim() || `${botType} ${symbol.trim().toUpperCase()}`,
          symbol: symbol.trim().toUpperCase(),
          interval,
          initialCapital: Number(initialCapital) || 1000,
          config,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { bot?: QuantBot; error?: string };
      if (!res.ok || !json.bot) {
        setSaveError(json.error ?? t("qa.bots.form.save_failed"));
        return;
      }
      setSelectedBotId(json.bot.id);
      reloadBots();
    } catch {
      setSaveError(t("qa.bots.form.save_failed"));
    } finally {
      setSaving(false);
    }
  }, [botType, config, initialCapital, interval, name, reloadBots, symbol, t]);

  const removeBot = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/quant-agent/bots/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          setListError(t("qa.bots.list.delete_failed"));
          return;
        }
        if (selectedBotId === id) {
          setSelectedBotId(null);
          setRun(null);
        }
        reloadBots();
      } catch {
        setListError(t("qa.bots.list.delete_failed"));
      }
    },
    [reloadBots, selectedBotId, t],
  );

  const setBotMode = useCallback(
    async (id: string, executionMode: QuantBotExecutionModeWire) => {
      setModeBusyId(id);
      setListError(null);
      try {
        const res = await fetch(
          `/api/quant-agent/bots/${encodeURIComponent(id)}/execution-mode`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ executionMode }),
          },
        );
        if (!res.ok) {
          setListError(t("qa.bots.mode.failed"));
          return;
        }
        reloadBots();
      } catch {
        setListError(t("qa.bots.mode.failed"));
      } finally {
        setModeBusyId(null);
      }
    },
    [reloadBots, t],
  );

  const simulate = useCallback(
    async (id: string) => {
      setRunning(true);
      setRunError(null);
      setSelectedBotId(id);
      try {
        const res = await fetch(`/api/quant-agent/bots/${encodeURIComponent(id)}/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const json = (await res.json().catch(() => ({}))) as {
          simulation?: { run: QuantBotRun | null; error: string | null };
          error?: string;
        };
        if (!res.ok) {
          setRunError(json.error ?? t("qa.bots.run.failed"));
          setRun(null);
          return;
        }
        setRun(json.simulation?.run ?? null);
        if (json.simulation?.error) setRunError(json.simulation.error);
      } catch {
        setRunError(t("qa.bots.run.failed"));
      } finally {
        setRunning(false);
      }
    },
    [t],
  );

  const draft = useCallback(async () => {
    const text = prompt.trim();
    if (text.length < 3) return;
    setDrafting(true);
    setDraftError(null);
    setDraftNote(null);
    try {
      const res = await fetch("/api/quant-agent/bots/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          symbol: symbol.trim().toUpperCase() || "XAUUSD",
          interval,
          locale,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        recommendation?: {
          botType: QuantBotType;
          botName: string;
          strategyParams: Record<string, string | number | boolean>;
        };
        barCount?: number;
        error?: string;
      };
      if (!res.ok || !json.recommendation) {
        setDraftError(json.error ?? t("qa.bots.recommend.error"));
        return;
      }
      const next = json.recommendation;
      setBotType(next.botType);
      setName(next.botName);
      setValues({
        ...DEFAULTS[next.botType],
        ...Object.fromEntries(
          FIELDS[next.botType]
            .filter((field) => next.strategyParams[field.key] !== undefined)
            .map((field) => [field.key, String(next.strategyParams[field.key])]),
        ),
      });
      setDraftNote(
        (json.barCount ?? 0) >= 5
          ? t("qa.bots.recommend.applied")
          : t("qa.bots.recommend.no_market_data"),
      );
    } catch {
      setDraftError(t("qa.bots.recommend.error"));
    } finally {
      setDrafting(false);
    }
  }, [interval, locale, prompt, symbol, t]);

  const canSave =
    !saving &&
    symbol.trim().length > 0 &&
    preview?.status === "ok" &&
    preview.blockingWarning === "";

  return (
    <div dir={dir} className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title={t("qa.bots.title")}
        description={t("qa.bots.subtitle")}
        icon={<Bot aria-hidden="true" />}
        actions={<AccountTypeBadge type={accountType} size="md" />}
      />

      <BotStatusBanner accountType={accountType} />

      {/* Describe it in words */}
      <Surface padding="sm" className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{t("qa.bots.recommend.heading")}</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={prompt}
            maxLength={2000}
            placeholder={t("qa.bots.recommend.placeholder")}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button
            size="xl"
            variant="outline"
            disabled={drafting || prompt.trim().length < 3}
            onClick={() => void draft()}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {drafting ? t("qa.bots.recommend.working") : t("qa.bots.recommend.submit")}
          </Button>
        </div>
        {draftNote ? <p className="text-[12px] text-muted-foreground">{draftNote}</p> : null}
        {draftError ? <p className="text-[12px] text-destructive">{draftError}</p> : null}
      </Surface>

      {/* Type chips */}
      <div className="flex flex-wrap gap-1.5">
        {QUANT_BOT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={botType === type}
            onClick={() => selectType(type)}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9",
              botType === type
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(`qa.bots.type.${type}`)}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">{t(`qa.bots.type.${botType}_hint`)}</p>

      {/* Config */}
      <Surface padding="sm" className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("qa.bots.form.heading")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qa-bot-name">{t("qa.bots.form.name")}</Label>
            <Input
              id="qa-bot-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qa-bot-symbol">{t("qa.bots.form.symbol")}</Label>
            <Input
              id="qa-bot-symbol"
              dir="ltr"
              value={symbol}
              placeholder="XAUUSD"
              maxLength={32}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qa-bot-interval">{t("qa.bots.form.interval")}</Label>
            <Select value={interval} onValueChange={(value) => value && setIntervalValue(value)}>
              <SelectTrigger id="qa-bot-interval" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((option) => (
                  <SelectItem key={option} value={option}>
                    <span dir="ltr">{option}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qa-bot-capital">{t("qa.bots.form.initial_capital")}</Label>
            <Input
              id="qa-bot-capital"
              dir="ltr"
              type="number"
              inputMode="decimal"
              value={initialCapital}
              onChange={(event) => setInitialCapital(event.target.value)}
            />
          </div>

          {FIELDS[botType].map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`qa-bot-${field.key}`}>{t(field.labelKey)}</Label>
              {field.kind === "select" ? (
                <Select
                  value={values[field.key] ?? ""}
                  onValueChange={(value) =>
                    value && setValues((prev) => ({ ...prev, [field.key]: value }))
                  }
                >
                  <SelectTrigger id={`qa-bot-${field.key}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options ?? []).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`qa-bot-${field.key}`}
                  dir="ltr"
                  type="number"
                  inputMode="decimal"
                  step={field.step}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="xl" disabled={!canSave} onClick={() => void saveBot()}>
            {saving ? t("qa.bots.form.saving") : t("qa.bots.form.save")}
          </Button>
          {saveError ? <p className="text-[12px] text-destructive">{saveError}</p> : null}
        </div>
      </Surface>

      {previewing && !preview ? (
        <SkeletonBlock className="h-40" />
      ) : preview ? (
        preview.status === "invalid" ? (
          <Surface padding="none">
            <EmptyState
              announce
              tone="danger"
              icon={<AlertTriangle aria-hidden="true" />}
              title={t("qa.bots.preview.heading")}
              description={preview.error ?? t("qa.bots.preview.blocked")}
            />
          </Surface>
        ) : (
          <BotLevelLadder
            levels={preview.levels}
            summary={preview.summary}
            warnings={preview.warnings}
            diagnostics={preview.riskDiagnostics}
            blockingWarning={preview.blockingWarning}
          />
        )
      ) : null}

      {/* Saved bots */}
      <Surface padding="sm" className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">{t("qa.bots.list.heading")}</h2>
        {listError ? <p className="text-[12px] text-destructive">{listError}</p> : null}
        {bots === null ? (
          <SkeletonBlock className="h-20" />
        ) : bots.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t("qa.bots.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {bots.map((bot) => {
              const simulatable = QUANT_BOT_SIMULATABLE_TYPES.includes(bot.botType);
              return (
                <li
                  key={bot.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {bot.name}
                  </span>
                  <span dir="ltr" className="font-mono text-[11px] text-muted-foreground">
                    {bot.symbol} · {bot.interval}
                  </span>
                  <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground">
                    {t(`qa.bots.type.${bot.botType}`)}
                  </span>
                  <BotModeBadge mode={bot.executionMode} />
                  <AccountTypeBadge type={accountType} />
                  <span className="text-[11px] text-muted-foreground">
                    {t("qa.bots.list.levels", { count: String(bot.levels.length) })}
                  </span>
                  <div className="ms-auto flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={modeBusyId === bot.id}
                      onClick={() =>
                        void setBotMode(
                          bot.id,
                          bot.executionMode === "live" ? "simulation" : "live",
                        )
                      }
                    >
                      {bot.executionMode === "live"
                        ? t("qa.bots.mode.set_simulation")
                        : t("qa.bots.mode.set_live")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={running || !simulatable}
                      title={simulatable ? undefined : t("qa.bots.run.not_simulatable")}
                      onClick={() => void simulate(bot.id)}
                    >
                      <Play className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" />
                      {running && selectedBotId === bot.id
                        ? t("qa.bots.run.running")
                        : t("qa.bots.run.start")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("qa.bots.list.delete")}
                      onClick={() => void removeBot(bot.id)}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Surface>

      {runError ? (
        <Surface padding="none">
          <EmptyState
            announce
            tone="danger"
            icon={<AlertTriangle aria-hidden="true" />}
            title={t("qa.bots.run.heading")}
            description={runError}
          />
        </Surface>
      ) : null}

      {running ? (
        <Surface padding="sm" aria-busy="true">
          <p className="text-[12px] text-muted-foreground">{t("qa.bots.run.running")}</p>
        </Surface>
      ) : run ? (
        <BotRunSummary run={run} />
      ) : null}
    </div>
  );
}
