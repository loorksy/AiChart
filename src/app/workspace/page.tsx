import { redirect } from "next/navigation";

/** Legacy route — the chat surface lives at /chat. */
export default function WorkspaceRedirectPage() {
  redirect("/chat");
}
