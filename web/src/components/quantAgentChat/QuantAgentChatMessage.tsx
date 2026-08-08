"use client";

/**
 * One message bubble in Quant Agent Chat (plan §4). Distinct from Lonora's
 * `SmartChartAgentPanel.tsx` bubble — this component is never shared between
 * the two agents' chat instances. Assistant messages render markdown,
 * including fenced code blocks as a bordered block with a language label and
 * a copy button (no reusable markdown/code renderer existed in the codebase
 * before this — `react-markdown`, already a dependency, is used directly).
 */
import { type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type {
  QuantAgentMemoryCandidate,
  QuantAgentStrategyProposal,
  QuantAgentUsedSkill,
} from "@/lib/agent/quantAgentChat/types";
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

export function QuantAgentChatMessage({ message, chatId }: { message: QuantAgentChatMessageData; chatId?: string }) {
  const { t, dir } = useLocale();
  const isUser = message.role === "user";
  const isThinking = !isUser && message.pending && !message.content;

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

          {!message.pending && message.memoryCandidate ? (
            <QuantAgentMemorySaveBanner content={message.memoryCandidate.content} chatId={chatId} />
          ) : null}
        </div>
      )}
    </div>
  );
}
