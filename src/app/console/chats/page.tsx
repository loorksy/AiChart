import { redirect } from "next/navigation";

/**
 * Compatibility: Chat History is no longer a separate product page.
 * Old bookmarks land on Chart and Chat with conversations in the sidebar.
 */
export default function ChatHistoryRedirectPage() {
  redirect("/workspace");
}
