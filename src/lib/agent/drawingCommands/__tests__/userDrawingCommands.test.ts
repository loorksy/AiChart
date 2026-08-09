import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveUserDrawingReference } from "@/lib/agent/drawingCommands/resolveUserDrawingReference";
import { buildUserDrawingMutation } from "@/lib/agent/drawingCommands/modifyUserDrawing";
import {
  buildDeleteUserDrawing,
  buildDeleteAllUserDrawings,
  wantsDeleteAll,
} from "@/lib/agent/drawingCommands/deleteUserDrawing";
import { handleUserDrawingCommand } from "@/lib/agent/drawingCommands/handleUserDrawingCommand";
import { routeIntent } from "@/lib/agent/intentRouter";
import type { AgentChartContext, AgentIntent } from "@/lib/agent/types";
import type { SerializedChartDrawing } from "@/lib/chart/drawings/types";

function drawing(over: Partial<SerializedChartDrawing> = {}): SerializedChartDrawing {
  return {
    id: "d1",
    owner: "user",
    type: "hline",
    symbol: "XAUUSD",
    interval: "15m",
    points: [{ price: 2400 }],
    source: "tradingview",
    ...over,
  };
}

function routes(message: string, chartContext?: AgentChartContext): AgentIntent[] {
  return routeIntent({
    message,
    chartContext,
    ctx: { requestId: "t", emitActivity: () => {}, emitDebug: () => {} },
  });
}

describe("resolveUserDrawingReference", () => {
  it("returns none when there are no user drawings", () => {
    assert.deepEqual(resolveUserDrawingReference({ message: "delete my line", drawings: [] }), {
      kind: "none",
    });
  });

  it("resolves the only user drawing", () => {
    const res = resolveUserDrawingReference({ message: "what about my line", drawings: [drawing()] });
    assert.equal(res.kind, "resolved");
  });

  it("resolves by mentioned price", () => {
    const list = [
      drawing({ id: "draw-1", points: [{ price: 2400 }] }),
      drawing({ id: "draw-2", points: [{ price: 2450 }] }),
    ];
    const res = resolveUserDrawingReference({ message: "move the 2450 line", drawings: list });
    assert.equal(res.kind, "resolved");
    assert.equal(res.kind === "resolved" && res.drawing.id, "draw-2");
  });

  it("is ambiguous for a destructive command with no signal", () => {
    const list = [drawing({ id: "draw-1" }), drawing({ id: "draw-2", points: [{ price: 2500 }] })];
    const res = resolveUserDrawingReference({
      message: "delete my drawing",
      drawings: list,
      requireStrong: true,
    });
    assert.equal(res.kind, "ambiguous");
  });

  it("does NOT fall back to most-recent when requireStrong (safety)", () => {
    const list = [
      drawing({ id: "draw-1", createdAt: 1 }),
      drawing({ id: "draw-2", createdAt: 2, points: [{ price: 2500 }] }),
    ];
    const strong = resolveUserDrawingReference({ message: "احذف رسمي", drawings: list, requireStrong: true });
    assert.equal(strong.kind, "ambiguous");
    const weak = resolveUserDrawingReference({ message: "رأيك في رسمي", drawings: list });
    assert.equal(weak.kind, "resolved"); // discuss can pick most-recent
  });

  it("uses the selection hint for 'this line'", () => {
    const list = [drawing({ id: "draw-1" }), drawing({ id: "draw-2", points: [{ price: 2500 }] })];
    const res = resolveUserDrawingReference({
      message: "what about this line",
      drawings: list,
      selectedDrawingId: "draw-2",
    });
    assert.equal(res.kind === "resolved" && res.drawing.id, "draw-2");
  });
});

describe("buildUserDrawingMutation", () => {
  it("refuses to mutate a non-user drawing", () => {
    const res = buildUserDrawingMutation({ message: "move to 2405", drawing: drawing({ owner: "agent" }) });
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.reason, "wrong_owner");
  });

  it("refuses a wrong-symbol context", () => {
    const res = buildUserDrawingMutation({
      message: "move to 2405",
      drawing: drawing({ symbol: "XAUUSD" }),
      contextSymbol: "EURUSD",
    });
    assert.equal(res.ok === false && res.reason, "wrong_symbol");
  });

  it("moves a line to an explicit price", () => {
    const res = buildUserDrawingMutation({ message: "move it to 2405", drawing: drawing() });
    assert.ok(res.ok);
    assert.equal(res.ok && res.command.mutation.type, "move_level");
    assert.equal(res.ok && res.command.mutation.type === "move_level" && res.command.mutation.price, 2405);
  });

  it("rejects an off-scale price", () => {
    const res = buildUserDrawingMutation({ message: "move it to 5", drawing: drawing() });
    assert.equal(res.ok === false && res.reason, "invalid_price");
  });

  it("resizes a zone from two prices", () => {
    const zone = drawing({ id: "z", type: "zone", points: [{ price: 2400 }, { price: 2420 }] });
    const res = buildUserDrawingMutation({ message: "make the zone 2410 to 2430", drawing: zone });
    assert.ok(res.ok);
    assert.equal(res.ok && res.command.mutation.type, "resize_zone");
  });

  it("updates a label from quoted text", () => {
    const res = buildUserDrawingMutation({ message: 'rename it to "key support"', drawing: drawing() });
    assert.ok(res.ok);
    assert.equal(res.ok && res.command.mutation.type, "update_label");
  });
});

