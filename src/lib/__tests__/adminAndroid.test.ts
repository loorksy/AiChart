import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO = path.join(import.meta.dirname, "..", "..", "..");

describe("admin Android WebView shell", () => {
  it("version.json is a dismissible v1 manifest on the same origin", () => {
    const file = path.join(REPO, "public", "admin-android", "version.json");
    assert.equal(existsSync(file), true, "public/admin-android/version.json");
    const manifest = JSON.parse(readFileSync(file, "utf8")) as {
      versionCode: number;
      versionName: string;
      apkUrl: string;
      minVersionCode: number;
    };
    assert.equal(manifest.versionCode, 1);
    assert.equal(manifest.versionName, "1.0.0");
    assert.equal(manifest.apkUrl, "/admin-android/lonora-admin.apk");
    // Force is optional and OFF for v1 — operators must be able to dismiss.
    assert.ok(manifest.minVersionCode <= manifest.versionCode);
  });

  it("the APK is served with the Android package MIME", () => {
    const config = readFileSync(path.join(REPO, "next.config.ts"), "utf8");
    assert.match(config, /\/admin-android\/lonora-admin\.apk/);
    assert.match(config, /application\/vnd\.android\.package-archive/);
    assert.match(config, /attachment; filename="lonora-admin\.apk"/);

    const route = readFileSync(
      path.join(REPO, "src", "app", "admin-android", "[file]", "route.ts"),
      "utf8",
    );
    assert.match(route, /application\/vnd\.android\.package-archive/);
    assert.match(route, /lonora-admin\.apk/);
    assert.match(route, /version\.json/);
  });

  it("the WebView loads the real admin origin, not file://", () => {
    const main = readFileSync(
      path.join(
        REPO,
        "admin_android",
        "app",
        "src",
        "main",
        "java",
        "cloud",
        "lork",
        "lonora",
        "admin",
        "MainActivity.kt",
      ),
      "utf8",
    );
    assert.match(main, /https:\/\/aichart\.lork\.cloud\/admin-app\//);
    assert.match(main, /javaScriptEnabled = true/);
    assert.match(main, /domStorageEnabled = true/);
    assert.match(main, /setAcceptThirdPartyCookies/);
    assert.match(main, /onShowFileChooser/);
    assert.doesNotMatch(main, /file:\/\//);
    assert.doesNotMatch(main, /userAgentString\s*=/);
  });
});
