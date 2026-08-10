import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { computeSessionHours, METER_ROLL_MS } from "../lifecycle";

/**
 * Always-on has no undeploy at all, anywhere in this module. Billing used to
 * live INSIDE the undeploy — closeDeploySession only ran from undeployAccount
 * — so removing the undeploy without replacing that would have stopped the
 * meter entirely: an account up 24/7 and charged for none of it, against a
 * cost model whose whole premise is that the owner never pays out of pocket.
 *
 * The sweep rolls the meter instead: close the open session, bill what it
 * accrued, open a fresh one, never touch the deployment. There is no config
 * flag or branch that can fall back to undeploying — always-on is
 * unconditional.
 */

const LIFECYCLE = readFileSync(new URL("../lifecycle.ts", import.meta.url), "utf8");

describe("an always-on account still bills", () => {
  it("has no undeploy path left anywhere in the module", () => {
    assert.ok(
      !LIFECYCLE.includes("undeployAccount"),
      "there must be no function left that can take a deployment down",
    );
    assert.ok(
      !LIFECYCLE.includes("shouldUndeploy"),
      "there must be no idle decision left to make — always-on is unconditional",
    );
    assert.ok(
      !LIFECYCLE.includes("metaapiAlwaysOn"),
      "always-on must not be behind a togglable flag — it is the only behaviour",
    );
  });

  it("the sweep unconditionally rolls the meter and keeps deployments up", () => {
    const sweep = LIFECYCLE.slice(LIFECYCLE.indexOf("export async function sweepIdleDeployments"));
    const body = sweep.slice(sweep.indexOf("{"));
    assert.ok(
      body.includes("rollOpenDeploySessions"),
      "the sweep must roll the meter — a bare `return 0` bills nothing, forever",
    );
    assert.ok(
      body.includes("ensureAlwaysOnDeployed"),
      "the sweep must also bring a parked account back, or it waits on presence after all",
    );
  });

  it("closes and reopens rather than undeploying", () => {
    const roll = LIFECYCLE.slice(
      LIFECYCLE.indexOf("export async function rollOpenDeploySessions"),
      LIFECYCLE.indexOf("export async function sweepIdleDeployments"),
    );
    assert.ok(roll.includes("closeDeploySession"), "the roll must bill the accrued hours");
    assert.ok(roll.includes("openDeploySession"), "and must restart the meter");
    assert.ok(
      !roll.includes("undeployAccount"),
      "rolling the meter must never take the connection down — that is the point",
    );
  });

  it("rolls on the hour, so an open session cannot accrue unbounded unbilled time", () => {
    assert.equal(METER_ROLL_MS, 3_600_000);
  });

  it("recognises an already-deployed row and leaves it alone", () => {
    /*
     * mt_accounts.state is written lowercase by deployAccount. "DEPLOYED" is
     * the SDK account object's state — same word, different object. Comparing
     * a row against the SDK spelling matches nothing, so the sweep redeployed
     * a live account every five minutes and never noticed.
     */
    const written = LIFECYCLE.match(/SET state = '([a-z_]+)' WHERE user_id/)?.[1];
    assert.equal(written, "deployed", "deployAccount writes the lowercase value");

    const ensure = LIFECYCLE.slice(
      LIFECYCLE.indexOf("export async function ensureAlwaysOnDeployed"),
      LIFECYCLE.indexOf("export const METER_ROLL_MS"),
    );
    assert.ok(
      !/state === "DEPLOYED"/.test(ensure),
      "the row check must not compare against the SDK's spelling",
    );
    assert.match(
      ensure,
      /state\?\.toLowerCase\(\) === "deployed"/,
      "skip rows the column already calls deployed",
    );
  });

  it("does not keep a meter running for an account the user re-linked away from", () => {
    /*
     * Relinking creates a NEW MetaApi account and leaves the previous session
     * open. Rolling every open session forward kept those dead meters alive:
     * production had three open sessions on one user, two of them for accounts
     * that were not deployed and that MetaApi was not charging for either.
     */
    const roll = LIFECYCLE.slice(
      LIFECYCLE.indexOf("export async function rollOpenDeploySessions"),
      LIFECYCLE.indexOf("export async function sweepIdleDeployments"),
    );
    assert.match(
      roll,
      /LEFT JOIN mt_accounts/,
      "the roll must know which account is actually linked",
    );
    assert.match(
      roll,
      /current_account_id !== session\.account_id/,
      "a session for any other account is stale",
    );
    assert.match(
      roll,
      /hours = 0, retail_usd = 0/,
      "a stale meter charges nothing — there was no deployment behind it",
    );
    // And it must not be reopened: the `continue` has to come before the roll.
    const staleBranch = roll.slice(0, roll.indexOf("METER_ROLL_MS"));
    assert.ok(
      staleBranch.includes("continue"),
      "a stale session must not be reopened after closing",
    );
  });

  it("bills the hours a rolled session actually accrued", () => {
    const start = 1_700_000_000_000;
    // One full roll window, to the minute resolution the meter uses.
    assert.equal(computeSessionHours(start, start + METER_ROLL_MS), 1);
    // A partial window still bills; rolling must not round anything away.
    assert.equal(computeSessionHours(start, start + 30 * 60_000), 0.5);
    assert.equal(computeSessionHours(start, start), 0);
  });
});
