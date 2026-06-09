"use client";

interface ChatWelcomeProps {
  displayName?: string;
  model?: string | null;
  creditsRemaining?: number;
}

export function ChatWelcome({
  model,
  creditsRemaining,
}: ChatWelcomeProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-6">
      <h1 className="mb-8 text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        ما الذي تريد البدء به؟
      </h1>
      {(model || creditsRemaining != null) && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
          {model && (
            <span>
              الموديل:{" "}
              <span dir="ltr" className="font-mono">
                {model}
              </span>
            </span>
          )}
          {creditsRemaining != null && (
            <span>{creditsRemaining} رصيد متبقّي</span>
          )}
        </div>
      )}
    </div>
  );
}
