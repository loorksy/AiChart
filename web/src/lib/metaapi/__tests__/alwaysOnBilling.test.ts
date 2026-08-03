import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { computeSessionHours, METER_ROLL_MS } from "../lifecycle";

/**
 * Always-on removed the undeploy. Billing lived INSIDE the undeploy.
 *
 * closeDeploySession is the only place deploy hours turn into a credit burn,
 * and it ran only from undeployAccount. Stopping the undeploy therefore stopped
 * the meter entirely — an account up 24/7 and charged for none of it, against
 * a cost model whose whole premise is that the owner never pays out of pocket.
 *
 * The sweep rolls the meter instead: close the open session, bill what it
 * accrued, open a fresh one, never touch the deployment.
 */

const LIFECYCLE = readFileSync(new URL("../lifecycle.ts", import.meta.url), "utf8");

describe("an always-on account still bills", () => {
  it("routes the always-on branch through the meter roll, not an early return", () => {
    const sweep = LIFECYCLE.slice(LIFECYCLE.indexOf("export async function sweepIdleDeployments"));
    const branch = sweep.slice(sweep.indexOf("metaapiAlwaysOn()"), sweep.indexOf("const open"));
    assert.ok(
      branch.includes("rollOpenDeploySessions"),
      "always-on must roll the meter — a bare `return 0` bills nothing, forever",
    );
    assert.ok(
      branch.includes("ensureAlwaysOnDeployed"),
      "always-on must also bring a parked account back, or it waits on presence after all",
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

  it("bills the hours a rolled session actually accrued", () => {
    const start = 1_700_000_000_000;
    // One full roll window, to the minute resolution the meter uses.
    assert.equal(computeSessionHours(start, start + METER_ROLL_MS), 1);
    // A partial window still bills; rolling must not round anything away.
    assert.equal(computeSessionHours(start, start + 30 * 60_000), 0.5);
    assert.equal(computeSessionHours(start, start), 0);
  });
});
