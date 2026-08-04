import type { Express, Request, Response } from "express";
import type { AiChartOAuthProvider } from "./provider.js";
import { SESSION_COOKIE } from "./provider.js";
import { mcpLoginErrorMessage } from "./platformAccess.js";

type LoginLocale = "ar" | "en";

function detectLoginLocale(req: Request): LoginLocale {
  const q = String(req.query.lang ?? req.body?.lang ?? "").toLowerCase();
  if (q.startsWith("en")) return "en";
  if (q.startsWith("ar")) return "ar";
  const al = String(req.headers["accept-language"] ?? "").toLowerCase();
  if (al.startsWith("en") || al.includes(",en")) return "en";
  return "ar";
}

const COPY = {
  ar: {
    title: "Lonora — MCP",
    heading: "تفويض اتصال MCP",
    lead: "سجّل دخول حساب Lonora للموافقة على ربط عميل MCP. لن تُعرض أسرار أو رموز في هذه الصفحة.",
    email: "البريد",
    password: "كلمة المرور",
    show: "إظهار",
    hide: "إخفاء",
    showAria: "إظهار كلمة المرور",
    hideAria: "إخفاء كلمة المرور",
    submit: "تسجيل الدخول والموافقة",
    submitting: "جارٍ التحقق…",
    cancel: "إلغاء",
    fieldsRequired: "جميع الحقول مطلوبة.",
    sessionInvalid: "جلسة OAuth غير صالحة أو منتهية.",
    expired: "انتهت صلاحية حسابك أو الجلسة. سجّل الدخول مجدداً.",
  },
  en: {
    title: "Lonora — MCP",
    heading: "Authorize MCP connection",
    lead: "Sign in with your Lonora account to approve an MCP client connection. Secrets and tokens are never shown on this page.",
    email: "Email",
    password: "Password",
    show: "Show",
    hide: "Hide",
    showAria: "Show password",
    hideAria: "Hide password",
    submit: "Sign in and approve",
    submitting: "Verifying…",
    cancel: "Cancel",
    fieldsRequired: "All fields are required.",
    sessionInvalid: "OAuth session is invalid or expired.",
    expired: "Your account or session expired. Sign in again.",
  },
} as const;

