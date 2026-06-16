import type { Express, Request, Response } from "express";
import type { AiChartOAuthProvider } from "./provider.js";
import { SESSION_COOKIE } from "./provider.js";
import { mcpLoginErrorMessage } from "./platformAccess.js";

function loginPage(pending: string, error?: string): string {
  const err = error
    ? `<p style="color:#f87171;margin:0 0 1rem">${escapeHtml(error)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>AiChart MCP — تسجيل الدخول</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    form{background:#1e293b;padding:2rem;border-radius:12px;width:min(400px,92vw);box-shadow:0 8px 32px #0006}
    h1{font-size:1.25rem;margin:0 0 .5rem}
    p{color:#94a3b8;font-size:.9rem;margin:0 0 1.25rem}
    label{display:block;margin:.75rem 0 .25rem;font-size:.85rem}
    input{width:100%;padding:.65rem .75rem;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;box-sizing:border-box}
    button{margin-top:1.25rem;width:100%;padding:.75rem;background:#3b82f6;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer}
    button:hover{background:#2563eb}
  </style>
</head>
<body>
  <form method="post" action="/oauth/login">
    <h1>AiChart Trading MCP</h1>
    <p>سجّل دخول <strong>حسابك في AiChart</strong> للربط مع Claude (بعد موافقة الإدارة).</p>
    ${err}
    <input type="hidden" name="pending" value="${escapeHtml(pending)}"/>
    <label for="email">البريد</label>
    <input id="email" name="email" type="email" required autocomplete="username"/>
    <label for="password">كلمة المرور</label>
    <input id="password" name="password" type="password" required autocomplete="current-password"/>
    <button type="submit">تسجيل الدخول والموافقة</button>
  </form>
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
    const pending = String(req.query.pending ?? "");
    if (!pending || !provider.pending.has(pending)) {
      res.status(400).send("جلسة OAuth غير صالحة أو منتهية.");
      return;
    }
    const errQuery = String(req.query.error ?? "");
    const err =
      errQuery === "expired"
        ? "انتهت صلاحية حسابك أو الجلسة. سجّل الدخول مجدداً."
        : undefined;
    res.type("html").send(loginPage(pending, err));
  });

  app.post("/oauth/login", async (req: Request, res: Response) => {
    const pending = String(req.body?.pending ?? "");
    const email = String(req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!pending || !email || !password) {
      res.status(400).send(loginPage(pending, "جميع الحقول مطلوبة."));
      return;
    }
    if (!provider.pending.has(pending)) {
      res.status(400).send("جلسة OAuth غير صالحة أو منتهية.");
      return;
    }
    const result = await provider.verifyPlatformUser(email, password);
    if (!result.ok) {
      res
        .type("html")
        .send(loginPage(pending, mcpLoginErrorMessage(result.reason)));
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
