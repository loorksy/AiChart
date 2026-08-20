import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  SETTINGS_ROOT,
  isSettingsSectionSlug,
  isSettingsPath,
  settingsPath,
  settingsTabFromLegacyQuery,
  settingsTabFromPathname,
  settingsTabFromSlug,
} from "@/lib/settings/paths";

const SRC = path.join(import.meta.dirname, "..", "..", "..");

describe("settings paths", () => {
  it("gives every section its own URL under /console/settings", () => {
    assert.equal(SETTINGS_ROOT, "/console/settings");
    assert.equal(settingsPath("profile"), "/console/settings/account");
    assert.equal(settingsPath("appearance"), "/console/settings/appearance");
    assert.equal(settingsPath("integrations"), "/console/settings/connections");
    assert.equal(settingsPath("skills"), "/console/settings/skills");
  });

  it("maps public slugs and legacy tab query names", () => {
    assert.equal(isSettingsSectionSlug("connections"), true);
    assert.equal(isSettingsSectionSlug("profile"), false);
    assert.equal(settingsTabFromSlug("connections"), "integrations");
    assert.equal(settingsTabFromLegacyQuery("integrations"), "integrations");
    assert.equal(settingsTabFromLegacyQuery("connections"), "integrations");
    assert.equal(settingsTabFromLegacyQuery("subscription"), "profile");
    assert.equal(settingsTabFromLegacyQuery("nope"), null);
  });

  it("reads the section from /console/settings/<slug>", () => {
    assert.equal(settingsTabFromPathname("/console/settings/account"), "profile");
    assert.equal(settingsTabFromPathname("/console/settings/connections"), "integrations");
    assert.equal(settingsTabFromPathname("/console/settings"), "profile");
    assert.equal(settingsTabFromPathname("/chat"), null);
  });

  it("the settings overlay tabs are real paths; embed mode still uses buttons", () => {
    const client = readFileSync(
      path.join(SRC, "components/SettingsClient.tsx"),
      "utf8",
    );
    assert.match(client, /href=\{settingsPath\(item\.id\)\}/);
    assert.match(client, /data-testid="settings-modal"/);
    assert.match(client, /embedMode/);
    assert.doesNotMatch(client, /\?tab=/);
    assert.match(client, /replace/);
    assert.match(client, /takeSettingsReturn/);
    assert.doesNotMatch(client, /router\.back\(/);
  });

  it("treats console and legacy settings URLs as settings paths", () => {
    assert.equal(isSettingsPath("/console/settings"), true);
    assert.equal(isSettingsPath("/console/settings/connections"), true);
    assert.equal(isSettingsPath("/settings/account"), true);
    assert.equal(isSettingsPath("/chat"), false);
    assert.equal(isSettingsPath("/recommendations"), false);
  });
});
