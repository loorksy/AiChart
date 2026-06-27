"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ChatErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[chat] render crash", { error, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[60dvh] items-center justify-center p-4" dir="rtl">
        <div className="w-full max-w-lg rounded-2xl border border-destructive/30 bg-card p-5 shadow-xl">
          <h2 className="text-lg font-bold text-foreground">تعذّر عرض المحادثة</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            حدث خطأ في واجهة الدردشة أثناء عرض التحليل. لم تُحذف المحادثة؛ أعد
            المحاولة أو حدّث الصفحة للرجوع إلى آخر حالة محفوظة.
          </p>
          {process.env.NODE_ENV !== "production" && (
            <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground" dir="ltr">
              {this.state.error.message}
            </pre>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              إعادة المحاولة
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground"
            >
              تحديث الصفحة
            </button>
          </div>
        </div>
      </div>
    );
  }
}
