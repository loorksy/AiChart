import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  SETTINGS_ROOT,
  isSettingsSectionSlug,
  settingsPath,
  settingsTabFromLegacyQuery,
  settingsTabFromSlug,
} from "@/lib/settings/paths";

const SRC = path.join(import.meta.dirname, "..", "..", "..");

describe("settings paths", () => {
  it("gives every section its own URL under /console/settings", () => {
    assert.equal(SETTINGS_ROOT, "/console/settings");
    assert.equal(settingsPath("profile"), "/console/settings/account");
    assert.equal(settingsPath("alerts"), "/console/settings/alerts");
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

  it("the settings page tabs are paths; the overlay still uses buttons", () => {
    const client = readFileSync(
      path.join(SRC, "components/SettingsClient.tsx"),
      "utf8",
    );
    assert.match(client, /href=\{settingsPath\(item\.id\)\}/);
    assert.match(client, /if \(!embedMode\)/);
    assert.match(client, /onClick=\{\(\) => \{[\s\S]*setTab\(item\.id\)/);
    assert.doesNotMatch(client, /\?tab=/);
  });
});
