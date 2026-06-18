import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import type { Response, Request } from "express";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AppConfig } from "../config.js";
import { PgClientsStore } from "./clientStore.js";
import { mintAccessToken, verifyAccessTokenJwt } from "./jwt.js";
import { RefreshTokenStore } from "./refreshStore.js";
import {
  accessTtlDays,
  type PlatformVerifyResult,
} from "./platformAccess.js";

const SESSION_COOKIE = "aichart_mcp_session";
const PENDING_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

interface PendingAuth {
  client: OAuthClientInformationFull;
  params: {
    state?: string;
    scopes?: string[];
    codeChallenge: string;
    redirectUri: string;
    resource?: URL;
  };
  createdAt: number;
}

export class AiChartOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: PgClientsStore;
  private readonly refreshStore: RefreshTokenStore;
  private codes = new Map<
    string,
    {
      client: OAuthClientInformationFull;
      params: PendingAuth["params"];
      email: string;
      accessExpiresAt: string | null;
    }
  >();
  readonly pending = new Map<string, PendingAuth>();

  constructor(private readonly cfg: AppConfig) {
    this.clientsStore = new PgClientsStore();
    this.refreshStore = new RefreshTokenStore(cfg.refreshTokenTtlDays);
  }

  private async issueTokenPair(
    clientId: string,
    email: string,
    scopes: string[],
    resource: URL | undefined,
    accessExpiresAt: string | null,
  ): Promise<OAuthTokens> {
    const ttlDays = accessTtlDays(
      accessExpiresAt,
      this.cfg.accessTokenTtlDays,
    );
    const { token, expiresAtSec } = await mintAccessToken(
      this.cfg.authSecret,
      {
        email,
        clientId,
        scopes,
        resource: resource?.href,
      },
      ttlDays,
    );
    const refresh = await this.refreshStore.issue(clientId, email, scopes);
    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: Math.max(0, expiresAtSec - Math.floor(Date.now() / 1000)),
      refresh_token: refresh.raw,
      scope: scopes.join(" "),
    };
  }

  private async checkPlatformAccess(email: string): Promise<PlatformVerifyResult> {
    const res = await fetch(`${this.cfg.apiUrl}/api/admin/mcp-auth/check-access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-Auth-Secret": this.cfg.authSecret,
      },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as PlatformVerifyResult & {
      access_expires_at?: string | null;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, reason: data.reason ?? "invalid" };
    }
    return {
      ok: true,
      email: data.email ?? email,
      accessExpiresAt: data.access_expires_at ?? null,
    };
  }

  async verifyPlatformUser(
    email: string,
    password: string,
  ): Promise<PlatformVerifyResult> {
    const res = await fetch(`${this.cfg.apiUrl}/api/admin/mcp-auth/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-Auth-Secret": this.cfg.authSecret,
      },
      body: JSON.stringify({ email, password }),
    });
    const data = (await res.json()) as PlatformVerifyResult & {
      access_expires_at?: string | null;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, reason: data.reason ?? "invalid" };
    }
    return {
      ok: true,
      email: data.email ?? email,
      accessExpiresAt: data.access_expires_at ?? null,
    };
  }

  /** @deprecated use verifyPlatformUser */
  async verifyAdmin(email: string, password: string): Promise<boolean> {
    const r = await this.verifyPlatformUser(email, password);
    return r.ok;
  }

  signSession(email: string): string {
    const payload = `${email}:${Date.now()}`;
    const sig = createHmac("sha256", this.cfg.authSecret)
      .update(payload)
      .digest("hex");
    return Buffer.from(`${payload}:${sig}`).toString("base64url");
  }

  verifySession(cookie: string | undefined): string | null {
    if (!cookie) return null;
    try {
      const decoded = Buffer.from(cookie, "base64url").toString("utf8");
      const lastColon = decoded.lastIndexOf(":");
      if (lastColon <= 0) return null;
      const payload = decoded.slice(0, lastColon);
      const sig = decoded.slice(lastColon + 1);
      const expected = createHmac("sha256", this.cfg.authSecret)
        .update(payload)
        .digest("hex");
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const email = payload.split(":")[0];
      const ts = Number(payload.split(":")[1]);
      if (!email || !Number.isFinite(ts)) return null;
      if (Date.now() - ts > SESSION_TTL_MS) return null;
      return email;
    } catch {
      return null;
    }
  }

  sessionCookieOptions(secure: boolean) {
    return {
      httpOnly: true,
      secure,
      sameSite: "lax" as const,
      maxAge: this.cfg.sessionCookieMaxAgeMs,
      path: "/",
    };
  }

  issueCode(
    client: OAuthClientInformationFull,
    params: PendingAuth["params"],
    email: string,
    accessExpiresAt: string | null,
  ): string {
    const code = randomUUID();
    this.codes.set(code, { client, params, email, accessExpiresAt });
    return code;
  }

  redirectWithCode(
    res: Response,
    client: OAuthClientInformationFull,
    params: PendingAuth["params"],
    email: string,
    accessExpiresAt: string | null,
  ) {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }
    const code = this.issueCode(client, params, email, accessExpiresAt);
    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state !== undefined) {
      target.searchParams.set("state", params.state);
    }
    res.redirect(target.toString());
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: PendingAuth["params"],
    res: Response,
  ): Promise<void> {
    const sessionEmail = this.verifySession(
      (res.req as Request).cookies?.[SESSION_COOKIE],
    );
    if (sessionEmail) {
      const access = await this.checkPlatformAccess(sessionEmail);
      if (access.ok) {
        this.redirectWithCode(
          res,
          client,
          params,
          sessionEmail,
          access.accessExpiresAt ?? null,
        );
        return;
      }
    }
    const pendingId = randomUUID();
    this.pending.set(pendingId, {
      client,
      params,
      createdAt: Date.now(),
    });
    res.redirect(`/oauth/login?pending=${pendingId}`);
  }

  completePendingLogin(
    pendingId: string,
    email: string,
    accessExpiresAt: string | null,
    res: Response,
  ) {
    const pending = this.pending.get(pendingId);
    if (!pending) {
      throw new InvalidRequestError("انتهت صلاحية جلسة الدخول.");
    }
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
      this.pending.delete(pendingId);
      throw new InvalidRequestError("انتهت صلاحية جلسة الدخول.");
    }
    this.pending.delete(pendingId);
    this.redirectWithCode(
      res,
      pending.client,
      pending.params,
      email,
      accessExpiresAt,
    );
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) throw new Error("Invalid authorization code");
    return codeData.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) throw new Error("Invalid authorization code");
    if (codeData.client.client_id !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }
    this.codes.delete(authorizationCode);
    const scopes = codeData.params.scopes ?? ["mcp:tools"];
    return this.issueTokenPair(
      client.client_id,
      codeData.email,
      scopes,
      codeData.params.resource,
      codeData.accessExpiresAt,
    );
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = await this.refreshStore.consume(refreshToken);
    if (!record) throw new Error("Invalid or expired refresh token");
    if (record.clientId !== client.client_id) {
      throw new Error("Refresh token was not issued to this client");
    }
    const access = await this.checkPlatformAccess(record.email);
    if (!access.ok) {
      throw new Error("Platform access revoked or expired");
    }
    const effectiveScopes =
      scopes && scopes.length > 0 ? scopes : record.scopes;
    return this.issueTokenPair(
      client.client_id,
      record.email,
      effectiveScopes,
      resource,
      access.accessExpiresAt ?? null,
    );
  }

  async verifyAccessToken(token: string): Promise<import("@modelcontextprotocol/sdk/server/auth/types.js").AuthInfo> {
    return verifyAccessTokenJwt(this.cfg.authSecret, token);
  }
}

export { SESSION_COOKIE };
