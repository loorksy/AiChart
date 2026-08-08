import { redirect } from "next/navigation";

/** Legacy route — web chat removed; workspace is the product home. */
export default function ChatRedirectPage() {
  redirect("/workspace");
}
