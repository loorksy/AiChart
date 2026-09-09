# Admin Android artifacts

- `version.json` — fetched by the installed APK on start/resume. Bump
  `versionCode` when a newer APK is published so operators see «يوجد تحديث».
- `lonora-admin.apk` — produced by `infra/build-admin-android.sh` (not always
  committed). Served with MIME `application/vnd.android.package-archive`.

First-time download is the Overview card in `/admin-app/`.