describe("delete safety", () => {
  it("only deletes user-owned drawings", () => {
    const res = buildDeleteUserDrawing({ drawing: drawing({ owner: "recommendation" }) });
    assert.equal(res.ok, false);
  });

  it("deletes a single resolved user drawing", () => {
    const res = buildDeleteUserDrawing({ drawing: drawing() });
    assert.ok(res.ok);
    assert.equal(res.ok && res.commands.length, 1);
    assert.equal(res.ok && res.commands[0]!.mutation.type, "delete");
  });

  it("deleteAll only targets user drawings", () => {
    const list = [
      drawing({ id: "u1", owner: "user" }),
      drawing({ id: "a1", owner: "agent" }),
      drawing({ id: "u2", owner: "user", points: [{ price: 2500 }] }),
    ];
    const res = buildDeleteAllUserDrawings({ drawings: list });
    assert.ok(res.ok);
    assert.deepEqual(
      res.ok && res.commands.map((c) => c.mutation.drawingId).sort(),
      ["u1", "u2"],
    );
  });

  it("wantsDeleteAll matches explicit all-wording only", () => {
    assert.equal(wantsDeleteAll("delete all my drawings"), true);
    assert.equal(wantsDeleteAll("احذف كل رسوماتي"), true);
    assert.equal(wantsDeleteAll("delete my line"), false);
  });
});

describe("intent routing — user drawings never become trades", () => {
  it("routes an edit of a user drawing away from execution", () => {
    const intents = routes("عدّل خطي إلى 2405");
    assert.ok(intents.includes("modify_user_drawing"));
    assert.ok(!intents.includes("trade_execution"));
    assert.ok(!intents.includes("new_trade_analysis"));
  });

  it("routes delete of a user drawing, not a trade close", () => {
    const intents = routes("احذف رسمي");
    assert.ok(intents.includes("delete_user_drawing"));
    assert.ok(!intents.includes("trade_execution"));
  });

  it("routes discussion of a user drawing", () => {
    const intents = routes("شو رأيك في خطي");
    assert.ok(intents.includes("discuss_user_drawing"));
    assert.ok(!intents.includes("new_trade_analysis"));
  });

  it("routes move of a user drawing", () => {
    const intents = routes("حرّك خطي");
    assert.ok(intents.includes("move_user_drawing"));
    assert.ok(!intents.includes("trade_management"));
  });

  it("still routes a plain execution request as a trade", () => {
    const intents = routes("نفذ صفقة شراء ذهب");
    assert.ok(intents.includes("trade_execution"));
    assert.ok(!intents.includes("modify_user_drawing"));
  });
});

describe("handleUserDrawingCommand", () => {
  const base: AgentChartContext = {
    symbol: "XAUUSD",
    interval: "15m",
    latestCandle: { time: Date.now(), close: 2401, symbol: "XAUUSD", interval: "15m" },
    userDrawings: [drawing()],
  };

  it("returns none_found when there are no user drawings", async () => {
    const res = await handleUserDrawingCommand({
      intents: ["discuss_user_drawing"],
      userMessage: "رأيك في خطي",
      chartContext: { ...base, userDrawings: [] },
      locale: "en",
    });
    assert.equal(res.decision, "informational");
    assert.ok(res.summary.length > 0);
    assert.equal(res.drawingMutations, undefined);
  });

  it("delete produces a single delete mutation for the resolved drawing", async () => {
    const res = await handleUserDrawingCommand({
      intents: ["delete_user_drawing"],
      userMessage: "delete my line",
      chartContext: base,
      locale: "en",
    });
    assert.equal(res.drawingMutations?.length, 1);
    assert.equal(res.drawingMutations![0]!.mutation.type, "delete");
  });

  it("move produces a move_level mutation and never a trade", async () => {
    const res = await handleUserDrawingCommand({
      intents: ["move_user_drawing"],
      userMessage: "move my line to 2405",
      chartContext: base,
      locale: "en",
    });
    assert.equal(res.decision, "informational");
    assert.equal(res.drawingMutations?.length, 1);
    assert.equal(res.drawingMutations![0]!.mutation.type, "move_level");
    assert.equal(res.recommendation, undefined);
  });

  it("ambiguous destructive reference asks for clarification (no mutation)", async () => {
    const res = await handleUserDrawingCommand({
      intents: ["delete_user_drawing"],
      userMessage: "delete my drawing",
      chartContext: {
        ...base,
        userDrawings: [drawing({ id: "draw-1" }), drawing({ id: "draw-2", points: [{ price: 2500 }] })],
      },
      locale: "en",
    });
    assert.equal(res.drawingMutations, undefined);
    assert.ok(res.summary.length > 0);
  });

  it("delete-all only removes user drawings", async () => {
    const res = await handleUserDrawingCommand({
      intents: ["delete_user_drawing"],
      userMessage: "delete all my drawings",
      chartContext: {
        ...base,
        userDrawings: [
          drawing({ id: "u1" }),
          drawing({ id: "u2", points: [{ price: 2500 }] }),
        ],
      },
      locale: "en",
    });
    assert.equal(res.drawingMutations?.length, 2);
  });

  it("discuss returns text with no mutations", async () => {
    const res = await handleUserDrawingCommand({
      intents: ["discuss_user_drawing"],
      userMessage: "what do you think of my line",
      chartContext: base,
      locale: "en",
    });
    assert.equal(res.drawingMutations, undefined);
    assert.ok(res.summary.length > 0);
  });
});
