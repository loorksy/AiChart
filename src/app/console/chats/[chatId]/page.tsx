import { redirect } from "next/navigation";
import { chatConsoleHref, isValidChatId } from "@/lib/chatUrl";

type PageProps = {
  params: Promise<{ chatId: string }>;
};

/** Pretty share link: `/console/chats/<id>` → canonical `/workspace?chat=<id>`. */
export default async function ChatShareRedirectPage({ params }: PageProps) {
  const { chatId } = await params;
  if (!isValidChatId(chatId)) redirect("/workspace");
  redirect(chatConsoleHref(chatId));
}
