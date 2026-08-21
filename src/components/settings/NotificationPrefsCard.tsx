"use client";

/**
 * Proactive-notification preferences (Phase 6) — the user-facing half of
 * /api/settings/notifications.
 *
 * Four event categories, each a real market event: activation triggered,
 * target reached, invalidation/stop hit, news-block window. Defaults are
 * all-on; a category turned off here is recorded silence, decided by the
 * user rather than by a failure.
 */
import { useCallback, useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Surface } from "@/components/foundation";
import { useLocale } from "@/hooks/useLocale";
// The PURE vocabulary module — never ./notifications, whose host/db import
// graph must not reach a client bundle (Turbopack refuses the build).
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPrefs,
} from "@/lib/resident/notificationPrefs";

export function NotificationPrefsCard() {
  const { t, dir } = useLocale();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/settings/notifications", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { prefs?: NotificationPrefs };
        if (!cancelled && json.prefs) setPrefs(json.prefs);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    async (category: NotificationCategory) => {
      if (!prefs || busy) return;
      const next = { ...prefs, [category]: !prefs[category] };
      setPrefs(next);
      setBusy(true);
      try {
        const res = await fetch("/api/settings/notifications", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [category]: next[category] }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { prefs?: NotificationPrefs };
        if (json.prefs) setPrefs(json.prefs);
      } catch {
        // Roll the switch back — a failed save must not look like a saved one.
        setPrefs(prefs);
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [prefs, busy],
  );

  return (
    <Surface padding="md" dir={dir}>
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <BellRing className="h-4 w-4" aria-hidden />
        {t("settings.notify.title")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t("settings.notify.desc")}</p>
      {failed ? (
        <p className="mt-2 text-xs text-destructive">{t("settings.notify.failed")}</p>
      ) : null}
      <div className="mt-3 space-y-2">
        {NOTIFICATION_CATEGORIES.map((category) => (
          <label
            key={category}
            className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm sm:min-h-9"
          >
            <span>{t(`settings.notify.${category}`)}</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={prefs ? prefs[category] : true}
              disabled={!prefs || busy}
              onChange={() => void toggle(category)}
            />
          </label>
        ))}
      </div>
    </Surface>
  );
}
