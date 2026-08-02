"use client";

import { useCallback, useRef, useState } from "react";
import { Bot, Check, Cpu, Plus, ShieldAlert } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useTradeMode } from "@/hooks/useTradeMode";
import { ComposerPopover } from "@/components/agent/ComposerPopover";
import { ModelChoiceList, useAgentModels } from "@/components/agent/AgentModelPicker";
import { cn } from "@/lib/utils";

const OPTION_CLASS =
  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-muted";

/**
 * Everything that governs the next turn but does not belong on the row.
 *
 * The composer row is for the things a trader changes constantly — the pair,
 * the frame, the risk. Which model answers, and whether the agent is allowed to
 * act on what it decides, are settings changed once and then left alone; giving
 * each of them a permanent chip cost the row the width it needed on a phone.
 * They live one tap away instead, behind a plus, on the same bottom-sheet
 * surface as every other composer control.
 */
export function ComposerMoreMenu() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const models = useAgentModels(open);
  const { view, saving, applyMode } = useTradeMode({ enabled: open });

  const close = useCallback(() => {
    setOpen(false);
    setConfirming(false);
    setError(null);
  }, []);

  const apply = useCallback(
    async (mode: "auto" | "advisory") => {
      setError(null);
      const result = await applyMode(mode);
      if (!result.ok) {
        setError(result.error ?? t("trade_mode.error"));
        return;
      }
      setConfirming(false);
    },
    [applyMode, t],
  );

  // The execution switch exists only while the broker connection is stable —
  // the same rule the trade-mode panel enforces, for the same reason.
  const showExecution = Boolean(view?.connected) && view?.downgraded_reason !== "phase_disabled";
  const mode = view?.mode ?? "advisory";
  const stage = view?.auto_execution_stage ?? "off";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label={t("composer.more")}
        title={t("composer.more")}
        data-testid="composer-more"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-out sm:size-9",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Plus className={cn("h-5 w-5 transition-transform duration-150", open && "rotate-45")} />
      </button>

      <ComposerPopover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        title={t("composer.more_title")}
      >
        <div className="max-h-[min(65vh,26rem)] overflow-y-auto p-1">
          {models.available && models.data && (
            <section aria-label={t("model.picker_title")}>
              <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] font-semibold text-foreground">
                <Cpu className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {t("model.picker_title")}
              </p>
              <ModelChoiceList
                models={models.data.models}
                selected={models.data.selected}
                saving={models.saving}
                onChoose={(ref) => void models.choose(ref)}
              />
            </section>
          )}

          {showExecution && (
            <section
              aria-label={t("trade_mode.title")}
              data-testid="composer-execution-mode"
              className={cn(models.available && "mt-2 border-t border-border pt-1")}
            >
              <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[11px] font-semibold text-foreground">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {t("trade_mode.title")}
              </p>

              {confirming ? (
                // Auto is standing execution authority; it is never one tap.
                <div className="px-2.5 pb-2">
                  <p className="text-[11px] font-semibold text-foreground">
                    {t("trade_mode.confirm.title")}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {t("trade_mode.confirm.body")}
                  </p>
                  {stage === "off" && (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-warning/35 bg-warning/[0.08] px-2 py-1.5 text-[11px] text-warning">
                      <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t("trade_mode.stage.off_note")}
                    </p>
                  )}
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirming(false)}
                      className="min-h-10 rounded-md border border-border px-2.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50 focus-ring"
                    >
                      {t("trade_mode.confirm.cancel")}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void apply("auto")}
                      data-testid="composer-execution-confirm"
                      className="min-h-10 rounded-md bg-buy px-2.5 text-[11px] font-semibold text-white hover:bg-buy/90 disabled:opacity-50 focus-ring"
                    >
                      {t("trade_mode.confirm.accept")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <ModeOption
                    label={t("trade_mode.mode.advisory")}
                    description={t("trade_mode.desc.advisory")}
                    selected={mode === "advisory"}
                    disabled={saving}
                    onSelect={() => void apply("advisory")}
                  />
                  <ModeOption
                    label={t("trade_mode.mode.auto")}
                    description={t("trade_mode.desc.auto")}
                    selected={mode === "auto"}
                    disabled={saving}
                    onSelect={() => (mode === "auto" ? undefined : setConfirming(true))}
                  />
                  <p className="px-2.5 pb-2 pt-1 text-[10px] text-muted-foreground">
                    {t("trade_mode.stage.label")}: {t(`trade_mode.stage.${stage}`)}
                  </p>
                </>
              )}

              {error && <p className="px-2.5 pb-2 text-[11px] text-destructive">{error}</p>}
            </section>
          )}

          {/* Never an empty box: a console with no provider key and no broker
              connection is told why there is nothing to set here. */}
          {!models.available && !showExecution && (
            <p className="px-2.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
              {t("composer.more_empty")}
            </p>
          )}
        </div>
      </ComposerPopover>
    </>
  );
}

function ModeOption({
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(OPTION_CLASS, "disabled:opacity-50")}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block text-xs", selected && "font-semibold")}>{label}</span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
      {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
    </button>
  );
}
