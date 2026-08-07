"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronLeft,
  Link2,
  Loader2,
  Search,
  ShieldCheck,
  Unlink,
} from "lucide-react";

import { PageHeader, Surface } from "@/components/foundation";
import { Button, buttonVariants } from "@/components/squareui/button";
import { useLocale } from "@/hooks/useLocale";
import {
  brokerLogoSlug,
  brokerMonogram,
  type BrokerGroup,
} from "@/lib/mt5/brokerSearch";
import { cn } from "@/lib/utils";

interface ExistingAccount {
  platform: string;
  server: string;
  login: string;
  state: string | null;
}

type Step = "broker" | "login" | "progress" | "done";

const FIELD =
  "min-h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";

/**
 * Broker mark, the way the official MT5 app renders one: the broker's
 * artwork when we have it (an asset drop into /public/brokers — see the
 * README there), a monogram tile otherwise. Monochrome per DESIGN.md §1:
 * the mark identifies, it does not decorate.
 */
function BrokerMark({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const slug = brokerLogoSlug(name);
  const box = size === "lg" ? "size-12" : "size-10";
  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-border bg-muted/50",
      )}
    >
      {logoFailed || !slug ? (
        <span className="font-mono text-sm font-semibold text-muted-foreground">
          {brokerMonogram(name)}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- optional local
        // asset probed at runtime; next/image would 400 on the missing file
        // instead of firing onError.
        <img
          src={`/brokers/${slug}.png`}
          alt=""
          className="size-full object-contain p-1"
          onError={() => setLogoFailed(true)}
        />
      )}
    </span>
  );
}

/**
 * The MT5-style linking flow: search your BROKER by name, pick it, then sign
 * in on a screen that already knows every server of that broker. Transparency
 * stays a requirement, not a style choice — the user is told in plain words
 * they are signing in to their REAL MetaTrader account through the MetaApi
 * cloud, what is stored (encrypted), and what happens next. Manual server
 * entry always works as the fallback when live search is down.
 */
