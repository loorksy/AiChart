"use client";

import { useCallback, useRef, useState } from "react";
import { Bot, Check, Cpu, Plus, ShieldAlert } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
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

  const close = useCallback(() => {
    setOpen(false);
    setConfirming(false);
    setError(null);
  }, []);

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


          {/* Never an empty box: a console with no provider key is told why
              there is nothing to set here. */}
          {!models.available && (
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
