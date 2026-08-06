import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reported in production: clicking "new chat" in the sidebar immediately
 * created and persisted a chat row — POST /api/agent/chats fired before the
 * operator typed anything — so an empty conversation appeared in the history
 * list for every "new chat" click, used or not. The bare `/workspace`
 * landing already avoids this (N19: no chat minted until the operator
 * sends, via the lazy `ensureChat`); the explicit "new chat" button was the
 * one path still creating eagerly.
 *
 * Fix: `newChat` now just returns to that same bare/lazy state — reset
 * local state, clear the URL — and relies on `ensureChat` to mint the row
 * on the first actual send, exactly like the bare landing does.
 *
 * No RTL/jsdom harness exists in this repo for hook behavior, so this pins
 * the fix at the source level.
 */

const HOOK_SRC = readFileSync(
  path.join(import.meta.dirname, "..", "useChatSessions.ts"),
  "utf8",
);
const URL_SRC = readFileSync(
  path.join(import.meta.dirname, "..", "useConsoleChatUrl.ts"),
  "utf8",
);

function fnBody(src: string, marker: string): string {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `could not locate "${marker}" in source`);
  const end = src.indexOf("\n  }, [", start);
  assert.notEqual(end, -1, `could not locate end of "${marker}"`);
  return src.slice(start, end);
}

describe("useChatSessions newChat is lazy", () => {
  it("newChat does not create a chat row", () => {
    const body = fnBody(HOOK_SRC, "const newChat = useCallback");
    assert.doesNotMatch(
      body,
      /createChat\(/,
      "clicking new chat must not POST /api/agent/chats before the operator sends anything",
    );
  });

  it("newChat resets to the bare/home state", () => {
    const body = fnBody(HOOK_SRC, "const newChat = useCallback");
    assert.match(body, /setActiveChatId\(null\)/);
    assert.match(body, /setPanelKey\("home"\)/);
    assert.match(body, /syncChatUrl\?\.\(null, "push"\)/);
  });

  it("syncChatUrl clears the URL back to the bare workspace on null", () => {
    assert.match(URL_SRC, /chatId: string \| null/);
    assert.match(
      URL_SRC,
      /chatId \? chatConsoleHref\(chatId\) : WORKSPACE_HOME_HREF/,
    );
  });
});
