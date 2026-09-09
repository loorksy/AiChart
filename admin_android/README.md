# Lonora Admin — Android WebView shell

A thin Kotlin wrapper. It is **not** a native rewrite of the admin console.
The WebView loads the live origin:

```
https://aichart.lork.cloud/admin-app/?app=1
```

That origin is required. Admin login uses relative `/api/admin/*`, the
`aichart_session` cookie, and a Bearer JWT. `file://` or a fake host breaks
sign-in.

- Package: `cloud.lork.lonora.admin`
- Current: `versionCode 2` / `versionName 1.0.1`
- Update check: `https://aichart.lork.cloud/admin-android/version.json`
- Download URL: `/admin-android/lonora-admin.apk`

## Build

Needs an Android SDK (`ANDROID_HOME` or `~/android-sdk` / `/opt/android-sdk`)
and a release keystore at `keystore/lonora-admin.jks` plus
`keystore/keystore.properties` (see `keystore/keystore.properties.example`).

```bash
# from the repo root
./infra/build-admin-android.sh
```

That runs `./gradlew assembleRelease` and copies the signed APK to
`public/admin-android/lonora-admin.apk`.

## Deploy

After a new APK is built:

1. Copy `public/admin-android/lonora-admin.apk` to
   `/opt/aichart/public/admin-android/lonora-admin.apk` (or run the build
   script on the VPS if the SDK is installed there).
2. Bump `versionCode` / `versionName` in `app/build.gradle.kts` **and** in
   `public/admin-android/version.json` so already-installed apps show
   «يوجد تحديث».
3. Rebuild the Flutter admin (`infra/build-admin-app.sh`) so the Overview
   download card stays in the served bundle.
4. Restart the web process as usual (`infra/vps-pull-deploy.sh` already
   rebuilds the Flutter console; the APK step is best-effort and will not
   abort the deploy if the Android SDK is missing).

`minVersionCode` is optional force. Keep it `<=` every build you still
want operators to be able to dismiss, or they get locked out.

## Sideload notes

Operators must allow installs from the browser / unknown sources. Play
Protect may warn on an unsigned-from-Play package. Cookies work because
the WebView is on the real HTTPS origin.
