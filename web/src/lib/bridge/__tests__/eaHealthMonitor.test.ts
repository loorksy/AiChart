import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideEaHealthEvent } from "@/lib/eaHealthMonitor";

describe("EA health transition alerts", () => {
  it("emits one outage event when the debounced state becomes offline", () => {
    const event = decideEaHealthEvent("online", "offline", 3);
    assert.equal(event?.type, "ea_offline");
    assert.match(event?.detail ?? "", /3/);
  });

  it("does not repeat an outage event while state stays offline", () => {
    assert.equal(decideEaHealthEvent("offline", "offline", 3), null);
  });

  it("emits recovery only after a recorded outage", () => {
    assert.equal(decideEaHealthEvent(null, "online", 0), null);
    assert.equal(decideEaHealthEvent("offline", "online", 0)?.type, "ea_recovered");
  });
});