/** Neutral Lonora MCP OAuth login — same auth flow, current visual system. */
function loginPage(pending: string, locale: LoginLocale, error?: string): string {
  const c = COPY[locale];
  const err = error
    ? `<p class="error" role="alert">${escapeHtml(error)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="dark light"/>
  <title>${escapeHtml(c.title)}</title>
  <link rel="icon" href="https://aichart.lork.cloud/favicon.ico" sizes="any"/>
  <link rel="icon" type="image/png" sizes="32x32" href="https://aichart.lork.cloud/favicon-32x32.png"/>
  <link rel="apple-touch-icon" href="https://aichart.lork.cloud/apple-touch-icon.png"/>
  <style>
    :root {
      --bg: #f7f7f8;
      --fg: #0d0d0d;
      --card: #ffffff;
      --muted: #52525b;
      --border: #e4e4e7;
      --input: #ffffff;
      --ring: #71717a;
      --danger: #dc2626;
      --btn: #18181b;
      --btn-fg: #fafafa;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0a0a0a;
        --fg: #ececec;
        --card: #141414;
        --muted: #a1a1aa;
        --border: #262626;
        --input: #141414;
        --ring: #a1a1aa;
        --danger: #ef4444;
        --btn: #fafafa;
        --btn-fg: #0a0a0a;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      font-family: "Segoe UI", Tahoma, system-ui, sans-serif;
      background: var(--bg);
      color: var(--fg);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
    }
    .panel {
      width: min(24rem, 100%);
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.5rem 1.25rem;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      margin-bottom: 1rem;
    }
    .brand svg {
      width: 2.25rem;
      height: 2.25rem;
      flex-shrink: 0;
      color: var(--fg);
    }
    .brand strong {
      font-size: 1.05rem;
      letter-spacing: -0.02em;
    }
    h1 {
      font-size: 1.15rem;
      font-weight: 650;
      margin: 0 0 0.4rem;
      letter-spacing: -0.02em;
    }
    .lead {
      margin: 0 0 0.85rem;
      color: var(--muted);
      font-size: 0.875rem;
      line-height: 1.45;
    }
    .error {
      margin: 0 0 0.75rem;
      padding: 0.55rem 0.7rem;
      border-radius: 0.5rem;
      border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
      background: color-mix(in srgb, var(--danger) 10%, var(--card));
      color: var(--danger);
      font-size: 0.85rem;
    }
    label {
      display: block;
      font-size: 0.8rem;
      font-weight: 500;
      margin: 0.75rem 0 0.3rem;
    }
    .field {
      position: relative;
    }
    input[type="email"],
    input[type="password"],
    input[type="text"] {
      width: 100%;
      min-height: 2.75rem;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: var(--input);
      color: var(--fg);
      font-size: 1rem;
    }
    input:focus {
      outline: 2px solid var(--ring);
      outline-offset: 1px;
    }
    .toggle {
      position: absolute;
      inset-inline-end: 0.35rem;
      top: 50%;
      transform: translateY(-50%);
      border: 0;
      background: transparent;
      color: var(--muted);
      font-size: 0.75rem;
      padding: 0.4rem 0.5rem;
      cursor: pointer;
      min-height: 2.25rem;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 1.15rem;
    }
    .primary {
      min-height: 2.75rem;
      border: 0;
      border-radius: 0.5rem;
      background: var(--btn);
      color: var(--btn-fg);
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .primary:disabled {
      opacity: 0.55;
      cursor: wait;
    }
    .cancel {
      min-height: 2.5rem;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: transparent;
      color: var(--muted);
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <main class="panel">
    <div class="brand">
      <svg width="36" height="36" viewBox="100 250 900 670" aria-hidden="true" focusable="false">
        <path fill="currentColor" fill-rule="evenodd" d="M258.63 274.35C278.01 271.86 299.01 274.62 317.66 279.79C400.53 302.73 452.07 386.95 434.75 471.32C429.32 497.75 416.93 522.49 399.9 543.35C387.04 559.1 370.42 572.4 352.62 582.11C332.62 593.02 310.2 599.97 287.5 601.87C266.99 603.59 245.9 601.15 226.28 595.25C140.5 569.44 90.62 477.72 116.16 391.6C120.93 375.53 128.1 359.97 137.59 346.1C149.4 328.83 164.29 313.8 181.6 302.02C204.84 286.21 230.99 277.9 258.63 274.35ZM805.76 274.41C816.59 272.9 828.7 273.63 839.5 274.88C922.33 284.44 985.94 354.65 985.59 438.5C985.23 523.81 919.85 593.52 835.5 601.82C819.14 603.43 802.12 601.81 786.13 598.45C698.33 580 642.8 491.95 660.29 404.7C671.01 351.17 710.18 305.39 760.72 285.23C775.29 279.42 790.31 276.58 805.76 274.41ZM542.79 642.35C558.84 638.96 571.8 654.43 583.11 663.41C612.25 686.55 640.77 710.54 670.12 733.39C677.05 738.78 683.77 744.46 690.68 749.87C696 754.03 701.29 758.22 701.91 765.5C702.24 769.44 700.84 773.79 698.44 776.94C693.51 783.4 678.53 793.35 671.57 799.05C643.15 822.33 614.44 845.3 585.64 868.09C575.11 876.42 561.61 891.61 547.5 891.6C533.22 891.59 519.55 876.01 508.84 867.63C480.11 845.16 451.58 822.27 423.45 799.04C416.48 793.28 401.51 783.42 396.56 776.93C394.19 773.81 392.75 769.41 393.08 765.5C393.67 758.5 398.66 754.34 403.8 750.32C411.09 744.63 418.24 738.74 425.43 732.94C452.38 711.24 479.12 689.25 506.32 667.87C516.1 660.19 530.89 644.87 542.79 642.35Z"/>
      </svg>
      <strong>Lonora</strong>
    </div>
    <h1>${escapeHtml(c.heading)}</h1>
    <p class="lead">${escapeHtml(c.lead)}</p>
    ${err}
    <form method="post" action="/oauth/login" id="mcp-login-form">
      <input type="hidden" name="pending" value="${escapeHtml(pending)}"/>
      <input type="hidden" name="lang" value="${locale}"/>
      <label for="email">${escapeHtml(c.email)}</label>
      <input id="email" name="email" type="email" required autocomplete="username" inputmode="email"/>
      <label for="password">${escapeHtml(c.password)}</label>
      <div class="field">
        <input id="password" name="password" type="password" required autocomplete="current-password"/>
        <button type="button" class="toggle" id="toggle-password" aria-label="${escapeHtml(c.showAria)}">${escapeHtml(c.show)}</button>
      </div>
      <div class="actions">
        <button class="primary" type="submit" id="submit-btn">${escapeHtml(c.submit)}</button>
        <a class="cancel" href="about:blank" id="cancel-btn">${escapeHtml(c.cancel)}</a>
      </div>
    </form>
  </main>
  <script>
    (function () {
      var form = document.getElementById("mcp-login-form");
      var btn = document.getElementById("submit-btn");
      var toggle = document.getElementById("toggle-password");
      var input = document.getElementById("password");
      var showLabel = ${JSON.stringify(c.show)};
      var hideLabel = ${JSON.stringify(c.hide)};
      var showAria = ${JSON.stringify(c.showAria)};
      var hideAria = ${JSON.stringify(c.hideAria)};
      var submitting = ${JSON.stringify(c.submitting)};
      if (form && btn) {
        form.addEventListener("submit", function () {
          btn.disabled = true;
          btn.textContent = submitting;
        });
      }
      if (toggle && input) {
        toggle.addEventListener("click", function () {
          var show = input.type === "password";
          input.type = show ? "text" : "password";
          toggle.textContent = show ? hideLabel : showLabel;
          toggle.setAttribute("aria-label", show ? hideAria : showAria);
        });
      }
      var cancel = document.getElementById("cancel-btn");
      if (cancel) {
        cancel.addEventListener("click", function (e) {
          e.preventDefault();
          if (window.history.length > 1) window.history.back();
          else window.close();
        });
      }
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mountLoginRoutes(app: Express, provider: AiChartOAuthProvider) {
  app.get("/oauth/login", (req: Request, res: Response) => {
    const locale = detectLoginLocale(req);
    const pending = String(req.query.pending ?? "");
    if (!pending || !provider.pending.has(pending)) {
      res.status(400).send(COPY[locale].sessionInvalid);
      return;
    }
    const errQuery = String(req.query.error ?? "");
    const err =
      errQuery === "expired" ? COPY[locale].expired : undefined;
    res.type("html").send(loginPage(pending, locale, err));
  });

  app.post("/oauth/login", async (req: Request, res: Response) => {
    const locale = detectLoginLocale(req);
    const pending = String(req.body?.pending ?? "");
    const email = String(req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!pending || !email || !password) {
      res.status(400).type("html").send(loginPage(pending, locale, COPY[locale].fieldsRequired));
      return;
    }
    if (!provider.pending.has(pending)) {
      res.status(400).send(COPY[locale].sessionInvalid);
      return;
    }
    const result = await provider.verifyPlatformUser(email, password);
    if (!result.ok) {
      res
        .type("html")
        .send(loginPage(pending, locale, mcpLoginErrorMessage(result.reason, locale)));
      return;
    }
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.cookie(
      SESSION_COOKIE,
      provider.signSession(email),
      provider.sessionCookieOptions(secure),
    );
    try {
      provider.completePendingLogin(
        pending,
        email,
        result.accessExpiresAt ?? null,
        res,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "OAuth error";
      res.status(400).send(msg);
    }
  });
}
