"use client";

interface ChatWelcomeProps {
  displayName: string;
  model?: string | null;
  creditsRemaining?: number;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "صباح الخير";
  if (h < 17) return "مساء الخير";
  return "مساء الخير";
}

export function ChatWelcome({
  displayName,
  model,
  creditsRemaining,
}: ChatWelcomeProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
      <h1 className="mb-2 text-center font-serif text-2xl font-bold tracking-tight sm:text-3xl">
        {greeting()}، {displayName}
      </h1>
      <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
        وكيل تداول ذكي على Binance — اسأل عن السوق، حسابك، أو أي زوج USDT.
      </p>
      {model && (
        <p className="mb-2 text-xs text-muted-foreground">
          الموديل: <span dir="ltr" className="font-mono">{model}</span>
        </p>
      )}
      {creditsRemaining != null && (
        <p className="text-xs text-muted-foreground">
          1 رصيد لكل رسالة • {creditsRemaining} متبقّي
        </p>
      )}
    </div>
  );
}
