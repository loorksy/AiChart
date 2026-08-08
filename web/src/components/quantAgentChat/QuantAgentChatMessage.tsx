"use client";

/**
 * One message bubble in Quant Agent Chat (plan §4). Distinct from Lonora's
 * `SmartChartAgentPanel.tsx` bubble — this component is never shared between
 * the two agents' chat instances. Assistant messages render markdown,
 * including fenced code blocks as a bordered block with a language label and
 * a copy button (no reusable markdown/code renderer existed in the codebase
 * before this — `react-markdown`, already a dependency, is used directly).
 */
import { type ReactElement, type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy, Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type {
  QuantAgentMemoryCandidate,
  QuantAgentStrategyProposal,
  QuantAgentUsedSkill,
} from "@/lib/agent/quantAgentChat/types";
import type { QuantRecommendation } from "@/lib/quantAgent/types";
import { QuantRecommendationCard } from "@/components/quantAgent/QuantRecommendationCard";
import { CodeBlock } from "./CodeBlock";
import { QuantAgentStrategyProposalCard } from "./QuantAgentStrategyProposalCard";
import { QuantAgentMemorySaveBanner } from "./QuantAgentMemorySaveBanner";

export interface QuantAgentChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** True while the first streamed token has not arrived yet (or is still streaming). */
  pending?: boolean;
  usedSkills?: QuantAgentUsedSkill[];
  strategyProposal?: QuantAgentStrategyProposal | null;
  memoryCandidate?: QuantAgentMemoryCandidate | null;
  /** The structured recommendation(s) the `explain_recommendation` turn read and explained. */
  recommendations?: QuantRecommendation[];
  /** Epoch ms — shown subtly under assistant messages, sidebar-date-formatting style. */
  createdAt?: number;
}

type CodeElement = ReactElement<{ className?: string; children?: ReactNode }>;

function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-markdown space-y-2 text-sm leading-relaxed text-foreground [&_a]:underline [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-0 [&_ul]:list-disc [&_ul]:ps-5">
      <ReactMarkdown
        components={{
          code(props) {
            const { className, children } = props;
            const match = /language-(\w+)/.exec(className ?? "");
            if (match) {
              // Block code — the `pre` override renders the bordered block;
              // this just passes the raw text through untouched.
              return <code className={className}>{children}</code>;
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
                {children}
              </code>
            );
          },
          pre(props) {
            const child = props.children as CodeElement | undefined;
            const codeClassName = child?.props?.className ?? "";
            const match = /language-(\w+)/.exec(codeClassName);
            const language = match?.[1] ?? "text";
            const text = String(child?.props?.children ?? "").replace(/\n$/, "");
            return <CodeBlock language={language} code={text} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Sidebar-date-formatting style, but time-of-day — matches `QuantAgentChatSidebar`'s locale handling. */
function formatMessageTime(createdAt: number, locale: "ar" | "en"): string {
  try {
    return new Date(createdAt).toLocaleTimeString(locale === "ar" ? "ar" : "en", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function QuantAgentChatMessage({ message, chatId }: { message: QuantAgentChatMessageData; chatId?: string }) {
  const { t, dir, locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const isThinking = !isUser && message.pending && !message.content;

  async function handleCopyReply() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silently ignore, same fallback as CodeBlock */
    }
  }

  return (
    <div
      dir={dir}
      data-role={message.role}
      className={cn(
        isUser
          ? "ms-auto max-w-[min(88%,42rem)] rounded-2xl bg-[var(--user-bubble)] px-3.5 py-2 text-sm text-foreground"
          : "me-auto max-w-[min(95%,46rem)] px-1 py-2 text-sm text-foreground",
      )}
    >
      {isThinking ? (
        <div
          className="flex items-center gap-2 rounded-2xl border border-dashed border-border/70 px-3.5 py-2.5 text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span className="text-xs">{t("qa.chat.thinking")}</span>
        </div>
      ) : isUser ? (
        <p className="whitespace-pre-wrap">{message.content}</p>
      ) : (
        <div className="min-w-0 rounded-2xl border border-border/60 bg-card px-3.5 py-2.5">
          <MessageMarkdown content={message.content} />
          {message.pending ? (
            <span className="ms-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-foreground/60 align-middle" />
          ) : null}

          {!message.pending && message.usedSkills?.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">{t("qa.chat.skills.used")}:</span>
              {message.usedSkills.map((skill) => (
                <span
                  key={`${skill.name}@${skill.version}`}
                  className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
                >
                  {skill.name}
                </span>
              ))}
            </div>
          ) : null}

          {!message.pending && message.strategyProposal ? (
            <QuantAgentStrategyProposalCard proposal={message.strategyProposal} />
          ) : null}

          {!message.pending && message.recommendations?.length ? (
            <div className="mt-2 space-y-2">
              {message.recommendations.map((rec) => (
                <QuantRecommendationCard key={rec.id} rec={rec} />
              ))}
            </div>
          ) : null}

          {!message.pending && message.memoryCandidate ? (
            <QuantAgentMemorySaveBanner content={message.memoryCandidate.content} chatId={chatId} />
          ) : null}

          {!message.pending && message.content ? (
            <div className="mt-2 flex items-center gap-2">
              {message.createdAt ? (
                <span className="text-[10px] text-muted-foreground">
                  {formatMessageTime(message.createdAt, locale)}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void handleCopyReply()}
                aria-label={t("qa.chat.message.copy_reply")}
                title={t("qa.chat.message.copy_reply")}
                className="ms-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" aria-hidden="true" />
                    {t("qa.chat.message.copy_reply_done")}
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    {t("qa.chat.message.copy_reply")}
                  </>
                )}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
