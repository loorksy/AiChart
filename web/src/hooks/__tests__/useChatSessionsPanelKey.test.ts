import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Regression for a same-day production bug: `SmartChartAgentPanel` used to be
 * keyed on `chat.activeChatId ?? "home"`. Sending the very first message from
 * the bare welcome screen calls `ensureChat()`, which mints a chat and sets
 * `activeChatId` — flipping that key mid-send. React then unmounted the panel
 * instance whose `useSmartChartAgent().sendMessage` closure was still
 * in-flight and mounted a fresh one hydrated from `activeMessages`, which
 * `ensureChat` had just reset to `[]`. The result: the user's message and the
 * agent's reply were computed and persisted, but every `setMessages`/
 * `setRunning` call from the orphaned closure landed on an unmounted
 * component — the screen just reset to the empty greeting, while a blank
 * entry appeared in the chat history sidebar. That reads exactly like
 * "switches to a chat history view but no chat is shown."
 *
 * `panelKey` fixes this by only changing when the operator switches to a
 * genuinely different, already-existing conversation (sidebar select, an
 * explicit new chat, or a deep-linked chat hydrating on load) — never when
 * `ensureChat` mints an id for a send already running on the current panel.
 *
 * No RTL/jsdom harness exists in this repo for hook-level remount timing, so
 * this pins the fix at the source level.
 */

const HOOK_SRC = readFileSync(
  path.join(import.meta.dirname, "..", "useChatSessions.ts"),
  "utf8",
);
const WORKSPACE_SRC = readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "..",
    "components",
    "SmartChartWorkspace.tsx",
  ),
  "utf8",
);
const AGENT_SRC = readFileSync(
  path.join(import.meta.dirname, "..", "useSmartChartAgent.ts"),
  "utf8",
);

function fnBody(src: string, marker: string): string {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `could not locate "${marker}" in source`);
  const end = src.indexOf("\n  }, [", start);
  assert.notEqual(end, -1, `could not locate end of "${marker}"`);
  return src.slice(start, end);
}

describe("useChatSessions panelKey", () => {
  it("the workspace keys the agent panel on panelKey, not activeChatId", () => {
    assert.match(WORKSPACE_SRC, /key=\{chat\.panelKey\}/);
    assert.doesNotMatch(WORKSPACE_SRC, /key=\{chat\.activeChatId \?\? "home"\}/);
  });

  it("ensureChat mints a chat without moving panelKey", () => {
    const body = fnBody(HOOK_SRC, "const ensureChat = useCallback");
    assert.doesNotMatch(
      body,
      /setPanelKey\(/,
      "ensureChat must not remount the panel that's already mid-send",
    );
  });

  it("selectChat and newChat DO move panelKey — a real conversation switch", () => {
    const selectBody = fnBody(HOOK_SRC, "const selectChat = useCallback");
    assert.match(selectBody, /setPanelKey\(id\)/);

    const newChatBody = fnBody(HOOK_SRC, "const newChat = useCallback");
    assert.match(newChatBody, /setPanelKey\(session\.id\)/);
  });

  it("a deep-linked chat hydrating on load also sets panelKey", () => {
    assert.match(HOOK_SRC, /setActiveChatId\(active\.id\);\s*\n\s*setPanelKey\(active\.id\);/);
  });

  it("the initial-load effect does not clobber a chat self-minted while it was in flight", () => {
    assert.match(HOOK_SRC, /activeChatIdRef\.current = activeChatId/);
    assert.match(HOOK_SRC, /if \(!activeChatIdRef\.current\) \{\s*\n\s*setActiveChatId\(null\);/);
  });

  /**
   * Found by adversarial review of the panelKey fix above, not the original
   * report: the initial sessions GET can resolve slower than ensureChat's
   * POST, so its stale snapshot (fetched before the self-minted chat
   * existed) can silently drop that chat back out of the sidebar on
   * overwrite — a narrower version of the same "vanishes" symptom, scoped to
   * the history list instead of the transcript.
   */
  it("the initial sessions fetch does not drop a chat self-minted while it was in flight", () => {
    const setSessionsCall = HOOK_SRC.slice(
      HOOK_SRC.indexOf("setSessions((prev) => {"),
      HOOK_SRC.indexOf("});", HOOK_SRC.indexOf("setSessions((prev) => {")),
    );
    assert.match(setSessionsCall, /mintedId = activeChatIdRef\.current/);
    assert.match(
      setSessionsCall,
      /list\.some\(\(s\) => s\.id === mintedId\)/,
      "must check whether the fetched list is missing the self-minted chat before overwriting",
    );
  });

  /**
   * Also found by adversarial review: ensureChatId (a real network call) was
   * awaited outside any try/catch. A thrown fetch (offline, DNS, reset — not
   * just a non-ok response, which was already handled) unwound sendMessage
   * before it ever appended the user's own message, so the composer had
   * already cleared the input (AgentChatInput clears synchronously on
   * submit) and the typed text just disappeared with no error shown.
   */
  it("sendMessage does not let a thrown ensureChatId reject the whole send", () => {
    const sendMessageBody = AGENT_SRC.slice(
      AGENT_SRC.indexOf("const sendMessage = useCallback"),
      AGENT_SRC.indexOf("abortRef.current?.abort();\n      const controller ="),
    );
    assert.match(sendMessageBody, /try \{\s*\n\s*const ensured = await opts\.ensureChatId\(\)/);
    assert.match(sendMessageBody, /\} catch \{/);
  });
});