export function Mt5ConnectWizard({
  enabled,
  existing,
}: {
  enabled: boolean;
  existing: ExistingAccount | null;
}) {
  const { t } = useLocale();

  // "manage" shows the linked-account card; the wizard proper starts at
  // "broker". A user with no link lands straight in the wizard.
  const [view, setView] = useState<"manage" | "wizard">(existing ? "manage" : "wizard");
  const [step, setStep] = useState<Step>("broker");

  const [query, setQuery] = useState("");
  const [brokers, setBrokers] = useState<BrokerGroup[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "empty" | "unavailable"
  >("idle");
  const [broker, setBroker] = useState<BrokerGroup | null>(null);
  const [manualServer, setManualServer] = useState(false);

  const [platform, setPlatform] = useState<"mt5" | "mt4">("mt5");
  const [server, setServer] = useState(existing?.server ?? "");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinked, setUnlinked] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setBrokers([]);
      setSearchState("idle");
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchState("loading");
      fetch(`/api/mt5/brokers?q=${encodeURIComponent(query.trim())}`)
        .then(async (res) => {
          const data = (await res.json()) as {
            ok: boolean;
            brokers?: BrokerGroup[];
          };
          const list = data.brokers ?? [];
          setBrokers(list);
          setSearchState(!data.ok ? "unavailable" : list.length === 0 ? "empty" : "idle");
        })
        .catch(() => setSearchState("unavailable"));
    }, 350);
  }, [query]);

  function chooseBroker(b: BrokerGroup) {
    setBroker(b);
    setManualServer(false);
    setServer(b.servers[0] ?? "");
    setError(null);
    setStep("login");
  }

  function chooseManual() {
    setBroker(null);
    setManualServer(true);
    setServer("");
    setError(null);
    setStep("login");
  }

  async function connect() {
    setStep("progress");
    setError(null);
    setStatus(t("mt5link.status_provisioning"));
    try {
      // /api/mt/connect, not /api/agent/mt/connect. Both hand the same body to
      // the same connectMtAccount; they differ only in who is allowed to call
      // them. The agent route demands bridge-only headers a browser never has —
      // this route authenticates the session cookie.
      const res = await fetch("/api/mt/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, server: server.trim(), login, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        setError(data.error ?? t("mt5link.error_generic"));
        setStep("login");
        return;
      }
      setStatus(t("mt5link.done_status"));
      setStep("done");
    } catch {
      setError(t("mt5link.error_network"));
      setStep("login");
    }
  }

  async function unlink() {
    setUnlinking(true);
    setError(null);
    try {
      const res = await fetch("/api/mt/connect", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || data.ok === false) {
        setError(t("mt5link.unlink_failed"));
        return;
      }
      setUnlinked(true);
      setConfirmUnlink(false);
      setView("wizard");
      setStep("broker");
    } catch {
      setError(t("mt5link.unlink_failed"));
    } finally {
      setUnlinking(false);
    }
  }

  const header = (
    <PageHeader
      title={t("mt5link.page_title")}
      description={t("mt5link.page_desc")}
      icon={<Link2 aria-hidden="true" />}
    />
  );

  if (!enabled) {
    return (
      <div className="space-y-6">
        {header}
        <Surface padding="lg">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("mt5link.disabled")}
          </p>
        </Surface>
      </div>
    );
  }

  // ---- linked-account management card --------------------------------------
  if (view === "manage" && existing && !unlinked) {
    const online = existing.state === "DEPLOYED";
    return (
      <div className="space-y-6">
        {header}
        <Surface as="section" padding="lg" aria-label={t("mt5link.linked_title")}>
          <div className="flex items-center gap-3">
            <BrokerMark name={existing.server.split("-")[0] || existing.server} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {existing.platform.toUpperCase()} ·{" "}
                <span className="font-mono">{existing.login}</span>
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {existing.server}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px]",
                online
                  ? "border-success/35 bg-success/10 text-success"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {online ? t("mt5link.state_online") : t("mt5link.state_offline")}
            </span>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          {confirmUnlink ? (
            <div className="mt-4 space-y-3 rounded-[var(--radius)] bg-muted/50 p-3">
              <p className="text-sm leading-relaxed">{t("mt5link.unlink_confirm")}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="destructive"
                  size="lg"
                  className="min-h-11"
                  onClick={unlink}
                  disabled={unlinking}
                >
                  {unlinking ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <Unlink aria-hidden="true" className="size-4" />
                  )}
                  {t("mt5link.unlink_yes")}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  className="min-h-11"
                  onClick={() => setConfirmUnlink(false)}
                  disabled={unlinking}
                >
                  {t("mt5link.unlink_cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                size="lg"
                className="min-h-11"
                onClick={() => {
                  setView("wizard");
                  setStep("broker");
                }}
              >
                {t("mt5link.link_new")}
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="min-h-11"
                onClick={() => setConfirmUnlink(true)}
              >
                <Unlink aria-hidden="true" className="size-4" />
                {t("mt5link.unlink")}
              </Button>
            </div>
          )}
          <p className="type-caption mt-3 text-muted-foreground">
            {t("mt5link.linked_replace_note")}
          </p>
        </Surface>
      </div>
    );
  }

  // ---- the wizard ----------------------------------------------------------
  const STEPS: { key: Step; label: string }[] = [
    { key: "broker", label: t("mt5link.step_broker") },
    { key: "login", label: t("mt5link.step_login") },
    { key: "progress", label: t("mt5link.step_link") },
  ];
  const activeIndex =
    step === "done" ? STEPS.length - 1 : STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-6">
      {header}

      {/* An ordered list so the wizard's shape is available to a screen
          reader, not just implied by the colour of three bars. */}
      <ol className="flex items-center gap-2" aria-label={t("mt5link.steps_label")}>
        {STEPS.map((s, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "current" : "todo";
          return (
            <li key={s.key} className="flex flex-1 flex-col gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "h-1 rounded-full transition-colors duration-200",
                  state === "todo" ? "bg-border" : "bg-primary",
                )}
              />
              <span
                className={cn(
                  "type-caption",
                  state === "current" && "font-semibold text-foreground",
                )}
                aria-current={state === "current" ? "step" : undefined}
              >
                {i + 1} · {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <Surface padding="lg">
        {step === "broker" && (
          <div className="space-y-4">
            <h2 className="type-heading">{t("mt5link.search_title")}</h2>

            <div className="space-y-1.5">
              <label htmlFor="mt5-broker-search" className="type-caption block font-medium">
                {t("mt5link.search_label")}
              </label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
                />
                <input
                  id="mt5-broker-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("mt5link.search_placeholder")}
                  autoComplete="off"
                  className={cn(FIELD, "ps-9")}
                />
              </div>
              <p className="type-caption text-muted-foreground">
                {t("mt5link.search_hint")}
              </p>
            </div>

            <div aria-live="polite">
              {searchState === "loading" && (
                <p className="type-caption flex items-center gap-1.5">
                  <Loader2
                    aria-hidden="true"
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                  />
                  {t("mt5link.searching")}
                </p>
              )}
              {searchState === "empty" && (
                <p className="type-caption">
                  {t("mt5link.search_empty", { query: query.trim() })}
                </p>
              )}
              {searchState === "unavailable" && (
                <p className="type-caption">{t("mt5link.search_unavailable")}</p>
              )}
            </div>

            {brokers.length > 0 && (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                {brokers.map((b) => (
                  <li key={b.name}>
                    <button
                      onClick={() => chooseBroker(b)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius)] border border-border px-3 py-2 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <BrokerMark name={b.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {b.name}
                        </span>
                        <span className="type-caption block text-muted-foreground">
                          {t("mt5link.servers_count", {
                            count: String(b.servers.length),
                          })}
                        </span>
                      </span>
                      <ChevronLeft
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground ltr:rotate-180"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-border pt-3">
              <Button variant="ghost" size="lg" className="min-h-11 -ms-2" onClick={chooseManual}>
                <Building2 aria-hidden="true" className="size-4" />
                {t("mt5link.manual_toggle")}
              </Button>
            </div>
          </div>
        )}

        {step === "login" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {broker && <BrokerMark name={broker.name} />}
              <h2 className="type-heading">
                {broker
                  ? t("mt5link.login_title", { broker: broker.name })
                  : t("mt5link.step_login")}
              </h2>
            </div>

            <div className="flex gap-2.5 rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-foreground">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>{t("mt5link.login_note")}</p>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="mt5-platform" className="type-caption block font-medium">
                  {t("mt5link.platform")}
                </label>
                <select
                  id="mt5-platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as "mt5" | "mt4")}
                  className={FIELD}
                >
                  <option value="mt5">MetaTrader 5</option>
                  <option value="mt4">MetaTrader 4</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="mt5-server" className="type-caption block font-medium">
                  {manualServer ? t("mt5link.manual_label") : t("mt5link.server")}
                </label>
                {broker && !manualServer ? (
                  <select
                    id="mt5-server"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    className={cn(FIELD, "font-mono")}
                  >
                    {broker.servers.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="mt5-server"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    placeholder="Exness-MT5Real8"
                    autoComplete="off"
                    className={cn(FIELD, "font-mono")}
                  />
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="mt5-login" className="type-caption block font-medium">
                  {t("mt5link.login")}
                </label>
                <input
                  id="mt5-login"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="123456789"
                  inputMode="numeric"
                  autoComplete="off"
                  className={cn(FIELD, "font-mono")}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="mt5-password" className="type-caption block font-medium">
                  {t("mt5link.password")}
                </label>
                <input
                  id="mt5-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete="off"
                  className={FIELD}
                />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="ghost"
                size="lg"
                className="min-h-11 sm:-ms-2"
                onClick={() => {
                  setError(null);
                  setStep("broker");
                }}
              >
                <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
                {t("mt5link.back_to_brokers")}
              </Button>
              <Button
                size="lg"
                className="min-h-11"
                onClick={connect}
                disabled={!server.trim() || !login.trim() || !password}
              >
                {t("mt5link.connect")}
              </Button>
            </div>
          </div>
        )}

        {(step === "progress" || step === "done") && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-12 items-center justify-center rounded-full border",
                step === "done"
                  ? "border-success/35 bg-success/10 text-success"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              {step === "done" ? (
                <CheckCircle2 className="size-6" />
              ) : (
                <Loader2 className="size-6 animate-spin motion-reduce:animate-none" />
              )}
            </span>

            <h2 className="type-heading">
              {step === "done" ? t("mt5link.done_title") : t("mt5link.connecting")}
            </h2>

            {/* The connect call is slow; announce each status change. */}
            <p className="type-caption" role="status" aria-live="polite">
              {status}
            </p>

            {step === "done" && (
              <a
                href="/workspace"
                className={cn(buttonVariants({ size: "lg" }), "min-h-11 px-6")}
              >
                {t("mt5link.go_workspace")}
              </a>
            )}
          </div>
        )}
      </Surface>
    </div>
  );
}
