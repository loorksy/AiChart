#!/usr/bin/env bash
# Build the Flutter admin console and publish it under /admin-app/.
#
# This is the platform's ONLY admin surface. The in-app Next.js panel was
# deleted, so if this bundle is missing or stale, there is no other screen to
# fall back to — treat a failure here as a deploy failure, not a warning.
#
# Where it lands: the built web bundle is copied into the Next.js `public/`
# directory, so `next start` serves it at https://<host>/admin-app/ with no
# nginx change of its own. (If you'd rather nginx served it straight from
# disk, see infra/nginx/aichart-admin-app.conf — the bundle is the same
# either way.)
#
# --base-href /admin-app/ is not optional: without it the bundle asks for
# /main.dart.js at the domain root, every asset 404s, and the operator gets a
# white page with no error.
#
# --pwa-strategy=none is not optional either. Flutter's default ships a
# service worker that caches the app shell and serves it offline-first, so a
# browser that once loaded the console keeps showing THAT build after a
# deploy. An admin console has no use for offline support and every use for
# being current, so no service worker is generated at all and caching is
# plain HTTP, governed by the headers in next.config.ts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/admin_flutter"
OUT="$ROOT/public/admin-app"

if ! command -v flutter >/dev/null 2>&1; then
  echo "flutter not found in PATH — install the SDK or add it (see admin_flutter/README.md)" >&2
  exit 1
fi

echo "→ analyze + test (a broken console must not reach the server)"
(cd "$APP" && flutter pub get && flutter analyze && flutter test)

echo "→ build web"
# Wipe the output first. `flutter build` writes into build/web without
# clearing it, so a file an earlier build produced and this one no longer
# does — flutter_service_worker.js being exactly that — survives and gets
# published as though it were current.
rm -rf "$APP/build/web"
(cd "$APP" && flutter build web --release --base-href /admin-app/ --pwa-strategy=none)

echo "→ publish to $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -r "$APP/build/web/." "$OUT/"

echo "done — /admin-app/ updated ($(du -sh "$OUT" | cut -f1))"
