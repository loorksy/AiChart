import { NextResponse, type NextRequest } from "next/server";

/**
 * Security middleware — prevents shared/intermediary caches (CDN, reverse
 * proxy, browser back/forward cache) from ever storing a per-user API
 * response and replaying it to a DIFFERENT user.
 *
 * Every authenticated `/api/*` response carries per-user data keyed only by the
 * session cookie, never by the URL. Without an explicit directive a proxy may
 * cache e.g. `GET /api/conversations/70` by URL alone and serve user A's chat
 * to user B (the classic cross-tenant cache-poisoning leak). We force
 * `private, no-store` and `Vary: Cookie` as a baseline so no layer between the
 * app and the browser can pool one user's data into another's view.
 *
 * The application layer is already user-scoped in SQL; this is defense in depth
 * at the HTTP edge. A route may still set its OWN Cache-Control (e.g. a public,
 * non-sensitive asset) — we only fill in the safe default when absent.
 */
export function proxy(req: NextRequest) {
  const res = NextResponse.next();

  // Only guard API routes; pages have their own caching semantics.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    if (!res.headers.has("Cache-Control")) {
      res.headers.set(
        "Cache-Control",
        "private, no-store, max-age=0, must-revalidate",
      );
    }
    // Ensure any cache that ignores Cache-Control still keys on the session.
    const vary = res.headers.get("Vary");
    if (!vary) {
      res.headers.set("Vary", "Cookie");
    } else if (!/\bcookie\b/i.test(vary)) {
      res.headers.set("Vary", `${vary}, Cookie`);
    }
  }

  return res;
}

export const config = {
  matcher: "/api/:path*",
};
