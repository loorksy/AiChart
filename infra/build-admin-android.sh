#!/usr/bin/env bash
# Build the Lonora admin WebView APK and publish it under /admin-android/.
#
# The APK is a thin shell; the console itself is still the Flutter web app
# at /admin-app/. This script is optional at deploy time: a missing Android
# SDK must not abort a web deploy. First-time download after a deploy needs
# the file at public/admin-android/lonora-admin.apk (copy it there, or run
# this script on a host that has the SDK).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/admin_android"
OUT_DIR="$ROOT/public/admin-android"
OUT_APK="$OUT_DIR/lonora-admin.apk"
COPY_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --copy-only) COPY_ONLY=1 ;;
  esac
done

mkdir -p "$OUT_DIR"

resolve_sdk() {
  if [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME" ]]; then
    echo "$ANDROID_HOME"
    return
  fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "$ANDROID_SDK_ROOT" ]]; then
    echo "$ANDROID_SDK_ROOT"
    return
  fi
  for candidate in /opt/android-sdk "$HOME/android-sdk" /usr/lib/android-sdk; do
    if [[ -d "$candidate/platforms" || -d "$candidate/cmdline-tools" ]]; then
      echo "$candidate"
      return
    fi
  done
  return 1
}

copy_built_apk() {
  local built
  built="$(ls -1t "$APP"/app/build/outputs/apk/release/*.apk 2>/dev/null | head -1 || true)"
  if [[ -z "$built" || ! -f "$built" ]]; then
    return 1
  fi
  cp -f "$built" "$OUT_APK"
  echo "copied $(basename "$built") → $OUT_APK ($(du -h "$OUT_APK" | cut -f1))"
}

if [[ "$COPY_ONLY" -eq 1 ]]; then
  if copy_built_apk; then
    exit 0
  fi
  if [[ -f "$OUT_APK" ]]; then
    echo "APK already at $OUT_APK"
    exit 0
  fi
  echo "no release APK to copy" >&2
  exit 1
fi

SDK="$(resolve_sdk || true)"
if [[ -z "${SDK:-}" ]]; then
  echo "Android SDK not found (ANDROID_HOME / /opt/android-sdk / ~/android-sdk)." >&2
  if [[ -f "$OUT_APK" ]]; then
    echo "keeping existing $OUT_APK" >&2
    exit 0
  fi
  exit 1
fi

export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"

if [[ ! -f "$APP/local.properties" ]]; then
  printf 'sdk.dir=%s\n' "$SDK" > "$APP/local.properties"
fi

if [[ ! -f "$APP/keystore/keystore.properties" ]]; then
  echo "missing $APP/keystore/keystore.properties — cannot sign a release APK" >&2
  exit 1
fi

if [[ ! -x "$APP/gradlew" ]]; then
  echo "admin_android/gradlew is missing" >&2
  exit 1
fi

echo "→ assembleRelease (SDK=$SDK)"
(cd "$APP" && ./gradlew --no-daemon assembleRelease)

copy_built_apk

if [[ ! -f "$OUT_DIR/version.json" ]]; then
  cat > "$OUT_DIR/version.json" <<'JSON'
{
  "versionCode": 1,
  "versionName": "1.0.0",
  "apkUrl": "/admin-android/lonora-admin.apk",
  "minVersionCode": 1
}
JSON
fi

echo "done — /admin-android/lonora-admin.apk"
