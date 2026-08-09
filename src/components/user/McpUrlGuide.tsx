"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { CopyField } from "@/components/ui/CopyField";

export function McpUrlGuide({
  mcpUrl,
  needsCredentials,
}: {
  mcpUrl: string;
  needsCredentials: boolean;
}) {
  return (
    <div className="space-y-4 text-sm">
      {needsCredentials ? (
        <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p>
            أكمل البريد وكلمة المرور للموصل من{" "}
            <Link href="/complete-profile" className="text-link">
              إكمال الملف
            </Link>{" "}
            قبل تسجيل الدخول في Claude.
          </p>
        </div>
      ) : null}
      <ol className="list-decimal space-y-3 ps-5">
        <li>
          افتح{" "}
          <a
            href="https://claude.ai/customize/connectors"
            className="text-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            Claude Connectors
          </a>
        </li>
        <li>Add custom connector → الاسم: Lonora Trading</li>
        <li>
          Remote connector URL:
          <div className="mt-2">
            <CopyField value={mcpUrl} />
          </div>
        </li>
        <li>OAuth Client ID/Secret: اتركهما فارغين</li>
        <li>سجّل دخول بحسابك في Lonora (بريد + كلمة المرور)</li>
      </ol>
      <p className="text-muted-foreground">
        بعد الربط يظهر مساعد Lonora داخل محادثة Claude — القرار من التحليل، والتنفيذ لا يتم إلا بعد موافقتك واجتياز الفحوص التقنية.
      </p>
    </div>
  );
}
