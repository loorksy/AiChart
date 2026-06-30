import { redirect } from "next/navigation";

/** Legacy route — web chat removed; smart chart is the home experience. */
export default function ChatRedirectPage() {
  redirect("/chart");
}
