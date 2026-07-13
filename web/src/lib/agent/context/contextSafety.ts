import type {
  ContextSafetyClassification,
  ContextWarning,
} from "./types";

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[a-z0-9_-]{16,}\b/gi,
  /\b(?:authorization\s*:\s*)?bearer\s+[a-z0-9._~+\/-]{12,}/gi,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?)?:?\/\/[^\s]+/gi,
  /\b(?:api[_-]?key|secret|password|token)\s*[=:]\s*[^\s,;]+/gi,
];
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi;
const INSTRUCTION_LIKE = [
  /ignore (?:all |the )?(?:(?:previous|system|developer)\s+){1,2}instructions?/i,
  /reveal (?:the )?(?:system prompt|hidden reasoning|chain[- ]of[- ]thought)/i,
  /تجاهل (?:كل )?(?:التعليمات|الأوامر) (?:السابقة|أعلاه)/i,
  /اكشف (?:تعليمات النظام|التفكير الداخلي)/i,
];

export interface SanitizedContextText {
  text: string;
  classifications: ContextSafetyClassification[];
  warnings: ContextWarning[];
  rejected: boolean;
  truncated: boolean;
}

export function sanitizeContextText(
  input: string,
  options: { maxChars?: number; messageId?: string; untrusted?: boolean } = {},
): SanitizedContextText {
  const classifications = new Set<ContextSafetyClassification>();
  const warnings: ContextWarning[] = [];
  let text = String(input ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "[script removed]")
    .replace(/<[^>]{1,500}>/g, "");

  if (options.untrusted) classifications.add("untrusted_content");
  if (PRIVATE_KEY.test(text)) {
    PRIVATE_KEY.lastIndex = 0;
    classifications.add("secret_detected");
    warnings.push({ code: "unsafe_memory_excluded", messageId: options.messageId });
    return { text: "", classifications: [...classifications], warnings, rejected: true, truncated: false };
  }
  PRIVATE_KEY.lastIndex = 0;

  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;
    text = text.replace(pattern, "[REDACTED]");
    classifications.add("secret_detected");
    warnings.push({ code: "secret_redacted", messageId: options.messageId });
  }
  if (INSTRUCTION_LIKE.some((pattern) => pattern.test(text))) {
    classifications.add("instruction_like");
  }

  const maxChars = Math.max(64, options.maxChars ?? 12_000);
  let truncated = false;
  if (text.length > maxChars) {
    text = `${text.slice(0, Math.max(0, maxChars - 28)).trimEnd()}\n[historical context truncated]`;
    classifications.add("oversized");
    warnings.push({ code: "message_truncated", messageId: options.messageId });
    truncated = true;
  }
  if (classifications.size === 0) classifications.add("safe");
  return { text: text.trim(), classifications: [...classifications], warnings, rejected: false, truncated };
}
