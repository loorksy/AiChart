import { redirect } from "next/navigation";
import { CHAT_QUERY_KEY } from "@/lib/chatUrl";

/**
 * Legacy route — the chat surface lives at /chat. The ?chat= query must
 * survive the hop: dropping it here is what bounced a just-created session
 * back to the empty landing state (the client used to navigate to
 * /workspace?chat=<id> right after the first message).
 */
export default async function WorkspaceRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const chat = params[CHAT_QUERY_KEY];
  const chatId = Array.isArray(chat) ? chat[0] : chat;
  redirect(
    chatId
      ? `/chat?${CHAT_QUERY_KEY}=${encodeURIComponent(chatId)}`
      : "/chat",
  );
}
